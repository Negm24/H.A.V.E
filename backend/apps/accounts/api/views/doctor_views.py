from drf_spectacular.utils import extend_schema, extend_schema_view

from apps.accounts.services.doctor_services import password_reset

from ..serializers.doctor_serializers import DoctorPasswordResetCompleteInputSerializer
from ..serializers.shared_serializers import (
    ErrorOutputSerializer,
    RecoveryChallengeOutputSerializer,
    RecoveryProofOutputSerializer,
    RecoveryRequestInputSerializer,
    RecoveryVerifyInputSerializer,
)
from .shared_views import ERRORS, RecoveryActionView


@extend_schema_view(post=extend_schema(
    tags=["Doctor authentication"], request=RecoveryRequestInputSerializer, responses={202: RecoveryChallengeOutputSerializer, **ERRORS},
    summary="Request doctor password reset",
))
class DoctorPasswordResetRequestView(RecoveryActionView):
    serializer_class = RecoveryRequestInputSerializer
    operation = staticmethod(password_reset.request_password_reset)
    response_status = 202


@extend_schema_view(post=extend_schema(
    tags=["Doctor authentication"], request=RecoveryVerifyInputSerializer, responses={200: RecoveryProofOutputSerializer, **ERRORS},
    summary="Verify doctor password reset",
))
class DoctorPasswordResetVerifyView(RecoveryActionView):
    serializer_class = RecoveryVerifyInputSerializer
    operation = staticmethod(password_reset.verify_password_reset)
    response_status = 200


@extend_schema_view(post=extend_schema(
    tags=["Doctor authentication"], request=DoctorPasswordResetCompleteInputSerializer, responses={200: ErrorOutputSerializer, **ERRORS},
    summary="Complete doctor password reset (sign in again afterward)",
))
class DoctorPasswordResetCompleteView(RecoveryActionView):
    serializer_class = DoctorPasswordResetCompleteInputSerializer
    operation = staticmethod(password_reset.complete_password_reset)
    response_status = 200
