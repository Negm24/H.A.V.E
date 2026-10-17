"""Opt-in local HTTPS tunnel testing; not a production deployment."""
import re

from .local import *

# Never expose Django's environment/traceback debug pages through a public tunnel.
DEBUG = False

TUNNEL_HOSTS = []
for variable in ("HUB_TUNNEL_HOST", "KIOSK_TUNNEL_HOST"):
    host = env(variable, default="").strip()
    if host:
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com", host):
            raise ValueError(f"{variable} must be one exact trycloudflare.com hostname, without scheme or path.")
        TUNNEL_HOSTS.append(host)

ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, "backend", *TUNNEL_HOSTS]))
CSRF_TRUSTED_ORIGINS = [f"https://{host}" for host in TUNNEL_HOSTS]
# Only the private frontend proxies set this header, after stripping browser input.
# The ordinary X-Forwarded-Proto header is deliberately not trusted.
MIDDLEWARE = ["config.tunnel_middleware.TunnelMiddleware", *MIDDLEWARE]
