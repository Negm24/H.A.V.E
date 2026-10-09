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
    DoctorPasswordResetCompleteView,
    DoctorPasswordResetRequestView,
    DoctorPasswordResetVerifyView,
)
from .views.owner_views import (
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
]
