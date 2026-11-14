"""Optional private HTTPS development settings, outside the served source tree."""
import json
from pathlib import Path
import re
from urllib.parse import urlsplit


ACCESS_FILE = Path(__file__).resolve().parents[2] / "development" / "access.local.json"


def load_development_access(path=ACCESS_FILE):
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        raise ValueError("Cannot read development/access.local.json. Check its JSON syntax and permissions.") from None
    fields = {"hubPublicOrigin", "kioskPublicOrigin", "kioskAccessPassword"}
    if (not isinstance(data, dict) or not fields.issubset(data)
            or set(data) - fields - {"ownerPrivateOrigin", "advisorPublicOrigin"}
            or any(not isinstance(data[key], str) for key in fields)):
        raise ValueError("development/access.local.json requires exactly hubPublicOrigin, kioskPublicOrigin and kioskAccessPassword strings.")
    for field, ports in (("hubPublicOrigin", (None, 443)), ("kioskPublicOrigin", (None, 443, 8443))):
        value = data[field]
        try:
            url = urlsplit(value)
            valid = (url.scheme == "https" and url.hostname and url.port in ports
                     and not url.username and not url.password and not url.path and not url.query and not url.fragment
                     and re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", url.hostname)
                     and not re.fullmatch(r"[0-9.]+", url.hostname)
                     and value == f"https://{url.hostname}" + (f":{url.port}" if url.port not in (None, 443) else ""))
        except ValueError:
            valid = False
        if not valid:
            raise ValueError(f"{field} must be an exact HTTPS development origin with a permitted port, without a path or trailing slash.")
    if data["hubPublicOrigin"] == data["kioskPublicOrigin"]:
        raise ValueError("Hub and Kiosk must use different public origins.")
    if not 16 <= len(data["kioskAccessPassword"]) <= 256:
        raise ValueError("kioskAccessPassword must contain 16 to 256 characters.")
    if "ownerPrivateOrigin" in data:
        try:
            value = data["ownerPrivateOrigin"]
            owner = urlsplit(value)
            valid = (owner.scheme == "https" and owner.port == 9443
                     and not owner.username and not owner.password and not owner.path
                     and not owner.query and not owner.fragment and owner.hostname
                     and re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", owner.hostname)
                     and not re.fullmatch(r"[0-9.]+", owner.hostname)
                     and value == f"https://{owner.hostname}:9443")
        except (ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            raise ValueError("ownerPrivateOrigin must be an exact HTTPS origin on private port 9443.")
    if "advisorPublicOrigin" in data:
        try:
            value = data["advisorPublicOrigin"]
            advisor = urlsplit(value)
            valid = (advisor.scheme == "https" and (advisor.port == 10000 or value == data["hubPublicOrigin"])
                     and not advisor.username and not advisor.password and not advisor.path
                     and not advisor.query and not advisor.fragment and advisor.hostname
                     and re.fullmatch(r"[a-z0-9]+(?:[.-][a-z0-9]+)+", advisor.hostname)
                     and not re.fullmatch(r"[0-9.]+", advisor.hostname)
                     and value == f"https://{advisor.hostname}" + (":10000" if advisor.port == 10000 else ""))
        except (ValueError, TypeError, AttributeError):
            valid = False
        if not valid:
            raise ValueError("advisorPublicOrigin must be the exact Hub HTTPS origin or an exact HTTPS origin on port 10000.")
    return data
