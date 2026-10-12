import { backendUrl } from "./apiUrl";
import type { Catalog, CustomerInfo } from "./types";

// En el servidor se llama directo al backend; en el navegador, a /api del mismo dominio
// (next.config.ts lo reenvía). Así no hace falta CORS y la cookie del panel es del mismo sitio.
export const API_URL = typeof window === "undefined" ? backendUrl() : "";
export const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME ?? "Dietética";
export const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER ?? "";

/** Server Component: catálogo completo, cacheado 60 s en el servidor de Next (o hasta revalidateTag). */
export async function getCatalog(): Promise<Catalog> {
  // Si Render durmió el backend no esperamos acá (desde el servidor no se despierta): la
  // página muestra "Abriendo la tienda…" y el navegador lo despierta (ver WakeBackend).
  const { ensureBackendAwake } = await import("./backendWake");
  if (!(await ensureBackendAwake(6_000))) throw new Error("backend dormido");
  const res = await fetch(`${backendUrl()}/api/catalog`, {
    next: { revalidate: 60, tags: ["catalog"] },
    signal: AbortSignal.timeout(60_000), // en el plan gratis de Render el backend tarda ~50 s en despertar
  });
  if (!res.ok) throw new Error(`No se pudo cargar el catálogo (${res.status})`);
  return res.json();
}

export interface OrderResponse {
  order: {
    code: string;
    total: number;
    items: { sku: string; product_name: string; variant_label: string; unit_price: number; quantity: number }[];
  };
  warnings: string[];
  checkout_url: string | null;
  whatsapp_url: string | null;
}

export async function createOrder(
  channel: "whatsapp" | "mercadopago",
  customer: CustomerInfo,
  items: { sku: string; quantity: number }[],
): Promise<OrderResponse> {
  const res = await fetch(`${API_URL}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel, customer, items }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(typeof err.detail === "string" ? err.detail : "No pudimos registrar el pedido");
  }
  return res.json();
}
