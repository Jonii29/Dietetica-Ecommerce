/**
 * Cliente del panel de gestión. Llama a /api/admin/* en el mismo dominio (ver rewrites en
 * next.config.ts) con la cookie de sesión. Si la sesión venció, manda al login.
 */
import type { Tag } from "./types";

export class AdminError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api/admin${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: isForm ? init.headers : { "Content-Type": "application/json", ...init.headers },
  });
  if (res.status === 401 && !path.startsWith("/login")) {
    window.location.href = `/admin/login?next=${encodeURIComponent(window.location.pathname)}`;
    throw new AdminError("Sesión vencida", 401);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const detail = Array.isArray(body.detail)
      ? body.detail.map((d: { msg: string }) => d.msg).join(" · ")
      : body.detail;
    throw new AdminError(detail || `Error ${res.status}`, res.status);
  }
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && !path.startsWith("/login") && !path.startsWith("/logout") && !path.includes("dry_run=true")) {
    // Refrescar el catálogo cacheado de la tienda (no bloquea)
    fetch("/revalidate-catalog", { method: "POST", credentials: "same-origin" }).catch(() => {});
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// ---------- Dinero: el panel muestra pesos, la API usa centavos ----------

/** "1.234,50" | "1234.5" | "1234" -> 123450. Devuelve null si no es un número válido. */
export function pesosToCents(input: string): number | null {
  let s = input.trim().replace(/[$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** 123450 -> "1234,5"; 120000 -> "1200" (para inputs editables). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toString().replace(".", ",");
}

// ---------- Tipos ----------

export interface AdminVariant {
  id?: number;
  sku: string;
  label: string;
  sale_type: "peso" | "unidad";
  quantity: number;
  unit: "g" | "ml" | "u";
  price: number;
  compare_at_price: number | null;
  stock: number | null;
  is_active: boolean;
}

export interface AdminProduct {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  description: string | null;
  image_url: string | null;
  category_id: number | null;
  synonyms: string | null;
  is_active: boolean;
  tags: Tag[];
  variants: AdminVariant[];
  updated_at: string | null;
}

export interface AdminCategory {
  id: number;
  name: string;
  slug: string;
  parent_id: number | null;
  products: number;
}

export type OrderStatus = "pending" | "awaiting_payment" | "paid" | "payment_failed" | "cancelled" | "fulfilled";

export interface AdminOrder {
  code: string;
  status: OrderStatus;
  channel: "whatsapp" | "mercadopago";
  customer_name: string;
  customer_phone: string | null;
  delivery_method: "retiro" | "envio";
  address: string | null;
  notes: string | null;
  total: number;
  mp_payment_id: string | null;
  stock_applied: boolean;
  items: { sku: string; product_name: string; variant_label: string; unit_price: number; quantity: number; subtotal: number }[];
  created_at: string | null;
  updated_at: string | null;
}

export interface Stats {
  days: number;
  sales_today: number;
  sales_period: number;
  orders_period: number;
  avg_ticket: number;
  pending_orders: number;
  series: { date: string; total: number; orders: number }[];
  top_products: { name: string; units: number; revenue: number }[];
  low_stock: { product_id: number; product_name: string; sku: string; label: string; stock: number }[];
  low_stock_threshold: number;
  active_products: number;
  hidden_products: number;
}

export interface ImportReport {
  dry_run: boolean;
  rows: number;
  products_created: number;
  products_updated: number;
  variants_created: number;
  variants_updated: number;
  variants_deactivated: number;
  errors: { line: number | null; sku: string | null; error: string }[];
  detected?: ImportDetected | null;
  sample?: Record<string, string>[];
}

export interface ImportDetected {
  sheets: string[];
  header_row: number | null;
  notes: string[];
  skipped: number;
  columns: { index: number; header: string; field: string | null; examples: string[] }[];
  fields: Record<string, string>;
}

export const STATUS: Record<OrderStatus, { label: string; tone: string }> = {
  pending: { label: "A confirmar", tone: "bg-amber-100 text-amber-900 ring-amber-300" },
  awaiting_payment: { label: "Esperando pago", tone: "bg-sky-100 text-sky-900 ring-sky-300" },
  paid: { label: "Pagado", tone: "bg-emerald-100 text-emerald-900 ring-emerald-300" },
  fulfilled: { label: "Entregado", tone: "bg-stone-200 text-stone-800 ring-stone-300" },
  payment_failed: { label: "Pago rechazado", tone: "bg-red-100 text-red-900 ring-red-300" },
  cancelled: { label: "Cancelado", tone: "bg-red-50 text-red-800 ring-red-200" },
};

export function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  // SQLite devuelve UTC sin zona: se agrega "Z" para que el navegador convierta a hora local
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
