"""Stable backend path retained for already-issued Django owner sessions."""
from apps.accounts.security.authentication import OwnerBackend

__all__ = ["OwnerBackend"]

