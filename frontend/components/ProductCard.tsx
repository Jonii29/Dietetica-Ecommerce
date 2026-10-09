"use client";
/**
 * Tarjeta de producto (diseño "Feria"): banda de color de su categoría con el precio grande,
 * selector de presentación (250 g / 500 g / 1 kg), cantidad y botón para agregar.
 */
import { memo, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { cart } from "@/lib/cart";
import { formatARS, pricePerBaseUnit } from "@/lib/format";
import type { CatalogProduct, Tag } from "@/lib/types";

interface Props {
  product: CatalogProduct;
  tagsBySlug: Map<string, Tag>;
  categoryName?: string;
  color: string;
  priority?: boolean;
}

function ProductCardImpl({ product, tagsBySlug, categoryName, color, priority }: Props) {
  const firstAvailable = product.variants.findIndex((v) => v.in_stock);
  const [idx, setIdx] = useState(firstAvailable === -1 ? 0 : firstAvailable);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const v = product.variants[idx];
  const dietary = product.tags
    .map((s) => tagsBySlug.get(s))
    .filter((t): t is Tag => t?.kind === "dietary")
    .map((t) => t.name);
  const perUnit = pricePerBaseUnit(v.price, v.quantity, v.unit);
  const discount = v.compare_at_price && v.compare_at_price > v.price
    ? Math.round(100 - (v.price / v.compare_at_price) * 100) : 0;

  function add() {
    cart.add({ sku: v.sku, slug: product.slug, name: product.name, label: v.label, unitPrice: v.price, image: product.image }, qty);
    setAdded(true);
    setQty(1);
    window.setTimeout(() => setAdded(false), 1200);
  }

  return (
    <article className="card-cv flex h-full flex-col overflow-hidden rounded-3xl border-2 border-ink bg-white">
      <div className="relative flex gap-3 px-4 py-4" style={{ background: color }}>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">{[categoryName, product.brand].filter(Boolean).join(" · ") || " "}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-[40px] font-extrabold leading-none tracking-tight tabular-nums">{formatARS(v.price)}</span>
          </p>
          <p className="mt-1 text-[13px]">
            {v.label}
            {perUnit && <> · {perUnit.replace(" / ", " el ")}</>}
          </p>
          {discount > 0 && (
            <p className="mt-1 text-[13px]">
              <span className="line-through">{formatARS(v.compare_at_price!)}</span>{" "}
              <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">-{discount}%</span>
            </p>
          )}
        </div>
        {product.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.image} alt="" width={88} height={88} loading={priority ? "eager" : "lazy"} decoding="async"
            className="size-[88px] shrink-0 rounded-2xl border-2 border-ink object-cover" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-4">
        <div>
          <h3 className="font-display text-2xl font-extrabold leading-[1.1]">{product.name}</h3>
          {dietary.length > 0 && <p className="mt-1 text-sm text-ink-soft">{dietary.join(" · ")}</p>}
        </div>

        {product.variants.length > 1 && (
          <div role="radiogroup" aria-label="Presentación" className="flex flex-wrap gap-1.5">
            {product.variants.map((variant, i) => (
              <button key={variant.sku} type="button" role="radio" aria-checked={i === idx}
                disabled={!variant.in_stock} onClick={() => setIdx(i)}
                className={`min-h-11 min-w-11 rounded-full px-3.5 text-sm font-bold transition-colors ${
                  i === idx ? "bg-ink text-white" : "bg-lilac text-ink hover:bg-lilac-200"
                } disabled:cursor-not-allowed disabled:line-through disabled:opacity-40`}>
                {variant.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-auto">
          {v.in_stock ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-full bg-lilac">
                <button type="button" aria-label="Restar" onClick={() => setQty((q) => Math.max(1, q - 1))} className="grid size-11 place-items-center rounded-full">
                  <Minus size={16} />
                </button>
                <span className="w-5 text-center font-bold tabular-nums" aria-live="polite">{qty}</span>
                <button type="button" aria-label="Sumar" onClick={() => setQty((q) => Math.min(99, q + 1))} className="grid size-11 place-items-center rounded-full">
                  <Plus size={16} />
                </button>
              </div>
              <button type="button" onClick={add}
                className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-ink px-4 text-[15px] font-bold text-white transition active:scale-[0.97]">
                {added && <Check size={16} />}
                {added ? "Agregado" : "Agregar"}
              </button>
            </div>
          ) : (
            <p className="rounded-full bg-lilac py-2.5 text-center text-sm font-bold text-ink-soft">Sin stock</p>
          )}
        </div>
      </div>
    </article>
  );
}

export const ProductCard = memo(ProductCardImpl);
