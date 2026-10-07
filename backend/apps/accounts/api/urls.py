from django.urls import path

from .views.customer_views import CustomerHubLoginView, CustomerHubMeView, CustomerHubRefreshView, CustomerHubLogoutView
from .views.customer_views import CustomerSignupView, CustomerSignupVerificationView
from .views.owner_views import OwnerLoginView, OwnerLogoutView, OwnerMeView
from .views.shared_views import CsrfTokenView
from .views.terminal_views import CustomerTerminalLoginView, CustomerTerminalMeView


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
]
