from unittest.mock import patch
import time

from django.test import TestCase, override_settings
from redis.exceptions import RedisError

from apps.terminals.security.state import session_key
from apps.terminals.tests.helpers import SessionFixtures, SESSIONS


@override_settings(TERMINAL_IDLE_SECONDS=120, TERMINAL_MAX_SECONDS=600,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class TerminalSessionTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    @override_settings(TERMINAL_IDLE_SECONDS=240, TERMINAL_MAX_SECONDS=900)
    def test_configured_limits_are_not_hardcoded(self):
        token = self.terminal_login(self.start_guest()).json()["session_token"]
        self.change_state(started_at=time.time() - 650, last_activity_at=time.time() - 130)
        self.assertEqual(self.terminal_me(token).status_code, 200)
        self.change_state(last_activity_at=time.time() - 241)
        self.assertEqual(self.terminal_me(token).status_code, 401)
        token = self.terminal_login(self.start_guest()).json()["session_token"]
        self.change_state(started_at=time.time() - 901, last_activity_at=time.time())
        self.assertEqual(self.terminal_me(token).status_code, 401)

    def test_terminal_start_over_end_and_remember_me_rejection(self):
        old = self.start_guest()
        new = self.start_guest()
        self.assertEqual(self.terminal_login(old).status_code, 401)
        self.assertEqual(self.terminal_login(new, remember_me=False).status_code, 400)
        response = self.client.post(SESSIONS + "end/", HTTP_AUTHORIZATION="Bearer " + new, **self.headers)
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.terminal_login(new).status_code, 401)

    def test_terminal_redis_failure_denies_access(self):
        token = self.start_guest()
        with patch("apps.terminals.security.state.get_redis_client", side_effect=RedisError):
            self.assertEqual(self.terminal_me(token).status_code, 503)
            self.assertEqual(self.client.post(SESSIONS, **self.headers).status_code, 503)

    def test_activity_cannot_revive_expired_session(self):
        token = self.start_guest()
        self.change_state(last_activity_at=time.time() - 121)
        response = self.client.post(SESSIONS + "activity/", HTTP_AUTHORIZATION="Bearer " + token, **self.headers)
        self.assertEqual(response.status_code, 401)
        self.assertFalse(self.redis.exists(session_key(self.terminal.pk)))
