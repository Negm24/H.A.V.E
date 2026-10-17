from drf_spectacular.utils import extend_schema, OpenApiResponse
from django.db import transaction
from rest_framework.response import Response

from config import openapi
from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS
from apps.terminals.api.serializers.session_serializers import TerminalSessionOutputSerializer
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess
from apps.terminals.services.session_services import operate, session_response
from apps.payments.security.return_authorization import revoke_terminal_results
from apps.terminals.models import Terminal


class TerminalStartView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]
    terminal_session_required = False

    @extend_schema(tags=[openapi.TERMINAL_GUEST_SESSION], request=None, responses={201: TerminalSessionOutputSerializer, **ERRORS},
                   summary="Start guest session; replace any previous session on this device")
    def post(self, request):
        # Serialize new-visitor replacement against first/reissued payment
        # result tickets. Never acquire an Order lock from this direction.
        with transaction.atomic():
            terminal = Terminal.objects.select_for_update().get(pk=request.auth["terminal"].pk)
            revoke_terminal_results(terminal)
            state, token = operate(terminal, "start")
        return Response(session_response(state, token), status=201)


class TerminalActivityView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=[openapi.TERMINAL_GUEST_SESSION], request=None, responses={200: TerminalSessionOutputSerializer, **ERRORS},
                   summary="Record explicit user activity (never background polling)")
    def post(self, request):
        state, _ = operate(request.auth["terminal"], "activity", request.auth["raw_token"])
        return Response(session_response(state))


class TerminalEndView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=[openapi.TERMINAL_GUEST_SESSION], request=None,
                   responses={204: OpenApiResponse(description="Session ended."), **ERRORS},
                   summary="End the guest session (start over / sign out)")
    def post(self, request):
        with transaction.atomic():
            terminal = Terminal.objects.select_for_update().get(pk=request.auth["terminal"].pk)
            operate(terminal, "end", request.auth["raw_token"])
            revoke_terminal_results(terminal)
        return Response(status=204)
