from django.http import Http404
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from config import openapi

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.catalogue.api.serializers.catalogue_serializers import CategoryOutputSerializer, ProductOutputSerializer
from apps.catalogue.services.catalogue_services import list_categories, list_products
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess


class TerminalCatalogueView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]


class CategoriesView(TerminalCatalogueView):
    @extend_schema(tags=[openapi.TERMINAL_CATALOGUE], responses={200: CategoryOutputSerializer(many=True), **ERRORS})
    def get(self, request):
        return Response(list_categories(request.auth["terminal"]))


class ProductsView(TerminalCatalogueView):
    @extend_schema(tags=[openapi.TERMINAL_CATALOGUE], responses={200: ProductOutputSerializer(many=True), **ERRORS})
    def get(self, request):
        return Response(list_products(request.auth["terminal"]))


class ProductDetailView(TerminalCatalogueView):
    @extend_schema(tags=[openapi.TERMINAL_CATALOGUE], responses={200: ProductOutputSerializer, **ERRORS})
    def get(self, request, product_id):
        result = next((p for p in list_products(request.auth["terminal"]) if p["id"] == product_id), None)
        if result is None:
            raise Http404
        return Response(result)
