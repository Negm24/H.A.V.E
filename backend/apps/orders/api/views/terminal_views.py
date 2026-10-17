from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.carts.api.serializers.cart_serializers import CartOutputSerializer
from apps.orders.api.serializers.order_serializers import CheckoutInputSerializer, CheckoutOutputSerializer, OrderOutputSerializer, ReorderInputSerializer
from apps.orders.services.order_services import fulfil_order
from apps.payments.models import PaymentTransaction
from apps.payments.security.return_authorization import cookie_name, return_payment
from apps.payments.services.payment_services import reconcile
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess
from .shared_views import TERMINAL, _data, OrderViewBase, CheckoutView, OrdersView, OrderDetailView, OrderCancelView, OrderReorderView


class TerminalOrderView(OrderViewBase):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]
    terminal_flow = True


class TerminalOrdersView(OrdersView, TerminalOrderView):
    @extend_schema(tags=[TERMINAL], responses={200: OrderOutputSerializer(many=True), **ERRORS})
    def get(self, request):
        return super().get(request)


class TerminalCheckoutView(CheckoutView, TerminalOrderView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]
    terminal_flow = True

    @extend_schema(tags=[TERMINAL], request=CheckoutInputSerializer, responses={200: CheckoutOutputSerializer, **ERRORS})
    def post(self, request):
        return super().post(request)


class TerminalOrderDetailView(OrderDetailView, TerminalOrderView):
    @extend_schema(tags=[TERMINAL], responses={200: OrderOutputSerializer, **ERRORS})
    def get(self, request, order_id):
        return super().get(request, order_id)


class TerminalOrderCancelView(OrderCancelView, TerminalOrderView):
    @extend_schema(tags=[TERMINAL], request=None, responses={200: OrderOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        return super().post(request, order_id)


class TerminalOrderReorderView(OrderReorderView, TerminalOrderView):
    @extend_schema(tags=[TERMINAL], request=ReorderInputSerializer, responses={200: CartOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        return super().post(request, order_id)


class TerminalOrderCollectView(TerminalOrderView):
    @extend_schema(tags=[TERMINAL], request=None, responses={200: OrderOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        order = self.owned(request, order_id)
        order = fulfil_order(order.pk, terminal=request.auth["terminal"])
        return Response(_data(order, request.auth["terminal"]))


class TerminalPaymentResultView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    terminal_session_required = False
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=[TERMINAL], responses={200: OrderOutputSerializer, **ERRORS},
        description="Device credentials plus the checkout's HttpOnly result cookie only. Does not restore customer login.")
    def get(self, request, order_id):
        payment = return_payment(request, order_id, request.auth["terminal"])
        if payment.status not in ("SUCCEEDED", "FAILED") and payment.next_attempt_at <= timezone.now():
            reconcile(payment.pk)
        payment.order.refresh_from_db()
        data = _data(payment.order)
        # Return only the specific receipt; never customer/profile/session credentials.
        data["customer_id"] = None
        return Response(data)


class TerminalPaymentResultEndView(TerminalPaymentResultView):
    http_method_names = ["post", "options"]

    @extend_schema(tags=[TERMINAL], request=None, responses={204: None, **ERRORS})
    def post(self, request, order_id):
        payment = return_payment(request, order_id, request.auth["terminal"])
        PaymentTransaction.objects.filter(pk=payment.pk).update(return_ended_at=timezone.now())
        response = Response(status=204)
        response.delete_cookie(cookie_name(order_id), path=f"/api/v1/terminals/orders/{order_id}/", samesite="Lax")
        return response


class TerminalPaymentResultActivityView(TerminalPaymentResultEndView):
    @extend_schema(tags=[TERMINAL], request=None, responses={204: None, **ERRORS},
        description="Explicit receipt-screen interaction only. Polling does not renew this private result scope.")
    def post(self, request, order_id):
        payment = return_payment(request, order_id, request.auth["terminal"])
        PaymentTransaction.objects.filter(pk=payment.pk).update(return_started_at=timezone.now())
        return Response(status=204)
