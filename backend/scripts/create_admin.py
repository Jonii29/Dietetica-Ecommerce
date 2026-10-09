#!/usr/bin/env python3
"""Crea un usuario del panel de gestión o le cambia la contraseña.

    python -m scripts.create_admin                 # pregunta usuario y contraseña
    python -m scripts.create_admin --user maria    # solo pregunta la contraseña
    python -m scripts.create_admin --user maria --password "mi-clave-123"   # sin preguntar

Al escribir la contraseña NO se ven los caracteres (ni asteriscos): es normal, escribila y
apretá Enter. Si tu terminal no deja escribir (pasa en Git Bash), usá --password.
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402
from app.models import AdminUser  # noqa: E402
from app.security import hash_password, validate_new_password  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--user", help="nombre de usuario")
    ap.add_argument("--password", help="contraseña (si la terminal no deja escribirla oculta)")
    args = ap.parse_args()

    init_db()
    username = (args.user or input("Usuario: ")).strip().lower()
    if not username:
        print("El usuario no puede estar vacío.")
        return 1
    if args.password:
        password = args.password
    else:
        print("(Mientras escribís la contraseña no se ve nada en pantalla: es normal. Escribila y apretá Enter.)")
        password = getpass.getpass("Contraseña (mínimo 8 caracteres): ")
    try:
        validate_new_password(password)
    except ValueError as exc:
        print(exc)
        return 1
    if not args.password and getpass.getpass("Repetí la contraseña: ") != password:
        print("Las contraseñas no coinciden.")
        return 1

    with SessionLocal() as db:
        user = db.scalar(select(AdminUser).where(AdminUser.username == username))
        if user:
            user.password_hash = hash_password(password)
            user.is_active = True
            print(f"Contraseña actualizada para '{username}'.")
        else:
            db.add(AdminUser(username=username, password_hash=hash_password(password)))
            print(f"Usuario '{username}' creado. Ya podés entrar en http://localhost:3000/admin")
        db.commit()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
