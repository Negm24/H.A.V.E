from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.accounts.security.authentication import HubAuthentication
from apps.carts.api.serializers.cart_serializers import CartOutputSerializer, CartQuantityInputSerializer, CartVersionInputSerializer
from apps.carts.services.cart_services import change_cart, get_cart
from apps.terminals.services.selection_services import selected_terminal


@extend_schema(parameters=[OpenApiParameter("terminal_serial", str, OpenApiParameter.QUERY, required=True,
    description="Selects this customer's separate cart for the collection Terminal.")])
class HubCartView(CustomerSessionView):
    authentication_classes = [HubAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["Hub · Cart"], responses={200: CartOutputSerializer, **ERRORS})
    def get(self, request):
        return Response(get_cart(user_id=request.user.pk, terminal=selected_terminal(request)))

    @extend_schema(tags=["Hub · Cart"], request=CartVersionInputSerializer, responses={200: CartOutputSerializer, 409: ERRORS[400], **ERRORS})
    def delete(self, request):
        serializer = CartVersionInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(change_cart(user_id=request.user.pk, terminal=selected_terminal(request), clear=True, **serializer.validated_data))


class HubCartItemView(HubCartView):
    http_method_names = ["put", "options"]

    @extend_schema(tags=["Hub · Cart"], request=CartQuantityInputSerializer, responses={200: CartOutputSerializer, 409: ERRORS[400], **ERRORS})
    def put(self, request, product_id):
        serializer = CartQuantityInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(change_cart(user_id=request.user.pk, terminal=selected_terminal(request), product_id=product_id, **serializer.validated_data))
