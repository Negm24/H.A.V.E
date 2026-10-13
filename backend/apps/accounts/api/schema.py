from drf_spectacular.extensions import OpenApiAuthenticationExtension

from apps.accounts.security.authentication import AdvisorAuthentication, HubAuthentication


class HubScheme(OpenApiAuthenticationExtension):
    target_class = HubAuthentication
    name = "HubBearer"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}


class AdvisorScheme(OpenApiAuthenticationExtension):
    target_class = AdvisorAuthentication
    name = "AdvisorBearer"

    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
