from apps.terminals.services.expiry import expiry_today
from rest_framework import serializers
from rest_framework.response import Response
from drf_spectacular.utils import extend_schema
from drf_spectacular.types import OpenApiTypes
from apps.catalogue.models import ProductBatch
from apps.terminals.models import Terminal
from apps.operations.services.inventory import adjust_external, transfer, external_data, cabinet_data, save_layout
from .views import OwnerView
from .redesign_serializers import ExternalPageOutput, MovementActionOutput, CabinetOutput
from apps.operations.services.cabinet_transfers import load_plan, load, return_packs
from apps.catalogue.models import Product
from apps.operations.models import ExternalStock
from django.utils import timezone
from django.db.models import Q


class ExternalInput(serializers.Serializer):
    batch_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=0, max_value=2147483647)
    revision = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=1000)
    action_id = serializers.UUIDField()


class TransferInput(serializers.Serializer):
    slot_id = serializers.IntegerField(min_value=1)
    batch_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1, max_value=2147483647)
    slot_revision = serializers.IntegerField(min_value=1)
    external_revision = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=1000)
    action_id = serializers.UUIDField()


class Position(serializers.Serializer):
    slot_id = serializers.IntegerField(min_value=1)
    row = serializers.IntegerField(min_value=1, max_value=4)
    column = serializers.IntegerField(min_value=1, max_value=6)


class LayoutInput(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)
    positions = Position(many=True)


class ExternalView(OwnerView):
    @extend_schema(tags=["Owner · Inventory"], responses=ExternalPageOutput)
    def get(self, request):
        return self.list_data(request.query_params.dict())

    def list_data(self, values):
        rows = ProductBatch.objects.select_related("product").order_by("product__name_en", "expiry_date")
        query = values.get("query", "")[:200]
        if query:
            from django.db.models import Q
            rows = rows.filter(Q(product__name_en__icontains=query) | Q(batch_number__icontains=query))
        from .serializers import SearchSerializer
        form = SearchSerializer(data=values)
        form.is_valid(raise_exception=True)
        page, size = form.validated_data["page"], form.validated_data["page_size"]
        return Response({"items": [external_data(batch) for batch in rows[(page-1)*size:page*size]], "total": rows.count(), "page": page, "page_size": size})


class ExternalSearchView(ExternalView):
    http_method_names = ["post", "options"]

    @extend_schema(tags=["Owner · Inventory"], request=OpenApiTypes.OBJECT, responses=ExternalPageOutput)
    def post(self, request):
        return self.list_data(request.data)


class ExternalAdjustView(OwnerView):
    @extend_schema(tags=["Owner · Inventory"], request=ExternalInput, responses=MovementActionOutput)
    def post(self, request):
        form = ExternalInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(adjust_external(actor=request.user, **form.validated_data))


class TransferView(OwnerView):
    @extend_schema(tags=["Owner · Inventory"], request=TransferInput, responses=MovementActionOutput)
    def post(self, request):
        form = TransferInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(transfer(actor=request.user, **form.validated_data))


class CabinetView(OwnerView):
    @extend_schema(tags=["Owner · Inventory"], responses=CabinetOutput)
    def get(self, request, serial):
        return Response(cabinet_data(Terminal.objects.get(pk=serial)))

    @extend_schema(tags=["Owner · Inventory"], request=LayoutInput, responses=CabinetOutput)
    def patch(self, request, serial):
        form = LayoutInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(save_layout(actor=request.user, serial=serial, **form.validated_data))


class BatchAllocation(serializers.Serializer):
    batch_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)
    revision = serializers.IntegerField(min_value=0)


class LoadPreviewInput(serializers.Serializer):
    slot_id = serializers.IntegerField(min_value=1)
    product_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=1)


class LoadInput(LoadPreviewInput):
    slot_revision = serializers.IntegerField(min_value=1)
    batches = BatchAllocation(many=True, allow_empty=False)
    action_id = serializers.UUIDField()


class ReturnInput(serializers.Serializer):
    expired_removal_confirmed = serializers.BooleanField(default=False)
    slot_id = serializers.IntegerField(min_value=1)
    slot_revision = serializers.IntegerField(min_value=1)
    batches = BatchAllocation(many=True, allow_empty=False)
    action_id = serializers.UUIDField()


class LoadPreviewView(OwnerView):
    @extend_schema(tags=['Owner · Inventory'], request=LoadPreviewInput, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        form = LoadPreviewInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(load_plan(**form.validated_data))


class LoadView(OwnerView):
    @extend_schema(tags=['Owner · Inventory'], request=LoadInput, responses=MovementActionOutput)
    def post(self, request):
        form = LoadInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(load(actor=request.user, **form.validated_data))


class ReturnView(OwnerView):
    @extend_schema(tags=['Owner · Inventory'], request=ReturnInput, responses=MovementActionOutput)
    def post(self, request):
        form = ReturnInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(return_packs(actor=request.user, **form.validated_data))


class ExternalProductsView(OwnerView):
    def _list(self, values):
        from .serializers import SearchSerializer
        form = SearchSerializer(data=values)
        form.is_valid(raise_exception=True)
        query = form.validated_data.get('query', '')
        products = Product.objects.filter(is_active=True, category__is_active=True,
            batches__external_stock__quantity__gt=0, batches__expiry_date__gte=expiry_today()).distinct().order_by('name_en','pk')
        if query:
            products = products.filter(Q(name_en__icontains=query)|Q(name_ar__icontains=query)|Q(sku__icontains=query)|Q(active_ingredient__icontains=query)|Q(strength__icontains=query))
        page, size = form.validated_data['page'], form.validated_data['page_size']
        items = []
        for product in products[(page-1)*size:page*size]:
            balances = ExternalStock.objects.filter(batch__product=product, quantity__gt=0, batch__expiry_date__gte=expiry_today()).select_related('batch').order_by('batch__expiry_date','batch_id')
            batches = [{'batch_id':row.batch_id,'batch_number':row.batch.batch_number,'expiry_date':row.batch.expiry_date,'quantity':row.quantity,'revision':row.revision} for row in balances]
            items.append({'id':product.pk,'product_id':product.pk,'sku':product.sku,'name_en':product.name_en,'product_name':product.name_en,'strength':product.strength,'pack_description':product.pack_description,'image_url':product.image.url if product.image else None,'quantity':sum(row['quantity'] for row in batches),'batches':batches})
        return Response({'items':items,'total':products.count(),'page':page,'page_size':size})

    @extend_schema(tags=['Owner · Inventory'], operation_id='owner_inventory_products_list', responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return self._list(request.query_params.dict())


class ExternalProductsSearchView(ExternalProductsView):
    http_method_names = ['post','options']

    @extend_schema(tags=['Owner · Inventory'], operation_id='owner_inventory_products_search', request=OpenApiTypes.OBJECT, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        return self._list(request.data)
