"""Catálogo en memoria (read-model).

Con ~1.000 productos es más rápido y simple tener el catálogo ya serializado en RAM que
hacer JOINs por request: listados, filtros y facetas se resuelven en < 5 ms.

Coherencia entre workers: cada proceso compara (como mucho cada `CHECK_EVERY` segundos)
su versión con `catalog_meta.version`, que el importador incrementa. Si cambió, recarga.
"""
from __future__ import annotations

import threading
import time
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import CatalogMeta, Category, Product, Tag
from ..schemas import CatalogItem, CategoryOut, ProductOut, TagOut
from .search import search_index

CHECK_EVERY = 15.0  # segundos


@dataclass
class _Snapshot:
    version: int = -1
    products: list[ProductOut] = field(default_factory=list)
    compact: list[CatalogItem] = field(default_factory=list)
    by_id: dict[int, ProductOut] = field(default_factory=dict)
    by_slug: dict[str, ProductOut] = field(default_factory=dict)
    root_cat: dict[int, str] = field(default_factory=dict)    # product_id -> slug categoría madre
    leaf_cat: dict[int, str] = field(default_factory=dict)    # product_id -> slug categoría hoja
    categories: list[CategoryOut] = field(default_factory=list)
    tags: list[TagOut] = field(default_factory=list)


class CatalogStore:
    def __init__(self) -> None:
        self._snap = _Snapshot()
        self._lock = threading.Lock()
        self._last_check = 0.0

    # ---- carga ----
    def ensure_fresh(self, db: Session, force: bool = False) -> _Snapshot:
        now = time.monotonic()
        if not force and now - self._last_check < CHECK_EVERY and self._snap.version >= 0:
            return self._snap
        self._last_check = now
        version = db.scalar(select(CatalogMeta.version).where(CatalogMeta.id == 1)) or 0
        if force or version != self._snap.version:
            with self._lock:
                if force or version != self._snap.version:
                    self._snap = self._load(db, version)
                    search_index.rebuild(db)
        return self._snap

    @staticmethod
    def _load(db: Session, version: int) -> _Snapshot:
        products = db.scalars(
            select(Product)
            .where(Product.is_active.is_(True))
            .options(selectinload(Product.category).selectinload(Category.parent))
            .order_by(Product.name)
        ).all()
        snap = _Snapshot(version=version)
        for p in products:
            variants = p.active_variants
            if not variants:
                continue
            out = ProductOut.model_validate(p)
            out.variants = [v for v in out.variants if v.sku in {x.sku for x in variants}]
            out.tags.sort(key=lambda t: (t.kind != "dietary", t.slug))
            snap.products.append(out)
            snap.by_id[p.id] = out
            snap.by_slug[p.slug] = out
            root = p.category.root if p.category else None
            snap.root_cat[p.id] = root.slug if root else ""
            snap.leaf_cat[p.id] = p.category.slug if p.category else ""
            snap.compact.append(CatalogItem(
                id=p.id, slug=p.slug, name=p.name, brand=p.brand, image=p.image_url,
                category=root.slug if root else None,
                subcategory=p.category.slug if p.category and p.category.parent_id else None,
                tags=[t.slug for t in out.tags], search=p.search_text, variants=out.variants,
            ))
        snap.categories = [CategoryOut.model_validate(c) for c in db.scalars(select(Category).order_by(Category.sort_order, Category.name))]
        snap.tags = [TagOut.model_validate(t) for t in db.scalars(select(Tag).order_by(Tag.sort_order, Tag.name))]
        return snap

    # ---- consultas ----
    def query(
        self, snap: _Snapshot, *, q: str | None, category: str | None, tags: list[str],
        brand: str | None, sort: str, in_stock: bool,
    ) -> tuple[list[ProductOut], dict[str, Counter]]:
        """Filtra + ordena. Devuelve (items, facetas). Facetas calculadas sobre el set filtrado
        por *los demás* criterios (UX estándar de filtros facetados)."""
        base = snap.products
        relevance: dict[int, int] | None = None
        if q and q.strip():
            ids = search_index.search(q)
            relevance = {pid: i for i, pid in enumerate(ids)}
            base = [snap.by_id[i] for i in ids if i in snap.by_id]

        def match_cat(p: ProductOut) -> bool:
            return not category or category in (snap.root_cat.get(p.id), snap.leaf_cat.get(p.id))

        def match_tags(p: ProductOut) -> bool:
            if not tags:
                return True
            have = {t.slug for t in p.tags}
            return all(t in have for t in tags)   # AND: "sin tacc" Y "vegano"

        def match_brand(p: ProductOut) -> bool:
            return not brand or (p.brand or "").lower() == brand.lower()

        def match_stock(p: ProductOut) -> bool:
            return not in_stock or any(v.in_stock for v in p.variants)

        items = [p for p in base if match_cat(p) and match_tags(p) and match_brand(p) and match_stock(p)]

        facets = {
            "tags": Counter(t.slug for p in base if match_cat(p) and match_brand(p) and match_stock(p)
                            and match_tags(p) for t in p.tags),
            "categories": Counter(snap.root_cat[p.id] for p in base if match_tags(p) and match_brand(p) and match_stock(p)),
            "brands": Counter(p.brand for p in base if p.brand and match_cat(p) and match_tags(p) and match_stock(p)),
        }

        if sort == "price_asc":
            items.sort(key=lambda p: p.min_price or 0)
        elif sort == "price_desc":
            items.sort(key=lambda p: -(p.min_price or 0))
        elif sort == "name" or relevance is None:
            items.sort(key=lambda p: p.name.lower())
        # "relevance" con q: ya viene ordenado por el índice
        return items, facets


catalog_store = CatalogStore()


def bump_catalog_version(db: Session) -> None:
    """Marca el catálogo como modificado (lo usan el panel y los cambios de stock).
    El llamador hace commit; después conviene `catalog_store.ensure_fresh(db, force=True)`."""
    meta = db.get(CatalogMeta, 1) or CatalogMeta(id=1, version=0)
    meta.version += 1
    db.add(meta)
