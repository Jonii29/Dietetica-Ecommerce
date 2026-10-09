"""Punto de entrada FastAPI.

    uvicorn app.main:app --reload
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import get_settings
from .database import SessionLocal, init_db
from .routers import admin, admin_auth, orders, products
from .security import ensure_initial_admin
from .services.catalog import catalog_store

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()  # en producción: usar migraciones Alembic
    with SessionLocal() as db:
        ensure_initial_admin(db)                     # crea el primer usuario si se definió ADMIN_PASSWORD
        catalog_store.ensure_fresh(db, force=True)  # precalienta catálogo + índice
    yield


app = FastAPI(title=f"{settings.store_name} API", version="1.0.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1024)  # el catálogo comprime ~85%
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST", "PUT", "PATCH"],
    allow_credentials=True,
    allow_headers=["*"],
)
app.include_router(products.router)
app.include_router(orders.router)
app.include_router(admin_auth.router)
app.include_router(admin.router)


@app.get("/", include_in_schema=False)
def root():
    return {"ok": True, "api": "/api", "docs": "/docs"}


@app.get("/health", tags=["infra"])
def health():
    return {"ok": True}
