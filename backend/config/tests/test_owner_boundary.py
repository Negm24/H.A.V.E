from pathlib import Path
from tempfile import TemporaryDirectory

from django.http import Http404, HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from config.media import catalogue_image
from config.owner_boundary import OwnerBoundaryMiddleware


@override_settings(ALLOWED_HOSTS=["*"], OWNER_ALLOWED_AUTHORITIES=["localhost:5176", "device.example.ts.net:9443"])
class OwnerOriginBoundaryTests(SimpleTestCase):
    def test_public_ports_cannot_access_owner_routes_even_with_session_cookie(self):
        middleware = OwnerBoundaryMiddleware(lambda request: HttpResponse(status=204))
        for host in ("device.example.ts.net", "device.example.ts.net:8443", "localhost:5174", "localhost:5175"):
            for path in ("/api/v1/owner/session/", "/api/v1/auth/owners/login/", "/api/v1/auth/owners/orders/"):
                request = RequestFactory().get(path, HTTP_HOST=host, HTTP_COOKIE="sessionid=private",
                                               HTTP_X_FORWARDED_HOST="device.example.ts.net:9443")
                self.assertEqual(middleware(request).status_code, 404)

    def test_private_origin_and_customer_routes_pass_to_authentication(self):
        middleware = OwnerBoundaryMiddleware(lambda request: HttpResponse(status=204))
        for path, host in (("/api/v1/owner/session/", "device.example.ts.net:9443"),
                           ("/api/v1/auth/owners/login/", "localhost:5176"),
                           ("/api/v1/hub/orders/", "device.example.ts.net")):
            self.assertEqual(middleware(RequestFactory().get(path, HTTP_HOST=host)).status_code, 204)

    def test_public_origin_or_referer_cannot_use_private_host_with_shared_cookies(self):
        middleware = OwnerBoundaryMiddleware(lambda request: HttpResponse(status=204))
        for headers in ({"HTTP_ORIGIN": "https://device.example.ts.net"},
                        {"HTTP_ORIGIN": "https://device.example.ts.net:8443"},
                        {"HTTP_REFERER": "https://device.example.ts.net/page"}):
            request = RequestFactory().post("/api/v1/owner/session/activity/", secure=True,
                HTTP_HOST="device.example.ts.net:9443", HTTP_COOKIE="sessionid=private; csrftoken=shared", **headers)
            self.assertEqual(middleware(request).status_code, 403)
        request = RequestFactory().post("/api/v1/owner/session/activity/", secure=True,
            HTTP_HOST="device.example.ts.net:9443", HTTP_ORIGIN="https://device.example.ts.net:9443")
        self.assertEqual(middleware(request).status_code, 204)


class CatalogueMediaBoundaryTests(SimpleTestCase):
    def test_only_catalogue_images_can_be_read_without_authentication(self):
        with TemporaryDirectory() as folder, override_settings(MEDIA_ROOT=folder):
            root = Path(folder)
            (root / "products").mkdir()
            (root / "products" / "example.png").write_bytes(b"image")
            (root / "private.txt").write_text("private")
            request = RequestFactory().get("/media/products/example.png")
            response = catalogue_image(request, "products/example.png")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["X-Content-Type-Options"], "nosniff")
            response.close()
            for path in ("private.txt", "products/../private.txt", "products/../../outside.png", "products", "products/missing.png"):
                with self.subTest(path=path), self.assertRaises(Http404):
                    catalogue_image(request, path)
