"""Esquemas Pydantic v2 (contratos de la API). Montos siempre en centavos."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Catálogo ----------

class TagOut(ORM):
    slug: str
    name: str
    kind: str


class CategoryOut(ORM):
    id: int
    slug: str
    name: str
    parent_id: int | None = None


class VariantOut(ORM):
    sku: str
    label: str
    sale_type: str
    quantity: int
    unit: str
    price: int
    compare_at_price: int | None = None
    in_stock: bool


class ProductOut(ORM):
    id: int
    slug: str
    name: str
    brand: str | None = None
    description: str | None = None
    image_url: str | None = None
    category: CategoryOut | None = None
    tags: list[TagOut]
    variants: list[VariantOut]
    min_price: int | None = None


class Facets(BaseModel):
    tags: dict[str, int]
    categories: dict[str, int]
    brands: dict[str, int]


class ProductPage(BaseModel):
    items: list[ProductOut]
    total: int
    page: int
    page_size: int
    pages: int
    facets: Facets


class CatalogItem(BaseModel):
    """Versión compacta para descargar el catálogo completo al cliente (búsqueda local)."""
    id: int
    slug: str
    name: str
    brand: str | None
    image: str | None
    category: str | None        # slug de la categoría madre
    subcategory: str | None     # slug de la hoja
    tags: list[str]
    search: str                 # search_text normalizado
    variants: list[VariantOut]


class Catalog(BaseModel):
    version: str
    categories: list[CategoryOut]
    tags: list[TagOut]
    products: list[CatalogItem]


class Suggestion(BaseModel):
    slug: str
    name: str
    brand: str | None
    min_price: int | None
    image: str | None


# ---------- Pedidos ----------

class OrderItemIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    quantity: int = Field(ge=1, le=999)


class CustomerIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    delivery_method: Literal["retiro", "envio"] = "retiro"
    address: str | None = Field(default=None, max_length=255)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("address")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() if v else v


class OrderCreate(BaseModel):
    channel: Literal["whatsapp", "mercadopago"]
    customer: CustomerIn
    items: list[OrderItemIn] = Field(min_length=1, max_length=200)


class OrderItemOut(ORM):
    sku: str
    product_name: str
    variant_label: str
    unit_price: int
    quantity: int
    subtotal: int


class OrderOut(ORM):
    code: str
    status: str
    channel: str
    customer_name: str
    delivery_method: str
    total: int
    items: list[OrderItemOut]
    created_at: datetime | None = None


class OrderCreated(BaseModel):
    order: OrderOut
    warnings: list[str] = []
    checkout_url: str | None = None      # init_point de Mercado Pago
    whatsapp_url: str | None = None      # wa.me con el mensaje armado (server-side)


class ImportResult(BaseModel):
    dry_run: bool
    rows: int
    products_created: int
    products_updated: int
    variants_created: int
    variants_updated: int
    variants_deactivated: int
    errors: list[dict]
    detected: dict | None = None        # cómo se interpretó el archivo (columnas, hojas, avisos)
    sample: list[dict] = []             # primeras filas ya interpretadas
