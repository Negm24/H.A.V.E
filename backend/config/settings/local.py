from .base import *

DEBUG = True

# Local runserver uses HTTP. Keep secure cookies enabled in base settings.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Development-only SMS simulation. Never enable for real deployments.
AUTH_CONSOLE_SMS = True
