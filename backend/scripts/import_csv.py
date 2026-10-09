#!/usr/bin/env python3
"""Importa/sincroniza el catálogo desde la línea de comandos.

    python -m scripts.import_csv data/plantilla_productos.csv            # upsert
    python -m scripts.import_csv inventario.xlsx --sync                  # upsert + desactiva faltantes
    python -m scripts.import_csv inventario.csv --dry-run                # solo valida
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal, init_db  # noqa: E402
from app.services.importer import import_catalog, read_rows  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file", type=Path)
    ap.add_argument("--sync", action="store_true", help="desactiva SKUs ausentes en el archivo")
    ap.add_argument("--dry-run", action="store_true", help="valida sin guardar")
    ap.add_argument("--strict", action="store_true", help="aborta si alguna fila tiene error")
    args = ap.parse_args()

    init_db()
    rows = read_rows(args.file.read_bytes(), args.file.name)
    with SessionLocal() as db:
        report = import_catalog(db, rows, sync=args.sync, dry_run=args.dry_run, strict=args.strict)
    print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False))
    return 1 if report.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
