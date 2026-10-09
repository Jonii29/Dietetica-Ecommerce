"""Autenticación del panel de gestión: usuario + contraseña con sesión en cookie.

* Contraseñas con scrypt (librería estándar, sin dependencias extra).
* El navegador recibe un token aleatorio en una cookie HttpOnly (JavaScript no puede leerla);
  la base guarda solo su SHA-256. Cerrar sesión borra la fila.
* Límite simple de intentos de login por IP para frenar ataques de fuerza bruta.
* Alternativa para scripts: header `X-Admin-Token` si se define la variable ADMIN_TOKEN.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import get_db
from .models import AdminSession, AdminUser

settings = get_settings()
COOKIE_NAME = "dietetica_admin"

# ---------------------------------------------------------------------------
# Contraseñas
# ---------------------------------------------------------------------------
_N, _R, _P = 2**14, 8, 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, hash_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=_N, r=_R, p=_P, dklen=32)
    return hmac.compare_digest(dk.hex(), hash_hex)


def validate_new_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError("La contraseña tiene que tener al menos 8 caracteres.")


# ---------------------------------------------------------------------------
# Sesiones
# ---------------------------------------------------------------------------

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    # SQLite devuelve fechas sin zona horaria: se guardaron en UTC
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def create_session(db: Session, user: AdminUser) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(delete(AdminSession).where(AdminSession.expires_at < _now()))  # limpieza
    db.add(AdminSession(
        token_hash=_hash_token(token), user_id=user.id,
        expires_at=_now() + timedelta(days=settings.session_days),
    ))
    user.last_login_at = _now()
    db.commit()
    return token


def destroy_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(AdminSession).where(AdminSession.token_hash == _hash_token(token)))
        db.commit()


def user_from_token(db: Session, token: str | None) -> AdminUser | None:
    if not token:
        return None
    sess = db.scalar(select(AdminSession).where(AdminSession.token_hash == _hash_token(token)))
    if sess is None or _aware(sess.expires_at) < _now() or not sess.user.is_active:
        return None
    return sess.user


def cookie_kwargs() -> dict:
    return {
        "key": COOKIE_NAME, "httponly": True, "samesite": "lax", "secure": settings.cookie_secure,
        "max_age": settings.session_days * 86400, "path": "/",
    }


# ---------------------------------------------------------------------------
# Dependencia FastAPI
# ---------------------------------------------------------------------------

def require_admin(
    db: Session = Depends(get_db),
    session_token: str | None = Cookie(None, alias=COOKIE_NAME),
    x_admin_token: str | None = Header(None),
) -> AdminUser | None:
    user = user_from_token(db, session_token)
    if user is not None:
        return user
    if settings.admin_token and x_admin_token and hmac.compare_digest(x_admin_token, settings.admin_token):
        return None  # acceso por script (sin usuario)
    raise HTTPException(401, "Tenés que iniciar sesión.")


# ---------------------------------------------------------------------------
# Límite de intentos de login
# ---------------------------------------------------------------------------
_WINDOW, _MAX_ATTEMPTS = 300, 8
_attempts: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Detrás del proxy de Render y de Next.js, la IP real viene en X-Forwarded-For (la primera)
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "?"


def check_login_rate(request: Request) -> None:
    ip = _client_ip(request)
    q = _attempts[ip]
    now = time.monotonic()
    while q and now - q[0] > _WINDOW:
        q.popleft()
    if len(q) >= _MAX_ATTEMPTS:
        raise HTTPException(429, "Demasiados intentos. Esperá unos minutos y probá de nuevo.")
    q.append(now)


def reset_login_rate(request: Request) -> None:
    _attempts.pop(_client_ip(request), None)


# ---------------------------------------------------------------------------
# Usuario inicial
# ---------------------------------------------------------------------------

def ensure_initial_admin(db: Session) -> None:
    """Si no hay usuarios y ADMIN_PASSWORD está definida, crea el primero."""
    if db.scalar(select(AdminUser.id).limit(1)) is not None or not settings.admin_password:
        return
    db.add(AdminUser(username=settings.admin_user.strip().lower(), password_hash=hash_password(settings.admin_password)))
    db.commit()
