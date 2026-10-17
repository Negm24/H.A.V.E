from django.http import Http404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.accounts.security.authentication import HubAuthentication
from apps.catalogue.api.serializers.catalogue_serializers import (
    HubCategoriesOutputSerializer, HubProductsOutputSerializer, HubProductDetailOutputSerializer,
)
from apps.catalogue.services.catalogue_services import list_categories, list_products
from config import openapi
from apps.terminals.services.selection_services import selected_terminal


def network_response(**data):
    return {**data, "availability_scope": "TERMINAL", "observed_at": timezone.now().isoformat()}


@extend_schema(parameters=[OpenApiParameter("terminal_serial", str, OpenApiParameter.QUERY, required=True,
    description="Collection Terminal selected before browsing.")])
class HubCatalogueView(CustomerSessionView):
    authentication_classes = [HubAuthentication]
    permission_classes = [IsAuthenticated]


class HubCategoriesView(HubCatalogueView):
    @extend_schema(operation_id="hub_catalogue_categories_list", tags=[openapi.HUB_CATALOGUE], responses={200: HubCategoriesOutputSerializer, **ERRORS})
    def get(self, request):
        return Response(network_response(items=list_categories(selected_terminal(request))))


class HubProductsView(HubCatalogueView):
    @extend_schema(operation_id="hub_catalogue_products_list", tags=[openapi.HUB_CATALOGUE], responses={200: HubProductsOutputSerializer, **ERRORS})
    def get(self, request):
        return Response(network_response(items=list_products(selected_terminal(request))))


class HubProductDetailView(HubCatalogueView):
    @extend_schema(operation_id="hub_catalogue_product_retrieve", tags=[openapi.HUB_CATALOGUE], responses={200: HubProductDetailOutputSerializer, **ERRORS})
    def get(self, request, product_id):
        product = next((item for item in list_products(selected_terminal(request)) if item["id"] == product_id), None)
        if product is None:
            raise Http404
        return Response(network_response(product=product))
