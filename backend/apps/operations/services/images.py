from io import BytesIO
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import transaction
from PIL import Image, ImageOps, UnidentifiedImageError

from apps.accounts.security.errors import AuthError
from apps.operations.audit import record_activity
from .common import require_owner, require_revision


def validated_image(upload):
    if upload is None or upload.size > 5 * 1024 * 1024:
        raise AuthError("Choose a PNG, JPEG or WebP image of at most 5 MiB.", 400)
    try:
        content = upload.read(5 * 1024 * 1024 + 1)
        if len(content) > 5 * 1024 * 1024:
            raise ValueError()
        source = Image.open(BytesIO(content))
        if source.format not in {"PNG", "JPEG", "WEBP"} or max(source.size) > 4096 or min(source.size) < 1:
            raise ValueError()
        source.verify()
        source = ImageOps.exif_transpose(Image.open(BytesIO(content)))
        source = source.convert("RGBA" if source.mode in {"RGBA", "LA", "P"} else "RGB")
        output = BytesIO()
        source.save(output, format="WEBP", quality=85)
        return ContentFile(output.getvalue(), name=f"{uuid4().hex}.webp")
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError):
        raise AuthError("The image is invalid or exceeds the 4096-pixel size limit.", 400) from None


@transaction.atomic
def replace_image(*, actor, model, pk, revision, upload=None, remove=False):
    require_owner(actor)
    row = model.objects.select_for_update().get(pk=pk)
    require_revision(row, revision)
    image = None if remove else validated_image(upload)
    old_name, storage = row.image.name, row.image.storage
    if remove:
        row.image = ""
    else:
        row.image.save(image.name, image, save=False)
    try:
        row.revision += 1
        row.save(update_fields=["image", "revision"])
    except Exception:
        if not remove and row.image.name:
            storage.delete(row.image.name)
        raise
    if old_name:
        transaction.on_commit(lambda: storage.delete(old_name))
    record_activity(actor=actor, action="IMAGE_REMOVE" if remove else "IMAGE_REPLACE",
                    target_type=model._meta.model_name, target_id=row.pk, metadata={"revision": row.revision})
    return row
