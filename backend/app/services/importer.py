"""Importación / sincronización masiva desde CSV o Excel.

Formato: **una fila por variante (SKU)**. Las filas que comparten `producto` (o, si está vacío,
el mismo nombre+marca) se agrupan en un único producto con varias variantes.

Columnas
--------
Obligatorias : sku, nombre, categoria, precio
Opcionales   : producto, marca, subcategoria, descripcion, etiquetas, sinonimos, variante,
               tipo_venta, contenido, precio_lista, stock, activo, imagen_url, orden

Comportamiento
--------------
* Upsert por `sku` (variante) y por slug de producto: re-importar el mismo archivo es idempotente.
* `sync=True`: las variantes que NO están en el archivo se desactivan (no se borran, para no
  romper pedidos históricos) y los productos sin variantes activas se ocultan.
* `dry_run=True`: valida y calcula el reporte sin escribir nada (rollback).
* Todo ocurre en una transacción: o entra el archivo completo o no entra nada.
* Errores por fila con número de línea; las filas válidas se procesan igual
  (salvo `strict=True`, que aborta si hay al menos un error).
"""
from __future__ import annotations

from collections import OrderedDict
from dataclasses import asdict, dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import CatalogMeta, Category, Product, SaleType, Tag, TagKind, Variant
from ..utils.text import (
    content_label, parse_bool, parse_content, parse_price_to_cents, slugify, split_list,
)
from .search import build_search_text
from .sheet_reader import ParsedSheet, finalize_skus, parse_tables, read_tables

REQUIRED_COLUMNS = ["sku", "nombre", "categoria", "precio"]
OPTIONAL_COLUMNS = [
    "producto", "marca", "subcategoria", "descripcion", "etiquetas", "sinonimos", "variante",
    "tipo_venta", "contenido", "precio_lista", "stock", "activo", "imagen_url", "orden",
]
# Orden recomendado de columnas en la plantilla
TEMPLATE_COLUMNS = [
    "sku", "producto", "nombre", "marca", "categoria", "subcategoria", "variante", "tipo_venta",
    "contenido", "precio", "precio_lista", "stock", "etiquetas", "sinonimos", "descripcion",
    "imagen_url", "activo", "orden",
]

# Etiquetas dietarias canónicas: slug -> (nombre visible, orden)
DIETARY_TAGS: dict[str, tuple[str, int]] = {
    "sin-tacc": ("Sin TACC", 1),
    "vegano": ("Vegano", 2),
    "organico": ("Orgánico", 3),
    "sin-azucar": ("Sin azúcar agregada", 4),
    "keto": ("Keto", 5),
    "sin-lactosa": ("Sin lactosa", 6),
}
# Variantes de escritura que se mapean a una etiqueta canónica
TAG_ALIASES: dict[str, str] = {
    "sin-gluten": "sin-tacc", "gluten-free": "sin-tacc", "gf": "sin-tacc", "celiaco": "sin-tacc",
    "vegan": "vegano", "veggie": "vegano", "plant-based": "vegano",
    "organic": "organico", "agroecologico": "organico",
    "sin-azucar-agregada": "sin-azucar", "sugar-free": "sin-azucar", "0-azucar": "sin-azucar",
    "low-carb": "keto", "cetogenico": "keto",
}
# Encabezados alternativos aceptados
HEADER_ALIASES = {
    "codigo": "sku", "código": "sku", "cod": "sku", "nombre_producto": "nombre",
    "categoría": "categoria", "rubro": "categoria", "subcategoría": "subcategoria",
    "descripción": "descripcion", "tags": "etiquetas", "precio_venta": "precio",
    "presentacion": "variante", "presentación": "variante", "imagen": "imagen_url",
}


@dataclass
class ImportReport:
    dry_run: bool = False
    rows: int = 0
    products_created: int = 0
    products_updated: int = 0
    variants_created: int = 0
    variants_updated: int = 0
    variants_deactivated: int = 0
    errors: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Lectura de archivos
# ---------------------------------------------------------------------------

def read_catalog_file(data: bytes, filename: str, columns: dict[int, str] | None = None) -> ParsedSheet:
    """Lee cualquier lista de precios (xlsx, xls, csv, pdf) y la lleva a filas de la plantilla.

    `columns` permite corregir desde el panel qué columna es cada campo ({índice: campo}).
    """
    parsed = parse_tables(read_tables(data, filename), override=columns)
    finalize_skus(parsed.rows)
    return parsed


def read_rows(data: bytes, filename: str) -> list[dict[str, str]]:
    return read_catalog_file(data, filename).rows


# ---------------------------------------------------------------------------
# Importación
# ---------------------------------------------------------------------------

class _Cache:
    """Precarga todo en memoria: 1.000 productos = 3 queries en vez de miles."""

    def __init__(self, db: Session):
        self.db = db
        self.categories = {c.slug: c for c in db.scalars(select(Category))}
        self.tags = {t.slug: t for t in db.scalars(select(Tag))}
        self.products = {p.slug: p for p in db.scalars(select(Product))}
        self.variants = {v.sku: v for v in db.scalars(select(Variant))}

    def category(self, name: str, parent: Category | None = None) -> Category:
        slug = slugify(name) if parent is None else f"{parent.slug}--{slugify(name)}"
        cat = self.categories.get(slug)
        if cat is None:
            cat = Category(name=name.strip(), slug=slug, parent=parent)
            self.db.add(cat)
            self.categories[slug] = cat
        return cat

    def tag(self, raw: str) -> Tag:
        slug = slugify(raw)
        slug = TAG_ALIASES.get(slug, slug)
        tag = self.tags.get(slug)
        if tag is None:
            name, order = DIETARY_TAGS.get(slug, (raw.strip().capitalize(), 100))
            kind = TagKind.DIETARY if slug in DIETARY_TAGS else TagKind.GENERAL
            tag = Tag(slug=slug, name=name, kind=kind, sort_order=order)
            self.db.add(tag)
            self.tags[slug] = tag
        return tag


def _validate(row: dict[str, str]) -> dict:
    """Convierte una fila cruda en valores tipados. Lanza ValueError con mensaje legible."""
    missing = [c for c in REQUIRED_COLUMNS if not row.get(c)]
    if missing:
        raise ValueError(f"faltan columnas obligatorias: {', '.join(missing)}")

    quantity, unit = parse_content(row.get("contenido"))
    sale_raw = (row.get("tipo_venta") or "").lower()
    if sale_raw in ("peso", "granel", "fraccionado", "suelto", "kg", "kilo", "por kilo", "x kg"):
        sale_type = SaleType.WEIGHT
    elif sale_raw in ("", "unidad", "envasado", "u", "un", "unid", "paquete"):
        sale_type = SaleType.UNIT
    else:
        raise ValueError(f"tipo_venta inválido: {sale_raw!r} (peso | unidad)")

    stock_raw = row.get("stock", "")
    return {
        # Qué trae el archivo: lo que no trae se conserva tal como está en la tienda
        "has": {k for k in ("stock", "precio_lista", "marca", "sinonimos", "descripcion", "activo")
                if k in row},
        "sku_auto": "_sku_auto" in row,
        "tags_complete": "_etiquetas_completas" in row or "_line" not in row,
        "category_default": "_categoria_por_defecto" in row,
        "sku": row["sku"].strip().upper(),
        "product_key": slugify(row.get("producto") or f"{row['nombre']} {row.get('marca', '')}"),
        "name": row["nombre"].strip(),
        "brand": (row.get("marca") or "").strip() or None,
        "category": row["categoria"].strip(),
        "subcategory": (row.get("subcategoria") or "").strip() or None,
        "description": (row.get("descripcion") or "").strip() or None,
        "tags": split_list(row.get("etiquetas")),
        "synonyms": "|".join(split_list(row.get("sinonimos"))) or None,
        "label": (row.get("variante") or "").strip() or content_label(quantity, unit),
        "sale_type": sale_type,
        "quantity": quantity,
        "unit": unit,
        "price": parse_price_to_cents(row["precio"]),
        "compare_at_price": parse_price_to_cents(row["precio_lista"]) if row.get("precio_lista") else None,
        "stock": int(float(stock_raw)) if stock_raw not in ("", None) else None,
        "is_active": parse_bool(row.get("activo"), default=True),
        "image_url": (row.get("imagen_url") or "").strip() or None,
        "sort_order": int(row["orden"]) if row.get("orden") else None,
    }


def import_catalog(
    db: Session,
    rows: list[dict[str, str]],
    *,
    sync: bool = False,
    dry_run: bool = False,
    strict: bool = False,
) -> ImportReport:
    report = ImportReport(dry_run=dry_run, rows=len(rows))
    cache = _Cache(db)

    # 1) Validar y agrupar por producto (manteniendo el orden del archivo)
    groups: OrderedDict[str, list[dict]] = OrderedDict()
    seen_skus: set[str] = set()
    for pos, raw in enumerate(rows, start=2):  # línea 1 = encabezado
        line = int(raw["_line"]) if raw.get("_line") else pos
        try:
            r = _validate(raw)
            if r["sku"] in seen_skus:
                raise ValueError(f"SKU duplicado en el archivo: {r['sku']}")
            seen_skus.add(r["sku"])
            groups.setdefault(r["product_key"], []).append(r)
        except (ValueError, KeyError) as exc:
            report.errors.append({"line": line, "sku": raw.get("sku"), "error": str(exc)})

    if strict and report.errors:
        report.dry_run = True
        return report

    touched_products: list[Product] = []

    # 2) Upsert producto + variantes
    for key, items in groups.items():
        head = items[0]
        product = cache.products.get(key)
        if head["category_default"] and product is not None and product.category is not None:
            cat = product.category  # la lista no dice el rubro: queda el que ya tenía
        else:
            cat = cache.category(head["category"])
            if head["subcategory"]:
                cat = cache.category(head["subcategory"], parent=cat)

        if product is None:
            product = Product(slug=key, name=head["name"])
            db.add(product)
            cache.products[key] = product
            report.products_created += 1
        else:
            report.products_updated += 1

        # Campos de producto: el primer valor no vacío del grupo gana
        def first(field_: str):
            return next((it[field_] for it in items if it[field_]), None)

        has = head["has"]
        product.name = head["name"]
        if "marca" in has or product.id is None:
            product.brand = first("brand")
        product.category = cat
        product.description = first("description") or product.description
        product.image_url = first("image_url") or product.image_url
        if "sinonimos" in has:
            product.synonyms = first("synonyms")
        tag_slugs = list(dict.fromkeys(t for it in items for t in it["tags"]))
        new_tags = [cache.tag(s) for s in tag_slugs]
        if not head["tags_complete"]:
            new_tags = list(product.tags or []) + new_tags  # suma lo detectado, no borra lo cargado
        product.tags = list({id(t): t for t in new_tags}.values())

        for pos, it in enumerate(items):
            v = cache.variants.get(it["sku"])
            if v is None and product.id is not None:
                # Misma presentación de un producto que ya existe, con otro código o sin código:
                # se actualiza esa en vez de duplicarla.
                v = next((x for x in product.variants
                          if slugify(x.label) == slugify(it["label"]) and x.sku not in seen_skus), None)
                if v is not None:
                    if not it["sku_auto"] and it["sku"] not in cache.variants:
                        cache.variants.pop(v.sku, None)   # la lista trae un código nuevo: se adopta
                        v.sku = it["sku"]
                        cache.variants[v.sku] = v
                    seen_skus.add(v.sku)
            if v is None:
                v = Variant(sku=it["sku"])
                db.add(v)
                cache.variants[it["sku"]] = v
                report.variants_created += 1
            else:
                report.variants_updated += 1
            v.product = product
            v.label, v.sale_type = it["label"], it["sale_type"]
            v.quantity, v.unit = it["quantity"], it["unit"]
            v.price = it["price"]
            if "precio_lista" in it["has"] or v.id is None:
                v.compare_at_price = it["compare_at_price"]
            if "stock" in it["has"] or v.id is None:
                v.stock = it["stock"]
            v.is_active = it["is_active"]
            v.sort_order = it["sort_order"] if it["sort_order"] is not None else pos
        touched_products.append(product)

    # 3) Sincronización: desactivar lo que no vino en el archivo
    if sync and not report.errors:
        for sku, v in cache.variants.items():
            if sku not in seen_skus and v.is_active:
                v.is_active = False
                report.variants_deactivated += 1
    elif sync and report.errors:
        report.errors.append({"line": None, "sku": None,
                              "error": "sync omitido: hay filas con error (corregir y reintentar)"})

    db.flush()

    # 4) Visibilidad + texto de búsqueda
    # Los productos del archivo se muestran si tienen alguna presentación activa. Los que no
    # vinieron solo se ocultan si se quedaron sin presentaciones (respeta lo oculto desde el panel).
    touched_ids = {id(p) for p in touched_products}
    for product in cache.products.values():
        has_active = any(v.is_active for v in product.variants)
        if id(product) in touched_ids or not has_active:
            product.is_active = has_active
    for product in touched_products:
        product.search_text = build_search_text(product)

    meta = db.get(CatalogMeta, 1) or CatalogMeta(id=1, version=0)
    meta.version += 1
    db.add(meta)

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report
