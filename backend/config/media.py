"""Public, validated catalogue images only; no arbitrary files or directory index."""
from pathlib import Path
from django.conf import settings
from django.http import FileResponse, Http404
from django.views.decorators.http import require_safe


@require_safe
def catalogue_image(request, path):
    relative = Path(path)
    root = Path(settings.MEDIA_ROOT).resolve()
    candidate = (root / relative).resolve()
    if (not relative.parts or relative.parts[0] not in ("products", "categories")
            or candidate.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp")
            or not candidate.is_relative_to(root) or not candidate.is_file()):
        raise Http404
    response = FileResponse(candidate.open("rb"))
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "public, max-age=3600"
    return response
