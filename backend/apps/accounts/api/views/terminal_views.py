from drf_spectacular.utils import extend_schema
from rest_framework.response import Response

from apps.accounts.api.serializers.customer_serializers import CustomerIdentityOutputSerializer
from apps.accounts.api.serializers.terminal_serializers import CustomerTerminalLoginInputSerializer
from apps.accounts.api.views.shared_views import CustomerSessionView, ERRORS, source
from apps.accounts.security.errors import AuthError
from apps.accounts.services.customer_services.login import authenticate_customer
from apps.terminals.api.serializers.session_serializers import TerminalSessionOutputSerializer
from apps.terminals.security.authentication import TerminalSessionAuthentication
from apps.terminals.security.permissions import HasTerminalAccess
from apps.terminals.services.session_services import operate, session_response


class CustomerTerminalLoginView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=["Customer Terminal"], request=CustomerTerminalLoginInputSerializer,
                   responses={200: TerminalSessionOutputSerializer, **ERRORS},
                   summary="Sign in within a Terminal session; replace the session token")
    def post(self, request):
        serializer = CustomerTerminalLoginInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate_customer(**serializer.validated_data, source=source(request),
                                     terminal_serial=request.auth["terminal"].pk)
        state, token = operate(request.auth["terminal"], "login", request.auth["raw_token"], user=user)
        return Response(session_response(state, token) | {"customer": CustomerIdentityOutputSerializer(user).data})


class CustomerTerminalMeView(CustomerSessionView):
    authentication_classes = [TerminalSessionAuthentication]
    permission_classes = [HasTerminalAccess]

    @extend_schema(tags=["Customer Terminal"], responses={200: CustomerIdentityOutputSerializer, **ERRORS},
                   summary="Current Terminal customer; does NOT renew activity")
    def get(self, request):
        if not request.user.is_authenticated:
            raise AuthError("Customer login is required for this terminal session.")
        return Response(CustomerIdentityOutputSerializer(request.user).data)
