from rest_framework.permissions import BasePermission


class HasTerminalAccess(BasePermission):
    def has_permission(self, request, view):
        return bool(request.auth and request.auth.get("terminal"))
