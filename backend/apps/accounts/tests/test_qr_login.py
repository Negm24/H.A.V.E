from concurrent.futures import ThreadPoolExecutor
from datetime import date
import time
from unittest.mock import patch

from django.db import close_old_connections, DatabaseError
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone
from redis.exceptions import RedisError
from rest_framework.test import APIClient

from apps.accounts.models import User, RefreshToken
from apps.accounts.security.errors import AuthError
from apps.accounts.security.qr_state import qr_key
from apps.accounts.security.challenges import enforce_limit
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.accounts.services.customer_services.hub_sessions import start_hub_session
from apps.accounts.services.customer_services.qr_login import complete_qr
from apps.accounts.services.shared_services.recovery import complete_recovery, request_recovery, verify_recovery
from apps.accounts.tests.helpers import SessionFixtures, HUB, TERM
from apps.terminals.models import Terminal
from apps.accounts.security.tokens import token_hash


class QrFixtures(SessionFixtures):
    def setup_qr(self):
        self.setup_sessions()
        self.access = self.hub_login().json()["access_token"]
        self.hub_headers = {"HTTP_AUTHORIZATION": "Bearer " + self.access}
        self.guest = self.start_guest()
        self.term_headers = self.headers | {"HTTP_AUTHORIZATION": "Bearer " + self.guest}

    def create(self):
        return self.client.post(TERM + "qr-login/", **self.term_headers)

    def scan(self, payload, headers=None):
        return self.client.post(HUB + "qr-login/scan/", {"qr_payload": payload},
            format="json", **(headers or self.hub_headers))

    def confirm(self, qr, approve=True, headers=None):
        return self.client.post(HUB + f"qr-login/{qr['challenge_id']}/confirm/", {"approve": approve},
            format="json", **(headers or self.hub_headers))

    def complete(self, qr, headers=None):
        return self.client.post(TERM + f"qr-login/{qr['challenge_id']}/complete/",
            **(headers or self.term_headers))

    def prepare(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.data)
        qr = response.json()
        self.assertEqual(self.scan(qr["qr_payload"]).status_code, 200)
        self.assertEqual(self.confirm(qr).status_code, 200)
        return qr


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class QrLoginTests(QrFixtures, TestCase):
    def setUp(self):
        self.setup_qr()

    def test_end_to_end_explicit_approval_token_rotation_and_fixed_clock(self):
        started = self.state()["started_at"]
        qr = self.create().json()
        self.assertEqual(qr["status"], "waiting_for_scan")
        self.assertLessEqual(qr["expires_in"], 90)
        self.assertNotIn(qr["qr_payload"], self.redis.get(qr_key(qr["challenge_id"])))
        self.assertEqual(self.complete(qr).status_code, 400)
        scanned = self.scan(qr["qr_payload"])
        self.assertEqual(scanned.status_code, 200, scanned.data)
        self.assertEqual(scanned.json()["terminal"]["serial_number"], self.terminal.pk)
        self.assertEqual(scanned.json()["status"], "waiting_for_confirmation")
        self.assertEqual(self.complete(qr).status_code, 400)
        self.assertEqual(self.confirm(qr).json()["status"], "approved")
        result = self.complete(qr)
        self.assertEqual(result.status_code, 200, result.data)
        token = result.json()["session_token"]
        self.assertNotEqual(token, self.guest)
        self.assertEqual(self.terminal_me(token).status_code, 200)
        self.assertEqual(self.terminal_me(self.guest).status_code, 401)
        self.assertEqual(self.state()["started_at"], started)
        self.assertEqual(RefreshToken.objects.count(), 1)  # only original Hub login
        self.assertEqual(self.complete(qr).status_code, 401)
        status = self.client.get(HUB + f"qr-login/{qr['challenge_id']}/", **self.hub_headers)
        self.assertEqual(status.status_code, 200, status.data)
        self.assertEqual(status.json()["status"], "completed")
        self.assertEqual(self.complete(qr, self.headers | {"HTTP_AUTHORIZATION": "Bearer " + token}).status_code, 400)

    def test_rejection_is_final(self):
        qr = self.create().json()
        self.scan(qr["qr_payload"])
        self.assertEqual(self.confirm(qr, False).json()["status"], "rejected")
        self.assertEqual(self.confirm(qr).status_code, 400)
        self.assertEqual(self.complete(qr).status_code, 400)

    def test_replacement_and_single_scan(self):
        first = self.create().json()
        second = self.create().json()
        self.assertEqual(self.scan(first["qr_payload"]).status_code, 400)
        self.assertEqual(self.scan(second["qr_payload"]).status_code, 200)
        self.assertEqual(self.scan(second["qr_payload"]).status_code, 400)

    def test_wrong_qr_secret_cannot_claim(self):
        qr = self.create().json()
        self.assertEqual(self.scan(qr["challenge_id"] + ".wrong").status_code, 400)
        self.assertEqual(self.scan(qr["qr_payload"]).status_code, 200)

    def test_anonymous_hub_and_customer_terminal_cannot_generate(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.post(HUB + "qr-login/scan/", {"qr_payload": "x"}).status_code, 401)
        token = self.terminal_login(self.guest).json()["session_token"]
        self.assertEqual(self.client.post(TERM + "qr-login/",
            **(self.headers | {"HTTP_AUTHORIZATION": "Bearer " + token})).status_code, 400)
        self.assertEqual(anonymous.post(TERM + "qr-login/").status_code, 401)

    def test_different_hub_family_cannot_confirm_or_read(self):
        qr = self.create().json()
        self.scan(qr["qr_payload"])
        _, _, _, access = start_hub_session(self.user, remember_me=False, previous_token=None,
                                            user_agent="test", ip_address="127.0.0.1")
        other = {"HTTP_AUTHORIZATION": "Bearer " + access["access_token"]}
        self.assertEqual(self.confirm(qr, headers=other).status_code, 403)
        self.assertEqual(self.client.get(HUB + f"qr-login/{qr['challenge_id']}/", **other).status_code, 403)
        self.assertEqual(self.confirm(qr).status_code, 200)

    def test_wrong_terminal_or_restarted_session_cannot_complete(self):
        qr = self.prepare()
        other = Terminal.objects.create(serial_number="QR-OTHER", display_name="Other",
            address_en="Other", address_ar="Other", latitude=30, longitude=31,
            device_credential_hash=token_hash("other-secret"))
        headers = {"HTTP_X_TERMINAL_SERIAL": other.pk, "HTTP_X_TERMINAL_KEY": "other-secret"}
        new = self.client.post("/api/v1/terminals/sessions/", **headers).json()["session_token"]
        self.assertEqual(self.complete(qr, headers | {"HTTP_AUTHORIZATION": "Bearer " + new}).status_code, 403)
        new = self.start_guest()
        self.assertEqual(self.complete(qr, self.headers | {"HTTP_AUTHORIZATION": "Bearer " + new}).status_code, 403)

    def test_qr_expiry_and_guest_expiry_deny_login(self):
        qr = self.prepare()
        self.redis.expire(qr_key(qr["challenge_id"]), 0)
        self.assertEqual(self.complete(qr).status_code, 400)
        qr = self.prepare()
        self.change_state(last_activity_at=time.time() - 1000)
        self.assertEqual(self.confirm(qr).status_code, 400)
        self.assertEqual(self.complete(qr).status_code, 401)

    def test_polling_does_not_renew_activity_or_qr_ttl(self):
        qr = self.prepare()
        state = self.change_state(last_activity_at=time.time() - 30)
        before = self.redis.pttl(qr_key(qr["challenge_id"]))
        for _ in range(2):
            self.assertEqual(self.client.get(HUB + f"qr-login/{qr['challenge_id']}/", **self.hub_headers).status_code, 200)
            response = self.client.get(TERM + f"qr-login/{qr['challenge_id']}/", **self.term_headers)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("customer", response.json())
        self.assertEqual(self.state()["last_activity_at"], state["last_activity_at"])
        self.assertLessEqual(self.redis.pttl(qr_key(qr["challenge_id"])), before)

    def test_disabled_rotated_device_or_disabled_customer_blocks_completion(self):
        qr = self.prepare()
        Terminal.objects.filter(pk=self.terminal.pk).update(is_disabled=True)
        self.assertEqual(self.complete(qr).status_code, 401)
        Terminal.objects.filter(pk=self.terminal.pk).update(is_disabled=False, device_credential_hash=token_hash("rotated"))
        self.assertEqual(self.confirm(qr).status_code, 400)
        Terminal.objects.filter(pk=self.terminal.pk).update(device_credential_hash=self.terminal.device_credential_hash)
        User.objects.filter(pk=self.user.pk).update(is_disabled=True)
        self.assertEqual(self.complete(qr).status_code, 400)

    def test_hub_logout_cancels_pending_terminal_authorization(self):
        qr = self.prepare()
        self.client.post(HUB + "logout/", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(self.complete(qr).status_code, 400)

    @override_settings(DEBUG=True, AUTH_CONSOLE_SMS=True)
    def test_pin_reset_cancels_pending_qr(self):
        qr = self.prepare()
        with patch("apps.accounts.services.shared_services.recovery.send_verification_sms") as sms:
            challenge = request_recovery(account_type="CUSTOMER", phone_number=self.user.phone_number, source="test")
            proof = verify_recovery(account_type="CUSTOMER", phone_number=self.user.phone_number,
                challenge_id=challenge["challenge_id"], code=sms.call_args.kwargs["code"], source="test")
        complete_recovery(account_type="CUSTOMER", reset_token=proof["reset_token"], new_credential="5937", source="test")
        self.assertEqual(self.complete(qr).status_code, 400)

    def test_rate_limits(self):
        for _ in range(10):
            self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create().status_code, 429)

    def test_redis_and_database_failures_deny_login(self):
        qr = self.prepare()
        with patch("apps.accounts.security.qr_state.get_redis_client", side_effect=RedisError):
            self.assertEqual(self.complete(qr).status_code, 503)
        with patch("apps.accounts.services.customer_services.qr_login._family_valid", side_effect=DatabaseError):
            self.assertEqual(self.complete(qr).status_code, 503)
        self.assertEqual(self.complete(qr).status_code, 200)


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class QrConcurrencyTests(QrFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_qr()

    def test_only_one_concurrent_completion_succeeds(self):
        qr = self.prepare()
        session_id = self.state()["session_id"]

        def finish(_):
            close_old_connections()
            try:
                complete_qr(terminal=self.terminal, session_id=session_id, guest_token=self.guest,
                            challenge_id=qr["challenge_id"], source="test")
                return "success"
            except AuthError:
                return "denied"
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(finish, range(2)))
        self.assertCountEqual(results, ["success", "denied"])
