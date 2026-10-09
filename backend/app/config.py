"""Configuración centralizada leída de variables de entorno (12-factor)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _list(value: str) -> list[str]:
    return [_url(v) for v in value.split(",") if v.strip()]


def _url(value: str) -> str:
    """Render entrega solo el host ("mi-app.onrender.com"); se completa con https://."""
    v = value.strip().rstrip("/")
    if v and "://" not in v:
        v = ("http://" if v.startswith(("localhost", "127.")) else "https://") + v
    return v


def _db_url(value: str) -> str:
    """Render/Heroku dan "postgres://…"; SQLAlchemy + psycopg 3 necesita "postgresql+psycopg://…"."""
    for prefix in ("postgres://", "postgresql://"):
        if value.startswith(prefix):
            return "postgresql+psycopg://" + value[len(prefix):]
    return value


@dataclass(frozen=True)
class Settings:
    # SQLite para empezar; para producción: postgresql+psycopg://user:pass@host/db
    database_url: str = _db_url(os.getenv("DATABASE_URL", "sqlite:///./dietetica.db"))
    cors_origins: list[str] = field(default_factory=lambda: _list(os.getenv("CORS_ORIGINS", "http://localhost:3000")))
    admin_token: str = os.getenv("ADMIN_TOKEN", "")  # opcional: acceso por header para scripts/curl

    # Panel de gestión
    admin_user: str = os.getenv("ADMIN_USER", "admin")          # se crea solo si no hay usuarios
    admin_password: str = os.getenv("ADMIN_PASSWORD", "")       # y si esta variable tiene valor
    session_days: int = int(os.getenv("SESSION_DAYS", "7"))
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "false").lower() == "true"  # true con HTTPS
    low_stock: int = int(os.getenv("LOW_STOCK", "5"))
    store_tz: str = os.getenv("STORE_TZ", "America/Argentina/Buenos_Aires")

    # Tienda
    store_name: str = os.getenv("STORE_NAME", "Dietética")
    whatsapp_number: str = os.getenv("WHATSAPP_NUMBER", "5491100000000")  # formato internacional, sin "+"
    public_site_url: str = _url(os.getenv("PUBLIC_SITE_URL", "http://localhost:3000"))
    public_api_url: str = _url(os.getenv("PUBLIC_API_URL", "http://localhost:8000"))

    # Mercado Pago
    mp_access_token: str = os.getenv("MP_ACCESS_TOKEN", "")
    mp_webhook_secret: str = os.getenv("MP_WEBHOOK_SECRET", "")  # "Clave secreta" del panel de Webhooks
    mp_api_base: str = os.getenv("MP_API_BASE", "https://api.mercadopago.com")


@lru_cache
def get_settings() -> Settings:
    return Settings()
