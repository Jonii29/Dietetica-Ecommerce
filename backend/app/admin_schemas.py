"""Esquemas del panel de gestión. Montos en centavos, igual que el resto de la API."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .schemas import ORM, OrderItemOut, TagOut

# ---------- Sesión ----------

class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)


class AdminMe(BaseModel):
    username: str


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=200)


# ---------- Productos ----------

class VariantIn(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=60)
    sale_type: Literal["peso", "unidad"] = "unidad"
    quantity: int = Field(ge=1, le=1_000_000)
    unit: Literal["g", "ml", "u"] = "u"
    price: int = Field(ge=0)
    compare_at_price: int | None = Field(default=None, ge=0)
    stock: int | None = Field(default=None, ge=0)
    is_active: bool = True

    @field_validator("sku")
    @classmethod
    def _sku(cls, v: str) -> str:
        return v.strip().upper()


class ProductIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    brand: str | None = Field(default=None, max_length=80)
    description: str | None = None
    image_url: str | None = Field(default=None, max_length=500)
    category_id: int | None = None
    new_category: str | None = Field(default=None, max_length=120)  # crea una categoría madre
    tags: list[str] = []                                           # slugs
    synonyms: str | None = None
    is_active: bool = True
    variants: list[VariantIn] = Field(min_length=1, max_length=30)

    @field_validator("brand", "description", "image_url", "synonyms", "new_category")
    @classmethod
    def _blank_to_none(cls, v: str | None) -> str | None:
        return v.strip() or None if isinstance(v, str) else v


class VariantPatch(BaseModel):
    """Edición rápida desde la tabla. Solo se cambian los campos enviados
    (`stock: null` = dejar de controlar stock)."""
    price: int | None = Field(default=None, ge=0)
    compare_at_price: int | None = Field(default=None, ge=0)
    stock: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class AdminVariantOut(ORM):
    id: int
    sku: str
    label: str
    sale_type: str
    quantity: int
    unit: str
    price: int
    compare_at_price: int | None
    stock: int | None
    is_active: bool


class AdminProductOut(ORM):
    id: int
    slug: str
    name: str
    brand: str | None
    description: str | None
    image_url: str | None
    category_id: int | None
    synonyms: str | None
    is_active: bool
    tags: list[TagOut]
    variants: list[AdminVariantOut]
    updated_at: datetime | None = None


class AdminProductPage(BaseModel):
    items: list[AdminProductOut]
    total: int


# ---------- Pedidos ----------

OrderStatusLit = Literal["pending", "awaiting_payment", "paid", "payment_failed", "cancelled", "fulfilled"]


class AdminOrderOut(ORM):
    code: str
    status: str
    channel: str
    customer_name: str
    customer_phone: str | None
    delivery_method: str
    address: str | None
    notes: str | None
    total: int
    mp_payment_id: str | None
    stock_applied: bool
    items: list[OrderItemOut]
    created_at: datetime | None
    updated_at: datetime | None


class AdminOrderPage(BaseModel):
    items: list[AdminOrderOut]
    total: int
    page: int
    pages: int
    counts: dict[str, int]  # cantidad por estado (para las pestañas)


class OrderStatusIn(BaseModel):
    status: OrderStatusLit


# ---------- Resumen ----------

class DayPoint(BaseModel):
    date: str        # YYYY-MM-DD (hora local del local)
    total: int       # ventas confirmadas, centavos
    orders: int


class TopProduct(BaseModel):
    name: str
    units: int
    revenue: int


class LowStockItem(BaseModel):
    product_id: int
    product_name: str
    sku: str
    label: str
    stock: int


class Stats(BaseModel):
    days: int
    sales_today: int
    sales_period: int
    orders_period: int          # pedidos vendidos (pagados o entregados)
    avg_ticket: int
    pending_orders: int         # a confirmar / esperando pago
    series: list[DayPoint]
    top_products: list[TopProduct]
    low_stock: list[LowStockItem]
    low_stock_threshold: int
    active_products: int
    hidden_products: int
