from concurrent.futures import ThreadPoolExecutor
from datetime import date
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from django.test import TestCase, override_settings
from redis.exceptions import RedisError
from rest_framework.test import APIClient

from apps.accounts.models import User, Customer, RefreshToken
from apps.accounts.security.state import _challenge_key, _latest_key, _digest, VERIFY_SCRIPT
from apps.accounts.security.state import get_redis_client
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.accounts.services.doctor_services.registration import create_doctor_account


@override_settings(DEBUG=True, AUTH_CONSOLE_SMS=True,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CustomerSignupTests(TestCase):
    """Integration tests: isolated Redis keys and Django's separate test database."""
    def setUp(self):
        self.prefix = f"have:test:signup:{uuid4().hex}:"
        override = override_settings(AUTH_REDIS_PREFIX=self.prefix)
        override.enable()
        self.addCleanup(override.disable)
        self.redis = get_redis_client()
        self.redis.ping()
        self.addCleanup(self.clear_keys)
        delivery = patch("apps.accounts.services.customer_services.signup._deliver_sms")
        self.sms = delivery.start()
        self.addCleanup(delivery.stop)
        self.client = APIClient(enforce_csrf_checks=True)
        self.data = {
            "first_name": "  Ahmed  ", "last_name": "Sherif", "phone_number": "01012345678",
            "email": "Customer@Example.test", "date_of_birth": "24-01-2005", "pin": "4826",
        }

    def clear_keys(self):
        keys = list(self.redis.scan_iter(match=self.prefix + "*"))
        if keys:
            self.redis.delete(*keys)

    def start_signup(self, **changes):
        return self.client.post("/api/v1/auth/customers/signup/", self.data | changes, format="json")

    def verify(self, challenge, **changes):
        return self.client.post("/api/v1/auth/customers/signup/verify/", {
            "challenge_id": challenge,
            "phone_number": self.data["phone_number"],
            "code": self.sms.call_args.kwargs["code"],
        } | changes, format="json")

    def expire_cooldown(self):
        for key in self.redis.scan_iter(match=self.prefix + "signup:cooldown:*"):
            self.redis.delete(key)

    def test_full_signup_bound_payload_normalization_and_no_login(self):
        response = self.start_signup()
        self.assertEqual(response.status_code, 202)
        challenge = response.json()["challenge_id"]
        self.assertFalse(User.objects.exists())
        stored = self.redis.hgetall(_challenge_key(challenge))
        self.assertNotIn('"pin":', stored["payload"])
        self.assertNotEqual(stored["code_hash"], self.sms.call_args.kwargs["code"])
        self.assertGreater(self.redis.ttl(_challenge_key(challenge)), 0)
        self.assertNotIn("code", response.json())
        response = self.verify(challenge, first_name="Attacker", account_type="OWNER")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["first_name"], "Ahmed")
        self.assertEqual(response.json()["account_type"], "CUSTOMER")
        self.assertEqual(response.json()["date_of_birth"], "24-01-2005")
        user = User.objects.get()
        self.assertEqual(user.phone_number, "+201012345678")
        self.assertEqual(user.email, "customer@example.test")
        self.assertTrue(user.pk.startswith("HAV-C678-"))
        self.assertTrue(user.check_password("4826"))
        self.assertIsNotNone(user.phone_verified_at)
        self.assertEqual(Customer.objects.count(), 1)
        self.assertFalse(RefreshToken.objects.exists())
        self.assertNotIn("sessionid", response.cookies)
        self.assertFalse(self.redis.exists(_challenge_key(challenge)))
        self.assertEqual(self.verify(challenge).status_code, 400)
        self.assertEqual(User.objects.count(), 1)

    def test_invalid_input_creates_nothing(self):
        for changes in (
            {"pin": "1111"}, {"pin": "1234"}, {"pin": "12345"},
            {"first_name": "أحمد"}, {"phone_number": "123"}, {"email": "invalid"},
            {"date_of_birth": "2005-01-24"}, {"date_of_birth": "31-02-2005"},
            {"date_of_birth": "01-01-2999"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(self.start_signup(**changes).status_code, 400)
        self.sms.assert_not_called()
        self.assertFalse(User.objects.exists())

    def test_wrong_code_attempt_limit(self):
        challenge = self.start_signup().json()["challenge_id"]
        correct = self.sms.call_args.kwargs["code"]
        wrong = "000000" if correct != "000000" else "111111"
        for _ in range(5):
            self.assertEqual(self.verify(challenge, code=wrong).status_code, 400)
        self.assertEqual(self.verify(challenge, code=correct).status_code, 400)
        self.assertFalse(User.objects.exists())

    def test_wrong_code_then_correct(self):
        challenge = self.start_signup().json()["challenge_id"]
        correct = self.sms.call_args.kwargs["code"]
        self.assertEqual(self.verify(challenge, code="000000" if correct != "000000" else "111111").status_code, 400)
        self.assertEqual(self.verify(challenge).status_code, 201)

    def test_expired_code(self):
        challenge = self.start_signup().json()["challenge_id"]
        self.redis.expire(_challenge_key(challenge), 0)
        self.assertEqual(self.verify(challenge).status_code, 400)
        self.assertFalse(User.objects.exists())

    def test_phone_binding(self):
        challenge = self.start_signup().json()["challenge_id"]
        self.assertEqual(self.verify(challenge, phone_number="01112345678").status_code, 400)
        self.assertEqual(self.verify(challenge).status_code, 201)

    def test_resend_replaces_old_challenge(self):
        old = self.start_signup().json()["challenge_id"]
        old_code = self.sms.call_args.kwargs["code"]
        response = self.start_signup()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        self.expire_cooldown()
        new = self.start_signup().json()["challenge_id"]
        self.assertFalse(self.redis.exists(_challenge_key(old)))
        self.assertEqual(self.verify(old, code=old_code).status_code, 400)
        self.assertEqual(self.verify(new).status_code, 201)

    def test_phone_send_limit(self):
        for _ in range(5):
            self.expire_cooldown()
            self.assertEqual(self.start_signup().status_code, 202)
        self.expire_cooldown()
        self.assertEqual(self.start_signup().status_code, 429)

    def test_source_limits(self):
        key = self.prefix + "signup:source:send:" + _digest("127.0.0.1")
        self.redis.set(key, 20, ex=600)
        self.assertEqual(self.start_signup().status_code, 429)
        self.redis.delete(key)
        challenge = self.start_signup().json()["challenge_id"]
        key = self.prefix + "signup:source:verify:" + _digest("127.0.0.1")
        self.redis.set(key, 60, ex=300)
        self.assertEqual(self.verify(challenge).status_code, 429)

    def test_duplicate_phone_or_email_rejected_after_verification(self):
        create_customer_account(first_name="Existing", last_name="Customer", phone_number="01012345678",
                                email="existing@example.test", date_of_birth=date(2000, 1, 1), pin="4826")
        challenge = self.start_signup().json()["challenge_id"]
        self.assertEqual(self.verify(challenge).status_code, 409)
        self.data["phone_number"] = "01112345678"
        challenge = self.start_signup(email="EXISTING@example.test").json()["challenge_id"]
        self.assertEqual(self.verify(challenge).status_code, 409)
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(Customer.objects.count(), 1)

    def test_doctor_can_create_distinct_customer_with_same_contacts(self):
        create_doctor_account(first_name="Doctor", last_name="Example", phone_number="01012345678",
                              email="customer@example.test", password="Orchid-River-Demo-4826!",
                              professional_license_number="SIGNUP-TEST", specialty="General",
                              clinic_name="Clinic", clinic_address="Address")
        challenge = self.start_signup().json()["challenge_id"]
        self.assertEqual(self.verify(challenge).status_code, 201)
        self.assertEqual(User.objects.count(), 2)

    def test_redis_outage_fails_closed(self):
        with patch("apps.accounts.services.customer_services.signup._source_limit", side_effect=RedisError):
            self.assertEqual(self.start_signup().status_code, 503)
        self.assertFalse(User.objects.exists())
        self.sms.assert_not_called()

    def test_delivery_failure_invalidates_challenge(self):
        self.sms.side_effect = OSError("mock delivery failure")
        self.assertEqual(self.start_signup().status_code, 503)
        challenge = self.sms.call_args.kwargs["challenge_id"]
        self.assertFalse(self.redis.exists(_challenge_key(challenge)))

    @override_settings(DEBUG=False)
    def test_console_sms_disabled_outside_local_debug(self):
        self.assertEqual(self.start_signup().status_code, 503)
        self.sms.assert_not_called()

    def test_database_failure_consumes_code_and_creates_nothing(self):
        challenge = self.start_signup().json()["challenge_id"]
        with patch("apps.accounts.services.customer_services.signup._create_customer_from_validated_data", side_effect=DatabaseError):
            self.assertEqual(self.verify(challenge).status_code, 503)
        self.assertEqual(self.verify(challenge).status_code, 400)
        self.assertFalse(User.objects.exists())

    def test_concurrent_verification_can_consume_code_only_once(self):
        challenge = self.start_signup().json()["challenge_id"]
        digest = _digest(f"{challenge}:{self.sms.call_args.kwargs['code']}")
        challenge_key = _challenge_key(challenge)
        latest_key = _latest_key("+201012345678")

        def consume(_):
            return self.redis.eval(VERIFY_SCRIPT, 2, challenge_key, latest_key, digest, 5)

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(consume, range(4)))
        self.assertEqual(sum(bool(result) for result in results), 1)

    def test_verification_redis_failure_preserves_pending_challenge(self):
        challenge = self.start_signup().json()["challenge_id"]
        with patch("apps.accounts.services.customer_services.signup._source_limit", side_effect=RedisError):
            self.assertEqual(self.verify(challenge).status_code, 503)
        self.assertFalse(User.objects.exists())
        self.assertEqual(self.verify(challenge).status_code, 201)
