"use client";
/**
 * Barras de ventas por día (una sola serie → sin leyenda; el título la nombra).
 * Barras finas con borde superior redondeado, grilla tenue, tooltip al pasar el mouse
 * y una tabla accesible para lectores de pantalla.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { formatARS } from "@/lib/format";

interface Point {
  date: string;
  total: number;
  orders: number;
}

const H = 180; // alto del área de dibujo (px del viewBox)
const PAD_L = 52;
const PAD_B = 22;

function niceMax(v: number): number {
  if (v <= 0) return 100_00; // $100 para que el eje no quede vacío
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
}

function shortARS(cents: number): string {
  const p = cents / 100;
  if (p >= 1_000_000) return `$${(p / 1_000_000).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
  if (p >= 1_000) return `$${(p / 1_000).toLocaleString("es-AR", { maximumFractionDigits: 0 })} mil`;
  return `$${p.toLocaleString("es-AR")}`;
}

function dayLabel(iso: string, long = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return long
    ? date.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })
    : date.toLocaleDateString("es-AR", { day: "numeric", month: "numeric" });
}

export function SalesChart({ series }: { series: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // El viewBox usa el ancho real del contenedor: 1 unidad = 1 px, así el texto no se achica en el celular
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const max = useMemo(() => niceMax(Math.max(...series.map((p) => p.total))), [series]);
  const step = (width - PAD_L) / series.length;
  const barW = Math.max(2, Math.min(18, step - 2));
  const y = (v: number) => H - (v / max) * H;
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.ceil(series.length / Math.max(3, Math.floor((width - PAD_L) / 56)));
  const h = hover != null ? series[hover] : null;

  return (
    <figure className="relative">
      <div ref={boxRef}>
        <svg viewBox={`0 0 ${width} ${H + PAD_B + 8}`} width={width} height={H + PAD_B + 8} className="block max-w-full" role="img"
          aria-label="Ventas confirmadas por día" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={width} y1={y(t) + 4} y2={y(t) + 4} stroke="var(--color-stone-200)" strokeWidth={1} />
              <text x={PAD_L - 8} y={y(t) + 8} textAnchor="end" fontSize={10} fill="var(--color-stone-500)">{shortARS(t)}</text>
            </g>
          ))}
          {series.map((p, i) => {
            const x = PAD_L + i * step + (step - barW) / 2;
            const top = y(p.total) + 4;
            const hgt = Math.max(0, H + 4 - top);
            const r = Math.min(4, barW / 2, hgt);
            return (
              <g key={p.date} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                aria-label={`${dayLabel(p.date, true)}: ${formatARS(p.total)}, ${p.orders} pedidos`}>
                {/* zona de hover más grande que la barra */}
                <rect x={PAD_L + i * step} y={0} width={step} height={H + 4} fill="transparent" />
                {hgt > 0 && (
                  <path
                    d={`M${x},${H + 4} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${H + 4} Z`}
                    fill={hover === i ? "var(--color-brand-900)" : "var(--color-brand-600)"}
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H + PAD_B} textAnchor="middle" fontSize={10} fill="var(--color-stone-500)">{dayLabel(p.date)}</text>
                )}
              </g>
            );
          })}
          <line x1={PAD_L} x2={width} y1={H + 4} y2={H + 4} stroke="var(--color-stone-400)" strokeWidth={1} />
        </svg>
      </div>
      {h && (
        <div className="pointer-events-none absolute right-2 top-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-md">
          <p className="font-medium text-stone-600 first-letter:uppercase">{dayLabel(h.date, true)}</p>
          <p className="text-sm font-bold tabular-nums text-stone-900">{formatARS(h.total)}</p>
          <p className="text-stone-500">{h.orders} {h.orders === 1 ? "pedido" : "pedidos"}</p>
        </div>
      )}
      <div className="sr-only">
      <table>
        <caption>Ventas por día</caption>
        <tbody>
          {series.map((p) => (
            <tr key={p.date}><td>{p.date}</td><td>{formatARS(p.total)}</td><td>{p.orders}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}
