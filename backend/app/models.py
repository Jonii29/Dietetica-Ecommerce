"""Modelos de datos (SQLAlchemy 2.0, tipado).

Decisiones clave
----------------
* **Dinero en centavos (int)**: sin errores de punto flotante. 1.234,50 ARS -> 123450.
* **Producto vs. Variante**: el *Producto* es lo que se busca/muestra ("Almendras peladas");
  la *Variante* es lo que se compra (SKU, 250 g / 500 g / 1 kg, precio, stock).
* **search_text**: columna desnormalizada (nombre + marca + categoría + etiquetas + sinónimos,
  sin tildes y en minúsculas) que se recalcula en cada importación. Permite búsqueda
  instantánea en memoria o un LIKE barato en SQL.
* **Tags** con `kind` ("dietary" | "general") para separar los filtros dietarios del resto.
* Las órdenes guardan un *snapshot* de nombre/precio: si mañana cambia el precio, el pedido
  histórico no se altera.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey, Index, Integer, String, Table, Text, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base

# ---------------------------------------------------------------------------
# Catálogo
# ---------------------------------------------------------------------------

product_tags = Table(
    "product_tags",
    Base.metadata,
    Column("product_id", ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_product_tags_tag", "tag_id"),
)


class Category(Base):
    """Categorías jerárquicas (madre -> hija). Ej: Harinas > Harinas sin TACC."""
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(140), unique=True, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    parent: Mapped[Category | None] = relationship(remote_side=[id], back_populates="children")
    children: Mapped[list[Category]] = relationship(back_populates="parent")
    products: Mapped[list[Product]] = relationship(back_populates="category")

    @property
    def root(self) -> Category:
        node = self
        while node.parent is not None:
            node = node.parent
        return node


class TagKind(str, enum.Enum):
    DIETARY = "dietary"   # sin-tacc, vegano, organico, sin-azucar, keto...
    GENERAL = "general"   # oferta, nuevo, a-granel...


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[TagKind] = mapped_column(Enum(TagKind, native_enum=False), default=TagKind.GENERAL)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160))
    brand: Mapped[str | None] = mapped_column(String(80), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(500))
    synonyms: Mapped[str | None] = mapped_column(Text)        # "chia|semillas de chía"
    search_text: Mapped[str] = mapped_column(Text, default="")  # normalizado, ver docstring
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    category: Mapped[Category | None] = relationship(back_populates="products")
    tags: Mapped[list[Tag]] = relationship(secondary=product_tags, lazy="selectin")
    variants: Mapped[list[Variant]] = relationship(
        back_populates="product", cascade="all, delete-orphan",
        order_by="Variant.sort_order", lazy="selectin",
    )

    @property
    def active_variants(self) -> list[Variant]:
        return [v for v in self.variants if v.is_active]

    @property
    def min_price(self) -> int | None:
        prices = [v.price for v in self.active_variants]
        return min(prices) if prices else None


class SaleType(str, enum.Enum):
    WEIGHT = "peso"     # fraccionado: 250 g / 500 g / 1 kg
    UNIT = "unidad"     # envasado: frasco, paquete, caja


class Variant(Base):
    """Unidad vendible. `quantity` + `unit` permiten calcular precio por kg/L para comparar."""
    __tablename__ = "variants"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    sku: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    label: Mapped[str] = mapped_column(String(60))                 # "500 g", "Frasco 360 g"
    sale_type: Mapped[SaleType] = mapped_column(Enum(SaleType, native_enum=False), default=SaleType.UNIT)
    quantity: Mapped[int] = mapped_column(Integer, default=1)       # 500
    unit: Mapped[str] = mapped_column(String(4), default="u")       # g | ml | u
    price: Mapped[int] = mapped_column(Integer)                     # centavos
    compare_at_price: Mapped[int | None] = mapped_column(Integer)   # precio tachado (oferta)
    stock: Mapped[int | None] = mapped_column(Integer)              # None = no se controla stock
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    product: Mapped[Product] = relationship(back_populates="variants")

    @property
    def in_stock(self) -> bool:
        return self.stock is None or self.stock > 0


class CatalogMeta(Base):
    """Fila única con la versión del catálogo. Se incrementa en cada importación para que
    todos los workers (y los navegadores, vía ETag) invaliden su caché."""
    __tablename__ = "catalog_meta"

    id: Mapped[int] = mapped_column(primary_key=True, default=1)
    version: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ---------------------------------------------------------------------------
# Pedidos
# ---------------------------------------------------------------------------

class OrderStatus(str, enum.Enum):
    PENDING = "pending"                    # creado, esperando confirmación (WhatsApp)
    AWAITING_PAYMENT = "awaiting_payment"  # preferencia de MP creada
    PAID = "paid"
    PAYMENT_FAILED = "payment_failed"
    CANCELLED = "cancelled"
    FULFILLED = "fulfilled"


class OrderChannel(str, enum.Enum):
    WHATSAPP = "whatsapp"
    MERCADOPAGO = "mercadopago"


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)  # "D-7K3Q9P" (público)
    status: Mapped[OrderStatus] = mapped_column(Enum(OrderStatus, native_enum=False), default=OrderStatus.PENDING, index=True)
    channel: Mapped[OrderChannel] = mapped_column(Enum(OrderChannel, native_enum=False))
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone: Mapped[str | None] = mapped_column(String(40))
    delivery_method: Mapped[str] = mapped_column(String(20), default="retiro")  # retiro | envio
    address: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    total: Mapped[int] = mapped_column(Integer)                      # centavos
    mp_preference_id: Mapped[str | None] = mapped_column(String(80))
    mp_payment_id: Mapped[str | None] = mapped_column(String(40), index=True)
    stock_applied: Mapped[bool] = mapped_column(Boolean, default=False)  # ¿ya se descontó stock?
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    items: Mapped[list[OrderItem]] = relationship(back_populates="order", cascade="all, delete-orphan", lazy="selectin")


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("variants.id", ondelete="SET NULL"))
    sku: Mapped[str] = mapped_column(String(64))
    product_name: Mapped[str] = mapped_column(String(160))   # snapshot
    variant_label: Mapped[str] = mapped_column(String(60))   # snapshot
    unit_price: Mapped[int] = mapped_column(Integer)         # snapshot, centavos
    quantity: Mapped[int] = mapped_column(Integer)
    subtotal: Mapped[int] = mapped_column(Integer)

    order: Mapped[Order] = relationship(back_populates="items")


# ---------------------------------------------------------------------------
# Panel de gestión
# ---------------------------------------------------------------------------

class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))   # scrypt$salt$hash
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AdminSession(Base):
    """Sesiones guardadas en la base: cerrar sesión las invalida de verdad.
    Se guarda el SHA-256 del token, nunca el token en sí."""
    __tablename__ = "admin_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("admin_users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[AdminUser] = relationship()
