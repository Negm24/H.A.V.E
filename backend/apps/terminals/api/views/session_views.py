from drf_spectacular.utils import extend_schema, OpenApiResponse
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.terminals.api.serializers.session_serializers import TerminalSessionOutputSerializer
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess
from apps.terminals.services.session_services import operate, session_response


class TerminalStartView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]
    terminal_session_required = False

    @extend_schema(tags=["Terminal sessions"], request=None, responses={201: TerminalSessionOutputSerializer, **ERRORS},
                   summary="Start guest session; replace any previous session on this device")
    def post(self, request):
        state, token = operate(request.auth["terminal"], "start")
        return Response(session_response(state, token), status=201)


class TerminalActivityView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=["Terminal sessions"], request=None, responses={200: TerminalSessionOutputSerializer, **ERRORS},
                   summary="Record explicit user activity (never background polling)")
    def post(self, request):
        state, _ = operate(request.auth["terminal"], "activity", request.auth["raw_token"])
        return Response(session_response(state))


class TerminalEndView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=["Terminal sessions"], request=None,
                   responses={204: OpenApiResponse(description="Session ended."), **ERRORS})
    def post(self, request):
        operate(request.auth["terminal"], "end", request.auth["raw_token"])
        return Response(status=204)
