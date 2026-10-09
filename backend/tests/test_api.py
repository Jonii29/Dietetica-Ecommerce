"""Tests de integración: importación, búsqueda, filtros, pedidos y firma del webhook."""
import hashlib
import hmac
import os
from pathlib import Path
from urllib.parse import unquote

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.utils.text import parse_content, parse_price_to_cents  # noqa: E402

CSV = Path(__file__).parents[1] / "data" / "plantilla_productos.csv"
ADMIN = {"X-Admin-Token": "secreto"}


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        r = c.post("/api/admin/import", headers=ADMIN, files={"file": ("p.csv", CSV.read_bytes(), "text/csv")})
        assert r.status_code == 200, r.text
        rep = r.json()
        assert rep["errors"] == [], rep["errors"]
        assert rep["products_created"] == 13 and rep["variants_created"] == 20
        yield c


@pytest.mark.parametrize("raw,cents", [("4.250", 425000), ("$ 1.234,50", 123450), ("1234.5", 123450),
                                       ("1,234.50", 123450), ("12.345.678", 1234567800), (990, 99000)])
def test_parse_price(raw, cents):
    assert parse_price_to_cents(raw) == cents


def test_parse_content():
    assert parse_content("1kg") == (1000, "g")
    assert parse_content("200ml") == (200, "ml")
    assert parse_content("1 u") == (1, "u")


@pytest.mark.parametrize("q,expected", [
    ("chia", "semillas-chia"), ("chía", "semillas-chia"), ("quínoa", "quinoa-blanca"),
    ("quinua", "quinoa-blanca"), ("harina almendras", "harina-almendras"),
    ("almendars", "almendras-peladas"),           # typo
    ("felices", "mantequilla-mani-crunchy"),      # marca
    ("peanut butter", "mantequilla-mani-crunchy"),  # sinónimo
])
def test_search(client, q, expected):
    items = client.get("/api/products", params={"q": q}).json()["items"]
    assert items and items[0]["slug"] == expected, [i["slug"] for i in items]


def test_filters_and_facets(client):
    r = client.get("/api/products", params={"tags": "sin-tacc,keto", "category": "harinas"}).json()
    assert {p["slug"] for p in r["items"]} == {"harina-almendras", "harina-coco-dicomere"}
    assert r["facets"]["tags"]["keto"] == 2
    r = client.get("/api/products", params={"q": "gluten free harina"}).json()
    assert all(any(t["slug"] == "sin-tacc" for t in p["tags"]) for p in r["items"])
    r = client.get("/api/products", params={"page_size": 5, "page": 2, "sort": "price_asc"}).json()
    assert r["total"] == 13 and r["pages"] == 3 and len(r["items"]) == 5


def test_catalog_etag(client):
    r = client.get("/api/catalog")
    assert r.status_code == 200 and len(r.json()["products"]) == 13
    r2 = client.get("/api/catalog", headers={"If-None-Match": r.headers["etag"]})
    assert r2.status_code == 304


def test_whatsapp_order(client):
    body = {"channel": "whatsapp", "customer": {"name": "Ana", "delivery_method": "retiro"},
            "items": [{"sku": "alm-500", "quantity": 2}, {"sku": "CHIA-250", "quantity": 1},
                      {"sku": "CREA-300", "quantity": 1}, {"sku": "NOEXISTE", "quantity": 1}]}
    r = client.post("/api/orders", json=body)
    assert r.status_code == 201, r.text
    d = r.json()
    assert d["order"]["total"] == 2 * 810000 + 180000
    assert len(d["warnings"]) == 2  # sin stock + inexistente
    msg = unquote(d["whatsapp_url"].split("text=")[1])
    assert "TOTAL: $ 18.000" in msg and "2 × Almendras peladas (500 g)" in msg
    print("\n" + msg)


def test_reimport_sync_deactivates(client):
    lines = CSV.read_text(encoding="utf-8").splitlines()
    partial = "\n".join(l for l in lines if not l.startswith("MIX-250")).encode()
    r = client.post("/api/admin/import?sync=true", headers=ADMIN, files={"file": ("p.csv", partial, "text/csv")}).json()
    assert r["variants_deactivated"] == 1 and r["variants_created"] == 0
    assert client.get("/api/products/mix-frutos-secos").status_code == 404


def test_webhook_signature(monkeypatch):
    from app.services import mercadopago as mp
    monkeypatch.setattr(mp.settings.__class__, "mp_webhook_secret", "s3cr3t", raising=False)
    object.__setattr__(mp.settings, "mp_webhook_secret", "s3cr3t")
    manifest = "id:123;request-id:req-1;ts:1700000000;"
    v1 = hmac.new(b"s3cr3t", manifest.encode(), hashlib.sha256).hexdigest()
    assert mp.verify_webhook_signature(f"ts=1700000000,v1={v1}", "req-1", "123")
    assert not mp.verify_webhook_signature(f"ts=1700000000,v1={v1}", "req-2", "123")
    object.__setattr__(mp.settings, "mp_webhook_secret", "")


def test_admin_requires_token(client):
    assert client.post("/api/admin/import", headers={"X-Admin-Token": "x"},
                       files={"file": ("p.csv", b"sku\n", "text/csv")}).status_code == 401
