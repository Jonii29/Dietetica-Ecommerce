"use client";
/**
 * Formulario de alta / edición de producto con sus presentaciones (250 g, 500 g, 1 kg…).
 * Los precios se escriben en pesos y se mandan en centavos.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  adminFetch, centsToInput, pesosToCents, type AdminCategory, type AdminProduct,
} from "@/lib/admin";
import type { Tag } from "@/lib/types";

interface VariantRow {
  key: string;
  sku: string;
  label: string;
  sale_type: "peso" | "unidad";
  quantity: string;
  unit: "g" | "ml" | "u";
  price: string;
  compare_at_price: string;
  stock: string;
  is_active: boolean;
}

const emptyVariant = (): VariantRow => ({
  key: Math.random().toString(36).slice(2), sku: "", label: "", sale_type: "peso", quantity: "500",
  unit: "g", price: "", compare_at_price: "", stock: "", is_active: true,
});

/** Etiqueta sugerida a partir del contenido: 1000 g -> "1 kg" */
function suggestLabel(quantity: string, unit: string): string {
  const n = Number(quantity);
  if (!n) return "";
  if (unit === "g") return n >= 1000 ? `${n / 1000} kg` : `${n} g`;
  if (unit === "ml") return n >= 1000 ? `${n / 1000} L` : `${n} ml`;
  return n === 1 ? "Unidad" : `${n} u`;
}

const input = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100";

export function ProductForm({ product }: { product?: AdminProduct }) {
  const router = useRouter();
  const [cats, setCats] = useState<AdminCategory[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState(product?.name ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [categoryId, setCategoryId] = useState<string>(product?.category_id ? String(product.category_id) : "");
  const [newCategory, setNewCategory] = useState("");
  const [description, setDescription] = useState(product?.description ?? "");
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "");
  const [synonyms, setSynonyms] = useState(product?.synonyms ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(product?.tags.map((t) => t.slug) ?? []);
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [variants, setVariants] = useState<VariantRow[]>(
    product?.variants.map((v) => ({
      key: v.sku, sku: v.sku, label: v.label, sale_type: v.sale_type, quantity: String(v.quantity), unit: v.unit,
      price: centsToInput(v.price), compare_at_price: centsToInput(v.compare_at_price),
      stock: v.stock == null ? "" : String(v.stock), is_active: v.is_active,
    })) ?? [emptyVariant()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminFetch<AdminCategory[]>("/categories").then(setCats);
    adminFetch<Tag[]>("/tags").then(setTags);
  }, []);

  const updateVariant = (key: string, patch: Partial<VariantRow>) =>
    setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payloadVariants = [];
    for (const [i, v] of variants.entries()) {
      const n = i + 1;
      const price = pesosToCents(v.price);
      if (!v.sku.trim()) return setError(`Presentación ${n}: falta el SKU.`);
      if (price == null) return setError(`Presentación ${n}: el precio no es válido.`);
      if (!Number(v.quantity)) return setError(`Presentación ${n}: el contenido tiene que ser un número.`);
      if (v.stock.trim() && !/^\d+$/.test(v.stock.trim())) return setError(`Presentación ${n}: el stock tiene que ser un número entero.`);
      payloadVariants.push({
        sku: v.sku.trim(), label: v.label.trim() || suggestLabel(v.quantity, v.unit), sale_type: v.sale_type,
        quantity: Number(v.quantity), unit: v.unit, price,
        compare_at_price: v.compare_at_price.trim() ? pesosToCents(v.compare_at_price) : null,
        stock: v.stock.trim() ? Number(v.stock) : null, is_active: v.is_active,
      });
    }
    const body = {
      name, brand, description, image_url: imageUrl, synonyms, is_active: isActive, tags: selectedTags,
      category_id: categoryId && categoryId !== "new" ? Number(categoryId) : null,
      new_category: categoryId === "new" ? newCategory : null,
      variants: payloadVariants,
    };
    setSaving(true);
    try {
      const saved = await adminFetch<AdminProduct>(product ? `/products/${product.id}` : "/products", {
        method: product ? "PUT" : "POST", body: JSON.stringify(body),
      });
      router.push(`/admin/productos?guardado=${encodeURIComponent(saved.name)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
      setSaving(false);
    }
  }

  const roots = cats.filter((c) => c.parent_id === null);
  const children = (id: number) => cats.filter((c) => c.parent_id === id);

  return (
    <form onSubmit={save} className="space-y-6">
      <section className="grid gap-4 rounded-xl bg-white shadow-[0_1px_0_var(--color-stone-200)] p-4 md:grid-cols-2">
        <label className="text-sm font-medium md:col-span-2">
          Nombre *
          <input id="p-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} className={`mt-1 ${input}`} placeholder="Almendras peladas" />
        </label>
        <label className="text-sm font-medium">
          Marca
          <input id="p-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={`mt-1 ${input}`} placeholder="Opcional" />
        </label>
        <label className="text-sm font-medium">
          Categoría
          <select id="p-category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`mt-1 ${input}`}>
            <option value="">Sin categoría</option>
            {roots.map((c) => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name}</option>
                {children(c.id).map((s) => <option key={s.id} value={s.id}>{c.name} › {s.name}</option>)}
              </optgroup>
            ))}
            <option value="new">+ Nueva categoría…</option>
          </select>
        </label>
        {categoryId === "new" && (
          <label className="text-sm font-medium md:col-span-2">
            Nombre de la nueva categoría
            <input id="p-new-category" required value={newCategory} onChange={(e) => setNewCategory(e.target.value)} className={`mt-1 ${input}`} />
          </label>
        )}
        <fieldset className="md:col-span-2">
          <legend className="text-sm font-medium">Etiquetas</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {tags.map((t) => {
              const on = selectedTags.includes(t.slug);
              return (
                <button type="button" key={t.slug} aria-pressed={on}
                  onClick={() => setSelectedTags((s) => (on ? s.filter((x) => x !== t.slug) : [...s, t.slug]))}
                  className={`min-h-11 rounded-full px-4 text-sm ring-1 ${on ? "bg-brand-700 text-white ring-brand-700" : "bg-white text-stone-700 ring-stone-300 hover:bg-stone-50"}`}>
                  {t.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        <label className="text-sm font-medium md:col-span-2">
          Descripción
          <textarea id="p-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="text-sm font-medium">
          URL de la imagen
          <input id="p-image" type="url" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className={`mt-1 ${input}`} placeholder="https://…" />
        </label>
        <label className="text-sm font-medium">
          Sinónimos para la búsqueda
          <input id="p-synonyms" value={synonyms} onChange={(e) => setSynonyms(e.target.value)} className={`mt-1 ${input}`} placeholder="almendra|almonds" />
          <span className="mt-1 block text-xs font-normal text-stone-500">Separados por |. Ayudan a que lo encuentren escribiendo distinto.</span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium md:col-span-2">
          <input id="p-active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-5 accent-brand-700" />
          Visible en la tienda
        </label>
      </section>

      <section className="space-y-3 rounded-xl bg-white shadow-[0_1px_0_var(--color-stone-200)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Presentaciones</h2>
          <button type="button" onClick={() => setVariants((v) => [...v, emptyVariant()])}
            className="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">
            <Plus size={16} /> Agregar
          </button>
        </div>
        <p className="text-xs text-stone-500">Precios en pesos (ej. 4.250 o 4250,50). Stock vacío = no se controla.</p>
        {variants.map((v, i) => (
          <div key={v.key} className="grid grid-cols-2 gap-2 rounded-xl border border-stone-200 p-3 sm:grid-cols-4 lg:grid-cols-8">
            <Field label="SKU *"><input id={`v-sku-${i}`} value={v.sku} onChange={(e) => updateVariant(v.key, { sku: e.target.value.toUpperCase() })} className={input} placeholder="ALM-500" /></Field>
            <Field label="Venta">
              <select id={`v-type-${i}`} value={v.sale_type} onChange={(e) => updateVariant(v.key, { sale_type: e.target.value as VariantRow["sale_type"] })} className={input}>
                <option value="peso">Por peso</option><option value="unidad">Por unidad</option>
              </select>
            </Field>
            <Field label="Contenido">
              <div className="flex gap-1">
                <input id={`v-qty-${i}`} inputMode="numeric" value={v.quantity} onChange={(e) => updateVariant(v.key, { quantity: e.target.value })} className={`${input} min-w-0`} />
                <select id={`v-unit-${i}`} aria-label="Unidad" value={v.unit} onChange={(e) => updateVariant(v.key, { unit: e.target.value as VariantRow["unit"] })} className="rounded-lg border border-stone-300 px-1 text-sm">
                  <option value="g">g</option><option value="ml">ml</option><option value="u">u</option>
                </select>
              </div>
            </Field>
            <Field label="Etiqueta"><input id={`v-label-${i}`} value={v.label} onChange={(e) => updateVariant(v.key, { label: e.target.value })} className={input} placeholder={suggestLabel(v.quantity, v.unit)} /></Field>
            <Field label="Precio *"><input id={`v-price-${i}`} inputMode="decimal" value={v.price} onChange={(e) => updateVariant(v.key, { price: e.target.value })} className={input} /></Field>
            <Field label="Precio tachado"><input id={`v-compare-${i}`} inputMode="decimal" value={v.compare_at_price} onChange={(e) => updateVariant(v.key, { compare_at_price: e.target.value })} className={input} placeholder="Oferta" /></Field>
            <Field label="Stock"><input id={`v-stock-${i}`} inputMode="numeric" value={v.stock} onChange={(e) => updateVariant(v.key, { stock: e.target.value })} className={input} placeholder="—" /></Field>
            <div className="flex items-end justify-between gap-2">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input id={`v-active-${i}`} type="checkbox" checked={v.is_active} onChange={(e) => updateVariant(v.key, { is_active: e.target.checked })} className="size-5 accent-brand-700" />
                Activa
              </label>
              <button type="button" disabled={variants.length === 1} aria-label="Quitar presentación"
                onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))}
                className="grid size-11 shrink-0 place-items-center rounded-lg text-stone-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30">
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} className="rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-900 disabled:opacity-60">
          {saving ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}
        </button>
        <button type="button" onClick={() => router.back()} className="rounded-lg px-4 py-2.5 text-stone-600 hover:bg-stone-200">Cancelar</button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 text-xs font-medium text-stone-600">
      <span className="mb-1 block">{label}</span>
      {children}
    </div>
  );
}
