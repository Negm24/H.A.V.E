from django.urls import path

from .views.cart_views import HubCartItemView, HubCartView, HubCartRevisionView

urlpatterns = [
    path("", HubCartView.as_view(), name="hub-cart"),
    path("version/", HubCartRevisionView.as_view(), name="hub-cart-version"),
    path("items/<int:product_id>/", HubCartItemView.as_view(), name="hub-cart-item"),
]
