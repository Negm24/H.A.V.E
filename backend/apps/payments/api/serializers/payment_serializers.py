from rest_framework import serializers


class SavedCardOutputSerializer(serializers.Serializer):
    brand = serializers.CharField()
    last_four = serializers.CharField()
    expiry_month = serializers.CharField()
    expiry_year = serializers.CharField()


class SavedCardsOutputSerializer(serializers.Serializer):
    cards = SavedCardOutputSerializer(many=True)
    setup_message = serializers.CharField()


class WebhookInputSerializer(serializers.Serializer):
    event = serializers.CharField()
    data = serializers.JSONField()
