"""Tests del panel de gestión: login, productos, pedidos con stock y resumen."""
from pathlib import Path

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app as fastapi_app  # noqa: E402

CSV = Path(__file__).parents[1] / "data" / "plantilla_productos.csv"


@pytest.fixture(scope="module")
def anon():
    with TestClient(fastapi_app) as c:
        yield c


@pytest.fixture(scope="module")
def admin(anon):
    r = anon.post("/api/admin/login", json={"username": "dueño", "password": "clave-segura-123"})
    assert r.status_code == 200, r.text
    assert "httponly" in r.headers["set-cookie"].lower()
    r = anon.post("/api/admin/import", files={"file": ("p.csv", CSV.read_bytes(), "text/csv")})
    assert r.status_code == 200 and r.json()["errors"] == []
    return anon


def test_requires_login():
    with TestClient(fastapi_app) as c:
        assert c.get("/api/admin/products").status_code == 401
        assert c.post("/api/admin/login", json={"username": "dueño", "password": "mal"}).status_code == 401


def test_create_edit_hide_product(admin):
    body = {
        "name": "Pasas de uva", "brand": None, "new_category": "Frutas desecadas",
        "tags": ["vegano", "sin tacc"], "synonyms": "pasas|uvas pasas",
        "variants": [
            {"sku": "pas-250", "label": "250 g", "sale_type": "peso", "quantity": 250, "unit": "g", "price": 150000, "stock": 10},
            {"sku": "PAS-500", "label": "500 g", "sale_type": "peso", "quantity": 500, "unit": "g", "price": 280000},
        ],
    }
    r = admin.post("/api/admin/products", json=body)
    assert r.status_code == 201, r.text
    p = r.json()
    assert {t["slug"] for t in p["tags"]} == {"vegano", "sin-tacc"} and p["variants"][0]["sku"] == "PAS-250"
    # aparece en la tienda y en la búsqueda pública
    assert admin.get("/api/products", params={"q": "uvas pasas"}).json()["items"][0]["id"] == p["id"]

    # SKU de otro producto -> 409
    body2 = {**body, "variants": [{**body["variants"][0], "sku": "ALM-500"}]}
    assert admin.put(f"/api/admin/products/{p['id']}", json=body2).status_code == 409

    # quitar una presentación y cambiar precio
    body["variants"] = [{**body["variants"][0], "price": 160000}]
    r = admin.put(f"/api/admin/products/{p['id']}", json=body).json()
    assert len(r["variants"]) == 1 and r["variants"][0]["price"] == 160000

    # ocultar
    admin.patch(f"/api/admin/products/{p['id']}/visibility", params={"is_active": False})
    assert admin.get(f"/api/products/{r['slug']}").status_code == 404
    assert any(x["id"] == p["id"] for x in admin.get("/api/admin/products", params={"status": "hidden"}).json()["items"])


def test_quick_variant_patch(admin):
    r = admin.patch("/api/admin/variants/alm-500", json={"price": 900000, "stock": 3})
    assert r.status_code == 200 and r.json()["stock"] == 3
    pub = admin.get("/api/products/almendras-peladas").json()
    assert next(v for v in pub["variants"] if v["sku"] == "ALM-500")["price"] == 900000
    r = admin.patch("/api/admin/variants/ALM-500", json={"stock": None})
    assert r.json()["stock"] is None and r.json()["price"] == 900000  # solo cambió lo enviado
    admin.patch("/api/admin/variants/ALM-500", json={"stock": 3})


def test_order_status_moves_stock_and_stats(admin):
    o = admin.post("/api/orders", json={"channel": "whatsapp", "customer": {"name": "Ana"},
                                        "items": [{"sku": "ALM-500", "quantity": 2}]}).json()["order"]
    code = o["code"]
    lst = admin.get("/api/admin/orders", params={"status": "pending"}).json()
    assert lst["counts"]["pending"] >= 1 and any(x["code"] == code for x in lst["items"])

    def stock():
        return next(v for v in admin.get("/api/admin/products", params={"q": "ALM-500"}).json()["items"][0]["variants"]
                    if v["sku"] == "ALM-500")["stock"]

    admin.patch(f"/api/admin/orders/{code}", json={"status": "paid"})
    assert stock() == 1
    admin.patch(f"/api/admin/orders/{code}", json={"status": "fulfilled"})
    assert stock() == 1                     # no descuenta dos veces
    st = admin.get("/api/admin/stats", params={"days": 7}).json()
    assert st["sales_today"] == 1800000 and st["orders_period"] == 1 and len(st["series"]) == 7
    assert st["top_products"][0]["name"] == "Almendras peladas"
    assert any(x["sku"] == "ALM-500" for x in st["low_stock"])
    admin.patch(f"/api/admin/orders/{code}", json={"status": "cancelled"})
    assert stock() == 3                     # devuelve al cancelar
    assert admin.get("/api/admin/stats").json()["sales_today"] == 0


def test_logout(admin):
    assert admin.post("/api/admin/logout").status_code == 204
    assert admin.get("/api/admin/me").status_code == 401

