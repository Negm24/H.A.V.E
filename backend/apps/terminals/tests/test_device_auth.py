from django.test import TestCase, override_settings

from apps.accounts.security.tokens import token_hash
from apps.terminals.tests.helpers import SessionFixtures


@override_settings(TERMINAL_IDLE_SECONDS=120, TERMINAL_MAX_SECONDS=600,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class DeviceAuthenticationTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    def test_device_credentials_wrong_disabled_rotated(self):
        token = self.terminal_login(self.start_guest()).json()["session_token"]
        self.assertEqual(self.terminal_me(token, headers={}).status_code, 401)
        self.assertEqual(self.terminal_me(token, headers=self.headers | {"HTTP_X_TERMINAL_KEY": "wrong"}).status_code, 401)
        self.terminal.is_disabled = True
        self.terminal.save()
        self.assertEqual(self.terminal_me(token).status_code, 401)
        self.terminal.is_disabled = False
        new_secret = "new-test-device-key"
        self.terminal.device_credential_hash = token_hash(new_secret)
        self.terminal.save()
        self.assertEqual(self.terminal_me(token, headers=self.headers | {"HTTP_X_TERMINAL_KEY": new_secret}).status_code, 401)
