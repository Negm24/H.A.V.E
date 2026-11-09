import hashlib
import json


def formulation_signature(product):
    fields = (
        'name_en', 'active_ingredient', 'strength', 'dosage_form',
        'pack_description', 'requires_prescription',
    )
    values = {field: getattr(product, field) for field in fields}
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()
