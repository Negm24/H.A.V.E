from drf_spectacular.extensions import OpenApiAuthenticationExtension


class HostAgentAuthenticationScheme(OpenApiAuthenticationExtension):
    target_class = "apps.observability.api.views.HostAgentAuthentication"
    name = "HostAgentKey"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "description": "Private, host-agent-only key. Never sent to the browser."}
