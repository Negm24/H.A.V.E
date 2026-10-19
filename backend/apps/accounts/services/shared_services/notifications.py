"""Explicit local SMS simulation and owner email notifications."""
import logging

from django.conf import settings
from django.core.mail import send_mail

from apps.accounts.security.errors import AuthError

logger = logging.getLogger(__name__)


def require_sms_delivery():
    # Explicit development opt-in; public tunnel testing keeps DEBUG disabled.
    if not settings.AUTH_CONSOLE_SMS:
        raise AuthError("SMS delivery is not configured.", 503)


def send_verification_sms(*, purpose, challenge_id, phone_number, code):
    require_sms_delivery()
    # The only intentional secret output: a development console, never normal logs.
    print(f"[MOCK SMS — {purpose}] {phone_number} | challenge={challenge_id} | code={code}", flush=True)


def send_verification_email(*, purpose, challenge_id, email, code):
    """Signup email code. Raises OSError/SMTPException so the caller can fail closed."""
    send_mail(
        subject="H.A.V.E: your email verification code",
        message=(
            f"Your H.A.V.E verification code is {code}.\n\n"
            f"It expires in {settings.CUSTOMER_SIGNUP_CODE_SECONDS // 60} minutes. "
            "If you did not start a signup, ignore this email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[email],
    )
    logger.info("Verification email sent: purpose=%s challenge=%s", purpose, challenge_id)


def send_doctor_rejection_email(*, email, first_name, reason, can_reapply, doctor_id):
    """Best effort: sign-in still shows the rejection if this email fails (FR-82e)."""
    lines = [f"Dear Dr. {first_name},", "",
             "Your H.A.V.E Advisor application was not approved."]
    if reason:
        lines += ["", f"Reason: {reason}"]
    if can_reapply:
        lines += ["", "You can apply again from the Advisor sign-in page."]
    try:
        send_mail(
            subject="H.A.V.E: your Advisor application",
            message="\n".join(lines),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
        )
    except Exception:
        logger.exception("Rejection email for doctor application %s failed.", doctor_id)


def notify_owner_of_doctor_application(user):
    """Announce a pending application; details are reviewed only in the dashboard."""
    if not settings.OWNER_NOTIFICATION_EMAIL:
        logger.warning("Doctor application %s received; no owner notification email configured.", user.pk)
        return
    try:
        send_mail(
            subject="H.A.V.E: new doctor application awaiting review",
            message=(
                f"A doctor application is waiting for review.\n\n"
                f"Application ID: {user.pk}\n"
                f"Name: Dr. {user.get_full_name()}\n"
                f"Specialty: {user.doctor.specialty}\n\n"
                "Sign in to the owner dashboard to review and approve or reject it."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[settings.OWNER_NOTIFICATION_EMAIL],
        )
    except Exception:
        # Notification is a convenience: the application stays reviewable in the dashboard.
        logger.exception("Owner notification for doctor application %s failed.", user.pk)
