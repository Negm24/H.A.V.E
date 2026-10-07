from django.apps import AppConfig


class TerminalsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.terminals"

    def ready(self):
        # Register documentation extensions explicitly, independent of URL imports.
        from .api import schema  # noqa: F401
