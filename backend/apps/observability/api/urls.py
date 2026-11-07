from django.urls import path
from . import views

owner_urlpatterns = [
    path("system/", views.SystemView.as_view()), path("history/", views.HistoryView.as_view()),
    path("usage/", views.UsageView.as_view()),
    path("summary/", views.SummaryView.as_view()), path("metrics/", views.MetricsView.as_view()),
    path("resources/", views.ResourcesView.as_view()), path("incidents/", views.IncidentsView.as_view()),
    path("incidents/<uuid:incident_id>/", views.IncidentView.as_view()), path("services/", views.ServicesView.as_view()),
    path("services/<str:service>/preview/", views.ServicePreviewView.as_view()),
    path("services/<str:service>/actions/", views.ServiceActionsView.as_view()),
    path("service-actions/<uuid:job_id>/", views.ServiceActionView.as_view()),
]
public_urlpatterns = [path("events/", views.TelemetryIngestView.as_view())]
internal_urlpatterns = [path("heartbeat/", views.HostHeartbeatView.as_view()), path("claim/", views.HostClaimView.as_view()), path("jobs/<uuid:job_id>/result/", views.HostResultView.as_view())]
