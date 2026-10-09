/**
 * Formateador de pedidos para WhatsApp.
 *
 * Toma el estado del carrito y construye https://wa.me/<numero>?text=<mensaje-codificado>.
 * Funciones puras: fáciles de testear y reutilizables en server o client.
 */
import { formatARS } from "./format";
import type { CartLine, CustomerInfo } from "./types";

export interface WhatsAppOrderOptions {
  storeName: string;
  orderCode?: string; // código devuelto por el backend (si se registró el pedido)
  customer?: CustomerInfo;
}

export function cartTotals(lines: CartLine[]) {
  const total = lines.reduce((acc, l) => acc + l.unitPrice * l.quantity, 0);
  const units = lines.reduce((acc, l) => acc + l.quantity, 0);
  return { total, units };
}

export function buildWhatsAppMessage(lines: CartLine[], opts: WhatsAppOrderOptions): string {
  if (lines.length === 0) throw new Error("El carrito está vacío");

  // Orden estable y legible: alfabético por producto y luego por presentación
  const sorted = [...lines].sort(
    (a, b) => a.name.localeCompare(b.name, "es") || a.unitPrice - b.unitPrice,
  );
  const { total, units } = cartTotals(sorted);
  const c = opts.customer;

  const out: string[] = [`🛒 *Nuevo pedido — ${opts.storeName}*`];
  if (opts.orderCode) out.push(`Pedido: *${opts.orderCode}*`);
  out.push("");

  for (const l of sorted) {
    out.push(`• ${l.quantity} × ${l.name} (${l.label})`);
    out.push(`   ${formatARS(l.unitPrice)} c/u → *${formatARS(l.unitPrice * l.quantity)}*`);
  }

  out.push("", `Artículos: ${units}`, `*TOTAL: ${formatARS(total)}*`);

  if (c) {
    out.push("", `👤 ${c.name}`);
    if (c.phone) out.push(`📞 ${c.phone}`);
    out.push(c.delivery_method === "envio" ? `🚚 Envío a: ${c.address || "(a coordinar)"}` : "🏪 Retiro en el local");
    if (c.notes?.trim()) out.push(`📝 ${c.notes.trim()}`);
  }
  return out.join("\n");
}

/** Solo dígitos: "+54 9 11 1234-5678" -> "5491112345678". */
export function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = sanitizePhone(phone);
  if (digits.length < 8) throw new Error("Número de WhatsApp inválido");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/** Atajo: carrito -> URL lista para abrir. */
export function cartToWhatsAppUrl(phone: string, lines: CartLine[], opts: WhatsAppOrderOptions): string {
  return buildWhatsAppUrl(phone, buildWhatsAppMessage(lines, opts));
}
