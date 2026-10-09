"""Creación de órdenes. Regla de oro: el cliente manda SKUs y cantidades; los PRECIOS
siempre se recalculan en el servidor (nunca se confía en el total del carrito)."""
from __future__ import annotations

import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Order, OrderChannel, OrderItem, OrderStatus, Variant
from ..schemas import OrderCreate
from .catalog import bump_catalog_version

_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"  # sin 0/O/1/I para dictarlo por teléfono


class OrderError(ValueError):
    pass


def _new_code(db: Session) -> str:
    while True:
        code = "D-" + "".join(secrets.choice(_ALPHABET) for _ in range(6))
        if not db.scalar(select(Order.id).where(Order.code == code)):
            return code


def create_order(db: Session, data: OrderCreate) -> tuple[Order, list[str]]:
    # Agrupar SKUs repetidos
    wanted: dict[str, int] = {}
    for it in data.items:
        sku = it.sku.strip().upper()
        wanted[sku] = wanted.get(sku, 0) + it.quantity

    variants = {
        v.sku: v for v in db.scalars(select(Variant).where(Variant.sku.in_(wanted.keys())))
    }
    warnings: list[str] = []
    items: list[OrderItem] = []
    for sku, qty in wanted.items():
        v = variants.get(sku)
        if v is None or not v.is_active or not v.product.is_active:
            warnings.append(f"{sku}: ya no está disponible y se quitó del pedido")
            continue
        if v.stock is not None and v.stock < qty:
            if v.stock <= 0:
                warnings.append(f"{v.product.name} ({v.label}): sin stock")
                continue
            warnings.append(f"{v.product.name} ({v.label}): solo hay {v.stock}, se ajustó la cantidad")
            qty = v.stock
        items.append(OrderItem(
            variant_id=v.id, sku=v.sku, product_name=v.product.name, variant_label=v.label,
            unit_price=v.price, quantity=qty, subtotal=v.price * qty,
        ))

    if not items:
        raise OrderError("Ninguno de los productos del carrito está disponible.")
    if data.customer.delivery_method == "envio" and not data.customer.address:
        raise OrderError("Para envío a domicilio indicá la dirección.")

    channel = OrderChannel(data.channel)
    order = Order(
        code=_new_code(db),
        channel=channel,
        status=OrderStatus.PENDING if channel is OrderChannel.WHATSAPP else OrderStatus.AWAITING_PAYMENT,
        customer_name=data.customer.name.strip(),
        customer_phone=data.customer.phone,
        delivery_method=data.customer.delivery_method,
        address=data.customer.address,
        notes=data.customer.notes,
        total=sum(i.subtotal for i in items),
        items=items,
    )
    db.add(order)
    db.commit()
    db.refresh(order)
    return order, warnings


# Estados en los que la mercadería se considera vendida (stock descontado)
SOLD_STATUSES = {OrderStatus.PAID, OrderStatus.FULFILLED}


def _move_stock(db: Session, order: Order, direction: int) -> None:
    """direction=-1 descuenta, +1 devuelve. Solo afecta variantes con control de stock."""
    ids = [i.variant_id for i in order.items if i.variant_id]
    variants = {v.id: v for v in db.scalars(select(Variant).where(Variant.id.in_(ids)).with_for_update())}
    for it in order.items:
        v = variants.get(it.variant_id)
        if v is not None and v.stock is not None:
            v.stock = max(0, v.stock + direction * it.quantity)


def set_status(db: Session, order: Order, new_status: OrderStatus) -> None:
    """Cambia el estado y mantiene el stock coherente (idempotente):
    * al pasar a pagado/entregado se descuenta una sola vez;
    * al cancelar un pedido que ya había descontado, se devuelve."""
    if new_status in SOLD_STATUSES and not order.stock_applied:
        _move_stock(db, order, -1)
        order.stock_applied = True
        bump_catalog_version(db)
    elif new_status in (OrderStatus.CANCELLED, OrderStatus.PAYMENT_FAILED) and order.stock_applied:
        _move_stock(db, order, +1)
        order.stock_applied = False
        bump_catalog_version(db)
    order.status = new_status
    db.commit()


def mark_paid(db: Session, order: Order, payment_id: str) -> None:
    """Webhook de Mercado Pago. Idempotente: un segundo aviso no vuelve a descontar."""
    if order.status in SOLD_STATUSES:
        return
    order.mp_payment_id = payment_id
    set_status(db, order, OrderStatus.PAID)
