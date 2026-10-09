"""Índice de búsqueda difusa en memoria.

Con ~1.000 productos el índice completo pesa < 1 MB y una búsqueda tarda < 5 ms, así que no
hace falta Elasticsearch/Meilisearch. Se reconstruye al iniciar y después de cada importación.

Algoritmo (igual al del frontend, para resultados consistentes):
1. Se normaliza la consulta (sin tildes, minúsculas) y se descartan stopwords ("de", "la"...).
2. Se expanden sinónimos globales (ej. "gluten free" -> "sin tacc").
3. Cada token de la consulta debe matchear alguna palabra del producto (AND), con puntaje:
   exacto 1.0 > prefijo 0.85 > contiene 0.6 > difuso (rapidfuzz ≥ 80) 0.5·similitud.
4. Se ordena por puntaje total, priorizando matches en el nombre.
"""
from __future__ import annotations

import threading
from dataclasses import dataclass

from rapidfuzz import fuzz
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Product
from ..utils.text import normalize

STOPWORDS = {"de", "del", "la", "las", "el", "los", "y", "con", "x", "en", "para", "a"}

# Sinónimos globales (el CSV además permite sinónimos por producto).
GLOBAL_SYNONYMS: dict[str, str] = {
    "gluten free": "sin tacc",
    "sin gluten": "sin tacc",
    "celiaco": "sin tacc",
    "celiacos": "sin tacc",
    "gf": "sin tacc",
    "vegan": "vegano",
    "organic": "organico",
    "sugar free": "sin azucar",
    "stevia": "sin azucar stevia",
}


def expand_query(query: str) -> list[str]:
    q = normalize(query)
    for src, dst in GLOBAL_SYNONYMS.items():
        if f" {src} " in f" {q} ":
            q = f" {q} ".replace(f" {src} ", f" {dst} ").strip()
    return [t for t in q.split() if t not in STOPWORDS]


def _token_score(token: str, words: list[str]) -> float:
    best = 0.0
    for w in words:
        if w == token:
            return 1.0
        if w.startswith(token):
            best = max(best, 0.85)
        elif len(token) >= 3 and token in w:
            best = max(best, 0.6)
        elif len(token) >= 4 and abs(len(w) - len(token)) <= 3:
            sim = fuzz.ratio(token, w)
            if sim >= 80:
                best = max(best, 0.5 * sim / 100)
    return best


@dataclass(slots=True)
class _Doc:
    words: list[str]
    name_words: set[str]


class SearchIndex:
    def __init__(self) -> None:
        self._docs: dict[int, _Doc] = {}
        self._lock = threading.Lock()
        self.version = 0

    def rebuild(self, db: Session) -> None:
        rows = db.execute(
            select(Product.id, Product.name, Product.search_text).where(Product.is_active.is_(True))
        ).all()
        docs = {pid: _Doc(words=text.split(), name_words=set(normalize(name).split())) for pid, name, text in rows}
        with self._lock:
            self._docs = docs
            self.version += 1

    def search(self, query: str, candidate_ids: set[int] | None = None, limit: int | None = None) -> list[int]:
        """Devuelve IDs de producto ordenados por relevancia."""
        tokens = expand_query(query)
        if not tokens:
            return []
        docs = self._docs
        scored: list[tuple[float, int]] = []
        for pid, doc in docs.items():
            if candidate_ids is not None and pid not in candidate_ids:
                continue
            total = 0.0
            for tok in tokens:
                s = _token_score(tok, doc.words)
                if s == 0.0:
                    break
                total += s + (0.25 if tok in doc.name_words else 0.0)
            else:
                scored.append((total, pid))
        scored.sort(key=lambda x: (-x[0], x[1]))
        ids = [pid for _, pid in scored]
        return ids[:limit] if limit else ids


search_index = SearchIndex()


def build_search_text(product: Product) -> str:
    """Texto plano normalizado que alimenta el índice (y un posible LIKE en SQL)."""
    parts: list[str] = [product.name, product.brand or "", product.synonyms or ""]
    cat = product.category
    while cat is not None:
        parts.append(cat.name)
        cat = cat.parent
    parts += [t.name for t in product.tags]
    words: list[str] = []
    seen: set[str] = set()
    for w in normalize(" ".join(parts)).split():
        if w not in seen:
            seen.add(w)
            words.append(w)
    return " ".join(words)
