"use client";
/**
 * Lista de productos con edición rápida: precio y stock se guardan al salir del campo
 * (o con Enter), y cada producto se puede ocultar/mostrar con un clic.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Pencil, Plus, Search } from "lucide-react";
import {
  adminFetch, centsToInput, pesosToCents, type AdminCategory, type AdminProduct, type AdminVariant,
} from "@/lib/admin";
import { normalize } from "@/lib/format";

type Filter = "all" | "active" | "hidden" | "low" | "out";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "active", label: "Visibles" },
  { key: "hidden", label: "Ocultos" },
  { key: "low", label: "Stock bajo" },
  { key: "out", label: "Sin stock" },
];
const LOW = 5;

export default function ProductsPage() {
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [cats, setCats] = useState<Map<number, string>>(new Map());
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<{ items: AdminProduct[] }>("/products").then((r) => setProducts(r.items));
    adminFetch<AdminCategory[]>("/categories").then((c) => setCats(new Map(c.map((x) => [x.id, x.name]))));
  }, []);

  useEffect(() => {
    const saved = new URLSearchParams(window.location.search).get("guardado");
    if (saved) {
      notify(`«${saved}» guardado`);
      window.history.replaceState(null, "", "/admin/productos");
    }
  }, []);

  function notify(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }

  const visible = useMemo(() => {
    if (!products) return [];
    const nq = normalize(q);
    return products.filter((p) => {
      if (nq && !normalize(`${p.name} ${p.brand ?? ""} ${p.variants.map((v) => v.sku).join(" ")}`).includes(nq)) return false;
      switch (filter) {
        case "active": return p.is_active;
        case "hidden": return !p.is_active;
        case "low": return p.variants.some((v) => v.stock != null && v.stock <= LOW);
        case "out": return p.variants.some((v) => v.stock === 0);
        default: return true;
      }
    });
  }, [products, q, filter]);

  // Celular (< 768 px): tarjetas en lugar de tabla. Se renderiza solo una de las dos vistas.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Funciones (no componentes) para que React no vuelva a montar los campos en cada render
  const priceField = (p: AdminProduct, v: AdminVariant) => (
    <InlineField
      id={`price-${v.sku}`} initial={centsToInput(v.price)} width="w-full max-w-28" inputMode="decimal"
      parse={(s) => pesosToCents(s)}
      onSave={async (cents) => {
        if (cents == null) throw new Error("Precio inválido");
        replaceVariant(p.id, await adminFetch<AdminVariant>(`/variants/${v.sku}`, { method: "PATCH", body: JSON.stringify({ price: cents }) }));
        notify(`Precio de ${p.name} (${v.label}) guardado`);
      }}
    />
  );
  const stockField = (p: AdminProduct, v: AdminVariant) => (
    <InlineField
      id={`stock-${v.sku}`} initial={v.stock == null ? "" : String(v.stock)} width="w-full max-w-28" placeholder="sin control" inputMode="numeric"
      parse={(s) => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number(s) : undefined)}
      onSave={async (stock) => {
        if (stock === undefined) throw new Error("Stock inválido");
        replaceVariant(p.id, await adminFetch<AdminVariant>(`/variants/${v.sku}`, { method: "PATCH", body: JSON.stringify({ stock }) }));
        notify(`Stock de ${p.name} (${v.label}) guardado`);
      }}
      tone={v.stock === 0 ? "text-red-700" : v.stock != null && v.stock <= LOW ? "text-amber-800" : ""}
    />
  );

  function replaceVariant(productId: number, v: AdminVariant) {
    setProducts((ps) => ps?.map((p) => (p.id === productId ? { ...p, variants: p.variants.map((x) => (x.sku === v.sku ? v : x)) } : p)) ?? null);
  }

  async function toggleVisibility(p: AdminProduct) {
    const updated = await adminFetch<AdminProduct>(`/products/${p.id}/visibility?is_active=${!p.is_active}`, { method: "PATCH" });
    setProducts((ps) => ps?.map((x) => (x.id === p.id ? updated : x)) ?? null);
    notify(updated.is_active ? `«${p.name}» visible en la tienda` : `«${p.name}» oculto`);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Productos</h1>
          {products && <p className="text-sm text-stone-500">{products.length} productos · editá precio y stock directo en la tabla</p>}
        </div>
        <Link href="/admin/productos/nuevo" className="flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-900">
          <Plus size={16} /> Nuevo producto
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Buscar</span>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input id="admin-search" type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, marca o SKU"
            className="h-11 w-full rounded-lg border border-stone-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-brand-600" />
        </label>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`min-h-10 rounded-full px-3.5 text-sm ${filter === f.key ? "bg-brand-700 text-white" : "bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {!products ? (
        <p className="text-stone-500">Cargando productos…</p>
      ) : visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-stone-500">No hay productos con ese filtro.</p>
      ) : narrow ? (
        /* Celular: una tarjeta por producto, precio y stock uno al lado del otro */
        <ul className="space-y-3">
          {visible.map((p) => (
            <li key={p.id} className="rounded-xl bg-white p-4 shadow-[0_1px_0_var(--color-stone-200)]">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-stone-900">{p.name}</p>
                  <p className="text-sm text-stone-500">
                    {[p.brand, p.category_id ? cats.get(p.category_id) : null].filter(Boolean).join(" · ")}
                  </p>
                  {!p.is_active && <span className="mt-1 inline-block rounded bg-stone-200 px-1.5 py-0.5 text-xs font-medium text-stone-700">Oculto</span>}
                </div>
                <VisibilityButton p={p} onToggle={toggleVisibility} />
                <Link href={`/admin/productos/${p.id}`} aria-label={`Editar ${p.name}`} className="grid size-11 place-items-center rounded-lg text-stone-500 hover:bg-stone-100">
                  <Pencil size={18} />
                </Link>
              </div>
              <div className="mt-3 divide-y divide-stone-100">
                {p.variants.map((v) => (
                  <div key={v.sku} className={`grid grid-cols-[minmax(0,1fr)_7rem_6rem] items-center gap-2 py-2 ${!v.is_active ? "text-stone-400" : ""} ${v.stock != null && v.stock <= LOW ? "-mx-2 rounded-lg bg-amber-50 px-2" : ""}`}>
                    <div className="min-w-0">
                      <p className="text-stone-800">{v.label}</p>
                      <p className="truncate text-xs text-stone-400">{v.sku}{!v.is_active && " · inactiva"}</p>
                    </div>
                    <label className="text-xs text-stone-500">
                      Precio $
                      {priceField(p, v)}
                    </label>
                    <label className="text-xs text-stone-500">
                      Stock
                      {stockField(p, v)}
                    </label>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-[0_1px_0_var(--color-stone-200)]">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Producto</th>
                <th className="px-2 py-2.5 font-medium">Presentación</th>
                <th className="px-2 py-2.5 font-medium">Precio ($)</th>
                <th className="px-2 py-2.5 font-medium">Stock</th>
                <th className="px-4 py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) =>
                p.variants.map((v, i) => (
                  <tr key={v.sku} className={`${i === 0 ? "border-t border-stone-200" : ""} ${!p.is_active || !v.is_active ? "text-stone-400" : ""} ${v.stock != null && v.stock <= LOW ? "bg-amber-50" : ""}`}>
                    {i === 0 && (
                      <td rowSpan={p.variants.length} className="px-4 py-2 align-top">
                        <p className="font-medium text-stone-900">{p.name}</p>
                        <p className="text-xs text-stone-500">
                          {[p.brand, p.category_id ? cats.get(p.category_id) : null].filter(Boolean).join(" · ")}
                        </p>
                        {!p.is_active && <span className="mt-1 inline-block rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-medium text-stone-700">Oculto</span>}
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <span className="text-stone-700">{v.label}</span>
                      <span className="block text-[11px] text-stone-400">{v.sku}{!v.is_active && " · inactiva"}</span>
                    </td>
                    <td className="px-2 py-2">{priceField(p, v)}</td>
                    <td className="px-2 py-2">{stockField(p, v)}</td>
                    {i === 0 && (
                      <td rowSpan={p.variants.length} className="px-4 py-2 text-right align-top">
                        <div className="inline-flex gap-1">
                          <VisibilityButton p={p} onToggle={toggleVisibility} />
                          <Link href={`/admin/productos/${p.id}`} aria-label={`Editar ${p.name}`} className="grid size-11 place-items-center rounded-lg text-stone-500 hover:bg-stone-100">
                            <Pencil size={17} />
                          </Link>
                        </div>
                      </td>
                    )}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

/** Input que guarda al salir o con Enter; Escape deshace. Marca error en rojo si falla. */
function InlineField<T>({
  id, initial, parse, onSave, width, placeholder, tone = "", inputMode = "decimal",
}: {
  inputMode?: "decimal" | "numeric";
  id: string;
  initial: string;
  parse: (s: string) => T;
  onSave: (value: T) => Promise<void>;
  width: string;
  placeholder?: string;
  tone?: string;
}) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  useEffect(() => setValue(initial), [initial]);

  async function commit() {
    if (value === initial) return;
    setState("saving");
    try {
      await onSave(parse(value));
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <input
      id={id}
      inputMode={inputMode}
      enterKeyHint="done"
      value={value}
      placeholder={placeholder}
      onChange={(e) => { setValue(e.target.value); setState("idle"); }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") { setValue(initial); setState("idle"); }
      }}
      aria-invalid={state === "error"}
      className={`${width} mt-0.5 h-11 rounded-md border px-2 tabular-nums outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-100 ${
        state === "error" ? "border-red-500 bg-red-50" : state === "saving" ? "border-stone-200 opacity-60" : "border-stone-200 pointer-fine:border-transparent pointer-fine:hover:border-stone-300"} ${tone}`}
    />
  );
}

function VisibilityButton({ p, onToggle }: { p: AdminProduct; onToggle: (p: AdminProduct) => void }) {
  return (
    <button onClick={() => onToggle(p)} title={p.is_active ? "Ocultar de la tienda" : "Mostrar en la tienda"}
      aria-label={p.is_active ? `Ocultar ${p.name}` : `Mostrar ${p.name}`}
      className="grid size-11 place-items-center rounded-lg text-stone-500 hover:bg-stone-100">
      {p.is_active ? <Eye size={18} /> : <EyeOff size={18} />}
    </button>
  );
}
