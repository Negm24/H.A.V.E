from decimal import Decimal, InvalidOperation
from django.db import transaction
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.accounts.security.authentication import HubAuthentication
from apps.accounts.security.errors import AuthError
from apps.orders.models import Order
from apps.payments.models import PaymentTransaction
from apps.payments.security.webhook import verify_webhook
from apps.payments.services.kashier_services import saved_cards
from ..serializers.payment_serializers import SavedCardsOutputSerializer, WebhookInputSerializer


class SavedCardsView(CustomerSessionView):
    authentication_classes = [HubAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["Hub · Payments"], responses={200: SavedCardsOutputSerializer, **ERRORS})
    def get(self, request):
        return Response({"cards": saved_cards(request.user.customer),
            "setup_message": "Save your first card during a Hub purchase on Kashier's secure checkout. CVV/OTP may still be required."})


class KashierWebhookView(CustomerSessionView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(tags=["Payments · Kashier"], request=WebhookInputSerializer, responses={200: None, **ERRORS})
    def post(self, request):
        data = verify_webhook(request.data, request.headers.get("X-Kashier-Signature"))
        with transaction.atomic():
            order = Order.objects.select_for_update().filter(order_number=data["merchantOrderId"]).first()
            if order is None:
                raise AuthError("Unknown payment reference.", 400)
            try:
                valid = data["currency"] == "EGP" and Decimal(str(data["amount"])) <= order.total_paid + order.customer_payable_amount
            except InvalidOperation:
                valid = False
            if not valid:
                raise AuthError("Payment notification does not match the order.", 400)
            # Persist a wake-up, not untrusted success. Worker verifies the stored
            # session and merchant/order/amount independently against sandbox.
            PaymentTransaction.objects.filter(order=order, status__in=["PENDING", "UNKNOWN"]).update(next_attempt_at=timezone.now())
        return Response({"received": True})
