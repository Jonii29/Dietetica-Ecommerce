"""Importación de listas de precios "como vengan": encabezados distintos, títulos arriba,
secciones, varias hojas, sin códigos, sin encabezado y PDF."""
import io
import json

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app as fastapi_app
from app.services.sheet_reader import detect_tags, map_columns, split_size


def xlsx(sheets: dict[str, list[list]]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for name, rows in sheets.items():
        ws = wb.create_sheet(name)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture(scope="module")
def admin():
    with TestClient(fastapi_app) as c:
        r = c.post("/api/admin/login", json={"username": "dueño", "password": "clave-segura-123"})
        assert r.status_code == 200
        yield c


def upload(c, name, data, dry_run=False, columns=None):
    form = {"columns": json.dumps(columns)} if columns else None
    r = c.post(f"/api/admin/import?dry_run={str(dry_run).lower()}", files={"file": (name, data)}, data=form)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- unidades ----------

def test_split_size():
    assert split_size("Almendras peladas x 500 grs.") == ("Almendras peladas", "500g")
    assert split_size("Aceite de coco 360cc") == ("Aceite de coco", "360cc")
    assert split_size("Avena instantánea 1 Kg") == ("Avena instantánea", "1kg")
    assert split_size("Mix tropical") == ("Mix tropical", None)
    assert split_size("Leche de almendras 1,5 L") == ("Leche de almendras", "1,5l")


def test_map_columns_prefers_sale_price():
    m = map_columns(["Cód.", "Descripción", "Rubro", "Precio Costo", "Precio Venta", "Stock"])
    assert m == {0: "sku", 1: "nombre", 2: "categoria", 4: "precio", 5: "stock"}
    # La plantilla oficial se reconoce tal cual
    m = map_columns(["sku", "producto", "nombre", "precio", "precio_lista"])
    assert m == {0: "sku", 1: "producto", 2: "nombre", 3: "precio", 4: "precio_lista"}
    # "Producto" solo = nombre; "Precio lista" solo = precio de venta
    assert map_columns(["Producto", "Precio lista"]) == {0: "nombre", 1: "precio"}


def test_detect_tags():
    assert detect_tags("Galletitas de arroz SIN T.A.C.C. veganas") == ["sin tacc", "vegano"]
    assert detect_tags("Mermelada sin azúcar orgánica") == ["organico", "sin azucar"]


# ---------- archivos completos ----------

def test_supplier_excel_with_title_rows_and_sections(admin):
    data = xlsx({"Lista": [
        ["DISTRIBUIDORA EL GRANERO"],
        ["Lista de precios octubre 2026"],
        [],
        ["Cód.", "Descripción", "Marca", "Precio Costo", "Precio Público", "Stock"],
        ["FRUTOS SECOS"],
        ["A100", "Almendras peladas x 500 grs", "", 5000, 8100, 12],
        ["A101", "Almendras peladas x 1 kg", "", 9500, 15500, "sin stock"],
        ["N200", "Nueces mariposa 250g", "", 2500, "3.900,50", ""],
        ["HARINAS"],
        ["H300", "Harina de almendras SIN TACC 500 g", "Dicomere", 4000, 6200, 5],
        ["H301", "Harina integral", "", 800, "consultar", ""],
    ]})
    r = upload(admin, "lista proveedor.xlsx", data)
    det = r["detected"]
    assert det["header_row"] == 4
    assert {c["header"]: c["field"] for c in det["columns"]}["Precio Costo"] is None
    assert r["variants_created"] == 4 and r["products_created"] == 3   # almendras agrupa 2
    assert [e["line"] for e in r["errors"]] == [11]                    # "consultar" no es precio

    p = admin.get("/api/products/almendras-peladas").json()
    assert p["category"]["name"] == "Frutos Secos"
    assert sorted(v["label"] for v in p["variants"]) == ["1 kg", "500 g"]
    v1k = next(v for v in p["variants"] if v["label"] == "1 kg")
    assert v1k["price"] == 1550000 and v1k["in_stock"] is False
    harina = admin.get("/api/products/harina-de-almendras-sin-tacc-dicomere").json()
    assert harina["category"]["name"] == "Harinas"
    assert "sin-tacc" in [t["slug"] for t in harina["tags"]]
    assert harina["name"] == "Harina de almendras SIN TACC"


def test_sheet_per_category_without_codes_reimport_updates(admin):
    def book(price):
        return xlsx({
            "Semillas": [["Producto", "Precio x kg"], ["Chía", price], ["Lino", 3000]],
            "Legumbres": [["Producto", "Precio x kg"], ["Lentejas", 2500]],
        })
    r = upload(admin, "granel.xlsx", book(9000))
    assert r["errors"] == [] and r["variants_created"] == 3
    assert r["detected"]["sheets"] == ["Semillas", "Legumbres"]
    chia = admin.get("/api/products/chia").json()
    assert chia["category"]["name"] == "Semillas"
    assert chia["variants"][0]["sale_type"] == "peso" and chia["variants"][0]["quantity"] == 1000

    # Nueva lista con precio actualizado: mismo producto, sin duplicar
    r = upload(admin, "granel.xlsx", book(9900))
    assert r["variants_created"] == 0 and r["variants_updated"] == 3
    assert admin.get("/api/products/chia").json()["variants"][0]["price"] == 990000


def test_csv_without_header(admin):
    csv_data = "Pasas de uva x 250 g;1.200\nPasas de uva x 500 g;2.200\nDátiles;4500\n".encode("latin-1")
    r = upload(admin, "precios.csv", csv_data, dry_run=True)
    assert r["errors"] == [] and r["variants_created"] == 3 and r["products_created"] == 2
    assert r["detected"]["header_row"] is None and r["detected"]["notes"]
    assert r["sample"][0]["nombre"] == "Pasas de uva" and r["sample"][0]["categoria"] == "Varios"


def test_column_override(admin):
    # Encabezados raros que no se reconocen: el usuario los asigna desde el panel
    data = xlsx({"H": [["Col A", "Col B", "Col C"], ["Té verde x 20", "Teas & Co", "1500"]]})
    r = upload(admin, "t.xlsx", data, dry_run=True)
    assert r["sample"][0]["marca"] == ""            # sin ayuda solo adivina nombre y precio
    r = upload(admin, "t.xlsx", data, dry_run=True, columns={"0": "nombre", "1": "marca", "2": "precio"})
    assert r["errors"] == [] and r["variants_created"] == 1
    assert r["sample"][0]["marca"] == "Teas & Co"


def test_pdf_price_list(admin):
    pytest.importorskip("reportlab")
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in ["LISTA DE PRECIOS", "Producto          Precio", "Coco rallado x 250 g        $ 2.300",
                 "Coco rallado x 500 g        $ 4.200", "Pasta de maní 380 g        $ 3.150"]:
        c.drawString(50, y, line)
        y -= 20
    c.save()
    r = upload(admin, "lista.pdf", buf.getvalue(), dry_run=True)
    assert r["errors"] == [], r
    assert r["variants_created"] == 3 and r["products_created"] == 2


def test_price_list_keeps_stock_category_and_tags(admin):
    # Primero la carga completa (con stock, rubro y etiquetas)
    full = xlsx({"P": [["Código", "Nombre", "Rubro", "Precio", "Stock", "Etiquetas"],
                       ["MAN-1", "Maní tostado x 500 g", "Snacks", 2000, 7, "vegano"]]})
    upload(admin, "full.xlsx", full)
    # Después solo una lista de precios nueva: código + precio
    prices = xlsx({"P": [["Código", "Descripción", "Precio"], ["MAN-1", "Maní tostado x 500 g", 2400]]})
    r = upload(admin, "precios.xlsx", prices)
    assert r["variants_updated"] == 1 and r["errors"] == []
    p = admin.get("/api/products/mani-tostado").json()
    assert p["variants"][0]["price"] == 240000
    assert p["category"]["name"] == "Snacks"
    assert [t["slug"] for t in p["tags"]] == ["vegano"]
    stock = admin.get("/api/admin/products?q=MAN-1").json()["items"][0]["variants"][0]["stock"]
    assert stock == 7


def test_same_presentation_with_new_or_missing_code_is_not_duplicated(admin):
    upload(admin, "a.xlsx", xlsx({"P": [["Código", "Nombre", "Precio"], ["OLD-1", "Pistachos x 250 g", 5000]]}))
    # El proveedor cambió el código
    r = upload(admin, "b.xlsx", xlsx({"P": [["Código", "Nombre", "Precio"], ["NEW-9", "Pistachos x 250 g", 5200]]}))
    assert r["variants_created"] == 0 and r["variants_updated"] == 1
    # Lista sin códigos
    r = upload(admin, "c.xlsx", xlsx({"P": [["Nombre", "Precio"], ["Pistachos x 250 g", 5400]]}))
    assert r["variants_created"] == 0 and r["variants_updated"] == 1
    p = admin.get("/api/products/pistachos").json()
    assert [(v["sku"], v["price"]) for v in p["variants"]] == [("NEW-9", 540000)]


def test_csv_with_title_line_above_table(admin):
    data = ("LISTA OCTUBRE\n\nCód.;Descripción;Precio Costo;Precio Público\nFRUTOS SECOS\n"
            "A1;Almendras x 500 grs;5000;8.100\nA2;Almendras x 1 kg;9500;15.500\n").encode()
    r = upload(admin, "lista.csv", data, dry_run=True)
    assert r["errors"] == [] and r["variants_created"] == 2 and r["products_created"] == 1
    assert r["sample"][0]["categoria"] == "Frutos Secos" and r["sample"][0]["precio_centavos"] == "810000"
