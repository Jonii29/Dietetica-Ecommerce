"""Login / logout del panel de gestión."""
from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..admin_schemas import AdminMe, LoginIn, PasswordChange
from ..database import get_db
from ..models import AdminUser
from ..security import (
    COOKIE_NAME, check_login_rate, cookie_kwargs, create_session, destroy_session, hash_password,
    require_admin, reset_login_rate, verify_password,
)

router = APIRouter(prefix="/api/admin", tags=["admin: sesión"])

# Hash de relleno: si el usuario no existe igual se calcula un scrypt, así el tiempo de
# respuesta no revela qué usuarios existen.
_DUMMY_HASH = hash_password("relleno-para-tiempo-constante")


@router.post("/login", response_model=AdminMe)
def login(data: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    check_login_rate(request)
    user = db.scalar(select(AdminUser).where(func.lower(AdminUser.username) == data.username.strip().lower()))
    ok = verify_password(data.password, user.password_hash if user else _DUMMY_HASH)
    if not user or not ok or not user.is_active:
        raise HTTPException(401, "Usuario o contraseña incorrectos.")
    reset_login_rate(request)
    response.set_cookie(value=create_session(db, user), **cookie_kwargs())
    return AdminMe(username=user.username)


@router.post("/logout", status_code=204)
def logout(response: Response, token: str | None = Cookie(None, alias=COOKIE_NAME), db: Session = Depends(get_db)):
    destroy_session(db, token)
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me", response_model=AdminMe)
def me(user: AdminUser | None = Depends(require_admin)):
    return AdminMe(username=user.username if user else "script")


@router.post("/password", status_code=204)
def change_password(data: PasswordChange, user: AdminUser | None = Depends(require_admin), db: Session = Depends(get_db)):
    if user is None or not verify_password(data.current_password, user.password_hash):
        raise HTTPException(400, "La contraseña actual no es correcta.")
    user.password_hash = hash_password(data.new_password)
    db.commit()
