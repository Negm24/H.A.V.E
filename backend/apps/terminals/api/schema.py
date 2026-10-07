from drf_spectacular.extensions import OpenApiAuthenticationExtension

from apps.terminals.security.authentication import TerminalDeviceAuthentication, TerminalSessionAuthentication


class DeviceScheme(OpenApiAuthenticationExtension):
    target_class = TerminalDeviceAuthentication
    name = ["TerminalSerial", "TerminalKey"]

    def get_security_definition(self, auto_schema):
        return [
            {"type": "apiKey", "in": "header", "name": "X-Terminal-Serial"},
            {"type": "apiKey", "in": "header", "name": "X-Terminal-Key"},
        ]


class TerminalScheme(DeviceScheme):
    target_class = TerminalSessionAuthentication
    name = ["TerminalSerial", "TerminalKey", "TerminalBearer"]

    def get_security_requirement(self, auto_schema):
        names = self.name if getattr(auto_schema.view, "terminal_session_required", True) else self.name[:2]
        return {name: [] for name in names}

    def get_security_definition(self, auto_schema):
        return super().get_security_definition(auto_schema) + [
            {"type": "http", "scheme": "bearer", "bearerFormat": "Opaque session token"},
        ]
