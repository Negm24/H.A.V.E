from datetime import datetime, timezone as dt_timezone

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist, ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser
from rest_framework.response import Response

from apps.accounts.api.views.shared_views import CustomerSessionView
from apps.accounts.api.serializers.owner_serializers import DoctorDecisionInputSerializer, OwnerIdentityOutputSerializer
from apps.accounts.models import User
from apps.accounts.security.errors import AuthError
from apps.accounts.security.permissions import IsOwner
from apps.accounts.services.owner_services import doctor_review
from apps.operations.audit import record_activity
from apps.operations.models import OwnerAction
from . import readers
from apps.operations.services.actions import account_action, submit_order_action, action_data
from apps.operations.services.kiosks import maintenance_preview, set_maintenance
from apps.operations.services.images import replace_image
from apps.operations.services.records import write_record, adjust_stock, stock_data
from apps.terminals.models import Terminal
from .serializers import (SearchSerializer, AccountActionSerializer, OrderActionSerializer, MaintenanceSerializer,
    StockAdjustmentSerializer, RevisionSerializer, OwnerSessionOutputSerializer, OverviewOutputSerializer,
    OwnerPageOutputSerializer, OwnerActionOutputSerializer, MaintenancePreviewOutputSerializer, ImageUploadSerializer)


@method_decorator(never_cache, name="dispatch")
class OwnerView(CustomerSessionView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsOwner]

    def handle_exception(self, exc):
        if isinstance(exc, ObjectDoesNotExist):
            return Response({"detail": "Record not found."}, status=404)
        if isinstance(exc, DjangoValidationError):
            code = getattr(exc, "code", None)
            status = {"not_found": 404, "not_pending": 409, "forbidden": 403}.get(code, 400)
            return Response({"detail": " ".join(exc.messages)}, status=status)
        if isinstance(exc, IntegrityError):
            return Response({"detail": "This change conflicts with an existing record. Refresh and review it."}, status=409)
        return super().handle_exception(exc)


def session_data(request):
    started = request.session.get("owner_started_at", timezone.now().timestamp())
    activity = request.session.get("owner_last_activity_at", started)
    absolute = started + settings.OWNER_SESSION_MAX_SECONDS
    return {"owner": OwnerIdentityOutputSerializer(request.user).data, "server_time": timezone.now(),
            "idle_expires_at": datetime.fromtimestamp(min(activity + settings.OWNER_SESSION_IDLE_SECONDS, absolute), dt_timezone.utc),
            "absolute_expires_at": datetime.fromtimestamp(absolute, dt_timezone.utc)}


class SessionView(OwnerView):
    @extend_schema(tags=["Owner · Session"], responses=OwnerSessionOutputSerializer)
    def get(self, request):
        return Response(session_data(request))


class ActivityView(OwnerView):
    @extend_schema(tags=["Owner · Session"], request=None, responses=OwnerSessionOutputSerializer)
    def post(self, request):
        now = timezone.now().timestamp()
        # Bound writes across tabs and repeated events. CSRF/session permission
        # checks have already passed; reads cannot reach this activity path.
        if now - request.session["owner_last_activity_at"] >= 30:
            request.session["owner_last_activity_at"] = now
            remaining = min(settings.OWNER_SESSION_IDLE_SECONDS,
                request.session["owner_started_at"] + settings.OWNER_SESSION_MAX_SECONDS - now)
            request.session.set_expiry(max(1, int(remaining)))
        return Response(session_data(request))


class OverviewView(OwnerView):
    @extend_schema(tags=["Owner · Overview"], responses=OverviewOutputSerializer)
    def get(self, request):
        return Response(readers.overview())


class ResourceListSchema(AutoSchema):
    def get_operation_id(self):
        operation = super().get_operation_id()
        return operation.rsplit("_", 1)[0] + "_list" if self.method == "GET" else operation


class ResourceView(OwnerView):
    schema = ResourceListSchema()
    @extend_schema(tags=["Owner · Records"], parameters=[SearchSerializer], responses=OwnerPageOutputSerializer)
    def get(self, request, resource):
        if "query" in request.query_params:
            raise AuthError("Use POST search to keep search text out of request URLs.", 400)
        # QueryDict's HTML checkbox semantics make omitted BooleanFields False.
        # API query parameters use absence to mean "no filter", not unchecked.
        form = SearchSerializer(data=request.query_params.dict())
        form.is_valid(raise_exception=True)
        return Response(readers.page(resource, form.validated_data))

    @extend_schema(tags=["Owner · Records"], request=OpenApiTypes.OBJECT, responses={201: OpenApiTypes.OBJECT})
    def post(self, request, resource):
        if resource not in readers.SERIALIZERS:
            raise AuthError("This resource cannot be created here.", 405)
        row = write_record(actor=request.user, model=readers.MODELS[resource], serializer_type=readers.SERIALIZERS[resource], data=dict(request.data))
        return Response(readers.serialize(resource, row), status=201)


@method_decorator(sensitive_post_parameters("query"), name="dispatch")
class SearchView(OwnerView):
    @extend_schema(tags=["Owner · Records"], request=SearchSerializer, responses=OwnerPageOutputSerializer)
    def post(self, request, resource):
        form = SearchSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(readers.page(resource, form.validated_data))


class DetailView(OwnerView):
    @extend_schema(tags=["Owner · Records"], responses=OpenApiTypes.OBJECT)
    def get(self, request, resource, pk):
        row = readers.records(resource, {}).get(pk=pk)
        return Response(readers.serialize(resource, row))

    @extend_schema(tags=["Owner · Records"], request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def patch(self, request, resource, pk):
        if resource not in readers.SERIALIZERS:
            raise AuthError("This record is read-only. Use its specific action.", 405)
        data = dict(request.data)
        revision = data.pop("revision", None)
        row = write_record(actor=request.user, model=readers.MODELS[resource], serializer_type=readers.SERIALIZERS[resource], data=data, pk=pk, revision=revision)
        return Response(readers.serialize(resource, row))


class DoctorDecisionView(OwnerView):
    @extend_schema(tags=["Owner · Doctors"], request=DoctorDecisionInputSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        form = DoctorDecisionInputSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        row = doctor_review.decide(doctor_id=pk, owner=request.user, **form.validated_data)
        return Response(readers.serialize("doctors", row))


class AccountDetailView(OwnerView):
    @extend_schema(tags=["Owner · Accounts"], responses=OpenApiTypes.OBJECT)
    def get(self, request, pk):
        user = get_object_or_404(User, pk=pk, account_type__in=["CUSTOMER", "DOCTOR"])
        return Response(readers.account_data(user))


class AccountActionView(OwnerView):
    @extend_schema(tags=["Owner · Accounts"], request=AccountActionSerializer, responses=OwnerActionOutputSerializer)
    def post(self, request, pk):
        form = AccountActionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(action_data(account_action(actor=request.user, account_id=pk, **form.validated_data)))


class OrderActionView(OwnerView):
    @extend_schema(tags=["Owner · Payments"], request=OrderActionSerializer, responses={202: OwnerActionOutputSerializer})
    def post(self, request, pk):
        form = OrderActionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(action_data(submit_order_action(actor=request.user, order_id=pk, **form.validated_data)), status=202)


class ActionDetailView(OwnerView):
    @extend_schema(tags=["Owner · Payments"], responses=OwnerActionOutputSerializer)
    def get(self, request, pk):
        return Response(action_data(get_object_or_404(OwnerAction, pk=pk)))


class StockAdjustView(OwnerView):
    @extend_schema(tags=["Owner · Inventory"], request=StockAdjustmentSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        raise AuthError("Use external inventory transfers to change machine stock.", 405)


class MaintenancePreviewView(OwnerView):
    @extend_schema(tags=["Owner · Kiosks"], responses=MaintenancePreviewOutputSerializer)
    def get(self, request, pk):
        return Response(maintenance_preview(get_object_or_404(Terminal, pk=pk)))


class MaintenanceView(OwnerView):
    @extend_schema(tags=["Owner · Kiosks"], request=MaintenanceSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        form = MaintenanceSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        row = set_maintenance(actor=request.user, serial=pk, **form.validated_data)
        return Response(readers.serialize("kiosks", row))


class ImageView(OwnerView):
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    @extend_schema(tags=["Owner · Catalogue"], request=ImageUploadSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, resource, pk):
        form = RevisionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        row = replace_image(actor=request.user, model=readers.MODELS[resource], pk=pk,
                            revision=form.validated_data["revision"], upload=request.FILES.get("image"))
        return Response(readers.serialize(resource, row))

    @extend_schema(tags=["Owner · Catalogue"], request=RevisionSerializer, responses=OpenApiTypes.OBJECT)
    def delete(self, request, resource, pk):
        form = RevisionSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        row = replace_image(actor=request.user, model=readers.MODELS[resource], pk=pk, revision=form.validated_data["revision"], remove=True)
        return Response(readers.serialize(resource, row))
