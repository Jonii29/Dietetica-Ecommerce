"""Inicio de sesión: mantener sesión, cerrar en todos lados, cambio y recuperación de contraseña."""
import pytest
from fastapi.testclient import TestClient

from app.database import SessionLocal
from app.main import app as fastapi_app
from app.security import _attempts, ensure_initial_admin, settings

USER, PASS = "dueño", "clave-segura-123"


def client():
    return TestClient(fastapi_app)


def login(c, password=PASS, remember=True):
    return c.post("/api/admin/login", json={"username": USER, "password": password, "remember": remember})


@pytest.fixture(autouse=True)
def _clean_rate_limit():
    _attempts.clear()
    yield
    _attempts.clear()


def test_remember_me_controls_cookie_lifetime():
    with client() as c:
        long = login(c).headers["set-cookie"].lower()
        assert "max-age=2592000" in long and "httponly" in long
    with client() as c:
        short = login(c, remember=False).headers["set-cookie"].lower()
        assert "max-age" not in short and "expires" not in short   # cookie de sesión del navegador
        assert c.get("/api/admin/me").status_code == 200


def test_me_counts_open_sessions_and_logout_all():
    with client() as a, client() as b:
        assert login(a).status_code == 200 and login(b).status_code == 200
        me = a.get("/api/admin/me").json()
        assert me["username"] == USER and me["sessions"] >= 2 and me["last_login_at"]
        assert a.post("/api/admin/logout-all").status_code == 204
        assert a.get("/api/admin/me").status_code == 401
        assert b.get("/api/admin/me").status_code == 401


def test_rate_limit_message_says_how_long_to_wait():
    with client() as c:
        for _ in range(8):
            assert login(c, password="mal").status_code == 401
        r = login(c, password="mal")
        assert r.status_code == 429 and "minuto" in r.json()["detail"]


def test_change_password_closes_other_devices():
    with client() as a, client() as b:
        login(a), login(b)
        assert a.post("/api/admin/password", json={"current_password": "mal", "new_password": "otra-clave-123"}).status_code == 400
        assert a.post("/api/admin/password", json={"current_password": PASS, "new_password": PASS}).status_code == 400
        assert a.post("/api/admin/password", json={"current_password": PASS, "new_password": "otra-clave-123"}).status_code == 204
        assert a.get("/api/admin/me").status_code == 200      # este dispositivo sigue
        assert b.get("/api/admin/me").status_code == 401      # el otro tiene que volver a entrar
        assert login(b).status_code == 401 and login(b, "otra-clave-123").status_code == 200

    # Al reiniciar el servidor con la MISMA variable, la clave elegida en el panel se respeta
    with SessionLocal() as db:
        ensure_initial_admin(db)
    with client() as c:
        assert login(c, "otra-clave-123").status_code == 200


def test_recover_access_by_changing_variable(monkeypatch):
    with client() as c:
        login(c, "otra-clave-123")
        import dataclasses

        from app import security
        monkeypatch.setattr(security, "settings", dataclasses.replace(settings, admin_password="recuperada-2026"))
        with SessionLocal() as db:
            ensure_initial_admin(db)                          # lo que pasa al redeployar en Render
        assert c.get("/api/admin/me").status_code == 401      # se cerraron las sesiones
        assert login(c, "otra-clave-123").status_code == 401
        assert login(c, "recuperada-2026").status_code == 200
