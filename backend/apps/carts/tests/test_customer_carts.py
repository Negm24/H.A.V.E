"""Customer-and-machine shared baskets, with isolated temporary guest carts."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from unittest.mock import patch
from uuid import uuid4
from types import SimpleNamespace

from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.utils import timezone
from redis.exceptions import ConnectionError as RedisConnectionError

from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import token_hash
from apps.accounts.services.customer_services.registration import create_customer_account
from apps.accounts.tests.helpers import SessionFixtures, SESSIONS, HUB, TERM
from apps.catalogue.models import Category, Product, ProductBatch
from apps.carts.security.state import customer_cart_key, transition, clear_purchased_cart
from apps.carts.services import cart_services
from apps.terminals.models import Terminal, TerminalSlot
from apps.terminals.services.inventory_services import set_stock
from apps.terminals.services.session_services import operate

HUB_CART = "/api/v1/hub/cart/"
TERMINAL_CART = "/api/v1/terminals/cart/"


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"], CART_DATA_EXPIRY=86400)
class CustomerCartTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()
        self.user.phone_verified_at = timezone.now()
        self.user.save()
        category = Category.objects.create(name_en="Cart tests", name_ar="اختبار")
        self.product = Product.objects.create(sku="CART-TEST", category=category, name_en="Cart sample", name_ar="عينة",
            price="18.50", pack_description="24 tablets", max_quantity_per_order=10,
            usage_instructions_en="Demonstration", usage_instructions_ar="تجريبي")
        batch = ProductBatch.objects.create(product=self.product, batch_number="CART-BATCH", expiry_date=timezone.localdate() + timedelta(days=30))
        self.terminal2 = Terminal.objects.create(serial_number="TEST-002", display_name="Second", address_en="Elsewhere",
            address_ar="مكان", latitude=0, longitude=0, device_credential_hash=token_hash("device-two"))
        for terminal, quantity in [(self.terminal, 6), (self.terminal2, 2)]:
            slot = TerminalSlot.objects.create(terminal=terminal, product=self.product, slot_code="C1", capacity=10)
            set_stock(slot_id=slot.pk, batch=batch, quantity=quantity)
        self.access = self.hub_login().json()["access_token"]
        self.token = self.terminal_login(self.start_guest()).json()["session_token"]
        _, token2 = operate(self.terminal2, "start")
        _, self.token2 = operate(self.terminal2, "login", token2, user=self.user)

    def hub(self, method="get", suffix="", data=None, token=None, terminal=None):
        return getattr(self.client, method)(HUB_CART + suffix + "?terminal_serial=" + (terminal or self.terminal).pk,
            data=data, format="json", HTTP_AUTHORIZATION="Bearer " + (token or self.access))

    def terminal_cart(self, method="get", suffix="", data=None, token=None):
        return getattr(self.client, method)(TERMINAL_CART + suffix, data=data, format="json",
            HTTP_AUTHORIZATION="Bearer " + (token or self.token), **self.headers)

    def hub_put(self, quantity, version=None, terminal=None):
        version = self.hub(terminal=terminal).json()["version"] if version is None else version
        return self.hub("put", f"items/{self.product.pk}/", {"quantity": quantity, "expected_version": version}, terminal=terminal)

    def terminal_put(self, quantity, token=None, version=None):
        version = self.terminal_cart(token=token).json()["version"] if version is None else version
        return self.terminal_cart("put", f"items/{self.product.pk}/", {"quantity": quantity, "expected_version": version}, token=token)

    def key(self, terminal=None):
        return customer_cart_key(self.user.pk, (terminal or self.terminal).pk)

    def test_same_customer_machine_cart_is_shared_with_terminal_with_local_stock(self):
        self.assertEqual(self.hub_put(5).json()["items"][0]["product"]["stock_quantity"], 6)
        self.assertEqual(self.terminal_cart().json()["total_quantity"], 5)
        self.assertEqual(self.hub(terminal=self.terminal2).json()["items"], [])
        self.assertEqual(cart_services.get_cart(user_id=self.user.pk, terminal=self.terminal2, raw_token=self.token2)["items"], [])
        self.terminal_put(3)
        self.hub_put(2, terminal=self.terminal2)
        self.assertEqual(self.hub().json()["total_quantity"], 3)
        self.assertEqual(self.hub(terminal=self.terminal2).json()["total_quantity"], 2)
        self.assertEqual(self.terminal_cart().json()["total_quantity"], 3)
        self.assertEqual(self.hub_put(3, terminal=self.terminal2).status_code, 400)

    def test_actual_change_renews_one_day_ttl_reads_noops_and_login_do_not(self):
        cart = self.hub_put(2).json()
        self.assertGreater(self.redis.ttl(self.key()), 86390)
        self.assertLessEqual(self.redis.ttl(self.key()), 86400)
        self.redis.expire(self.key(), 100)
        before = self.redis.get(self.key())
        self.hub()
        self.terminal_cart()
        self.assertEqual(self.hub_put(2, version=cart["version"]).json()["version"], cart["version"])
        self.assertEqual(self.redis.get(self.key()), before)
        self.terminal_login(self.start_guest())
        self.assertLessEqual(self.redis.ttl(self.key()), 100)
        changed = self.hub_put(1).json()
        self.assertNotEqual(changed["version"], cart["version"])
        self.assertEqual(changed["created_at"], cart["created_at"])
        self.assertGreater(self.redis.ttl(self.key()), 86390)

    def test_clear_renews_only_when_items_removed_and_expiry_returns_empty(self):
        cart = self.hub_put(1).json()
        self.redis.expire(self.key(), 100)
        cleared = self.hub("delete", data={"expected_version": cart["version"]}).json()
        self.assertEqual(cleared["items"], [])
        self.assertGreater(self.redis.ttl(self.key()), 86390)
        self.redis.expire(self.key(), 100)
        self.hub("delete", data={"expected_version": cleared["version"]})
        self.assertLessEqual(self.redis.ttl(self.key()), 100)
        self.redis.delete(self.key())
        empty = self.hub().json()
        self.assertEqual((empty["items"], empty["version"], empty["created_at"]), ([], "empty", None))

    def test_stale_writes_conflict_and_missing_version_is_invalid(self):
        cart = self.hub_put(1).json()
        self.hub_put(2, version=cart["version"])
        self.assertEqual(self.hub_put(3, version=cart["version"]).status_code, 409)
        self.assertEqual(self.hub("put", f"items/{self.product.pk}/", {"quantity": 3}).status_code, 400)
        self.assertEqual(self.hub().json()["total_quantity"], 2)

    def test_concurrent_atomic_writes_have_one_winner(self):
        initial = self.hub_put(1).json()
        def update(quantity):
            try:
                transition("set", user_id=self.user.pk, terminal=self.terminal, expected_version=initial["version"], product_id=str(self.product.pk), quantity=quantity)
                return "ok"
            except AuthError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as workers:
            self.assertCountEqual(list(workers.map(update, [2, 3])), ["ok", 409])

    def test_cross_app_version_reads_are_lightweight_and_never_renew_deadlines(self):
        initial = self.hub_put(1).json()
        self.redis.expire(self.key(), 100)
        before = self.state()
        with patch("apps.carts.services.cart_services.availability", side_effect=AssertionError("Version reads must not query stock")):
            hub_version = self.hub(suffix="version/")
            kiosk_version = self.terminal_cart(suffix="version/")
        self.assertEqual(hub_version.status_code, 200)
        self.assertEqual(kiosk_version.json(), {"version": initial["version"]})
        self.assertEqual(hub_version.json(), kiosk_version.json())
        self.assertLessEqual(self.redis.ttl(self.key()), 100)
        self.assertEqual(self.state(), before)
        changed = self.terminal_put(2, version=initial["version"]).json()
        self.assertNotEqual(changed["version"], initial["version"])
        self.assertEqual(self.hub(suffix="version/").json()["version"], changed["version"])
        self.assertEqual(self.hub_put(3, version=initial["version"]).status_code, 409)

    def test_saved_cart_survives_one_hour_absence_and_fresh_kiosk_signin(self):
        initial = self.hub_put(3).json()
        self.redis.expire(self.key(), 86400 - 3600)
        self.change_state(last_activity_at=0)
        self.assertEqual(self.terminal_cart().status_code, 401)
        self.token = self.terminal_login(self.start_guest()).json()["session_token"]
        restored = self.terminal_cart().json()
        self.assertEqual((restored["version"], restored["total_quantity"]), (initial["version"], 3))
        self.assertLessEqual(self.redis.ttl(self.key()), 86400 - 3600)

    def test_version_read_outage_and_expired_terminal_are_not_empty_carts(self):
        with patch("apps.carts.security.state.get_redis_client", side_effect=RedisConnectionError):
            self.assertEqual(self.hub(suffix="version/").status_code, 503)
        self.change_state(last_activity_at=0)
        self.assertEqual(self.terminal_cart(suffix="version/").status_code, 401)

    def test_terminal_end_expiry_and_next_visitor_destroy_only_terminal_basket(self):
        self.hub_put(2)
        self.terminal_put(1)
        self.client.post(SESSIONS + "end/", HTTP_AUTHORIZATION="Bearer " + self.token, **self.headers)
        guest = self.start_guest()
        self.assertEqual(self.terminal_cart(token=guest).json()["items"], [])
        self.change_state(last_activity_at=0)
        self.assertEqual(self.terminal_cart(token=guest).status_code, 401)
        self.assertEqual(self.hub().json()["total_quantity"], 1)

    def test_guest_login_discards_guest_cart_without_adoption_or_clock_restart(self):
        guest = self.start_guest()
        initial = self.terminal_put(3, token=guest).json()
        started = self.state()["started_at"]
        self.token = self.terminal_login(guest).json()["session_token"]
        state = self.state()
        current = self.terminal_cart().json()
        self.assertEqual((current["total_quantity"], current["version"]), (0, "empty"))
        self.assertIsNone(current["created_at"])
        self.assertIsNone(current["updated_at"])
        self.assertFalse(current["comparison_required"])
        self.assertIsNone(current["adoption_notice"])
        self.assertEqual(self.hub().json()["items"], [])
        self.assertIsNotNone(initial["created_at"])
        self.assertEqual(started, state["started_at"])
        self.assertEqual(state["last_activity_at"], self.state()["last_activity_at"])
        self.assertEqual(self.terminal_cart(token=guest).status_code, 401)

    def test_existing_hub_cart_and_guest_cart_never_trigger_comparison(self):
        self.hub_put(1)
        guest = self.start_guest()
        self.terminal_put(2, token=guest)
        self.token = self.terminal_login(guest).json()["session_token"]
        current = self.terminal_cart().json()
        self.assertEqual(current["total_quantity"], 1)
        self.assertFalse(current["comparison_required"])
        self.terminal_put(3)
        self.assertEqual(self.hub().json()["total_quantity"], 3)

    def test_failed_login_keeps_guest_basket_unchanged(self):
        guest = self.start_guest()
        initial = self.terminal_put(2, token=guest).json()
        self.assertEqual(self.terminal_login(guest, pin="7392").status_code, 401)
        current = self.terminal_cart(token=guest).json()
        self.assertEqual((current["total_quantity"], current["version"]), (2, initial["version"]))

    def test_removed_comparison_choice_routes_cannot_merge_carts(self):
        self.hub_put(1)
        self.terminal_put(2)
        self.assertEqual(self.terminal_cart(suffix="comparison/").status_code, 404)
        self.assertEqual(self.terminal_cart("post", "choice/", {"choice": "guest"}).status_code, 404)
        for mode in ("comparison", "choice"):
            with self.assertRaises(AuthError) as error:
                transition(mode, user_id=self.user.pk, terminal=self.terminal, raw_token=self.token)
            self.assertEqual(error.exception.status, 410)
        self.assertEqual(self.hub().json()["total_quantity"], 2)
        self.assertEqual(self.terminal_cart().json()["total_quantity"], 2)

    def test_reductions_and_removals_allow_unavailable_prescription_lines(self):
        self.hub_put(3)
        self.product.requires_prescription = True
        self.product.is_active = False
        self.product.save()
        self.assertTrue(self.hub().json()["has_issues"])
        self.assertEqual(self.hub_put(2).status_code, 200)
        self.assertEqual(self.hub_put(3).status_code, 400)
        self.assertEqual(self.hub_put(0).json()["items"], [])

    def test_cart_reads_and_mutations_never_renew_terminal_activity(self):
        before = self.state()
        self.terminal_cart()
        self.terminal_put(2)
        self.assertEqual(self.state()["last_activity_at"], before["last_activity_at"])
        self.assertEqual(self.state()["started_at"], before["started_at"])

    def test_customer_isolation_bearer_required_and_no_device_or_terminal_token_on_hub(self):
        self.hub_put(1)
        other = create_customer_account(first_name="Other", last_name="Customer", phone_number="01112345678", email="other@example.test", date_of_birth=date(2000, 1, 1), pin="4826")
        self.assertEqual(cart_services.get_cart(user_id=other.pk, terminal=self.terminal)["items"], [])
        self.assertEqual(self.client.get(HUB_CART + "?terminal_serial=" + self.terminal.pk, **self.headers).status_code, 401)
        self.assertEqual(self.hub(token=self.token).status_code, 401)
        self.assertEqual(self.terminal_cart().json()["total_quantity"], 1)

    def test_hub_requires_valid_selected_terminal(self):
        headers = {"HTTP_AUTHORIZATION": "Bearer " + self.access}
        self.assertEqual(self.client.get(HUB_CART, **headers).status_code, 400)
        self.assertEqual(self.client.get(HUB_CART + "?terminal_serial=UNKNOWN", **headers).status_code, 400)
        self.terminal2.is_disabled = True
        self.terminal2.save()
        self.assertEqual(self.hub(terminal=self.terminal2).status_code, 400)

    def test_redis_and_database_outages_are_503_not_empty_baskets(self):
        with patch("apps.carts.security.state.get_redis_client", side_effect=RedisConnectionError):
            self.assertEqual(self.hub().status_code, 503)
        with patch("apps.carts.services.cart_services.availability", side_effect=DatabaseError):
            self.assertEqual(self.hub().status_code, 503)

    def test_device_rotation_cannot_mutate_terminal_or_hub_cart(self):
        self.hub_put(1)
        initial = self.terminal_put(1).json()
        self.terminal.device_credential_hash = token_hash("rotated")
        self.terminal.save()
        self.assertEqual(self.terminal_put(2, version=initial["version"]).status_code, 401)
        self.assertEqual(self.hub().json()["total_quantity"], 1)

    def test_hub_signout_preserves_its_per_terminal_carts(self):
        self.hub_put(2)
        self.hub_put(1, terminal=self.terminal2)
        self.client.post(HUB + "logout/", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(self.hub().status_code, 401)
        self.assertIsNotNone(self.redis.get(self.key()))
        self.access = self.hub_login().json()["access_token"]
        self.assertEqual(self.hub().json()["total_quantity"], 2)
        self.assertEqual(self.hub(terminal=self.terminal2).json()["total_quantity"], 1)

    def test_qr_login_discards_guest_cart_but_never_overwrites_hub_cart(self):
        self.hub_put(1)
        guest = self.start_guest()
        initial = self.terminal_put(2, token=guest).json()
        terminal_headers = self.headers | {"HTTP_AUTHORIZATION": "Bearer " + guest}
        hub_headers = {"HTTP_AUTHORIZATION": "Bearer " + self.access}
        qr = self.client.post(TERM + "qr-login/", **terminal_headers).json()
        self.assertEqual(self.client.post(HUB + "qr-login/scan/", {"qr_payload": qr["qr_payload"]}, format="json", **hub_headers).status_code, 200)
        self.assertEqual(self.client.post(HUB + f"qr-login/{qr['challenge_id']}/confirm/", {"approve": True}, format="json", **hub_headers).status_code, 200)
        self.token = self.client.post(TERM + f"qr-login/{qr['challenge_id']}/complete/", **terminal_headers).json()["session_token"]
        cart = self.terminal_cart().json()
        self.assertEqual(cart["total_quantity"], 1)
        self.assertNotEqual(cart["version"], "empty")
        self.assertIsNotNone(initial["created_at"])
        self.assertIsNotNone(cart["created_at"])
        self.assertFalse(cart["comparison_required"])
        self.assertEqual(self.hub().json()["total_quantity"], 1)

    def test_guest_reset_and_replacement_destroy_guest_basket_only(self):
        self.hub_put(1)
        guest = self.start_guest()
        self.terminal_put(2, token=guest)
        self.assertEqual(self.terminal_cart(token=self.start_guest()).json()["items"], [])
        self.assertEqual(self.terminal_cart(token=guest).status_code, 401)
        self.assertEqual(self.hub().json()["total_quantity"], 1)

    def test_one_hub_machine_expiry_does_not_destroy_another(self):
        self.hub_put(1)
        self.hub_put(2, terminal=self.terminal2)
        self.redis.delete(self.key())
        self.assertEqual(self.hub().json()["items"], [])
        self.assertEqual(self.hub(terminal=self.terminal2).json()["total_quantity"], 2)

    def test_mutation_revalidates_session_after_database_validation(self):
        self.hub_put(1)
        before = self.terminal_put(1).json()
        original = cart_services.product_data
        def reset_during_validation(product, stock):
            self.start_guest()
            return original(product, stock)
        with patch("apps.carts.services.cart_services.product_data", side_effect=reset_during_validation):
            self.assertEqual(self.terminal_put(2, version=before["version"]).status_code, 401)
        self.assertEqual(self.hub().json()["total_quantity"], 1)

    def test_superseded_shared_cart_is_never_adopted(self):
        from apps.accounts.security.state import auth_key
        legacy = auth_key(f"customer-cart:{token_hash(self.user.pk)}")
        self.redis.set(legacy, '{"items":{"999":8},"version":"legacy"}', ex=300)
        self.assertEqual(self.hub().json()["items"], [])
        self.assertEqual(self.terminal_cart().json()["items"], [])
        self.assertIsNotNone(self.redis.get(legacy))

    def test_paid_hub_cart_cleanup_preserves_later_edits_and_only_clears_exact_snapshot(self):
        original = self.hub_put(1).json()
        paid = SimpleNamespace(paid_at=timezone.now(), channel="HUB", customer_id=self.user.pk,
            terminal_id=self.terminal.pk, cart_version=original["version"])
        changed = self.hub_put(2).json()
        self.redis.expire(self.key(), 100)
        self.assertFalse(clear_purchased_cart(paid))
        self.assertEqual(self.hub().json()["total_quantity"], 2)
        self.assertLessEqual(self.redis.ttl(self.key()), 100)
        paid.cart_version = changed["version"]
        self.assertTrue(clear_purchased_cart(paid))
        self.assertEqual(self.hub().json()["items"], [])
        self.assertFalse(self.redis.exists(self.key()))

    def test_paid_customer_terminal_checkout_cleans_shared_basket_not_next_guest(self):
        original = self.hub_put(2).json()
        paid = SimpleNamespace(paid_at=timezone.now(), channel="TERMINAL", customer_id=self.user.pk,
            terminal_id=self.terminal.pk, terminal_session_id=self.state()["session_id"], cart_version=original["version"])
        guest = self.start_guest()
        self.terminal_put(1, token=guest)
        self.assertTrue(clear_purchased_cart(paid))
        self.assertEqual(self.hub().json()["items"], [])
        self.assertEqual(self.terminal_cart(token=guest).json()["total_quantity"], 1)

    def test_paid_terminal_cart_cleanup_preserves_next_visitor_and_session_clocks(self):
        original = self.terminal_put(1).json()
        paid = SimpleNamespace(paid_at=timezone.now(), channel="TERMINAL", terminal_id=self.terminal.pk,
            terminal_session_id=self.state()["session_id"], cart_version=original["version"])
        guest = self.start_guest()
        current = self.terminal_put(2, token=guest).json()
        before = self.state()
        clear_purchased_cart(paid)
        self.assertEqual(self.terminal_cart(token=guest).json()["total_quantity"], 2)
        paid.terminal_session_id = before["session_id"]
        paid.cart_version = current["version"]
        clear_purchased_cart(paid)
        self.assertEqual(self.terminal_cart(token=guest).json()["items"], [])
        self.assertEqual(self.state()["started_at"], before["started_at"])
        self.assertEqual(self.state()["last_activity_at"], before["last_activity_at"])
