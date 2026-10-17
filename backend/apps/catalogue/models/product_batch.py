from django.db import models


class ProductBatch(models.Model):
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT, related_name="batches")
    batch_number = models.CharField(max_length=100)
    expiry_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "product_batches"
        constraints = [models.UniqueConstraint(fields=["product", "batch_number"], name="product_batches_product_number_unique")]
