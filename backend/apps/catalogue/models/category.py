from django.db import models


class Category(models.Model):
    name_en = models.CharField(max_length=100, unique=True)
    name_ar = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)
    image = models.ImageField(upload_to="categories/", blank=True)
    revision = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "categories"
        ordering = ["id"]

    def __str__(self):
        return self.name_en
