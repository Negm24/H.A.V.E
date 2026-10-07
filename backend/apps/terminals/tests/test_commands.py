import io

from django.core.management import call_command
from django.test import TestCase, override_settings

from apps.terminals.models import Terminal
from apps.terminals.tests.helpers import SessionFixtures


@override_settings(TERMINAL_IDLE_SECONDS=120, TERMINAL_MAX_SECONDS=600,
                   PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class TerminalCommandTests(SessionFixtures, TestCase):
    def setUp(self):
        self.setup_sessions()

    def test_provision_and_rotate_commands(self):
        output = io.StringIO()
        call_command("provision_terminal", serial="COMMAND-001", name="Command Test",
                     address_en="Test", address_ar="اختبار", latitude="30", longitude="31", stdout=output)
        terminal = Terminal.objects.get(pk="COMMAND-001")
        old_hash = terminal.device_credential_hash
        self.assertNotIn(old_hash, output.getvalue())
        call_command("rotate_terminal_key", "COMMAND-001", stdout=io.StringIO())
        terminal.refresh_from_db()
        self.assertNotEqual(old_hash, terminal.device_credential_hash)
