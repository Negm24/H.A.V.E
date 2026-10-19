from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import IsOwner
from apps.orders.api.serializers.order_serializers import OrderOutputSerializer, ReconciliationInputSerializer
from apps.orders.models import Order
from apps.payments.models import PaymentTransaction
from apps.payments.services.payment_services import reconcile, cancel_purchase, process_refund
from .shared_views import _data


class OwnerOrderCancelView(CustomerSessionView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsOwner]

    @extend_schema(tags=["Owner · Payments"], request=None, responses={200: OrderOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        order = Order.objects.filter(pk=order_id).first()
        if order is None:
            raise Http404
        if order.status == "COMPLETED":
            raise AuthError("Completed orders cannot be cancelled.", 409)
        order = cancel_purchase(order, reason="OWNER_CANCELLED")
        return Response(_data(order))


class OwnerOrderReconcileView(OwnerOrderCancelView):
    @extend_schema(tags=["Owner · Payments"], request=ReconciliationInputSerializer, responses={200: OrderOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        payment = PaymentTransaction.objects.filter(order_id=order_id, operation="CAPTURE").first()
        if payment is None:
            raise Http404
        form = ReconciliationInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        candidate = form.validated_data.get("session_id")
        if candidate and not payment.session_id:
            from apps.payments.services.kashier_services import verify_order
            # A session ID supplied by an owner is only a recovery hint, never
            # payment proof. Verify merchant/order/amount/currency via sandbox.
            verify_order(payment.order, candidate)
            PaymentTransaction.objects.filter(pk=payment.pk, session_id="").update(session_id=candidate)
        reconcile(payment.pk, force=True)
        refund = PaymentTransaction.objects.filter(order_id=order_id, operation="REFUND").first()
        if refund:
            # Explicit owner action permits read-only reconciliation of failed
            # refunds, never another refund submission.
            if refund.status == "FAILED":
                PaymentTransaction.objects.filter(pk=refund.pk).update(status="UNKNOWN")
            process_refund(refund.pk)
        return Response(_data(Order.objects.get(pk=order_id)))
