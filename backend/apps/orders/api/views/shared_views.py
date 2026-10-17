from django.conf import settings
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView
from apps.accounts.security.errors import AuthError
from apps.orders.api.serializers.order_serializers import CheckoutInputSerializer, ReorderInputSerializer
from apps.orders.models import Order
from apps.orders.services.checkout_services import checkout_order, reorder
from apps.orders.services.order_services import order_data
from apps.payments.security.return_authorization import cookie_name
from apps.payments.services.payment_services import start_checkout, reconcile, cancel_purchase
from apps.terminals.models import Terminal


HUB = "Hub · Orders"
TERMINAL = "Terminal · Orders"


def _data(order, terminal=None):
    data = order_data(order)
    data["terminal"]["status"] = order.terminal.status
    data["can_collect"] = bool(terminal and order.terminal_id == terminal.pk and order.channel == "HUB"
        and order.paid_at and order.status == "PENDING" and order.collection_deadline and order.collection_deadline > timezone.now())
    data["payment_status"] = order.payments.filter(operation="CAPTURE").values_list("status", flat=True).first()
    data["refund_status"] = order.payments.filter(operation="REFUND").values_list("status", flat=True).first()
    return data


class OrderViewBase(CustomerSessionView):
    terminal_flow = False

    def context(self, request):
        if self.terminal_flow:
            return request.auth["terminal"], request.auth["raw_token"], request.auth["state"]["session_id"]
        return None, "", None

    def owned(self, request, order_id):
        if not request.user.is_authenticated:
            raise AuthError("Sign in to view Order History.", 401)
        order = Order.objects.select_related("terminal").filter(pk=order_id, customer_id=request.user.pk).first()
        if order is None:
            raise Http404
        return order


class CheckoutView(OrderViewBase):
    def post(self, request):
        form = CheckoutInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        data = form.validated_data
        terminal, raw, session_id = self.context(request)
        if not self.terminal_flow:
            terminal = Terminal.objects.filter(pk=data.get("terminal_serial"), is_disabled=False).first()
            if terminal is None:
                raise AuthError("Choose an available collection Terminal first.", 400)
            data["print_requested"] = False
        order = checkout_order(user=request.user, terminal=terminal, raw_token=raw, session_id=session_id,
            data=data, channel="TERMINAL" if self.terminal_flow else "HUB")
        payment, ticket = start_checkout(order, simulator_id=data.get("return_simulator_id", ""))
        response = Response({"order": _data(order, terminal if self.terminal_flow else None), "checkout_url": payment.checkout_url})
        if ticket:
            response.set_cookie(cookie_name(order.pk), ticket, max_age=1800, httponly=True, secure=not settings.DEBUG,
                samesite="Lax", path=f"/api/v1/terminals/orders/{order.pk}/")
        return response


class OrdersView(OrderViewBase):
    def get(self, request):
        if not request.user.is_authenticated:
            raise AuthError("Sign in to view Order History.")
        terminal, _, _ = self.context(request)
        return Response([_data(order, terminal) for order in Order.objects.select_related("terminal").filter(customer_id=request.user.pk)[:100]])


class OrderDetailView(OrderViewBase):
    def get(self, request, order_id):
        order = self.owned(request, order_id)
        payment = order.payments.filter(operation="CAPTURE").first()
        if payment and payment.status not in ("SUCCEEDED", "FAILED") and payment.next_attempt_at <= timezone.now():
            reconcile(payment.pk)
            order.refresh_from_db()
        return Response(_data(order, self.context(request)[0]))


class OrderCancelView(OrderViewBase):
    def post(self, request, order_id):
        order = self.owned(request, order_id)
        if order.status == "COMPLETED":
            raise AuthError("A completed order cannot be cancelled.", 409)
        order = cancel_purchase(order)
        return Response(_data(order, self.context(request)[0]))


class OrderReorderView(OrderViewBase):
    def post(self, request, order_id):
        order = self.owned(request, order_id)
        form = ReorderInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        terminal, raw, _ = self.context(request)
        terminal = terminal or order.terminal
        result = reorder(order, user_id=request.user.pk, terminal=terminal, raw_token=raw,
                         expected_version=form.validated_data["cart_version"], replace_existing=form.validated_data["replace_existing"])
        return Response(result)
