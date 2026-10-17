from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from config import openapi

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess
from apps.terminals.api.serializers.cart_serializers import (
    CartOutputSerializer, CartQuantityInputSerializer, CartVersionInputSerializer,
)
from apps.terminals.services.cart_services import change_cart, get_cart


class TerminalCartView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]


class CartView(TerminalCartView):
    @extend_schema(tags=[openapi.TERMINAL_CART], responses={200: CartOutputSerializer, **ERRORS})
    def get(self, request):
        return Response(get_cart(request.auth["terminal"], request.auth["raw_token"]))

    @extend_schema(tags=[openapi.TERMINAL_CART], request=CartVersionInputSerializer,
                   responses={200: CartOutputSerializer, 409: ERRORS[400], **ERRORS})
    def delete(self, request):
        serializer = CartVersionInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(change_cart(request.auth["terminal"], request.auth["raw_token"], clear=True, **serializer.validated_data))


class CartItemView(TerminalCartView):
    @extend_schema(tags=[openapi.TERMINAL_CART], request=CartQuantityInputSerializer,
                   responses={200: CartOutputSerializer, 409: ERRORS[400], **ERRORS})
    def put(self, request, product_id):
        serializer = CartQuantityInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(change_cart(request.auth["terminal"], request.auth["raw_token"], product_id=product_id,
                                    **serializer.validated_data))
