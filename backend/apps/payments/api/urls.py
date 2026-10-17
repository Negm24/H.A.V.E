from django.urls import path
from .views.payment_views import KashierWebhookView, SavedCardsView

urlpatterns = [path("kashier/webhook/", KashierWebhookView.as_view(), name="kashier-webhook")]
hub_urlpatterns = [path("cards/", SavedCardsView.as_view(), name="hub-saved-cards")]
