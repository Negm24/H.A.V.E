from django.urls import include, path

from .views.session_views import TerminalStartView, TerminalActivityView, TerminalEndView
from .views.cart_views import CartView, CartItemView, CartRevisionView
from .views.availability_views import TerminalAvailabilityView, TerminalHeartbeatView


urlpatterns = [
    path("sessions/", TerminalStartView.as_view(), name="terminal-session-start"),
    path("sessions/activity/", TerminalActivityView.as_view(), name="terminal-session-activity"),
    path("sessions/end/", TerminalEndView.as_view(), name="terminal-session-end"),
    path("cart/", CartView.as_view(), name="terminal-cart"),
    path("cart/version/", CartRevisionView.as_view(), name="terminal-cart-version"),
    path("cart/items/<int:product_id>/", CartItemView.as_view(), name="terminal-cart-item"),
    path("availability/", TerminalAvailabilityView.as_view(), name="terminal-availability"),
    path("heartbeat/", TerminalHeartbeatView.as_view(), name="terminal-heartbeat"),
    path("catalogue/", include("apps.catalogue.api.urls")),
]
