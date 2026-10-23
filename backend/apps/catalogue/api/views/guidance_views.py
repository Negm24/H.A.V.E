from django.conf import settings
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_variables, sensitive_post_parameters
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.response import Response
from apps.accounts.security.state import auth_key, get_redis_client
from apps.accounts.security.tokens import token_hash
from apps.catalogue.api.serializers.catalogue_serializers import ProductOutputSerializer
from apps.catalogue.services.catalogue_services import list_products
from apps.catalogue.services.guidance_services import screening, candidates, select_with_groq, GuidanceUnavailable
from apps.terminals.services.session_services import operate
from .catalogue_views import TerminalCatalogueView


class GuidanceInputSerializer(serializers.Serializer):
    answers = serializers.DictField(child=serializers.ListField(child=serializers.CharField(max_length=40), min_length=1, max_length=10))
    demo_consent = serializers.BooleanField()


class GuidanceOutputSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["demo_recommendation", "no_match", "urgent", "needs_advice"])
    product = ProductOutputSerializer(allow_null=True)
    demo_only = serializers.BooleanField()


@method_decorator(sensitive_post_parameters(), name="dispatch")
class GuidanceView(TerminalCatalogueView):
    @extend_schema(tags=["Terminal · Guidance"], request=GuidanceInputSerializer,
                   responses={200: GuidanceOutputSerializer},
                   description="Synthetic university-demo answers only. No persistence or stock mutation.")
    @sensitive_variables()
    def post(self, request):
        data = GuidanceInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        if not data.validated_data["demo_consent"]:
            return Response({"detail": "Confirm synthetic demo use first."}, status=400)
        try:
            outcome = screening(data.validated_data["answers"])
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        if outcome:
            return Response({"status": outcome, "product": None, "demo_only": True})
        if not settings.DEBUG or not settings.GUIDANCE_DEMO_ENABLED or not settings.GROQ_API_KEY:
            return Response({"detail": "AI demo is not configured."}, status=503)
        terminal = request.auth["terminal"]
        # Device-wide cooldown survives session reset; contains no symptom data.
        key = auth_key("guidance-cooldown:" + token_hash(str(terminal.pk)))
        if not get_redis_client().set(key, "1", nx=True, ex=30):
            return Response({"detail": "Please wait before trying again."}, status=429, headers={"Retry-After": "30"})
        available = candidates(list_products(terminal))
        product = None
        if available:
            try:
                selected = select_with_groq(data.validated_data["answers"], available,
                                            api_key=settings.GROQ_API_KEY, model=settings.GROQ_MODEL)
            except GuidanceUnavailable:
                return Response({"detail": "AI service unavailable. No recommendation was made."}, status=503)
            # Recheck identity and authoritative availability after the external request.
            operate(terminal, "read", request.auth["raw_token"])
            product = next((p for p in candidates(list_products(terminal)) if p["id"] == selected), None)
        return Response({"status": "demo_recommendation" if product else "no_match", "product": product, "demo_only": True})
