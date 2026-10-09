"use client";
/**
 * Tienda (diseño "Feria"): encabezado con buscador y carrito, bloques de color por categoría,
 * filtros dietarios y grilla de productos.
 *
 * Rendimiento:
 *  - Índice construido una sola vez (useMemo) sobre el catálogo que llega por props (SSR/ISR).
 *  - useDeferredValue: el input nunca se traba; el filtrado corre con prioridad baja.
 *  - Render incremental (48 tarjetas + "ver más" automático con IntersectionObserver).
 *  - Tarjetas memoizadas + `content-visibility:auto`.
 *  - Estado reflejado en la URL (?q=&tags=&cat=) con history.replaceState (sin navegación).
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Search, ShoppingBag, X } from "lucide-react";
import { DietaryFilter } from "./DietaryFilter";
import { ProductCard } from "./ProductCard";
import { useCart } from "@/lib/cart";
import { categoryColor } from "@/lib/categoryColors";
import { formatARS } from "@/lib/format";
import { buildIndex, runSearch, type SortKey } from "@/lib/search";
import type { Catalog } from "@/lib/types";

const PAGE = 48;

export function CatalogSearch({ catalog, storeName }: { catalog: Catalog; storeName: string }) {
  const [query, setQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("relevance");
  const [visible, setVisible] = useState(PAGE);
  const inputRef = useRef<HTMLInputElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { count, total } = useCart();

  // --- Índice (una vez por versión de catálogo) ---
  const index = useMemo(() => buildIndex(catalog.products), [catalog.products]);
  const tagsBySlug = useMemo(() => new Map(catalog.tags.map((t) => [t.slug, t])), [catalog.tags]);
  const dietaryTags = useMemo(() => catalog.tags.filter((t) => t.kind === "dietary"), [catalog.tags]);
  const rootCategories = useMemo(() => catalog.categories.filter((c) => c.parent_id === null), [catalog.categories]);
  const catName = useMemo(() => new Map(catalog.categories.map((c) => [c.slug, c.name])), [catalog.categories]);

  // --- Búsqueda diferida ---
  const deferredQuery = useDeferredValue(query);
  const result = useMemo(
    () => runSearch(index, { query: deferredQuery, tags, category, sort }),
    [index, deferredQuery, tags, category, sort],
  );
  const isStale = deferredQuery !== query;

  // --- Estado <-> URL ---
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setQuery(p.get("q") ?? "");
    setTags(p.get("tags")?.split(",").filter(Boolean) ?? []);
    setCategory(p.get("cat"));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (deferredQuery) p.set("q", deferredQuery);
    if (tags.length) p.set("tags", tags.join(","));
    if (category) p.set("cat", category);
    const qs = p.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    setVisible(PAGE);
  }, [deferredQuery, tags, category]);

  // --- Atajo "/" para enfocar el buscador ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Scroll infinito ---
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && setVisible((v) => v + PAGE),
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [result.items.length]);

  const toggleTag = useCallback(
    (slug: string) => setTags((prev) => (prev.includes(slug) ? prev.filter((t) => t !== slug) : [...prev, slug])),
    [],
  );
  const pickCategory = (slug: string) => {
    setCategory((c) => (c === slug ? null : slug));
    resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const clearAll = () => {
    setQuery("");
    setTags([]);
    setCategory(null);
  };
  const hasFilters = Boolean(query || tags.length || category);
  const showHero = !query;

  return (
    <>
      {/* Encabezado fijo: marca, buscador y carrito */}
      <header className="sticky top-0 z-20 border-b border-lilac-200 bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 md:px-6">
          <a href="/" className="font-display text-[28px] font-extrabold lowercase tracking-tight text-ink no-underline">{storeName}</a>
          <div className="order-last flex min-w-0 basis-full items-center gap-2.5 rounded-full bg-lilac px-4 md:order-none md:basis-0 md:flex-1">
            <Search size={20} aria-hidden className="shrink-0" />
            <label htmlFor="search" className="sr-only">Buscar productos</label>
            <input
              ref={inputRef} id="search" type="search" inputMode="search" autoComplete="off" enterKeyHint="search"
              placeholder={`Buscá entre ${catalog.products.length} productos: chía, harina de almendras…`}
              value={query} onChange={(e) => setQuery(e.target.value)}
              className="h-12 min-w-0 flex-1 bg-transparent text-base font-medium outline-none placeholder:text-ink-soft"
            />
            {query && (
              <button type="button" aria-label="Borrar búsqueda" onClick={() => { setQuery(""); inputRef.current?.focus(); }}
                className="grid size-10 place-items-center rounded-full hover:bg-lilac-200">
                <X size={18} />
              </button>
            )}
          </div>
          <button type="button" onClick={() => window.dispatchEvent(new Event("open-cart"))}
            aria-label={`Abrir carrito (${count} artículos)`}
            className="ml-auto flex min-h-12 items-center gap-2 rounded-full bg-ink px-5 font-bold text-white md:ml-0">
            <ShoppingBag size={20} aria-hidden />
            <span className="tabular-nums">{count > 0 ? `${count} · ${formatARS(total)}` : "Carrito"}</span>
          </button>
        </div>
      </header>

      {/* Portada: titular + bloques de categoría */}
      {showHero && (
        <section className="mx-auto max-w-[1240px] px-4 pb-4 pt-8 md:px-6 md:pt-10">
          <h1 className="max-w-[880px] font-display text-[44px] font-extrabold leading-[0.98] tracking-[-0.03em] [text-wrap:balance] md:text-[76px]">
            Todo lo natural, en una sola compra.
          </h1>
          <nav aria-label="Categorías" className="mt-8 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:none] md:grid md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] md:gap-3.5 md:overflow-visible">
            {rootCategories.map((c) => {
              const n = result.categoryCounts[c.slug] ?? 0;
              const active = category === c.slug;
              return (
                <button key={c.slug} type="button" onClick={() => pickCategory(c.slug)} aria-pressed={active} disabled={n === 0 && !active}
                  style={{ background: categoryColor(c.slug) }}
                  className={`flex min-h-[132px] w-44 shrink-0 flex-col justify-between rounded-[22px] p-4 text-left text-ink transition md:w-auto md:min-h-[150px] ${
                    active ? "ring-[3px] ring-ink ring-offset-2" : "hover:-translate-y-0.5"
                  } disabled:opacity-40`}>
                  <span className="font-display text-[24px] font-extrabold leading-[1.05] md:text-[26px]">{c.name}</span>
                  <span className="text-sm font-medium tabular-nums">{n} {n === 1 ? "producto" : "productos"}</span>
                </button>
              );
            })}
          </nav>
        </section>
      )}

      {/* Filtros + resultados */}
      <section ref={resultsRef} aria-label="Productos" className="mx-auto max-w-[1240px] scroll-mt-24 px-4 pb-20 pt-6 md:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="font-bold">Filtrar:</span>
          <div className="min-w-0 flex-1">
            <DietaryFilter tags={dietaryTags} selected={tags} counts={result.tagCounts} onToggle={toggleTag} />
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
          <p aria-live="polite" className="flex flex-wrap items-center gap-2">
            <strong className="font-display text-xl font-extrabold">
              {result.items.length} {result.items.length === 1 ? "producto" : "productos"}
            </strong>
            {category && (
              <button type="button" onClick={() => setCategory(null)} style={{ background: categoryColor(category) }}
                className="flex min-h-10 items-center gap-1 rounded-full px-3.5 font-bold">
                {catName.get(category) ?? category} <X size={14} aria-label="Quitar categoría" />
              </button>
            )}
            {hasFilters && (
              <button type="button" onClick={clearAll} className="min-h-10 px-1 font-bold underline underline-offset-2">Limpiar filtros</button>
            )}
          </p>
          <label className="flex items-center gap-2 font-bold">
            Ordenar
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
              className="min-h-10 rounded-full border-2 border-ink bg-white px-3 font-bold">
              <option value="relevance">Relevancia</option>
              <option value="name">Nombre A-Z</option>
              <option value="price_asc">Menor precio</option>
              <option value="price_desc">Mayor precio</option>
            </select>
          </label>
        </div>

        {result.items.length === 0 ? (
          <div className="rounded-3xl bg-lilac p-10 text-center">
            <p className="font-display text-2xl font-extrabold">No encontramos productos con esa búsqueda.</p>
            <p className="mt-2 text-ink-soft">Probá con otra palabra o quitá algún filtro.</p>
            {hasFilters && (
              <button type="button" onClick={clearAll} className="mt-4 min-h-11 rounded-full bg-ink px-5 font-bold text-white">Ver todos los productos</button>
            )}
          </div>
        ) : (
          <ul className={`grid grid-cols-1 gap-5 transition-opacity min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${isStale ? "opacity-60" : ""}`}>
            {result.items.slice(0, visible).map((doc, i) => (
              <li key={doc.product.id}>
                <ProductCard
                  product={doc.product}
                  tagsBySlug={tagsBySlug}
                  categoryName={doc.product.category ? catName.get(doc.product.category) : undefined}
                  color={categoryColor(doc.product.category)}
                  priority={i < 4}
                />
              </li>
            ))}
          </ul>
        )}
        {visible < result.items.length && <div ref={sentinelRef} className="h-10" aria-hidden />}
      </section>
    </>
  );
}
