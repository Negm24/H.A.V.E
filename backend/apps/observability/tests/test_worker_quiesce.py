from io import StringIO
from threading import Event
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.observability import worker_state
from apps.payments.management.commands.order_worker import Command
from apps.payments.services.worker_services import _run


class WorkerQuiesceTests(SimpleTestCase):
    def setUp(self):
        worker_state.STOP_REQUESTED.clear()
        self.addCleanup(worker_state.STOP_REQUESTED.clear)

    def test_stop_finishes_current_operation_and_exits_before_next_operation(self):
        completed = []
        stats = {"reconciled": 0, "errors": 0}
        def work():
            worker_state.request_stop()
            completed.append("committed")
        with patch("apps.payments.services.worker_services.progress"), patch("apps.observability.worker_state.progress"):
            with self.assertRaises(worker_state.WorkerQuiescing): _run(work, stats, "reconciled")
            with self.assertRaises(worker_state.WorkerQuiescing): _run(lambda: completed.append("unexpected"), stats, "reconciled")
        self.assertEqual(completed, ["committed"])
        self.assertEqual(stats, {"reconciled": 1, "errors": 0})

    def test_command_restores_signals_and_stops_heartbeat_monitor_on_quiesce(self):
        module = "apps.payments.management.commands.order_worker."
        event, thread = Event(), MagicMock()
        command = Command(stdout=StringIO(), stderr=StringIO())
        with patch(module + "signal.signal", return_value="previous") as signals, patch(module + "start_heartbeat_monitor", return_value=(event, thread)), patch(module + "progress") as progress, patch(module + "run_cycle", side_effect=worker_state.WorkerQuiescing) as run:
            command.handle(once=False, interval=5)
        self.assertEqual(run.call_count, 1)
        self.assertTrue(event.is_set())
        thread.join.assert_called_once_with(timeout=1)
        progress.assert_called_with(state="stopped")
        self.assertEqual(signals.call_count, 4)
