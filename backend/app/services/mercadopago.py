"""Cliente mínimo de Mercado Pago (Checkout Pro) usando la API REST con httpx.

Se evita el SDK oficial para tener control de timeouts, idempotencia y async.
Docs: https://www.mercadopago.com.ar/developers/es/docs/checkout-pro
"""
from __future__ import annotations

import hashlib
import hmac

import httpx

from ..config import get_settings
from ..models import Order

settings = get_settings()
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class MercadoPagoError(RuntimeError):
    pass


def _headers(idempotency_key: str | None = None) -> dict[str, str]:
    if not settings.mp_access_token:
        raise MercadoPagoError("MP_ACCESS_TOKEN no configurado")
    h = {"Authorization": f"Bearer {settings.mp_access_token}", "Content-Type": "application/json"}
    if idempotency_key:
        h["X-Idempotency-Key"] = idempotency_key
    return h


async def create_preference(order: Order) -> dict:
    """Crea la preferencia y devuelve el JSON de MP (usar `init_point` para redirigir)."""
    payload = {
        "items": [
            {
                "id": it.sku,
                "title": f"{it.product_name} ({it.variant_label})"[:250],
                "quantity": it.quantity,
                "unit_price": round(it.unit_price / 100, 2),
                "currency_id": "ARS",
            }
            for it in order.items
        ],
        "payer": {"name": order.customer_name},
        "external_reference": order.code,  # nos permite encontrar la orden en el webhook
        "notification_url": f"{settings.public_api_url}/api/payments/mercadopago/webhook",
        "back_urls": {
            "success": f"{settings.public_site_url}/pedido/{order.code}?estado=ok",
            "pending": f"{settings.public_site_url}/pedido/{order.code}?estado=pendiente",
            "failure": f"{settings.public_site_url}/pedido/{order.code}?estado=error",
        },
        "auto_return": "approved",
        "statement_descriptor": settings.store_name[:22],
    }
    async with httpx.AsyncClient(base_url=settings.mp_api_base, timeout=_TIMEOUT) as client:
        r = await client.post("/checkout/preferences", json=payload, headers=_headers(order.code))
    if r.status_code >= 300:
        raise MercadoPagoError(f"MP preference {r.status_code}: {r.text[:300]}")
    return r.json()


async def get_payment(payment_id: str) -> dict:
    async with httpx.AsyncClient(base_url=settings.mp_api_base, timeout=_TIMEOUT) as client:
        r = await client.get(f"/v1/payments/{payment_id}", headers=_headers())
    if r.status_code >= 300:
        raise MercadoPagoError(f"MP payment {r.status_code}: {r.text[:300]}")
    return r.json()


def verify_webhook_signature(x_signature: str | None, x_request_id: str | None, data_id: str | None) -> bool:
    """Valida el header `x-signature` ("ts=...,v1=...") con la clave secreta del webhook.

    Manifest según la doc de MP: ``id:{data.id};request-id:{x-request-id};ts:{ts};``
    (se omiten las partes ausentes; data.id va en minúsculas si es alfanumérico).
    Si no hay secreto configurado (desarrollo) se acepta, pero igual se consulta el pago a la API.
    """
    secret = settings.mp_webhook_secret
    if not secret:
        return True
    if not x_signature:
        return False
    parts = dict(p.split("=", 1) for p in x_signature.split(",") if "=" in p)
    ts, v1 = parts.get("ts", "").strip(), parts.get("v1", "").strip()
    if not ts or not v1:
        return False
    manifest = ""
    if data_id:
        manifest += f"id:{data_id.lower()};"
    if x_request_id:
        manifest += f"request-id:{x_request_id};"
    manifest += f"ts:{ts};"
    expected = hmac.new(secret.encode(), manifest.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)
