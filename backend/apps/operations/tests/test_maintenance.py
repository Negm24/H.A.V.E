import json
import time
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase, override_settings
from django.utils import timezone
from redis.exceptions import RedisError

from apps.accounts.security.errors import AuthError
from apps.catalogue.services.catalogue_services import availability
from apps.observability.models import ServiceActionJob
from apps.orders.models import Order
from apps.orders.services.order_services import mark_paid, fulfil_order, expire_orders
from apps.operations.services.kiosks import set_maintenance, maintenance_preview
from apps.terminals.services.heartbeat import heartbeat_key
from .helpers import OperationsFixtures


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class MaintenanceTests(OperationsFixtures, TestCase):
    def setUp(self):
        self.setup_operations()

    def change(self, **values):
        return set_maintenance(**(dict(actor=self.owner, serial=self.terminal.pk, enabled=True,
            reason="Fictional service test", revision=self.terminal.revision) | values))

    def test_live_session_denies_activation_without_force_or_queued_transition(self):
        self.start_guest()
        self.assertFalse(maintenance_preview(self.terminal)["eligible"])
        with self.assertRaises(AuthError):
            self.change()
        self.terminal.refresh_from_db()
        self.assertFalse(self.terminal.maintenance_enabled)
        self.assertEqual(self.terminal.revision, 1)

    def test_unknown_session_state_fails_closed_and_expired_session_allows_activation(self):
        with patch("apps.terminals.services.maintenance.get_redis_client", side_effect=RedisError):
            with self.assertRaises(AuthError):
                self.change()
        self.start_guest()
        self.change_state(last_activity_at=time.time() - 601)
        self.change()
        self.terminal.refresh_from_db()
        self.assertTrue(self.terminal.maintenance_enabled)

    def test_paid_collection_warning_required_and_deadlines_remain_effective(self):
        order = self.reserve()
        mark_paid(order.pk)
        order.refresh_from_db()
        deadline = order.collection_deadline
        preview = maintenance_preview(self.terminal)
        self.assertTrue(preview["eligible"])
        self.assertEqual(preview["paid_waiting_orders"][0]["collection_deadline"], deadline)
        with self.assertRaises(AuthError):
            self.change()
        self.change(acknowledge_paid_orders=True)
        order.refresh_from_db()
        self.assertEqual(order.collection_deadline, deadline)
        with self.assertRaises(AuthError):
            fulfil_order(order.pk, terminal=self.terminal)
        order.refresh_from_db()
        self.assertEqual(order.status, "PENDING")
        self.assertEqual(availability(self.terminal), {})
        expire_orders(now=deadline + timedelta(seconds=1))
        order.refresh_from_db()
        self.assertEqual(order.status, "CANCELLED")
        self.assertEqual(order.cancellation_reason, "COLLECTION_EXPIRED")

    def test_maintenance_blocks_session_and_checkout_but_availability_remains_accessible(self):
        self.change()
        self.assertEqual(self.client.post("/api/v1/terminals/sessions/", **self.headers).status_code, 409)
        with self.assertRaises(AuthError):
            self.reserve()
        result = self.client.get("/api/v1/terminals/availability/", **self.headers)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertTrue(result.json()["maintenance"])
        self.assertFalse(result.json()["available"])

    def test_inflight_unpaid_or_uncertain_work_blocks_activation(self):
        self.reserve()
        self.assertFalse(maintenance_preview(self.terminal)["eligible"])
        with self.assertRaises(AuthError):
            self.change()

    def test_heartbeat_is_fixed_bounded_and_does_not_extend_session(self):
        self.start_guest()
        before = self.state()
        result = self.client.post("/api/v1/terminals/heartbeat/", {"app_version": "1.0"}, format="json", **self.headers)
        self.assertEqual(result.status_code, 200, result.data)
        self.assertEqual(self.state(), before)
        self.assertTrue(self.redis.get(heartbeat_key(self.terminal.pk)))
        self.assertGreater(self.redis.ttl(heartbeat_key(self.terminal.pk)), 0)
        owner_kiosk = self.admin.get(f"/api/v1/owner/kiosks/{self.terminal.pk}/").json()
        self.assertIsNotNone(owner_kiosk["app_last_seen_at"])
        self.assertEqual(owner_kiosk["peripheral_health"], "unknown")
        self.assertEqual(self.client.post("/api/v1/terminals/heartbeat/", {"email": "private@example.test"}, format="json", **self.headers).status_code, 400)

    def test_unresolved_kiosk_service_action_blocks_customer_but_not_fixed_availability(self):
        for state in ["RUNNING", "UNKNOWN"]:
            job = ServiceActionJob.objects.create(actor=self.owner, service="kiosk", action="restart", status=state,
                preview_revision="test", expires_at=timezone.now() + timedelta(minutes=5))
            self.assertEqual(self.client.post("/api/v1/terminals/sessions/", **self.headers).status_code, 409)
            with self.assertRaises(AuthError):
                self.reserve()
            data = self.client.get("/api/v1/terminals/availability/", **self.headers).json()
            self.assertFalse(data["available"])
            self.assertFalse(data["maintenance"])
            job.status = "SUCCEEDED"
            job.save(update_fields=["status"])
        self.assertTrue(self.client.get("/api/v1/terminals/availability/", **self.headers).json()["available"])
