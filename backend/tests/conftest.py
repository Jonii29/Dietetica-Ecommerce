"""Configuración común de tests: una base SQLite temporal, recreada en cada módulo."""
import os
import tempfile
from pathlib import Path

_DB = Path(tempfile.gettempdir()) / "dietetica_test.db"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_DB}")  # p. ej. postgresql://…
os.environ["ADMIN_TOKEN"] = "secreto"
os.environ["ADMIN_USER"] = "Dueño"
os.environ["ADMIN_PASSWORD"] = "clave-segura-123"

import pytest  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def fresh_db():
    from app.database import Base, engine, init_db
    from app.services import catalog

    Base.metadata.drop_all(engine)
    init_db()
    catalog.catalog_store._snap = catalog._Snapshot()  # olvidar el catálogo en memoria
    yield
