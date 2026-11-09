import base64
from django.core.exceptions import ObjectDoesNotExist, ValidationError
from django.db import IntegrityError
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes
from rest_framework.parsers import JSONParser, FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.accounts.api.views.shared_views import CustomerSessionView, source
from apps.accounts.security.authentication import AdvisorAuthentication
from apps.accounts.security.challenges import enforce_limit
from apps.accounts.models import User
from apps.catalogue.models import Product
from .models import PrescribingEligibility
from .eligibility import formulation_signature
from .dosage import dose_unit
from . import services
from .serializers import (
    LookupInput,
    SearchInput,
    IssueInput,
    RevokeInput,
    ReplaceInput,
    LetterheadInput,
    PreviewInput,
    LogoInput,
    AdvisorPatientLookup,
    AdvisorMedicinePage,
    AdvisorPrescription,
    AdvisorPrescriptionPage,
    AdvisorLetterhead,
)


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters(), name="dispatch")
class AdvisorView(CustomerSessionView):
    authentication_classes = [AdvisorAuthentication]
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        services.require_doctor(request.user)

    def handle_exception(self, exc):
        if isinstance(exc, ObjectDoesNotExist):
            return Response({"detail": "Record not found."}, status=404)
        if isinstance(exc, ValidationError):
            return Response({"detail": "Invalid input."}, status=400)
        if isinstance(exc, IntegrityError):
            return Response(
                {
                    "detail": "The record changed. Review its current state before retrying."
                },
                status=409,
            )
        return super().handle_exception(exc)


def valid(serializer, request):
    form = serializer(data=request.data)
    form.is_valid(raise_exception=True)
    return form.validated_data


class PatientLookupView(AdvisorView):
    @extend_schema(tags=["Advisor"], request=LookupInput, responses=AdvisorPatientLookup)
    def post(self, request):
        values = valid(LookupInput, request)
        enforce_limit("advisor-patient-lookup", str(request.user.pk), 30, 300)
        enforce_limit("advisor-patient-lookup-source", source(request), 60, 300)
        patient = User.objects.filter(
            account_type="CUSTOMER", phone_number=values["phone_number"]
        ).first()
        result = {
            "found": bool(patient),
            "patient_phone_number": values["phone_number"],
        }
        if patient:
            result.update(
                patient_first_name=patient.first_name,
                patient_last_name=patient.last_name,
                patient_date_of_birth=patient.customer.date_of_birth,
            )
        return Response(result)


class MedicineSearchView(AdvisorView):
    @extend_schema(tags=["Advisor"], request=SearchInput, responses=AdvisorMedicinePage)
    def post(self, request):
        from django.db.models import Q

        values = valid(SearchInput, request)
        allowed = [
            row.product_id
            for row in PrescribingEligibility.objects.filter(
                approved=True, controlled=False
            ).select_related('product')
            if row.formulation_signature == formulation_signature(row.product)
        ]
        products = Product.objects.filter(
            pk__in=allowed, is_active=True, category__is_active=True
        ).order_by("name_en", "pk")
        term = values["query"]
        if term:
            products = products.filter(
                Q(name_en__icontains=term)
                | Q(strength__icontains=term)
                | Q(sku__icontains=term)
            )
        page, size = values["page"], values["page_size"]
        items = [
            {
                "id": p.pk,
                "name_en": p.name_en,
                "strength": p.strength,
                "dosage_form": p.dosage_form,
                "pack_description": p.pack_description,
                "requires_prescription": p.requires_prescription,
                "dose_unit": dose_unit(p.dosage_form),
            }
            for p in products[(page - 1) * size : page * size]
        ]
        return Response(
            {"items": items, "total": products.count(), "page": page, "page_size": size}
        )


class IssueView(AdvisorView):
    @extend_schema(tags=["Advisor"], request=IssueInput, responses=AdvisorPrescription)
    def post(self, request):
        return Response(
            services.issue(
                request.user,
                services.session_family(request),
                valid(IssueInput, request),
            )
        )


class PrescriptionSearchView(AdvisorView):
    @extend_schema(tags=["Advisor"], request=SearchInput, responses=AdvisorPrescriptionPage)
    def post(self, request):
        return Response(
            services.search_prescriptions(
                request.user.doctor, valid(SearchInput, request)
            )
        )


class PrescriptionView(AdvisorView):
    @extend_schema(tags=["Advisor"], responses=AdvisorPrescription)
    def get(self, request, pk):
        return Response(
            services.prescription_data(services.owned(request.user.doctor, pk))
        )


class RevokeView(AdvisorView):
    @extend_schema(tags=["Advisor"], request=RevokeInput, responses=AdvisorPrescription)
    def post(self, request, pk):
        return Response(services.revoke(request.user, pk, valid(RevokeInput, request)))


class ReplaceView(AdvisorView):
    @extend_schema(
        tags=["Advisor"], request=ReplaceInput, responses=AdvisorPrescription
    )
    def post(self, request, pk):
        return Response(
            services.issue(
                request.user,
                services.session_family(request),
                valid(ReplaceInput, request),
                pk,
            )
        )


class LetterheadView(AdvisorView):
    @extend_schema(tags=["Advisor"], responses=AdvisorLetterhead)
    def get(self, request):
        return Response(
            services.letterhead_data(services.letterhead(request.user.doctor))
        )

    @extend_schema(
        tags=["Advisor"], request=LetterheadInput, responses=AdvisorLetterhead
    )
    def patch(self, request):
        return Response(
            services.update_letterhead(request.user, valid(LetterheadInput, request))
        )


class LogoView(AdvisorView):
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    @extend_schema(tags=["Advisor"], request=LogoInput, responses=AdvisorLetterhead)
    def post(self, request):
        values = valid(LogoInput, request)
        return Response(
            services.update_letterhead(request.user, values, values["file"])
        )

    @extend_schema(
        tags=["Advisor"], responses={(200, "image/png"): OpenApiTypes.BINARY}
    )
    def get(self, request):
        row = services.letterhead(request.user.doctor)
        if not row.logo_data_uri:
            from apps.accounts.security.errors import AuthError

            raise AuthError("No clinic logo uploaded.", 404)
        return HttpResponse(
            base64.b64decode(row.logo_data_uri.split(",")[1]),
            content_type="image/png",
            headers={
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )


def pdf_response(snapshot, *, revoked=False, filename="prescription.pdf"):
    from .pdf import render_prescription_pdf

    result = render_prescription_pdf(snapshot, revoked=revoked)
    return HttpResponse(
        result,
        content_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


class PdfView(AdvisorView):
    @extend_schema(
        tags=["Advisor"], responses={(200, "application/pdf"): OpenApiTypes.BINARY}
    )
    def get(self, request, pk):
        row = services.owned(request.user.doctor, pk)
        return pdf_response(
            row.snapshot, revoked=bool(row.revoked_at), filename=row.reference + ".pdf"
        )


class PreviewView(AdvisorView):
    @extend_schema(
        tags=["Advisor"],
        request=PreviewInput,
        responses={(200, "application/pdf"): OpenApiTypes.BINARY},
    )
    def post(self, request):
        return pdf_response(
            services.preview_snapshot(
                request.user.doctor, valid(PreviewInput, request)
            ),
            filename="clinic-letterhead-preview.pdf",
        )
