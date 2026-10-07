from django.urls import path

from .views.session_views import TerminalStartView, TerminalActivityView, TerminalEndView


urlpatterns = [
    path("sessions/", TerminalStartView.as_view(), name="terminal-session-start"),
    path("sessions/activity/", TerminalActivityView.as_view(), name="terminal-session-activity"),
    path("sessions/end/", TerminalEndView.as_view(), name="terminal-session-end"),
]
