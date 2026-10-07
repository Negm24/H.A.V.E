from datetime import date
from uuid import uuid4
import json

from django.test import override_settings
from rest_framework.test import APIClient

from apps.accounts.security.state import get_redis_client
from apps.accounts.security.tokens import token_hash
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.terminals.models import Terminal
from apps.terminals.security.state import session_key


HUB = "/api/v1/auth/customers/hub/"
TERM = "/api/v1/auth/customers/terminal/"
SESSIONS = "/api/v1/terminals/sessions/"


class SessionFixtures:
    def setup_sessions(self):
        self.prefix = f"have:test:sessions:{uuid4().hex}:"
        override = override_settings(AUTH_REDIS_PREFIX=self.prefix)
        override.enable()
        self.addCleanup(override.disable)
        self.redis = get_redis_client()
        self.redis.ping()
        self.addCleanup(self.cleanup_redis)
        self.user = create_customer_account(first_name="Customer", last_name="Tester",
            phone_number="01012345678", email="sessions@example.test", date_of_birth=date(2005, 1, 24), pin="4826")
        self.device_secret = "test-device-secret-" + uuid4().hex
        self.terminal = Terminal.objects.create(serial_number="TEST-001", display_name="Test",
            address_en="Test", address_ar="اختبار", latitude="30.000000", longitude="31.000000",
            device_credential_hash=token_hash(self.device_secret))
        self.client = APIClient(enforce_csrf_checks=True)
        self.headers = {"HTTP_X_TERMINAL_SERIAL": self.terminal.pk, "HTTP_X_TERMINAL_KEY": self.device_secret}

    def cleanup_redis(self):
        keys = list(self.redis.scan_iter(match=self.prefix + "*"))
        if keys:
            self.redis.delete(*keys)

    def csrf(self):
        return self.client.get("/api/v1/auth/csrf/").json()["csrf_token"]

    def hub_login(self, **changes):
        return self.client.post(HUB + "login/", {"phone_number": "01012345678", "pin": "4826"} | changes,
            format="json", HTTP_X_CSRFTOKEN=self.csrf())

    def hub_me(self, token):
        return self.client.get(HUB + "me/", HTTP_AUTHORIZATION="Bearer " + token)

    def refresh(self):
        return self.client.post(HUB + "refresh/", HTTP_X_CSRFTOKEN=self.csrf())

    def start_guest(self):
        response = self.client.post(SESSIONS, **self.headers)
        self.assertEqual(response.status_code, 201, response.data)
        return response.json()["session_token"]

    def terminal_login(self, token, **changes):
        return self.client.post(TERM + "login/", {"phone_number": "01012345678", "pin": "4826"} | changes,
            format="json", HTTP_AUTHORIZATION="Bearer " + token, **self.headers)

    def terminal_me(self, token, headers=None):
        return self.client.get(TERM + "me/", HTTP_AUTHORIZATION="Bearer " + token,
            **(self.headers if headers is None else headers))

    def state(self):
        return json.loads(self.redis.get(session_key(self.terminal.pk)))

    def change_state(self, **changes):
        state = self.state() | changes
        self.redis.set(session_key(self.terminal.pk), json.dumps(state), ex=600)
        return state
