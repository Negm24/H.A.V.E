import time

from django.test import TestCase, override_settings

from apps.accounts.models import User, RefreshToken
from apps.accounts.security.tokens import token_hash
from apps.accounts.tests.helpers import SessionFixtures, SESSIONS
from apps.terminals.models import Terminal
from apps.terminals.security.state import session_key


@override_settings(TERMINAL_IDLE_SECONDS=120, TERMINAL_MAX_SECONDS=600,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class CustomerTerminalTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    def test_shared_lockout_across_hub_and_terminal(self):
        token = self.start_guest()
        for _ in range(3):
            self.assertEqual(self.hub_login(pin="7392").status_code, 401)
        for _ in range(2):
            self.assertEqual(self.terminal_login(token, pin="7392").status_code, 401)
        self.assertEqual(self.hub_login().status_code, 401)
        self.assertEqual(self.terminal_login(token).status_code, 401)

    def test_source_and_device_rate_limits(self):
        from apps.accounts.security.state import enforce_customer_login_limit
        for _ in range(60):
            enforce_customer_login_limit("source", "127.0.0.1")
        self.assertEqual(self.hub_login().status_code, 429)
        self.cleanup_redis()
        token = self.start_guest()
        for _ in range(60):
            enforce_customer_login_limit("terminal", self.terminal.pk)
        self.assertEqual(self.terminal_login(token).status_code, 429)

    def test_terminal_guest_login_rotation_and_no_refresh_rows(self):
        guest = self.start_guest()
        started = self.state()["started_at"]
        self.assertEqual(self.terminal_me(guest).status_code, 401)
        login = self.terminal_login(guest)
        self.assertEqual(login.status_code, 200, login.data)
        token = login.json()["session_token"]
        self.assertNotEqual(token, guest)
        self.assertEqual(self.state()["started_at"], started)
        self.assertEqual(self.terminal_me(guest).status_code, 401)
        self.assertEqual(self.terminal_me(token).status_code, 200)
        self.assertFalse(RefreshToken.objects.exists())
        self.assertNotIn(token, self.redis.get(session_key(self.terminal.pk)))

    def test_terminal_me_does_not_renew_idle_but_activity_does(self):
        token = self.terminal_login(self.start_guest()).json()["session_token"]
        state = self.change_state(last_activity_at=time.time() - 100)
        self.assertEqual(self.terminal_me(token).status_code, 200)
        self.assertEqual(self.state()["last_activity_at"], state["last_activity_at"])
        response = self.client.post(SESSIONS + "activity/", HTTP_AUTHORIZATION="Bearer " + token, **self.headers)
        self.assertEqual(response.status_code, 200)
        self.assertGreater(self.state()["last_activity_at"], state["last_activity_at"])
        self.assertEqual(self.state()["started_at"], state["started_at"])

    def test_terminal_idle_absolute_and_login_preserves_guest_clock(self):
        token = self.terminal_login(self.start_guest()).json()["session_token"]
        self.change_state(last_activity_at=time.time() - 121)
        self.assertEqual(self.terminal_me(token).status_code, 401)
        guest = self.start_guest()
        started = time.time() - 590
        self.change_state(started_at=started)
        login = self.terminal_login(guest)
        self.assertEqual(login.status_code, 200)
        self.assertLessEqual(login.json()["idle_expires_in"], 10)
        self.assertAlmostEqual(self.state()["started_at"], started, places=4)
        self.change_state(started_at=time.time() - 601, last_activity_at=time.time())
        self.assertEqual(self.terminal_me(login.json()["session_token"]).status_code, 401)

    def test_token_app_and_terminal_isolation(self):
        hub = self.hub_login().json()["access_token"]
        term = self.terminal_login(self.start_guest()).json()["session_token"]
        self.assertEqual(self.hub_me(term).status_code, 401)
        self.assertEqual(self.terminal_me(hub).status_code, 401)
        other = Terminal.objects.create(serial_number="TEST-002", display_name="Other", address_en="Test",
            address_ar="اختبار", latitude=30, longitude=31, device_credential_hash=token_hash("other"))
        self.assertEqual(self.terminal_me(term, headers={"HTTP_X_TERMINAL_SERIAL": other.pk, "HTTP_X_TERMINAL_KEY": "other"}).status_code, 401)

    def test_disabling_customer_blocks_terminal_me_and_activity(self):
        token = self.terminal_login(self.start_guest()).json()["session_token"]
        User.objects.filter(pk=self.user.pk).update(is_disabled=True)
        self.assertEqual(self.terminal_me(token).status_code, 401)
        response = self.client.post(SESSIONS + "activity/", HTTP_AUTHORIZATION="Bearer " + token, **self.headers)
        self.assertEqual(response.status_code, 401)
