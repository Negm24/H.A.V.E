from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from apps.accounts.security.errors import AuthError, SignupError
from apps.accounts.services.customer_services.signup import request_customer_signup
from apps.accounts.services.doctor_services.signup import request_doctor_signup
from apps.accounts.services.shared_services.notifications import send_verification_sms


class MockSmsConfigurationTests(SimpleTestCase):
    def test_sms_opt_in_is_independent_of_debug(self):
        for debug in (False, True):
            for enabled in (False, True):
                with self.subTest(debug=debug, enabled=enabled), override_settings(
                    DEBUG=debug, AUTH_CONSOLE_SMS=enabled,
                ), patch("builtins.print") as console:
                    data = dict(purpose="TEST", challenge_id="test-challenge",
                                phone_number="+201099999999", code="482639")
                    if enabled:
                        send_verification_sms(**data)
                        console.assert_called_once()
                        self.assertIn("code=482639", console.call_args.args[0])
                    else:
                        with self.assertRaises(AuthError) as error:
                            send_verification_sms(**data)
                        self.assertEqual(error.exception.status, 503)
                        console.assert_not_called()

    @override_settings(DEBUG=False, AUTH_CONSOLE_SMS=False)
    def test_disabled_sms_blocks_signup_before_redis_or_database_work(self):
        for signup in (request_customer_signup, request_doctor_signup):
            with self.subTest(signup=signup.__name__), self.assertRaises(SignupError) as error:
                signup(data={}, source="test")
            self.assertEqual(error.exception.status, 503)
            self.assertEqual(error.exception.detail, "SMS delivery is not configured.")
