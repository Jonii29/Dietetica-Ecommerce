"use client";
/**
 * Pedidos: pestañas por estado, búsqueda, detalle desplegable y cambio de estado.
 * Se actualiza solo cada 30 segundos para ver los pedidos nuevos.
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, MessageCircle, RefreshCw, Search } from "lucide-react";
import { adminFetch, formatDateTime, STATUS, type AdminOrder, type OrderStatus } from "@/lib/admin";
import { formatARS } from "@/lib/format";

const TABS: { key: OrderStatus | "all"; label: string }[] = [
  { key: "pending", label: "A confirmar" },
  { key: "awaiting_payment", label: "Esperando pago" },
  { key: "paid", label: "Pagados" },
  { key: "fulfilled", label: "Entregados" },
  { key: "cancelled", label: "Cancelados" },
  { key: "all", label: "Todos" },
];

/** Acciones que tienen sentido según el estado actual. */
const NEXT: Record<OrderStatus, { to: OrderStatus; label: string; primary?: boolean }[]> = {
  pending: [{ to: "paid", label: "Confirmar como pagado", primary: true }, { to: "cancelled", label: "Cancelar" }],
  awaiting_payment: [{ to: "paid", label: "Marcar pagado" }, { to: "cancelled", label: "Cancelar" }],
  paid: [{ to: "fulfilled", label: "Marcar entregado", primary: true }, { to: "cancelled", label: "Cancelar y devolver stock" }],
  fulfilled: [{ to: "paid", label: "Volver a pagado" }],
  payment_failed: [{ to: "pending", label: "Reabrir" }, { to: "cancelled", label: "Cancelar" }],
  cancelled: [{ to: "pending", label: "Reabrir" }],
};

interface Page {
  items: AdminOrder[];
  total: number;
  page: number;
  pages: number;
  counts: Record<string, number>;
}

export default function OrdersPage() {
  const [tab, setTab] = useState<OrderStatus | "all">("pending");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get("estado");
    if (s && TABS.some((t) => t.key === s)) setTab(s as OrderStatus);
  }, []);

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page) });
    if (tab !== "all") p.set("status", tab);
    if (q.trim()) p.set("q", q.trim());
    try {
      setData(await adminFetch<Page>(`/orders?${p}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar los pedidos");
    }
  }, [tab, q, page]);

  useEffect(() => {
    const t = window.setTimeout(load, q ? 250 : 0); // pequeña espera al tipear
    const i = window.setInterval(load, 30_000);
    return () => { window.clearTimeout(t); window.clearInterval(i); };
  }, [load, q]);

  async function changeStatus(order: AdminOrder, to: OrderStatus) {
    setBusy(order.code);
    try {
      await adminFetch(`/orders/${order.code}`, { method: "PATCH", body: JSON.stringify({ status: to }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar");
    } finally {
      setBusy(null);
    }
  }

  const totalAll = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Pedidos</h1>
        <button onClick={load} className="flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-stone-600 hover:bg-stone-200">
          <RefreshCw size={15} /> Actualizar
        </button>
      </header>

      <div className="flex gap-1 overflow-x-auto border-b border-stone-200">
        {TABS.map((t) => {
          const n = t.key === "all" ? totalAll : data?.counts[t.key] ?? 0;
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(1); setOpen(null); }} aria-pressed={tab === t.key}
              className={`-mb-px flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm ${
                tab === t.key ? "border-brand-700 font-semibold text-brand-900" : "border-transparent text-stone-600 hover:text-stone-900"}`}>
              {t.label}
              {n > 0 && <span className="rounded-full bg-stone-200 px-1.5 text-xs tabular-nums text-stone-700">{n}</span>}
            </button>
          );
        })}
      </div>

      <label className="relative block max-w-md">
        <span className="sr-only">Buscar pedido</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input id="order-search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Código, nombre o teléfono"
          className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-brand-600" />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      {!data ? <p className="text-stone-500">Cargando pedidos…</p> : data.items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-stone-500">No hay pedidos en esta pestaña.</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((o) => {
            const expanded = open === o.code;
            const st = STATUS[o.status];
            const phone = o.customer_phone?.replace(/\D/g, "");
            return (
              <li key={o.code} className="rounded-xl bg-white shadow-[0_1px_0_var(--color-stone-200)]">
                <button onClick={() => setOpen(expanded ? null : o.code)} aria-expanded={expanded}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left">
                  <span className="font-mono text-sm font-semibold">{o.code}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${st.tone}`}>{st.label}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{o.customer_name}</span>
                  <span className="text-xs text-stone-500">{o.channel === "whatsapp" ? "WhatsApp" : "Mercado Pago"} · {formatDateTime(o.created_at)}</span>
                  <span className="font-semibold tabular-nums">{formatARS(o.total)}</span>
                  <ChevronDown size={16} className={`text-stone-400 transition ${expanded ? "rotate-180" : ""}`} />
                </button>
                {expanded && (
                  <div className="space-y-3 border-t border-stone-100 px-4 py-3 text-sm">
                    <ul className="space-y-1">
                      {o.items.map((it) => (
                        <li key={it.sku} className="flex justify-between gap-3">
                          <span>{it.quantity} × {it.product_name} <span className="text-stone-500">({it.variant_label})</span></span>
                          <span className="tabular-nums">{formatARS(it.subtotal)}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="grid gap-1 text-stone-600 sm:grid-cols-2">
                      <p>{o.delivery_method === "envio" ? `Envío a: ${o.address ?? "(a coordinar)"}` : "Retira en el local"}</p>
                      {o.customer_phone && <p>Tel.: {o.customer_phone}</p>}
                      {o.notes && <p className="sm:col-span-2">Nota: {o.notes}</p>}
                      {o.mp_payment_id && <p>Pago MP n.º {o.mp_payment_id}</p>}
                      <p className="text-xs text-stone-500 sm:col-span-2">
                        {o.stock_applied ? "El stock de este pedido ya está descontado." : "El stock se descuenta al marcarlo pagado o entregado."}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {NEXT[o.status].map((a) => (
                        <button key={a.to} disabled={busy === o.code} onClick={() => changeStatus(o, a.to)}
                          className={`min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 ${
                            a.primary ? "bg-brand-700 text-white hover:bg-brand-900"
                              : a.to === "cancelled" ? "text-red-700 ring-1 ring-red-200 hover:bg-red-50"
                              : "ring-1 ring-stone-300 hover:bg-stone-50"}`}>
                          {a.label}
                        </button>
                      ))}
                      {phone && (
                        <a href={`https://wa.me/${phone}?text=${encodeURIComponent(`Hola ${o.customer_name}, te escribimos por tu pedido ${o.code}.`)}`}
                          target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-1.5 rounded-lg px-4 text-sm font-semibold text-[#0E6E5C] ring-1 ring-[#25D366]/50 hover:bg-[#25D366]/10">
                          <MessageCircle size={15} /> Escribirle
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {data && data.pages > 1 && (
        <nav className="flex items-center justify-center gap-2 text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="min-h-11 rounded-lg px-4 ring-1 ring-stone-300 disabled:opacity-40">Anterior</button>
          <span className="tabular-nums text-stone-600">Página {data.page} de {data.pages}</span>
          <button disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} className="min-h-11 rounded-lg px-4 ring-1 ring-stone-300 disabled:opacity-40">Siguiente</button>
        </nav>
      )}
    </div>
  );
}
