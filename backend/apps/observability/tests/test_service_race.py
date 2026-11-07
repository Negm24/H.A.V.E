import threading
from unittest.mock import patch
from uuid import uuid4

from django.db import connections, transaction
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from apps.accounts.security.errors import AuthError
from apps.accounts.services.owner_services.registration import create_owner_account
from apps.accounts.tests.helpers import SessionFixtures
from apps.observability import services
from apps.observability.models import HostState, ServiceActionJob
from apps.terminals.models import Terminal
from apps.terminals.services.session_services import operate


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ServiceSessionRaceTests(SessionFixtures, TransactionTestCase):
    def setUp(self):
        self.setup_sessions()
        self.owner = create_owner_account(first_name="Race", last_name="Owner", phone_number="01112345678", email="technical-race@example.test", password="Orchid-River-Sample-4826!")
        HostState.objects.create(pk="local", observed_at=timezone.now(), payload={"containers": [{"service": "kiosk", "state": "running", "health": "healthy"}]})
        preview = services.preview("kiosk", "restart")
        self.job = services.create_job(actor=self.owner, service="kiosk", action="restart", action_id=uuid4(), preview_revision=preview["preview_revision"])

    def thread(self, function, outcome, name):
        def run():
            try:
                outcome[name] = function()
            except Exception as error:
                outcome[name] = error
            finally:
                connections.close_all()
        thread = threading.Thread(target=run)
        thread.start()
        return thread

    def test_claim_winning_terminal_lock_blocks_racing_new_session(self):
        locked, release = threading.Event(), threading.Event()
        original = services.preview
        def held_preview(*args):
            locked.set()
            if not release.wait(3): raise RuntimeError("Test barrier timed out")
            return original(*args)
        results = {}
        with patch("apps.observability.services.preview", side_effect=held_preview):
            claim = self.thread(services.claim_job, results, "claim")
            try:
                self.assertTrue(locked.wait(3))
                session = self.thread(lambda: operate(self.terminal, "start"), results, "session")
            finally:
                release.set()
            claim.join(5); session.join(5)
        self.assertFalse(claim.is_alive()); self.assertFalse(session.is_alive())
        self.assertEqual(results["claim"]["id"], str(self.job.pk))
        self.assertIsInstance(results["session"], AuthError)
        self.assertEqual(results["session"].status, 409)

    def test_session_winning_terminal_lock_causes_waiting_claim_to_fail(self):
        results = {}
        with transaction.atomic():
            terminal = Terminal.objects.select_for_update().get(pk=self.terminal.pk)
            claim = self.thread(services.claim_job, results, "claim")
            state, token = operate(terminal, "start")
            self.assertIsNotNone(token)
        claim.join(5)
        self.assertFalse(claim.is_alive())
        self.assertIsNone(results["claim"])
        self.job.refresh_from_db()
        self.assertEqual(self.job.status, "FAILED")
