"""Private simulator links from non-secret local identifiers only."""
import json
from pathlib import Path
import re
from urllib.parse import urlencode, urlsplit

from django.conf import settings


def simulator_url(terminal, *, paths=None):
    paths = paths if paths is not None else [Path("/development/simulators.local.json"),
             Path(settings.BASE_DIR).parent / "development" / "simulators.local.json"]
    for path in paths:
        try:
            if path.stat().st_size > 65536:
                return None
            mapping = json.loads(path.read_text(encoding="utf-8-sig"))
        except FileNotFoundError:
            continue
        except (OSError, ValueError):
            return None
        value = mapping.get(terminal.pk) if isinstance(mapping, dict) else None
        if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
            return None
        base = getattr(settings, "KIOSK_PUBLIC_BASE_URL", "") or "http://localhost:5173"
        try:
            parsed = urlsplit(base)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                return None
        except ValueError:
            return None
        return base.rstrip("/") + "/?" + urlencode({"terminal": value})
    return None
