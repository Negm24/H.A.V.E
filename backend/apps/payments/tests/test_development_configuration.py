from unittest.mock import patch

from django.http import HttpResponse
from django.conf import settings
from django.test import Client, RequestFactory, SimpleTestCase, override_settings

from apps.accounts.security.errors import AuthError
from apps.payments.services import kashier_services as provider
from config.development_middleware import DevelopmentHttpsMiddleware


@override_settings(ALLOWED_HOSTS=["laptop.example.ts.net", "localhost"], DEVELOPMENT_PUBLIC_ORIGINS=["https://laptop.example.ts.net", "https://laptop.example.ts.net:8443"])
class DevelopmentBoundaryTests(SimpleTestCase):
    def respond(self, request):
        response = HttpResponse("https" if request.is_secure() else "http")
        response.set_cookie("example", "test", httponly=True, samesite="Strict")
        return response

    def test_exact_proxy_header_marks_https_and_secures_response_cookies(self):
        request = RequestFactory().get("/", HTTP_HOST="laptop.example.ts.net", HTTP_X_HAVE_FORWARDED_PROTO="https")
        response = DevelopmentHttpsMiddleware(self.respond)(request)
        self.assertEqual(response.content, b"https")
        self.assertTrue(response.cookies["example"]["secure"])
        self.assertEqual(response.cookies["example"]["samesite"], "Strict")

    def test_standard_forwarding_header_does_not_establish_trust(self):
        request = RequestFactory().get("/", HTTP_HOST="laptop.example.ts.net", HTTP_X_FORWARDED_PROTO="https")
        self.assertEqual(DevelopmentHttpsMiddleware(self.respond)(request).status_code, 400)

    def test_localhost_stays_http_and_does_not_trust_forwarding_headers(self):
        request = RequestFactory().get("/", HTTP_HOST="localhost", HTTP_X_HAVE_FORWARDED_PROTO="https")
        response = DevelopmentHttpsMiddleware(self.respond)(request)
        self.assertEqual(response.content, b"http")
        self.assertFalse(response.cookies["example"]["secure"])

    def test_kiosk_requires_the_configured_port_and_secure_proxy_marker(self):
        factory = RequestFactory()
        request = factory.get("/", HTTP_HOST="laptop.example.ts.net:8443", HTTP_X_HAVE_FORWARDED_PROTO="https")
        response = DevelopmentHttpsMiddleware(self.respond)(request)
        self.assertEqual(response.content, b"https")
        self.assertTrue(response.cookies["example"]["secure"])
        request = factory.get("/", HTTP_HOST="laptop.example.ts.net:10000", HTTP_X_HAVE_FORWARDED_PROTO="https")
        self.assertEqual(DevelopmentHttpsMiddleware(self.respond)(request).content, b"http")

    def test_real_csrf_roundtrip_accepts_matching_https_origin_and_rejects_cross_site(self):
        client = Client(enforce_csrf_checks=True)
        headers = {"HTTP_HOST": "laptop.example.ts.net", "HTTP_X_HAVE_FORWARDED_PROTO": "https"}
        middleware = ["config.development_middleware.DevelopmentHttpsMiddleware", *[item for item in settings.MIDDLEWARE if item != "config.development_middleware.DevelopmentHttpsMiddleware"]]
        with override_settings(MIDDLEWARE=middleware, CSRF_TRUSTED_ORIGINS=["https://laptop.example.ts.net"]):
            response = client.get("/api/v1/auth/csrf/", **headers)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.cookies[settings.CSRF_COOKIE_NAME]["secure"])
            token = response.json()["csrf_token"]
            # No refresh cookie: 401 proves CSRF passed, without creating any login.
            same = client.post("/api/v1/auth/customers/hub/refresh/", data={}, content_type="application/json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://laptop.example.ts.net", **headers)
            self.assertEqual(same.status_code, 401)
            wrong = client.post("/api/v1/auth/customers/hub/refresh/", data={}, content_type="application/json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="https://evil.example", **headers)
            self.assertEqual(wrong.status_code, 403)

    @override_settings(KASHIER_DEFAULT_TEST_KEY="test", KASHIER_SECRET_KEY="test", KASHIER_MERCHANT_ID="MID-TEST", PAYMENTS_PUBLIC_BASE_URL="https://hub.example", KIOSK_PUBLIC_BASE_URL="https://kiosk.example")
    def test_origins_and_invalid_configuration_fail_before_provider_io(self):
        self.assertEqual(provider.checkout_base_url("HUB"), "https://hub.example")
        self.assertEqual(provider.checkout_base_url("TERMINAL"), "https://kiosk.example")
        with patch.object(provider, "urlopen") as network:
            for origin in ["", "http://localhost:5173", "https://localhost", "https://name:password@example.com", "https://example.com/path", "https://example.com?redirect=evil", "https://example.com#fragment", "https://example.com:invalid"]:
                with self.subTest(origin=origin), override_settings(KIOSK_PUBLIC_BASE_URL=origin), self.assertRaises(AuthError):
                    provider.checkout_base_url("TERMINAL")
            network.assert_not_called()

    @override_settings(KASHIER_DEFAULT_TEST_KEY="test", KASHIER_SECRET_KEY="test", KASHIER_MERCHANT_ID="MID-TEST",
                       PAYMENTS_PUBLIC_BASE_URL="https://laptop.example.ts.net",
                       KIOSK_PUBLIC_BASE_URL="https://laptop.example.ts.net:8443",
                       DEVELOPMENT_KIOSK_PUBLIC_ORIGIN="https://laptop.example.ts.net:8443")
    def test_nonstandard_payment_port_is_allowed_only_for_the_configured_development_kiosk(self):
        self.assertEqual(provider.checkout_base_url("TERMINAL"), "https://laptop.example.ts.net:8443")
        self.assertFalse(provider.valid_public_origin("https://laptop.example.ts.net:8443"))
        for value in ("https://other.example.ts.net:8443", "https://laptop.example.ts.net:10000"):
            with self.subTest(value=value), override_settings(KIOSK_PUBLIC_BASE_URL=value), self.assertRaises(AuthError):
                provider.checkout_base_url("TERMINAL")
        with override_settings(DEVELOPMENT_KIOSK_PUBLIC_ORIGIN=""), self.assertRaises(AuthError):
            provider.checkout_base_url("TERMINAL")
        with override_settings(PAYMENTS_PUBLIC_BASE_URL="https://laptop.example.ts.net:8443"), self.assertRaises(AuthError):
            provider.checkout_base_url("HUB")
