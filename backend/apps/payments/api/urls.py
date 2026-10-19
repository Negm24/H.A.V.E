from django.urls import path
from .views.payment_views import KashierWebhookView, SavedCardsView, PaymentReturnView

urlpatterns = [path("kashier/webhook/", KashierWebhookView.as_view(), name="kashier-webhook"),
    path("return/<uuid:order_id>/", PaymentReturnView.as_view(), name="payment-return")]
hub_urlpatterns = [path("cards/", SavedCardsView.as_view(), name="hub-saved-cards")]
