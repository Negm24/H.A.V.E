from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes
from .views import OwnerView
from .redesign_serializers import BusinessOutput, FleetOutput
from apps.operations.services.reporting import business, fleet


class BusinessView(OwnerView):
    @extend_schema(tags=["Owner · Overview"], responses=BusinessOutput)
    def get(self, request):
        return Response(business(request.query_params.get("period", "month")))


class FleetView(OwnerView):
    @extend_schema(tags=["Owner · Overview"], responses=FleetOutput)
    def get(self, request):
        return Response(fleet(request.query_params.get("period", "month")))
