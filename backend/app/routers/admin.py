"""Panel de gestión: productos, pedidos, resumen de ventas e importación.

Todas las rutas requieren sesión iniciada (ver app/security.py)."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..admin_schemas import (
    AdminOrderOut, AdminOrderPage, AdminProductOut, AdminProductPage, AdminVariantOut, DayPoint,
    LowStockItem, OrderStatusIn, ProductIn, Stats, TopProduct, VariantPatch,
)
from ..config import get_settings
from ..database import get_db
from ..models import Category, Order, OrderItem, OrderStatus, Product, Tag, TagKind, Variant
from ..schemas import ImportResult
from ..security import require_admin
from ..services.catalog import bump_catalog_version, catalog_store
from ..services.importer import DIETARY_TAGS, TEMPLATE_COLUMNS, import_catalog, read_rows
from ..services.orders import SOLD_STATUSES, set_status
from ..services.search import build_search_text
from ..utils.text import normalize, slugify

settings = get_settings()
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _refresh_catalog(db: Session) -> None:
    bump_catalog_version(db)
    db.commit()
    catalog_store.ensure_fresh(db, force=True)


# ===========================================================================
# Productos
# ===========================================================================

@router.get("/products", response_model=AdminProductPage)
def list_products(
    q: str | None = None,
    status: str = Query("all", pattern="^(all|active|hidden|low_stock|no_stock)$"),
    category_id: int | None = None,
    db: Session = Depends(get_db),
):
    """Todos los productos (incluidos los ocultos). Con ~1.000 productos se devuelven completos
    y la tabla filtra en el navegador; los filtros acá sirven para pedidos puntuales."""
    stmt = select(Product).order_by(Product.name)
    if category_id:
        sub = select(Category.id).where(or_(Category.id == category_id, Category.parent_id == category_id))
        stmt = stmt.where(Product.category_id.in_(sub))
    if status == "active":
        stmt = stmt.where(Product.is_active.is_(True))
    elif status == "hidden":
        stmt = stmt.where(Product.is_active.is_(False))
    products = list(db.scalars(stmt))

    if q:
        nq, raw = normalize(q), q.strip().lower()
        products = [p for p in products if nq in p.search_text or nq in normalize(p.name)
                    or any(raw in v.sku.lower() for v in p.variants)]
    if status == "low_stock":
        products = [p for p in products if any(v.stock is not None and v.stock <= settings.low_stock for v in p.variants)]
    elif status == "no_stock":
        products = [p for p in products if any(v.stock == 0 for v in p.variants)]
    return AdminProductPage(items=products, total=len(products))


@router.get("/products/{product_id}", response_model=AdminProductOut)
def get_product(product_id: int, db: Session = Depends(get_db)):
    p = db.get(Product, product_id)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return p


def _unique_slug(db: Session, base: str, exclude_id: int | None = None) -> str:
    slug, n = base, 2
    while True:
        other = db.scalar(select(Product.id).where(Product.slug == slug))
        if other is None or other == exclude_id:
            return slug
        slug, n = f"{base}-{n}", n + 1


def _resolve_category(db: Session, data: ProductIn) -> Category | None:
    if data.new_category:
        slug = slugify(data.new_category)
        cat = db.scalar(select(Category).where(Category.slug == slug))
        if cat is None:
            cat = Category(name=data.new_category, slug=slug)
            db.add(cat)
        return cat
    if data.category_id:
        cat = db.get(Category, data.category_id)
        if not cat:
            raise HTTPException(422, "La categoría elegida no existe.")
        return cat
    return None


def _resolve_tags(db: Session, slugs: list[str]) -> list[Tag]:
    tags: list[Tag] = []
    for raw in dict.fromkeys(s.strip() for s in slugs if s.strip()):
        slug = slugify(raw)
        tag = db.scalar(select(Tag).where(Tag.slug == slug))
        if tag is None:
            name, order = DIETARY_TAGS.get(slug, (raw.strip().capitalize(), 100))
            tag = Tag(slug=slug, name=name, sort_order=order,
                      kind=TagKind.DIETARY if slug in DIETARY_TAGS else TagKind.GENERAL)
            db.add(tag)
        tags.append(tag)
    return tags


def _save_product(db: Session, product: Product, data: ProductIn) -> Product:
    skus = [v.sku for v in data.variants]
    if len(set(skus)) != len(skus):
        raise HTTPException(422, "Hay SKUs repetidos en las presentaciones.")
    taken = db.scalars(select(Variant).where(Variant.sku.in_(skus))).all()
    for v in taken:
        if v.product_id != product.id:
            raise HTTPException(409, f"El SKU {v.sku} ya lo usa otro producto ({v.product.name}).")

    product.name = data.name.strip()
    product.brand = data.brand
    product.description = data.description
    product.image_url = data.image_url
    product.synonyms = data.synonyms
    product.is_active = data.is_active
    product.category = _resolve_category(db, data)
    product.tags = _resolve_tags(db, data.tags)

    current = {v.sku: v for v in product.variants}
    for pos, vin in enumerate(data.variants):
        v = current.pop(vin.sku, None)
        if v is None:
            v = Variant(sku=vin.sku)
            product.variants.append(v)
        for field in ("label", "sale_type", "quantity", "unit", "price", "compare_at_price", "stock", "is_active"):
            setattr(v, field, getattr(vin, field))
        v.sort_order = pos
    # Presentaciones quitadas: se borran si nunca se vendieron; si no, se desactivan
    for v in current.values():
        sold = db.scalar(select(OrderItem.id).where(OrderItem.variant_id == v.id).limit(1))
        if sold:
            v.is_active = False
        else:
            product.variants.remove(v)

    db.flush()
    product.search_text = build_search_text(product)
    _refresh_catalog(db)
    db.refresh(product)
    return product


@router.post("/products", response_model=AdminProductOut, status_code=201)
def create_product(data: ProductIn, db: Session = Depends(get_db)):
    product = Product(slug=_unique_slug(db, slugify(f"{data.name} {data.brand or ''}")), name=data.name)
    db.add(product)
    return _save_product(db, product, data)


@router.put("/products/{product_id}", response_model=AdminProductOut)
def update_product(product_id: int, data: ProductIn, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Producto no encontrado")
    return _save_product(db, product, data)


@router.patch("/products/{product_id}/visibility", response_model=AdminProductOut)
def set_visibility(product_id: int, is_active: bool, db: Session = Depends(get_db)):
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(404, "Producto no encontrado")
    product.is_active = is_active
    _refresh_catalog(db)
    return product


@router.patch("/variants/{sku}", response_model=AdminVariantOut)
def patch_variant(sku: str, data: VariantPatch, db: Session = Depends(get_db)):
    """Edición rápida de precio / stock / activo desde la tabla."""
    v = db.scalar(select(Variant).where(Variant.sku == sku.upper()))
    if not v:
        raise HTTPException(404, "Presentación no encontrada")
    for field in data.model_fields_set:   # solo lo que se mandó
        setattr(v, field, getattr(data, field))
    _refresh_catalog(db)
    return v


@router.get("/categories")
def categories(db: Session = Depends(get_db)):
    """Categorías con su cantidad de productos (incluye las vacías, a diferencia de la API pública)."""
    counts = dict(db.execute(select(Product.category_id, func.count()).group_by(Product.category_id)).all())
    cats = db.scalars(select(Category).order_by(Category.sort_order, Category.name)).all()
    return [{"id": c.id, "name": c.name, "slug": c.slug, "parent_id": c.parent_id, "products": counts.get(c.id, 0)} for c in cats]


@router.get("/tags")
def tags(db: Session = Depends(get_db)):
    existing = {t.slug: t for t in db.scalars(select(Tag))}
    # Siempre ofrecer las etiquetas dietarias, aunque todavía ningún producto las use
    out = [{"slug": s, "name": n, "kind": "dietary"} for s, (n, _) in sorted(DIETARY_TAGS.items(), key=lambda x: x[1][1])]
    out += [{"slug": t.slug, "name": t.name, "kind": t.kind.value} for t in existing.values() if t.slug not in DIETARY_TAGS]
    return out


# ===========================================================================
# Pedidos
# ===========================================================================

@router.get("/orders", response_model=AdminOrderPage)
def list_orders(
    status: str | None = None,
    q: str | None = Query(None, max_length=80),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    base = select(Order)
    if q:
        like = f"%{q.strip()}%"
        base = base.where(or_(Order.code.ilike(like), Order.customer_name.ilike(like), Order.customer_phone.ilike(like)))
    sub = base.subquery()
    counts = {getattr(s, "value", s): n
              for s, n in db.execute(select(sub.c.status, func.count()).group_by(sub.c.status)).all()}
    if status:
        base = base.where(Order.status == OrderStatus(status))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(Order.created_at.desc(), Order.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return AdminOrderPage(items=rows, total=total, page=page, pages=max(1, math.ceil(total / page_size)), counts=counts)


@router.get("/orders/{code}", response_model=AdminOrderOut)
def get_order(code: str, db: Session = Depends(get_db)):
    order = db.scalar(select(Order).where(Order.code == code.upper()))
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    return order


@router.patch("/orders/{code}", response_model=AdminOrderOut)
def update_order_status(code: str, data: OrderStatusIn, db: Session = Depends(get_db)):
    """Cambiar estado. El stock se descuenta al pasar a pagado/entregado y se devuelve al cancelar."""
    order = db.scalar(select(Order).where(Order.code == code.upper()))
    if not order:
        raise HTTPException(404, "Pedido no encontrado")
    set_status(db, order, OrderStatus(data.status))
    catalog_store.ensure_fresh(db, force=True)
    db.refresh(order)
    return order


# ===========================================================================
# Resumen de ventas
# ===========================================================================

def _store_tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(settings.store_tz)
    except Exception:  # Windows sin el paquete tzdata
        return timezone(timedelta(hours=-3))


def _local_date(dt: datetime, tz) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)  # SQLite guarda UTC sin zona
    return dt.astimezone(tz).date()


@router.get("/stats", response_model=Stats)
def stats(days: int = Query(30, ge=1, le=365), db: Session = Depends(get_db)):
    tz = _store_tz()
    today = datetime.now(tz).date()
    start_day = today - timedelta(days=days - 1)
    since_utc = datetime.combine(start_day, datetime.min.time(), tz).astimezone(timezone.utc).replace(tzinfo=None)

    sold = db.scalars(select(Order).where(Order.status.in_(SOLD_STATUSES), Order.created_at >= since_utc)).all()

    by_day: dict[date, list[int]] = defaultdict(lambda: [0, 0])
    top: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for o in sold:
        d = _local_date(o.created_at, tz)
        by_day[d][0] += o.total
        by_day[d][1] += 1
        for it in o.items:
            top[it.product_name][0] += it.quantity
            top[it.product_name][1] += it.subtotal

    series = [
        DayPoint(date=(start_day + timedelta(days=i)).isoformat(),
                 total=by_day[start_day + timedelta(days=i)][0], orders=by_day[start_day + timedelta(days=i)][1])
        for i in range(days)
    ]
    sales_period = sum(p.total for p in series)
    orders_period = sum(p.orders for p in series)

    low = db.execute(
        select(Variant, Product.name)
        .join(Product)
        .where(Variant.is_active.is_(True), Variant.stock.is_not(None), Variant.stock <= settings.low_stock)
        .order_by(Variant.stock, Product.name)
        .limit(50)
    ).all()

    return Stats(
        days=days,
        sales_today=by_day[today][0],
        sales_period=sales_period,
        orders_period=orders_period,
        avg_ticket=round(sales_period / orders_period) if orders_period else 0,
        pending_orders=db.scalar(select(func.count()).where(
            Order.status.in_([OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT]))) or 0,
        series=series,
        top_products=[TopProduct(name=n, units=u, revenue=r)
                      for n, (u, r) in sorted(top.items(), key=lambda x: -x[1][1])[:8]],
        low_stock=[LowStockItem(product_id=v.product_id, product_name=name, sku=v.sku, label=v.label, stock=v.stock)
                   for v, name in low],
        low_stock_threshold=settings.low_stock,
        active_products=db.scalar(select(func.count()).where(Product.is_active.is_(True))) or 0,
        hidden_products=db.scalar(select(func.count()).where(Product.is_active.is_(False))) or 0,
    )


# ===========================================================================
# Importación
# ===========================================================================

@router.post("/import", response_model=ImportResult)
async def import_products(
    file: UploadFile = File(..., description="CSV (; o ,) o XLSX"),
    sync: bool = Query(False, description="Desactiva SKUs que no estén en el archivo"),
    dry_run: bool = Query(False, description="Solo valida, no guarda"),
    strict: bool = Query(False, description="Aborta todo si alguna fila tiene error"),
    db: Session = Depends(get_db),
):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "El archivo supera los 10 MB.")
    try:
        rows = read_rows(data, file.filename or "upload.csv")
    except Exception as exc:  # archivo corrupto / formato desconocido
        raise HTTPException(400, f"No se pudo leer el archivo: {exc}") from exc
    report = import_catalog(db, rows, sync=sync, dry_run=dry_run, strict=strict)
    if not report.dry_run:
        catalog_store.ensure_fresh(db, force=True)
    return report.to_dict()


@router.get("/import/template", response_class=PlainTextResponse)
def template():
    """Encabezado de la plantilla CSV (con BOM para que Excel respete las tildes)."""
    return PlainTextResponse(
        "﻿" + ";".join(TEMPLATE_COLUMNS) + "\n",
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="plantilla_productos.csv"'},
    )
