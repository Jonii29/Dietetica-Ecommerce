"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { SalesChart } from "@/components/admin/SalesChart";
import { adminFetch, type Stats } from "@/lib/admin";
import { formatARS } from "@/lib/format";

const RANGES = [7, 30, 90] as const;

export default function DashboardPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<Stats>(`/stats?days=${days}`).then(setStats).catch((e) => setError(e.message));
  }, [days]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!stats) return <p className="text-stone-500">Cargando resumen…</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Resumen</h1>
          <p className="text-sm text-stone-500">Ventas confirmadas = pedidos pagados o entregados.</p>
        </div>
        <div role="group" aria-label="Período" className="flex rounded-lg border border-stone-300 bg-white p-0.5 text-sm">
          {RANGES.map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d}
              className={`min-h-10 rounded-md px-3.5 ${days === d ? "bg-brand-700 font-semibold text-white" : "text-stone-600 hover:bg-stone-100"}`}>
              {d} días
            </button>
          ))}
        </div>
      </header>

      {stats.pending_orders > 0 && (
        <Link href="/admin/pedidos?estado=pending"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900 hover:bg-amber-100">
          <span className="flex items-center gap-2 text-sm font-medium">
            <AlertTriangle size={18} aria-hidden />
            {stats.pending_orders} {stats.pending_orders === 1 ? "pedido espera" : "pedidos esperan"} confirmación o pago
          </span>
          <ArrowRight size={18} aria-hidden />
        </Link>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Ventas de hoy" value={formatARS(stats.sales_today)} highlight />
        <Kpi label={`Ventas ${days} días`} value={formatARS(stats.sales_period)} />
        <Kpi label="Pedidos vendidos" value={String(stats.orders_period)} />
        <Kpi label="Ticket promedio" value={stats.orders_period ? formatARS(stats.avg_ticket) : "—"} />
      </section>

      <section className="rounded-xl bg-white p-4">
        <h2 className="mb-2 font-semibold">Ventas por día</h2>
        <SalesChart series={stats.series} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl bg-white p-4">
          <h2 className="mb-3 font-semibold">Más vendidos</h2>
          {stats.top_products.length === 0 ? (
            <p className="text-sm text-stone-500">Todavía no hay ventas confirmadas en este período.</p>
          ) : (
            <ol className="space-y-2">
              {stats.top_products.map((p) => {
                const pct = (p.revenue / stats.top_products[0].revenue) * 100;
                return (
                  <li key={p.name} className="text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 tabular-nums text-stone-600">{p.units} u · <strong className="text-stone-900">{formatARS(p.revenue)}</strong></span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-stone-100">
                      <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-xl bg-white p-4">
          <h2 className="mb-1 font-semibold">Stock bajo</h2>
          <p className="mb-3 text-xs text-stone-500">Presentaciones con {stats.low_stock_threshold} unidades o menos.</p>
          {stats.low_stock.length === 0 ? (
            <p className="text-sm text-stone-500">Todo en orden.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {stats.low_stock.map((v) => (
                <li key={v.sku} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/admin/productos/${v.product_id}`} className="flex min-h-11 min-w-0 items-center truncate hover:underline">
                    {v.product_name} <span className="text-stone-500">· {v.label}</span>
                  </Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 tabular-nums ${
                    v.stock === 0 ? "bg-red-100 text-red-900 ring-red-300" : "bg-amber-100 text-amber-900 ring-amber-300"}`}>
                    {v.stock === 0 ? "Sin stock" : `Quedan ${v.stock}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="text-xs text-stone-500">
        Catálogo: {stats.active_products} productos visibles · {stats.hidden_products} ocultos.
      </p>
    </div>
  );
}

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4">
      <p className="text-sm font-medium text-stone-600">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-condensed)] text-3xl font-bold tabular-nums md:text-4xl">
        <span className={highlight ? "bg-highlight px-1" : ""}>{value}</span>
      </p>
    </div>
  );
}
