/**
 * Motor de búsqueda difusa 100% en el cliente (sin dependencias).
 *
 * El catálogo completo (~1.000 productos) se descarga una vez (cacheado con ETag) y se
 * indexa en memoria: cada tecla filtra en ~1-3 ms sin ir al servidor.
 *
 * Mismo algoritmo que backend/app/services/search.py:
 *   exacto 1.0 > prefijo 0.85 > contiene 0.6 > difuso (similitud ≥ 0.8) 0.5·sim
 *   + 0.25 si el token está en el nombre. Todos los tokens deben matchear (AND).
 */
import { normalize } from "./format";
import type { CatalogProduct } from "./types";

const STOPWORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "con", "x", "en", "para", "a"]);

const GLOBAL_SYNONYMS: Record<string, string> = {
  "gluten free": "sin tacc",
  "sin gluten": "sin tacc",
  celiaco: "sin tacc",
  celiacos: "sin tacc",
  gf: "sin tacc",
  vegan: "vegano",
  organic: "organico",
  "sugar free": "sin azucar",
};

export interface IndexedProduct {
  product: CatalogProduct;
  words: string[];
  nameWords: Set<string>;
  minPrice: number;
}

export function buildIndex(products: CatalogProduct[]): IndexedProduct[] {
  return products.map((p) => ({
    product: p,
    words: p.search.split(" "),
    nameWords: new Set(normalize(p.name).split(" ")),
    minPrice: Math.min(...p.variants.map((v) => v.price)),
  }));
}

export function tokenize(query: string): string[] {
  let q = ` ${normalize(query)} `;
  for (const [src, dst] of Object.entries(GLOBAL_SYNONYMS)) {
    q = q.replace(` ${src} `, ` ${dst} `);
  }
  return q.trim().split(/\s+/).filter((t) => t && !STOPWORDS.has(t));
}

/** Similitud tipo "InDel ratio" (equivalente a rapidfuzz.fuzz.ratio / 100). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (!m || !n) return 0;
  let prev = new Uint8Array(n + 1);
  let curr = new Uint8Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return (2 * prev[n]) / (m + n); // 2·LCS / (|a|+|b|)
}

function tokenScore(token: string, words: string[]): number {
  let best = 0;
  for (const w of words) {
    if (w === token) return 1;
    if (w.startsWith(token)) best = Math.max(best, 0.85);
    else if (token.length >= 3 && w.includes(token)) best = Math.max(best, 0.6);
    else if (token.length >= 4 && Math.abs(w.length - token.length) <= 3 && best < 0.5) {
      const sim = similarity(token, w);
      if (sim >= 0.8) best = Math.max(best, 0.5 * sim);
    }
  }
  return best;
}

export type SortKey = "relevance" | "name" | "price_asc" | "price_desc";

export interface Filters {
  query: string;
  tags: string[]; // AND
  category: string | null;
  sort: SortKey;
}

export interface SearchResult {
  items: IndexedProduct[];
  tagCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
}

/** Busca + filtra + ordena + calcula facetas en una sola pasada. */
export function runSearch(index: IndexedProduct[], f: Filters): SearchResult {
  const tokens = tokenize(f.query);
  const scored: { doc: IndexedProduct; score: number }[] = [];

  for (const doc of index) {
    let score = 0;
    let ok = true;
    for (const t of tokens) {
      const s = tokenScore(t, doc.words);
      if (s === 0) {
        ok = false;
        break;
      }
      score += s + (doc.nameWords.has(t) ? 0.25 : 0);
    }
    if (ok) scored.push({ doc, score });
  }

  const tagCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const hasTags = (d: IndexedProduct) => f.tags.every((t) => d.product.tags.includes(t));
  const inCat = (d: IndexedProduct) =>
    !f.category || d.product.category === f.category || d.product.subcategory === f.category;

  const items: { doc: IndexedProduct; score: number }[] = [];
  for (const s of scored) {
    const tagOk = hasTags(s.doc);
    const catOk = inCat(s.doc);
    // Facetas: cada dimensión se cuenta aplicando solo los OTROS filtros
    if (tagOk && s.doc.product.category) {
      categoryCounts[s.doc.product.category] = (categoryCounts[s.doc.product.category] ?? 0) + 1;
    }
    if (catOk && tagOk) {
      for (const t of s.doc.product.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      items.push(s);
    }
  }

  const byName = (a: IndexedProduct, b: IndexedProduct) => a.product.name.localeCompare(b.product.name, "es");
  switch (f.sort) {
    case "price_asc":
      items.sort((a, b) => a.doc.minPrice - b.doc.minPrice);
      break;
    case "price_desc":
      items.sort((a, b) => b.doc.minPrice - a.doc.minPrice);
      break;
    case "name":
      items.sort((a, b) => byName(a.doc, b.doc));
      break;
    default:
      items.sort((a, b) => b.score - a.score || byName(a.doc, b.doc));
  }

  return { items: items.map((s) => s.doc), tagCounts, categoryCounts };
}
