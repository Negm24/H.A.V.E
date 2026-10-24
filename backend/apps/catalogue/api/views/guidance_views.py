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
from apps.catalogue.services.guidance_services import screening, candidates, assess_candidates, eligible_candidates, reason_for, select_with_groq, next_with_groq, validate_answers, GuidanceUnavailable, NO_MATCH_REASONS
from apps.terminals.services.session_services import operate
from .catalogue_views import TerminalCatalogueView


class GuidanceInputSerializer(serializers.Serializer):
    answers = serializers.DictField(child=serializers.ListField(child=serializers.CharField(max_length=40), min_length=1, max_length=10))
    demo_consent = serializers.BooleanField()


class GuidanceRecommendationSerializer(serializers.Serializer):
    product = ProductOutputSerializer()
    reason = serializers.ChoiceField(choices=["pain_option", "fever_option", "anti_inflammatory_option", "lower_back_option", "antacid_option", "acid_reducer_option", "allergy_option", "nasal_option", "skin_option"])


class GuidanceOutputSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=["demo_recommendation", "no_match", "urgent", "needs_advice"])
    product = ProductOutputSerializer(allow_null=True)
    recommendations = GuidanceRecommendationSerializer(many=True)
    no_match_reason = serializers.ChoiceField(choices=NO_MATCH_REASONS, allow_null=True)
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
            return Response({"status": outcome, "product": None, "recommendations": [], "no_match_reason": None, "demo_only": True})
        if not settings.DEBUG or not settings.GUIDANCE_DEMO_ENABLED or not settings.GROQ_API_KEY:
            return Response({"detail": "AI demo is not configured."}, status=503)
        terminal = request.auth["terminal"]
        # Device-wide cooldown survives session reset; contains no symptom data.
        key = auth_key("guidance-cooldown:" + token_hash(str(terminal.pk)))
        if not get_redis_client().set(key, "1", nx=True, ex=30):
            return Response({"detail": "Please wait before trying again."}, status=429, headers={"Retry-After": "30"})
        available, no_match_reason = assess_candidates(list_products(terminal), data.validated_data["answers"])
        recommendations = []
        if available:
            try:
                selected = select_with_groq(data.validated_data["answers"], available,
                                            api_key=settings.GROQ_API_KEY, model=settings.GROQ_MODEL)
            except GuidanceUnavailable:
                return Response({"detail": "AI service unavailable. No recommendation was made."}, status=503)
            # Recheck identity and authoritative availability after the external request.
            operate(terminal, "read", request.auth["raw_token"])
            refreshed = {p["id"]: p for p in eligible_candidates(list_products(terminal), data.validated_data["answers"])}
            recommendations = [{"product": refreshed[id], "reason": reason_for(refreshed[id], data.validated_data["answers"])} for id in selected if id in refreshed]
            no_match_reason = None if recommendations else "stock_changed" if selected else "model_no_match"
        return Response({"status": "demo_recommendation" if recommendations else "no_match", "product": recommendations[0]["product"] if recommendations else None, "recommendations": recommendations, "no_match_reason": no_match_reason, "demo_only": True})


class GuidanceNextOutputSerializer(serializers.Serializer):
    question_id = serializers.CharField(allow_null=True)


@method_decorator(sensitive_post_parameters(), name="dispatch")
class GuidanceNextView(TerminalCatalogueView):
    @extend_schema(tags=["Terminal · Guidance"], request=GuidanceInputSerializer,
                   responses={200: GuidanceNextOutputSerializer},
                   description="Send a completed fictional answer; AI selects one bounded, unasked question ID.")
    @sensitive_variables()
    def post(self, request):
        data = GuidanceInputSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        answers = data.validated_data["answers"]
        if not data.validated_data["demo_consent"]:
            return Response({"detail": "Confirm synthetic demo use first."}, status=400)
        try:
            validate_answers(answers, complete=False)
            if screening(answers, complete=False):
                return Response({"detail": "Urgent answers stop this guide."}, status=400)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        if not settings.DEBUG or not settings.GUIDANCE_DEMO_ENABLED or not settings.GROQ_API_KEY:
            return Response({"detail": "AI demo is not configured."}, status=503)
        terminal = request.auth["terminal"]
        available = candidates(list_products(terminal), answers["areas"][0])
        if not available:
            return Response({"detail": "No matching stock remains for this path."}, status=409)
        key = auth_key("guidance-step:" + token_hash(str(terminal.pk)))
        count = get_redis_client().eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],60) end; return n", 1, key)
        if count > 28:
            return Response({"detail": "AI question request limit reached."}, status=429, headers={"Retry-After": "60"})
        try:
            question_id = next_with_groq(answers, available, api_key=settings.GROQ_API_KEY, model=settings.GROQ_MODEL)
        except GuidanceUnavailable:
            return Response({"detail": "AI question selection is unavailable."}, status=503)
        operate(terminal, "read", request.auth["raw_token"])
        return Response({"question_id": question_id})
