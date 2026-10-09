"""Formateador de pedidos para WhatsApp (versión servidor, espejo de frontend/lib/whatsapp.ts).

Se usa con los precios ya validados por el backend, así el mensaje que recibe el local
coincide 100% con lo guardado en la base.
"""
from __future__ import annotations

from urllib.parse import quote

from ..models import Order


def format_ars(cents: int) -> str:
    """123450 -> '$ 1.234,50'; 120000 -> '$ 1.200'."""
    pesos, cent = divmod(abs(cents), 100)
    txt = f"{pesos:,}".replace(",", ".")
    if cent:
        txt += f",{cent:02d}"
    return f"{'-' if cents < 0 else ''}$ {txt}"


def build_order_message(order: Order, store_name: str) -> str:
    lines = [
        f"🛒 *Nuevo pedido — {store_name}*",
        f"Pedido: *{order.code}*",
        "",
    ]
    for it in order.items:
        lines.append(f"• {it.quantity} × {it.product_name} ({it.variant_label})")
        lines.append(f"   {format_ars(it.unit_price)} c/u → *{format_ars(it.subtotal)}*")
    units = sum(i.quantity for i in order.items)
    lines += [
        "",
        f"Artículos: {units}",
        f"*TOTAL: {format_ars(order.total)}*",
        "",
        f"👤 {order.customer_name}",
        "🏪 Retiro en el local" if order.delivery_method == "retiro" else f"🚚 Envío a: {order.address or '(a coordinar)'}",
    ]
    if order.notes:
        lines.append(f"📝 {order.notes}")
    return "\n".join(lines)


def build_whatsapp_url(phone: str, message: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"https://wa.me/{digits}?text={quote(message, safe='')}"
