from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response

from apps.accounts.api.serializers.shared_serializers import StrictInputSerializer
from apps.accounts.api.views.shared_views import CustomerSessionView
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess
from apps.terminals.services.heartbeat import availability_data


class AvailabilityOutputSerializer(serializers.Serializer):
    maintenance = serializers.BooleanField()
    is_disabled = serializers.BooleanField()
    available = serializers.BooleanField()
    last_seen_at = serializers.DateTimeField(allow_null=True)
    unavailable_reason = serializers.CharField(allow_null=True)
    observed_at = serializers.DateTimeField(required=False)


class HeartbeatInputSerializer(StrictInputSerializer):
    app_version = serializers.RegexField(r"^[A-Za-z0-9._+-]{1,50}$", required=False)


class TerminalAvailabilityView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]
    terminal_session_required = False

    @extend_schema(tags=["Terminal · Availability"], responses=AvailabilityOutputSerializer)
    def get(self, request):
        return Response(availability_data(request.auth["terminal"]))


class TerminalHeartbeatView(TerminalAvailabilityView):
    http_method_names = ["post", "options"]
    @extend_schema(tags=["Terminal · Availability"], request=HeartbeatInputSerializer, responses=AvailabilityOutputSerializer)
    def post(self, request):
        form = HeartbeatInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        # Only server time is retained. Versions, identifiers and browser input
        # are deliberately not persisted by this fixed presence endpoint.
        return Response(availability_data(request.auth["terminal"], heartbeat=True))
