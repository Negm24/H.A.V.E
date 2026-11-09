from django.urls import path
from .views import (
    PatientLookupView,
    MedicineSearchView,
    IssueView,
    PrescriptionSearchView,
    PrescriptionView,
    RevokeView,
    ReplaceView,
    PdfView,
    LetterheadView,
    LogoView,
    PreviewView,
)

urlpatterns = [
    path("patient-lookup/", PatientLookupView.as_view()),
    path("medicines/search/", MedicineSearchView.as_view()),
    path("prescriptions/issue/", IssueView.as_view()),
    path("prescriptions/search/", PrescriptionSearchView.as_view()),
    path("prescriptions/<uuid:pk>/", PrescriptionView.as_view()),
    path("prescriptions/<uuid:pk>/revoke/", RevokeView.as_view()),
    path("prescriptions/<uuid:pk>/replace/", ReplaceView.as_view()),
    path("prescriptions/<uuid:pk>/pdf/", PdfView.as_view()),
    path("letterhead/", LetterheadView.as_view()),
    path("letterhead/logo/", LogoView.as_view()),
    path("letterhead/preview/", PreviewView.as_view()),
]
