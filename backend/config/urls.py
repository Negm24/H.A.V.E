"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.conf import settings
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from config.views import health
from apps.catalogue.api.urls import hub_urlpatterns
from apps.orders.api.urls import hub_urlpatterns as hub_orders, terminal_urlpatterns as terminal_orders, owner_urlpatterns as owner_orders
from apps.payments.api.urls import hub_urlpatterns as hub_payments

urlpatterns = [
    path("api/v1/health/", health, name="health"),
    path("api/v1/auth/", include("apps.accounts.api.urls")),
    path("api/v1/terminals/", include("apps.terminals.api.urls")),
    path("api/v1/hub/catalogue/", include(hub_urlpatterns)),
    path("api/v1/hub/cart/", include("apps.carts.api.urls")),
    path("api/v1/hub/orders/", include(hub_orders)),
    path("api/v1/hub/payments/", include(hub_payments)),
    path("api/v1/terminals/orders/", include(terminal_orders)),
    path("api/v1/auth/owners/orders/", include(owner_orders)),
    path("api/v1/payments/", include("apps.payments.api.urls")),
]

# Interactive documentation is local-only for this increment.
if settings.DEBUG:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
    ]
