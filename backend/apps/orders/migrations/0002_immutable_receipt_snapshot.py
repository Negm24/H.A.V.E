from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("orders", "0001_initial")]
    operations = [migrations.RunSQL(
        sql="""
        CREATE FUNCTION have_protect_receipt_snapshot() RETURNS trigger AS $$
        BEGIN
            IF NEW.order_id IS DISTINCT FROM OLD.order_id
                OR NEW.receipt_number IS DISTINCT FROM OLD.receipt_number
                OR NEW.receipt_snapshot IS DISTINCT FROM OLD.receipt_snapshot
                OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
                RAISE EXCEPTION 'Issued receipt identity and snapshot are immutable'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        CREATE TRIGGER have_receipt_snapshot_immutable
            BEFORE UPDATE ON receipts
            FOR EACH ROW EXECUTE FUNCTION have_protect_receipt_snapshot();
        """,
        reverse_sql="""
        DROP TRIGGER IF EXISTS have_receipt_snapshot_immutable ON receipts;
        DROP FUNCTION IF EXISTS have_protect_receipt_snapshot();
        """,
    )]
