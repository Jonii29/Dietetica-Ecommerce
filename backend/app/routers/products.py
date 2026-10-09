"""Endpoints públicos de catálogo y búsqueda."""
from __future__ import annotations

import hashlib
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..schemas import Catalog, CategoryOut, Facets, ProductOut, ProductPage, Suggestion, TagOut
from ..services.catalog import catalog_store
from ..services.search import search_index

router = APIRouter(prefix="/api", tags=["catálogo"])


@router.get("/products", response_model=ProductPage)
def list_products(
    response: Response,
    q: str | None = Query(None, max_length=100, description="Texto libre (tolerante a tildes y errores)"),
    category: str | None = Query(None, description="slug de categoría madre o hija"),
    tags: str | None = Query(None, description="slugs separados por coma: sin-tacc,vegano"),
    brand: str | None = None,
    in_stock: bool = False,
    sort: Literal["relevance", "name", "price_asc", "price_desc"] = "relevance",
    page: int = Query(1, ge=1),
    page_size: int = Query(24, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Listado paginado con filtros facetados. Ej: `/api/products?q=harina&tags=sin-tacc&page=2`"""
    snap = catalog_store.ensure_fresh(db)
    tag_list = [t.strip() for t in (tags or "").split(",") if t.strip()]
    items, facets = catalog_store.query(
        snap, q=q, category=category, tags=tag_list, brand=brand, sort=sort, in_stock=in_stock,
    )
    total = len(items)
    start = (page - 1) * page_size
    response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=120"
    return ProductPage(
        items=items[start:start + page_size],
        total=total, page=page, page_size=page_size, pages=max(1, math.ceil(total / page_size)),
        facets=Facets(tags=dict(facets["tags"]), categories=dict(facets["categories"]), brands=dict(facets["brands"])),
    )


@router.get("/catalog", response_model=Catalog)
def full_catalog(request: Request, response: Response, db: Session = Depends(get_db)):
    """Catálogo completo compacto (~150-250 KB, ~30 KB con gzip) para búsqueda 100% en el cliente.

    Soporta `ETag`/`If-None-Match`: si el catálogo no cambió responde 304 sin cuerpo.
    """
    snap = catalog_store.ensure_fresh(db)
    etag = f'W/"cat-{snap.version}-{len(snap.compact)}"'
    headers = {"ETag": etag, "Cache-Control": "public, max-age=60, stale-while-revalidate=600"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return Catalog(
        version=hashlib.sha1(etag.encode()).hexdigest()[:10],
        categories=snap.categories, tags=snap.tags, products=snap.compact,
    )


@router.get("/search/suggest", response_model=list[Suggestion])
def suggest(q: str = Query(..., min_length=1, max_length=100), limit: int = Query(8, le=20),
            db: Session = Depends(get_db)):
    """Autocompletado liviano para el buscador predictivo (server-side)."""
    snap = catalog_store.ensure_fresh(db)
    out: list[Suggestion] = []
    for pid in search_index.search(q, limit=limit):
        p = snap.by_id.get(pid)
        if p:
            out.append(Suggestion(slug=p.slug, name=p.name, brand=p.brand, min_price=p.min_price, image=p.image_url))
    return out


@router.get("/products/{slug}", response_model=ProductOut)
def product_detail(slug: str, db: Session = Depends(get_db)):
    p = catalog_store.ensure_fresh(db).by_slug.get(slug)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return p


@router.get("/categories", response_model=list[CategoryOut])
def categories(db: Session = Depends(get_db)):
    return catalog_store.ensure_fresh(db).categories


@router.get("/tags", response_model=list[TagOut])
def tags_list(db: Session = Depends(get_db)):
    return catalog_store.ensure_fresh(db).tags
