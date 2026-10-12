"""Engine, sesión y Base declarativa de SQLAlchemy 2.0."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()
_is_sqlite = settings.database_url.startswith("sqlite")

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=not _is_sqlite,
)

if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):  # pragma: no cover - config de bajo nivel
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")    # lecturas concurrentes mientras se escribe
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """Dependencia FastAPI: una sesión por request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401  (registra los modelos)
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()


# Columnas agregadas después de la primera versión. create_all() crea tablas nuevas pero no
# agrega columnas a tablas existentes; esto evita tener que borrar la base. (Con PostgreSQL en
# producción conviene pasar a Alembic.)
_NEW_COLUMNS = {
    "orders": {"stock_applied": "BOOLEAN NOT NULL DEFAULT FALSE"},  # FALSE vale en SQLite y PostgreSQL
    "admin_users": {"env_password_hash": "VARCHAR(200)"},
}


def _add_missing_columns() -> None:
    from sqlalchemy import inspect, text

    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _NEW_COLUMNS.items():
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
