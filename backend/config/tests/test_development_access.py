import json
from pathlib import Path
from tempfile import TemporaryDirectory

from django.test import SimpleTestCase

from config.development_access import load_development_access


class DevelopmentAccessTests(SimpleTestCase):
    def setUp(self):
        folder = TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "access.local.json"
        self.valid = {"hubPublicOrigin": "https://laptop.example.ts.net",
                      "kioskPublicOrigin": "https://laptop.example.ts.net:8443",
                      "kioskAccessPassword": "private-test-password"}

    def read(self, data):
        self.path.write_text(json.dumps(data), encoding="utf-8")
        return load_development_access(self.path)

    def test_missing_file_means_localhost_only(self):
        self.assertIsNone(load_development_access(self.path))

    def test_accepts_exact_origins_and_a_utf8_bom(self):
        self.assertEqual(self.read(self.valid), self.valid)
        self.path.write_text(json.dumps(self.valid), encoding="utf-8-sig")
        self.assertEqual(load_development_access(self.path), self.valid)

    def test_invalid_file_fails_without_disclosing_password(self):
        self.path.write_text("not JSON", encoding="utf-8")
        with self.assertRaisesMessage(ValueError, "JSON syntax"):
            load_development_access(self.path)
        for changes in ({"extra": "field"}, {"kioskAccessPassword": ""}, {"kioskAccessPassword": "x" * 257}, {"hubPublicOrigin": None}):
            with self.subTest(changes=list(changes)), self.assertRaises(ValueError):
                self.read(self.valid | changes)

    def test_rejects_broad_hosts_paths_credentials_and_arbitrary_ports(self):
        for value in ("http://laptop.example.ts.net", "https://*.ts.net", "https://laptop.example.ts.net/",
                      "https://laptop.example.ts.net/path", "https://laptop.example.ts.net?x=1",
                      "https://laptop.example.ts.net#fragment", "https://user:secret@laptop.example.ts.net",
                      "https://localhost", "https://127.0.0.1", "https://laptop.example.ts.net:443",
                      "https://laptop.example.ts.net:8443", "https://laptop.example.ts.net:10000"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.read(self.valid | {"hubPublicOrigin": value})
        with self.assertRaises(ValueError):
            self.read(self.valid | {"kioskPublicOrigin": self.valid["hubPublicOrigin"]})
