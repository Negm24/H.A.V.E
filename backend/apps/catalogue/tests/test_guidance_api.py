from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory, force_authenticate
from apps.accounts.security.errors import AuthError
from apps.catalogue.api.views.guidance_views import GuidanceView
from .test_guidance import answers, product


@override_settings(DEBUG=True, GUIDANCE_DEMO_ENABLED=True, GROQ_API_KEY="test-key", GROQ_MODEL="test-model")
class GuidanceApiTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.terminal = SimpleNamespace(pk="test-terminal")

    def send(self, data=None):
        request = self.factory.post("/api/v1/terminals/guidance/", data or {"answers": answers(), "demo_consent": True}, format="json")
        force_authenticate(request, user=SimpleNamespace(is_authenticated=False), token={"terminal": self.terminal, "raw_token": "test-session"})
        return GuidanceView.as_view()(request)

    def test_rejects_incomplete_and_unconsented_before_provider(self):
        self.assertEqual(self.send({"answers": {}, "demo_consent": True}).status_code, 400)
        self.assertEqual(self.send({"answers": answers(), "demo_consent": False}).status_code, 400)

    def test_safety_and_production_gate(self):
        result = self.send({"answers": {**answers(), "urgent": ["breathing"]}, "demo_consent": True})
        self.assertEqual(result.data["status"], "urgent")
        with override_settings(DEBUG=False):
            self.assertEqual(self.send().status_code, 503)
        with override_settings(GROQ_API_KEY=""):
            self.assertEqual(self.send().status_code, 503)

    @patch("apps.catalogue.api.views.guidance_views.get_redis_client")
    def test_device_cooldown(self, redis):
        redis.return_value.set.return_value = False
        result = self.send()
        self.assertEqual(result.status_code, 429)
        self.assertEqual(result["Retry-After"], "30")

    @patch("apps.catalogue.api.views.guidance_views.operate")
    @patch("apps.catalogue.api.views.guidance_views.select_with_groq", return_value=1)
    @patch("apps.catalogue.api.views.guidance_views.list_products")
    @patch("apps.catalogue.api.views.guidance_views.get_redis_client")
    def test_rechecks_stock_and_session(self, redis, catalogue, model, session):
        redis.return_value.set.return_value = True
        catalogue.side_effect = [[product()], [product(stock_quantity=0)]]
        result = self.send()
        self.assertEqual(result.data["status"], "no_match")
        self.assertIsNone(result.data["product"])
        session.assert_called_once_with(self.terminal, "read", "test-session")
        catalogue.side_effect = [[product()]]
        session.side_effect = AuthError("Session expired.")
        self.assertEqual(self.send().status_code, 401)

    @patch("apps.catalogue.api.views.guidance_views.select_with_groq")
    @patch("apps.catalogue.api.views.guidance_views.list_products", return_value=[])
    @patch("apps.catalogue.api.views.guidance_views.get_redis_client")
    def test_empty_catalogue_does_not_call_model(self, redis, catalogue, model):
        redis.return_value.set.return_value = True
        self.assertEqual(self.send().data["status"], "no_match")
        model.assert_not_called()
