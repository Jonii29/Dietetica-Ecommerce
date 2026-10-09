"""Utilidades de texto: normalización para búsqueda, slugs y parseo de valores del CSV."""
from __future__ import annotations

import re
import unicodedata
from decimal import Decimal, InvalidOperation

_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize(value: str | None) -> str:
    """'Quínoa  Orgánica!' -> 'quinoa organica'. Quita tildes, ñ->n, minúsculas, solo [a-z0-9 ]."""
    if not value:
        return ""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    return _NON_ALNUM.sub(" ", value.lower()).strip()


def slugify(value: str | None) -> str:
    return normalize(value).replace(" ", "-")


def split_list(value: str | None) -> list[str]:
    """Separa listas en celdas: 'vegano|sin tacc; keto' -> ['vegano', 'sin tacc', 'keto']."""
    if not value:
        return []
    return [p.strip() for p in re.split(r"[|;]", str(value)) if p.strip()]


def parse_price_to_cents(value: str | float | int | None) -> int:
    """Acepta '$ 1.234,50', '1234.5', '1,234.50', 1234 -> centavos (int).

    Regla: si aparecen '.' y ',' el último es el separador decimal. Si solo hay uno y
    le siguen exactamente 3 dígitos, se interpreta como separador de miles (formato AR).
    """
    if value is None or str(value).strip() == "":
        raise ValueError("precio vacío")
    if isinstance(value, (int, float)):
        return int((Decimal(str(value)) * 100).quantize(Decimal("1")))
    s = re.sub(r"[^\d,.\-]", "", str(value))
    if "," in s and "." in s:
        dec = "," if s.rfind(",") > s.rfind(".") else "."
        thou = "." if dec == "," else ","
        s = s.replace(thou, "").replace(dec, ".")
    elif "," in s or "." in s:
        sep = "," if "," in s else "."
        if re.fullmatch(rf"-?\d{{1,3}}(\{sep}\d{{3}})+", s):
            s = s.replace(sep, "")                  # 1.234 / 12.345.678 -> miles
        else:
            s = s.replace(",", ".")                 # 1234,5 -> decimal
    try:
        cents = (Decimal(s) * 100).quantize(Decimal("1"))
    except InvalidOperation as exc:
        raise ValueError(f"precio inválido: {value!r}") from exc
    if cents < 0:
        raise ValueError("precio negativo")
    return int(cents)


_TRUE = {"1", "si", "sí", "s", "true", "verdadero", "x", "yes", "y", "activo"}
_FALSE = {"0", "no", "n", "false", "falso", "inactivo"}


def parse_bool(value, default: bool = True) -> bool:
    if value is None or str(value).strip() == "":
        return default
    v = str(value).strip().lower()
    if v in _TRUE:
        return True
    if v in _FALSE:
        return False
    raise ValueError(f"booleano inválido: {value!r}")


_CONTENT = re.compile(r"^\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Z]*)\s*$")
_UNIT_MAP = {
    "g": ("g", 1), "gr": ("g", 1), "grs": ("g", 1), "gramos": ("g", 1),
    "kg": ("g", 1000), "k": ("g", 1000), "kilo": ("g", 1000), "kilos": ("g", 1000),
    "ml": ("ml", 1), "cc": ("ml", 1), "l": ("ml", 1000), "lt": ("ml", 1000), "litro": ("ml", 1000),
    "u": ("u", 1), "un": ("u", 1), "unid": ("u", 1), "unidad": ("u", 1), "unidades": ("u", 1), "": ("u", 1),
}


def parse_content(value: str | None) -> tuple[int, str]:
    """'1kg' -> (1000, 'g'); '500 ml' -> (500, 'ml'); '6 u' -> (6, 'u'); '' -> (1, 'u')."""
    if value is None or str(value).strip() == "":
        return 1, "u"
    m = _CONTENT.match(str(value))
    if not m:
        raise ValueError(f"contenido inválido: {value!r} (ej: 500g, 1kg, 1 u)")
    amount = Decimal(m.group(1).replace(",", "."))
    unit_key = m.group(2).lower()
    if unit_key not in _UNIT_MAP:
        raise ValueError(f"unidad desconocida: {m.group(2)!r}")
    unit, factor = _UNIT_MAP[unit_key]
    return int(amount * factor), unit


def content_label(quantity: int, unit: str) -> str:
    """(1000,'g') -> '1 kg'; (250,'g') -> '250 g'; (1,'u') -> 'Unidad'."""
    if unit == "g":
        return f"{quantity / 1000:g} kg" if quantity >= 1000 else f"{quantity} g"
    if unit == "ml":
        return f"{quantity / 1000:g} L" if quantity >= 1000 else f"{quantity} ml"
    return "Unidad" if quantity == 1 else f"{quantity} u"
