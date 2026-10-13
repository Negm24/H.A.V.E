from rest_framework.permissions import BasePermission


class IsOwner(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return (
            user.is_authenticated
            and user.account_type == "OWNER"
            and user.is_active
            and user.is_staff
        )


def eligible_customer(user):
    return bool(user and user.account_type == "CUSTOMER" and user.is_active and user.phone_verified_at)


def eligible_doctor(user):
    """Advisor access: owner-approved and MFA-enrolled. Approval alone is not login."""
    return bool(
        user and user.account_type == "DOCTOR" and user.is_active
        and user.doctor.approval_status == "APPROVED" and user.doctor.mfa_enrolled_at
    )
