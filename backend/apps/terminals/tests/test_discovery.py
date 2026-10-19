"""Public-to-customers machine state never exposes an occupant or renews sessions."""
from unittest.mock import patch

from django.test import TestCase, override_settings
from redis.exceptions import ConnectionError as RedisConnectionError

from apps.accounts.tests.helpers import SessionFixtures
from apps.carts.security.state import customer_cart_key
from apps.terminals.services.discovery_services import collection_terminals


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class TerminalDiscoveryTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    def row(self):
        return collection_terminals(self.user.pk)[0]

    def test_guest_is_occupied_own_login_is_distinct_and_neither_read_extends_activity(self):
        self.assertEqual(self.row()["occupancy"], "FREE")
        guest = self.start_guest()
        before = self.state()
        row = self.row()
        self.assertEqual(row["occupancy"], "IN_USE")
        self.assertEqual(self.state(), before)
        self.assertNotIn("user_id", row)
        self.assertNotIn("session_id", row)
        self.terminal_login(guest)
        before = self.state()
        self.assertEqual(self.row()["occupancy"], "OWN_SESSION")
        self.assertEqual(collection_terminals("different-customer")[0]["occupancy"], "IN_USE")
        self.assertEqual(self.state(), before)

    def test_expired_and_rotated_sessions_are_free_disabled_terminal_remains_listed(self):
        self.start_guest()
        self.change_state(last_activity_at=0)
        self.assertEqual(self.row()["occupancy"], "FREE")
        self.start_guest()
        self.terminal.device_credential_hash = "f" * 64
        self.terminal.is_disabled = True
        self.terminal.save()
        row = self.row()
        self.assertTrue(row["is_disabled"])
        self.assertEqual(row["occupancy"], "FREE")

    def test_saved_cart_count_is_customer_machine_scoped_and_does_not_extend_ttl(self):
        self.redis.set(customer_cart_key(self.user.pk, self.terminal.pk), '{"items":{"1":2,"2":3}}', ex=100)
        self.redis.set(customer_cart_key("other", self.terminal.pk), '{"items":{"1":9}}', ex=100)
        row = self.row()
        self.assertEqual(row["cart_total_quantity"], 5)
        self.assertTrue(row["cart_available"])
        self.assertLessEqual(self.redis.ttl(customer_cart_key(self.user.pk, self.terminal.pk)), 100)

    def test_redis_outage_preserves_machine_list_with_unknown_state_not_fake_empty_cart(self):
        with patch("apps.terminals.services.discovery_services.get_redis_client", side_effect=RedisConnectionError):
            row = self.row()
        self.assertEqual(row["occupancy"], "UNKNOWN")
        self.assertIsNone(row["cart_total_quantity"])
        self.assertFalse(row["cart_available"])
