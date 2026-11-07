"""Operational activity history with an explicit metadata allowlist."""
from .models import ActivityEntry


SAFE_FIELDS = {
    "revision", "previous_revision", "quantity", "previous_quantity", "price",
    "previous_price", "is_disabled", "maintenance_enabled", "service", "action",
    "status", "previous_state", "new_state", "job_id", "duration_ms", "reason_code",
    "category_id", "product_id", "slot_id", "batch_id", "terminal_serial", "enabled",
}


def record_activity(*, actor=None, action, target_type, target_id, outcome="SUCCEEDED", metadata=None):
    safe = {}
    for key, value in (metadata or {}).items():
        if key in SAFE_FIELDS and (value is None or type(value) in (str, int, float, bool)):
            safe[key] = value[:200] if isinstance(value, str) else value
    return ActivityEntry.objects.create(
        actor=actor, action=str(action)[:80], target_type=str(target_type)[:40],
        target_id=str(target_id)[:120], outcome=str(outcome)[:30], metadata=safe,
    )
