from django.apps import AppConfig


class ObservabilityConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.observability"

    def ready(self):
        from .api import schema  # noqa: F401
