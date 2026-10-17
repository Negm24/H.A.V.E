from django.urls import path

from .views.cart_views import HubCartItemView, HubCartView

urlpatterns = [
    path("", HubCartView.as_view(), name="hub-cart"),
    path("items/<int:product_id>/", HubCartItemView.as_view(), name="hub-cart-item"),
]
