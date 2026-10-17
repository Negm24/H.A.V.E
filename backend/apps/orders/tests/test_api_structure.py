from uuid import uuid4

from django.test import SimpleTestCase
from django.urls import resolve

from apps.accounts.security.authentication import HubAuthentication
from apps.terminals.security.authentication import TerminalSessionAuthentication


class OrderApiStructureTests(SimpleTestCase):
    def test_routed_order_handlers_live_with_their_role(self):
        order_id = uuid4()
        routes = [
            ("/api/v1/hub/orders/", "hub_views", "HubOrdersView"),
            ("/api/v1/hub/orders/checkout/", "hub_views", "HubCheckoutView"),
            (f"/api/v1/hub/orders/{order_id}/", "hub_views", "HubOrderDetailView"),
            ("/api/v1/terminals/orders/", "terminal_views", "TerminalOrdersView"),
            ("/api/v1/terminals/orders/checkout/", "terminal_views", "TerminalCheckoutView"),
            (f"/api/v1/terminals/orders/{order_id}/result/", "terminal_views", "TerminalPaymentResultView"),
            (f"/api/v1/auth/owners/orders/{order_id}/cancel/", "owner_views", "OwnerOrderCancelView"),
            (f"/api/v1/auth/owners/orders/{order_id}/reconcile/", "owner_views", "OwnerOrderReconcileView"),
        ]
        for path, module, name in routes:
            with self.subTest(path=path):
                handler = resolve(path).func.cls
                self.assertEqual(handler.__name__, name)
                self.assertEqual(handler.__module__, "apps.orders.api.views." + module)

    def test_shared_http_operations_keep_explicit_role_authentication(self):
        from apps.orders.api.views.hub_views import HubCheckoutView, HubOrderView
        from apps.orders.api.views.terminal_views import TerminalCheckoutView, TerminalOrderView
        from apps.orders.api.views.shared_views import CheckoutView
        self.assertTrue(issubclass(HubCheckoutView, CheckoutView))
        self.assertTrue(issubclass(TerminalCheckoutView, CheckoutView))
        self.assertEqual(HubCheckoutView.authentication_classes, [HubAuthentication])
        self.assertEqual(TerminalCheckoutView.authentication_classes, [TerminalSessionAuthentication])
        self.assertFalse(issubclass(TerminalOrderView, HubOrderView))
        self.assertFalse(HubCheckoutView.terminal_flow)
        self.assertTrue(TerminalCheckoutView.terminal_flow)
