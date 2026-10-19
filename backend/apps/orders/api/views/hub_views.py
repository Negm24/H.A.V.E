from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import ERRORS
from apps.accounts.security.authentication import HubAuthentication
from apps.carts.api.serializers.cart_serializers import CartOutputSerializer
from apps.orders.api.serializers.order_serializers import (
    CheckoutInputSerializer, CheckoutOutputSerializer, OrderOutputSerializer,
    ReorderInputSerializer, CollectionTerminalOutputSerializer, ResumeCheckoutInputSerializer, OrderSummaryOutputSerializer, CheckoutErrorOutputSerializer,
)
from .shared_views import HUB, OrderViewBase, CheckoutView, OrdersView, OrderDetailView, OrderCancelView, OrderReorderView, OrderResumeView, OrderSummaryView


class HubOrderView(OrderViewBase):
    authentication_classes = [HubAuthentication]
    permission_classes = [IsAuthenticated]
    terminal_flow = False


class CollectionTerminalsView(HubOrderView):
    @extend_schema(tags=[HUB], responses={200: CollectionTerminalOutputSerializer(many=True), **ERRORS})
    def get(self, request):
        from apps.terminals.services.discovery_services import collection_terminals
        return Response(collection_terminals(request.user.pk))


class HubOrderSummaryView(OrderSummaryView, HubOrderView):
    @extend_schema(tags=[HUB], responses={200: OrderSummaryOutputSerializer, **ERRORS})
    def get(self, request):
        return super().get(request)


class HubOrderResumeView(OrderResumeView, HubOrderView):
    @extend_schema(tags=[HUB], request=ResumeCheckoutInputSerializer, responses={200: CheckoutOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        return super().post(request, order_id)


class HubCheckoutView(CheckoutView, HubOrderView):
    @extend_schema(tags=[HUB], request=CheckoutInputSerializer, responses={200: CheckoutOutputSerializer, 409: CheckoutErrorOutputSerializer, **ERRORS})
    def post(self, request):
        return super().post(request)


class HubOrdersView(OrdersView, HubOrderView):
    @extend_schema(tags=[HUB], responses={200: OrderOutputSerializer(many=True), **ERRORS})
    def get(self, request):
        return super().get(request)


class HubOrderDetailView(OrderDetailView, HubOrderView):
    @extend_schema(tags=[HUB], responses={200: OrderOutputSerializer, **ERRORS})
    def get(self, request, order_id):
        return super().get(request, order_id)


class HubOrderCancelView(OrderCancelView, HubOrderView):
    @extend_schema(tags=[HUB], request=None, responses={200: OrderOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        return super().post(request, order_id)


class HubOrderReorderView(OrderReorderView, HubOrderView):
    @extend_schema(tags=[HUB], request=ReorderInputSerializer, responses={200: CartOutputSerializer, **ERRORS})
    def post(self, request, order_id):
        return super().post(request, order_id)
