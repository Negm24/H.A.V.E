from django.urls import path

from .views.customer_views import (
    CustomerHubLoginView,
    CustomerHubLogoutView,
    CustomerHubMeView,
    CustomerHubPinResetCompleteView,
    CustomerHubPinResetRequestView,
    CustomerHubPinResetVerifyView,
    CustomerHubQrConfirmView,
    CustomerHubQrScanView,
    CustomerHubQrStatusView,
    CustomerHubRefreshView,
    CustomerSignupVerificationView,
    CustomerSignupView,
)
from .views.doctor_views import (
    DoctorLoginMfaView,
    DoctorLoginView,
    DoctorLogoutView,
    DoctorMeView,
    DoctorPasswordResetCompleteView,
    DoctorPasswordResetRequestView,
    DoctorPasswordResetVerifyView,
    DoctorRefreshView,
    DoctorSignupVerificationView,
    DoctorSignupView,
)
from .views.owner_views import (
    OwnerDoctorDecisionView,
    OwnerDoctorDetailView,
    OwnerDoctorListView,
    OwnerLoginView,
    OwnerLogoutView,
    OwnerMeView,
    OwnerPasswordResetCompleteView,
    OwnerPasswordResetRequestView,
    OwnerPasswordResetVerifyView,
)
from .views.shared_views import CsrfTokenView
from .views.terminal_views import (
    CustomerTerminalLoginView,
    CustomerTerminalMeView,
    CustomerTerminalQrCompleteView,
    CustomerTerminalQrCreateView,
    CustomerTerminalQrStatusView,
)


app_name = "accounts_api"

urlpatterns = [
    path("customers/hub/login/", CustomerHubLoginView.as_view(), name="hub-login"),
    path("customers/hub/me/", CustomerHubMeView.as_view(), name="hub-me"),
    path("customers/hub/refresh/", CustomerHubRefreshView.as_view(), name="hub-refresh"),
    path("customers/hub/logout/", CustomerHubLogoutView.as_view(), name="hub-logout"),
    path("customers/terminal/login/", CustomerTerminalLoginView.as_view(), name="terminal-login"),
    path("customers/terminal/me/", CustomerTerminalMeView.as_view(), name="terminal-me"),
    path("customers/signup/", CustomerSignupView.as_view(), name="customer-signup"),
    path("customers/signup/verify/", CustomerSignupVerificationView.as_view(), name="customer-signup-verify"),
    path("csrf/", CsrfTokenView.as_view(), name="csrf"),
    path("owners/login/", OwnerLoginView.as_view(), name="owner-login"),
    path("owners/me/", OwnerMeView.as_view(), name="owner-me"),
    path("owners/logout/", OwnerLogoutView.as_view(), name="owner-logout"),
    # Login-page recovery routes fix the role.
    path("customers/hub/pin-reset/request/", CustomerHubPinResetRequestView.as_view(), name="customers-hub-pin-reset-request"),
    path("customers/hub/pin-reset/verify/", CustomerHubPinResetVerifyView.as_view(), name="customers-hub-pin-reset-verify"),
    path("customers/hub/pin-reset/complete/", CustomerHubPinResetCompleteView.as_view(), name="customers-hub-pin-reset-complete"),
    path("doctors/password-reset/request/", DoctorPasswordResetRequestView.as_view(), name="doctors-password-reset-request"),
    path("doctors/password-reset/verify/", DoctorPasswordResetVerifyView.as_view(), name="doctors-password-reset-verify"),
    path("doctors/password-reset/complete/", DoctorPasswordResetCompleteView.as_view(), name="doctors-password-reset-complete"),
    path("owners/password-reset/request/", OwnerPasswordResetRequestView.as_view(), name="owners-password-reset-request"),
    path("owners/password-reset/verify/", OwnerPasswordResetVerifyView.as_view(), name="owners-password-reset-verify"),
    path("owners/password-reset/complete/", OwnerPasswordResetCompleteView.as_view(), name="owners-password-reset-complete"),


    path("customers/terminal/qr-login/", CustomerTerminalQrCreateView.as_view(), name="terminal-qr-create"),
    path("customers/terminal/qr-login/<uuid:challenge_id>/", CustomerTerminalQrStatusView.as_view(), name="terminal-qr-status"),
    path("customers/terminal/qr-login/<uuid:challenge_id>/complete/", CustomerTerminalQrCompleteView.as_view(), name="terminal-qr-complete"),
    path("customers/hub/qr-login/scan/", CustomerHubQrScanView.as_view(), name="hub-qr-scan"),
    path("customers/hub/qr-login/<uuid:challenge_id>/", CustomerHubQrStatusView.as_view(), name="hub-qr-status"),
    path("customers/hub/qr-login/<uuid:challenge_id>/confirm/", CustomerHubQrConfirmView.as_view(), name="hub-qr-confirm"),

    # Advisor doctors: SMS-verified application, then password + TOTP sign-in.
    path("doctors/signup/", DoctorSignupView.as_view(), name="doctor-signup"),
    path("doctors/signup/verify/", DoctorSignupVerificationView.as_view(), name="doctor-signup-verify"),
    path("doctors/login/", DoctorLoginView.as_view(), name="doctor-login"),
    path("doctors/login/mfa/", DoctorLoginMfaView.as_view(), name="doctor-login-mfa"),
    path("doctors/refresh/", DoctorRefreshView.as_view(), name="doctor-refresh"),
    path("doctors/logout/", DoctorLogoutView.as_view(), name="doctor-logout"),
    path("doctors/me/", DoctorMeView.as_view(), name="doctor-me"),

    # Owner review of doctor applications: owner session cookie + CSRF.
    path("owners/doctors/", OwnerDoctorListView.as_view(), name="owner-doctors"),
    path("owners/doctors/<str:doctor_id>/", OwnerDoctorDetailView.as_view(), name="owner-doctor-detail"),
    path("owners/doctors/<str:doctor_id>/decision/", OwnerDoctorDecisionView.as_view(), name="owner-doctor-decision"),
]
