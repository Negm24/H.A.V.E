from django.db import connection


def generate_user_id(account_type, phone_number):
    prefixes = {
        "CUSTOMER": "C",
        "DOCTOR": "D",
        "OWNER": "O",
    }

    try:
        prefix = prefixes[account_type]
    except KeyError:
        raise ValueError("Unsupported account type.") from None

    phone_suffix = phone_number[-3:]

    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval('have_user_id_seq')")
        sequence_number = cursor.fetchone()[0]

    return f"HAV-{prefix}{phone_suffix}-{sequence_number:012d}"