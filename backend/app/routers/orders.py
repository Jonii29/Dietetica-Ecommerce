"""Pedidos (WhatsApp / Mercado Pago) y webhook de pagos."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..models import Order, OrderChannel, OrderStatus
from ..schemas import OrderCreate, OrderCreated, OrderOut
from ..services import mercadopago as mp
from ..services.orders import OrderError, create_order, mark_paid, set_status
from ..services.whatsapp import build_order_message, build_whatsapp_url

log = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api", tags=["pedidos"])


@router.post("/orders", response_model=OrderCreated, status_code=201)
async def create(data: OrderCreate, db: Session = Depends(get_db)):
    """Crea el pedido con precios del servidor.

    * `channel=whatsapp`  -> devuelve `whatsapp_url` lista para abrir.
    * `channel=mercadopago` -> crea la preferencia de Checkout Pro y devuelve `checkout_url`.
    """
    try:
        order, warnings = create_order(db, data)
    except OrderError as exc:
        raise HTTPException(422, str(exc)) from exc

    result = OrderCreated(order=OrderOut.model_validate(order), warnings=warnings)

    if order.channel is OrderChannel.WHATSAPP:
        msg = build_order_message(order, settings.store_name)
        result.whatsapp_url = build_whatsapp_url(settings.whatsapp_number, msg)
    else:
        try:
            pref = await mp.create_preference(order)
        except mp.MercadoPagoError as exc:
            log.exception("Error creando preferencia MP")
            order.status = OrderStatus.CANCELLED
            db.commit()
            raise HTTPException(502, "No pudimos iniciar el pago. Probá de nuevo o pedí por WhatsApp.") from exc
        order.mp_preference_id = pref.get("id")
        db.commit()
        result.checkout_url = pref.get("init_point")
    return result


@router.get("/orders/{code}", response_model=OrderOut)
def get_order(code: str, db: Session = Depends(get_db)):
    order = db.scalar(select(Order).where(Order.code == code.upper()))
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return order


_MP_STATUS = {
    "approved": OrderStatus.PAID,
    "rejected": OrderStatus.PAYMENT_FAILED,
    "cancelled": OrderStatus.PAYMENT_FAILED,
    "refunded": OrderStatus.CANCELLED,
    "charged_back": OrderStatus.CANCELLED,
}


@router.post("/payments/mercadopago/webhook", status_code=200)
async def mercadopago_webhook(
    request: Request,
    db: Session = Depends(get_db),
    x_signature: str | None = Header(None),
    x_request_id: str | None = Header(None),
):
    """Notificación de MP. Nunca se confía en el cuerpo: se re-consulta el pago a la API
    y se valida monto + external_reference antes de marcar la orden como pagada."""
    params = request.query_params
    try:
        body = await request.json()
    except Exception:
        body = {}
    topic = body.get("type") or params.get("type") or params.get("topic")
    data_id = str((body.get("data") or {}).get("id") or params.get("data.id") or params.get("id") or "")

    if not mp.verify_webhook_signature(x_signature, x_request_id, data_id):
        raise HTTPException(401, "firma inválida")
    if topic != "payment" or not data_id:
        return {"ignored": True}  # merchant_order, etc.

    payment = await mp.get_payment(data_id)
    order = db.scalar(select(Order).where(Order.code == payment.get("external_reference")))
    if not order:
        log.warning("Pago %s sin orden asociada", data_id)
        return {"ok": True}

    status = payment.get("status")
    paid_cents = round(float(payment.get("transaction_amount") or 0) * 100)
    if status == "approved":
        if paid_cents < order.total:
            log.error("Monto pagado %s < total %s (orden %s)", paid_cents, order.total, order.code)
            return {"ok": True}
        mark_paid(db, order, data_id)
    elif status in _MP_STATUS and order.status is not OrderStatus.PAID:
        order.mp_payment_id = data_id
        set_status(db, order, _MP_STATUS[status])
    return {"ok": True}
