from unittest.mock import patch
from urllib.error import URLError

from django.test import SimpleTestCase, override_settings

from apps.payments.services import kashier_services as provider


@override_settings(KASHIER_DEFAULT_TEST_KEY="sandbox-test", KASHIER_SECRET_KEY="sandbox-test",
                   KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://hub.example",
                   KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
class ProviderTimeoutClassificationTests(SimpleTestCase):
    def test_only_known_transport_timeout_records_a_timeout(self):
        for failure in (TimeoutError(), URLError(TimeoutError()), URLError("Unknown network failure")):
            with self.subTest(kind=type(failure).__name__), patch.object(provider, "urlopen", side_effect=failure), \
                    patch.object(provider, "record_provider_timeout") as record:
                with self.assertRaises(provider.ProviderUnavailable):
                    provider._call(provider.API, "/v3/orders")
                self.assertEqual(record.call_count, 0 if isinstance(failure, URLError) and not isinstance(failure.reason, TimeoutError) else 1)
