from django.urls import path

from .views.catalogue_views import CategoriesView, ProductsView, ProductDetailView
from .views.hub_views import HubCategoriesView, HubProductsView, HubProductDetailView

urlpatterns = [
    path("categories/", CategoriesView.as_view(), name="terminal-categories"),
    path("products/", ProductsView.as_view(), name="terminal-products"),
    path("products/<int:product_id>/", ProductDetailView.as_view(), name="terminal-product-detail"),
]

hub_urlpatterns = [
    path("categories/", HubCategoriesView.as_view(), name="hub-categories"),
    path("products/", HubProductsView.as_view(), name="hub-products"),
    path("products/<int:product_id>/", HubProductDetailView.as_view(), name="hub-product-detail"),
]
