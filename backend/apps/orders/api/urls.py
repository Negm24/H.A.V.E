from django.urls import path
from .views.hub_views import (
    CollectionTerminalsView, HubCheckoutView, HubOrdersView, HubOrderDetailView, HubOrderCancelView, HubOrderReorderView,
    HubOrderResumeView, HubOrderSummaryView,
)
from .views.terminal_views import (
    TerminalCheckoutView, TerminalOrdersView, TerminalOrderDetailView, TerminalOrderCancelView, TerminalOrderReorderView,
    TerminalOrderCollectView, TerminalPaymentResultView, TerminalPaymentResultEndView,
    TerminalPaymentResultActivityView,
    TerminalOrderResumeView, TerminalOrderSummaryView,
    TerminalPaymentContinueView,
)
from .views.owner_views import OwnerOrderCancelView, OwnerOrderReconcileView

hub_urlpatterns = [
    path("", HubOrdersView.as_view(), name="hub-orders"),
    path("terminals/", CollectionTerminalsView.as_view(), name="hub-collection-terminals"),
    path("checkout/", HubCheckoutView.as_view(), name="hub-checkout"),
    path("summary/", HubOrderSummaryView.as_view(), name="hub-order-summary"),
    path("<uuid:order_id>/", HubOrderDetailView.as_view(), name="hub-order-detail"),
    path("<uuid:order_id>/cancel/", HubOrderCancelView.as_view(), name="hub-order-cancel"),
    path("<uuid:order_id>/reorder/", HubOrderReorderView.as_view(), name="hub-order-reorder"),
    path("<uuid:order_id>/resume/", HubOrderResumeView.as_view(), name="hub-order-resume"),
]
terminal_urlpatterns = [
    path("", TerminalOrdersView.as_view(), name="terminal-orders"),
    path("checkout/", TerminalCheckoutView.as_view(), name="terminal-checkout"),
    path("summary/", TerminalOrderSummaryView.as_view(), name="terminal-order-summary"),
    path("<uuid:order_id>/", TerminalOrderDetailView.as_view(), name="terminal-order-detail"),
    path("<uuid:order_id>/cancel/", TerminalOrderCancelView.as_view(), name="terminal-order-cancel"),
    path("<uuid:order_id>/reorder/", TerminalOrderReorderView.as_view(), name="terminal-order-reorder"),
    path("<uuid:order_id>/resume/", TerminalOrderResumeView.as_view(), name="terminal-order-resume"),
    path("<uuid:order_id>/collect/", TerminalOrderCollectView.as_view(), name="terminal-order-collect"),
    path("<uuid:order_id>/result/", TerminalPaymentResultView.as_view(), name="terminal-payment-result"),
    path("<uuid:order_id>/result/end/", TerminalPaymentResultEndView.as_view(), name="terminal-payment-result-end"),
    path("<uuid:order_id>/result/continue/", TerminalPaymentContinueView.as_view(), name="terminal-payment-result-continue"),
    path("<uuid:order_id>/result/activity/", TerminalPaymentResultActivityView.as_view(), name="terminal-payment-result-activity"),
]
owner_urlpatterns = [
    path("<uuid:order_id>/cancel/", OwnerOrderCancelView.as_view(), name="owner-order-cancel"),
    path("<uuid:order_id>/reconcile/", OwnerOrderReconcileView.as_view(), name="owner-order-reconcile"),
]
