"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { ProductForm } from "@/components/admin/ProductForm";
import { adminFetch, type AdminProduct } from "@/lib/admin";

export default function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [product, setProduct] = useState<AdminProduct | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    adminFetch<AdminProduct>(`/products/${id}`).then(setProduct).catch((e) => setError(e.message));
  }, [id]);

  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/admin/productos" className="text-sm text-stone-500 hover:underline">← Productos</Link>
      {error ? <p className="text-red-600">{error}</p> : !product ? <p className="text-stone-500">Cargando…</p> : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-bold">{product.name}</h1>
            {product.is_active && <a href={`/?q=${encodeURIComponent(product.name)}`} target="_blank" className="text-sm text-brand-700 hover:underline">Ver en la tienda ↗</a>}
          </div>
          <ProductForm product={product} />
        </>
      )}
    </div>
  );
}
