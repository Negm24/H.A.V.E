from django.urls import path
from . import views
from .inventory_views import ExternalView, ExternalSearchView, ExternalAdjustView, TransferView, CabinetView
from .report_views import BusinessView, FleetView
from .inventory_views import ExternalProductsView, ExternalProductsSearchView, LoadPreviewView, LoadView, ReturnView

urlpatterns = [
    path('inventory/products/', ExternalProductsView.as_view()),
    path('inventory/products/search/', ExternalProductsSearchView.as_view()),
    path('inventory/load/preview/', LoadPreviewView.as_view()),
    path('inventory/load/', LoadView.as_view()),
    path('inventory/returns/', ReturnView.as_view()),
    path("overview/business/", BusinessView.as_view()),
    path("overview/fleet/", FleetView.as_view()),
    path("inventory/external/", ExternalView.as_view()),
    path("inventory/external/search/", ExternalSearchView.as_view()),
    path("inventory/external/adjust/", ExternalAdjustView.as_view()),
    path("inventory/transfers/", TransferView.as_view()),
    path("inventory/cabinets/<str:serial>/", CabinetView.as_view()),
    path("session/", views.SessionView.as_view()),
    path("session/activity/", views.ActivityView.as_view()),
    path("overview/", views.OverviewView.as_view()),
    path("accounts/<str:pk>/", views.AccountDetailView.as_view()),
    path("accounts/<str:pk>/action/", views.AccountActionView.as_view()),
    path("doctors/<str:pk>/decision/", views.DoctorDecisionView.as_view()),
    path("orders/<uuid:pk>/actions/", views.OrderActionView.as_view()),
    path("actions/<uuid:pk>/", views.ActionDetailView.as_view()),
    path("stock/adjust/", views.StockAdjustView.as_view()),
    path("kiosks/<str:pk>/maintenance/preview/", views.MaintenancePreviewView.as_view()),
    path("kiosks/<str:pk>/maintenance/", views.MaintenanceView.as_view()),
]
for resource in ["doctors", "customers", "orders", "categories", "products", "batches", "slots", "stock", "kiosks", "activity"]:
    urlpatterns += [path(f"{resource}/", views.ResourceView.as_view(), {"resource": resource}),
                    path(f"{resource}/search/", views.SearchView.as_view(), {"resource": resource}),
                    path(f"{resource}/<str:pk>/", views.DetailView.as_view(), {"resource": resource})]
for resource in ["products", "categories"]:
    urlpatterns.append(path(f"{resource}/<int:pk>/image/", views.ImageView.as_view(), {"resource": resource}))
