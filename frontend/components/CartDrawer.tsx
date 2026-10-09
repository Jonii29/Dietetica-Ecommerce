"use client";
/**
 * Panel del carrito (se abre con el botón del encabezado, evento "open-cart") con checkout por WhatsApp o Mercado Pago.
 *
 * Flujo WhatsApp: se registra el pedido en el backend (precios validados + código) y con esa
 * respuesta se arma el mensaje. Si la API no responde, igual se envía el pedido armado con los
 * datos del carrito (la venta no se pierde).
 */
import { useEffect, useRef, useState } from "react";
import { CreditCard, Minus, Plus, Trash2, X } from "lucide-react";
import { useCart } from "@/lib/cart";
import { createOrder, STORE_NAME, WHATSAPP_NUMBER, type OrderResponse } from "@/lib/api";
import { formatARS } from "@/lib/format";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "@/lib/whatsapp";
import type { CartLine, CustomerInfo } from "@/lib/types";

export function CartDrawer() {
  const { items, total, setQuantity, remove, clear } = useCart();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState<null | "whatsapp" | "mercadopago">(null);
  const [error, setError] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerInfo>({ name: "", delivery_method: "retiro" });

  // Recordar datos del cliente para la próxima compra
  useEffect(() => {
    try {
      const saved = localStorage.getItem("dietetica:customer");
      if (saved) setCustomer((c) => ({ ...c, ...JSON.parse(saved), notes: "" }));
    } catch {}
  }, []);

  const close = () => dialogRef.current?.close();

  // El botón del encabezado abre el carrito con un evento (así no comparten estado)
  useEffect(() => {
    const onOpen = () => dialogRef.current?.showModal();
    window.addEventListener("open-cart", onOpen);
    return () => window.removeEventListener("open-cart", onOpen);
  }, []);

  async function checkout(channel: "whatsapp" | "mercadopago") {
    setError(null);
    if (customer.name.trim().length < 2) return setError("Ingresá tu nombre.");
    if (customer.delivery_method === "envio" && !customer.address?.trim()) return setError("Ingresá la dirección de envío.");
    try {
      localStorage.setItem("dietetica:customer", JSON.stringify({ ...customer, notes: undefined }));
    } catch {}

    setBusy(channel);
    const payload = items.map((l) => ({ sku: l.sku, quantity: l.quantity }));
    let res: OrderResponse | null = null;
    try {
      res = await createOrder(channel, customer, payload);
    } catch (e) {
      if (channel === "mercadopago") {
        setError(e instanceof Error ? e.message : "No se pudo iniciar el pago");
        setBusy(null);
        return;
      }
      // WhatsApp sin servidor: se envía igual con los datos del carrito (la venta no se pierde)
    }

    if (channel === "mercadopago") {
      if (res?.checkout_url) window.location.href = res.checkout_url;
      else { setError("No se pudo iniciar el pago. Probá de nuevo o pedí por WhatsApp."); setBusy(null); }
      return;
    }

    // Con respuesta del servidor el mensaje lleva código y precios confirmados
    const lines: CartLine[] = res
      ? res.order.items.map((it) => ({
          sku: it.sku, slug: "", name: it.product_name, label: it.variant_label,
          unitPrice: it.unit_price, quantity: it.quantity, image: null,
        }))
      : items;
    const msg = buildWhatsAppMessage(lines, { storeName: STORE_NAME, orderCode: res?.order.code, customer });
    let url: string | null = null;
    try {
      url = buildWhatsAppUrl(WHATSAPP_NUMBER, msg);
    } catch {
      url = res?.whatsapp_url ?? null; // número no configurado en el frontend: usar el del servidor
    }
    if (!url) {
      setError("La tienda todavía no configuró su número de WhatsApp. Probá con Mercado Pago o avisale al local.");
      setBusy(null);
      return;
    }
    if (res) clear();
    setBusy(null);
    window.location.href = url; // href (no window.open): iOS bloquea popups después de un await
  }

  return (
    <>

      <dialog
        ref={dialogRef}
        onClick={(e) => e.target === dialogRef.current && close()}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-md bg-white p-0 text-ink backdrop:bg-ink/40"
        aria-labelledby="cart-title"
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b-2 border-ink p-4 pt-[calc(1rem+env(safe-area-inset-top))]">
            <h2 id="cart-title" className="font-display text-2xl font-extrabold">Tu pedido</h2>
            <button type="button" onClick={close} aria-label="Cerrar" className="grid size-10 place-items-center rounded-full hover:bg-lilac">
              <X />
            </button>
          </header>

          {items.length === 0 ? (
            <p className="flex-1 p-8 text-center text-ink-soft">Tu carrito está vacío. Agregá productos desde la tienda.</p>
          ) : (
            <>
              <ul className="flex-1 divide-y divide-lilac-200 overflow-y-auto overscroll-contain px-4">
                {items.map((l) => (
                  <li key={l.sku} className="flex gap-3 py-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium leading-tight">{l.name}</p>
                      <p className="text-xs text-ink-soft">{l.label} · {formatARS(l.unitPrice)} c/u</p>
                      <div className="mt-2 flex items-center gap-2">
                        <button type="button" aria-label="Restar" onClick={() => setQuantity(l.sku, l.quantity - 1)} className="grid size-10 place-items-center rounded-full bg-lilac">
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums">{l.quantity}</span>
                        <button type="button" aria-label="Sumar" onClick={() => setQuantity(l.sku, l.quantity + 1)} className="grid size-10 place-items-center rounded-full bg-lilac">
                          <Plus size={14} />
                        </button>
                        <button type="button" aria-label="Quitar" onClick={() => remove(l.sku)} className="ml-1 grid size-10 place-items-center rounded-full text-ink-soft hover:text-red-700">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatARS(l.unitPrice * l.quantity)}</p>
                  </li>
                ))}
              </ul>

              <form className="space-y-2 border-t-2 border-ink p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onSubmit={(e) => e.preventDefault()}>
                <input
                  required
                  autoComplete="name"
                  placeholder="Tu nombre"
                  value={customer.name}
                  onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
                  className="w-full rounded-xl bg-lilac px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ink"
                />
                <div className="grid grid-cols-2 gap-2 text-sm" role="radiogroup" aria-label="Entrega">
                  {(["retiro", "envio"] as const).map((m) => (
                    <label key={m} className={`cursor-pointer rounded-full border-2 px-3 py-2 text-center ${customer.delivery_method === m ? "border-ink bg-ink font-bold text-white" : "border-lilac-200 font-bold"}`}>
                      <input type="radio" name="delivery" className="sr-only" checked={customer.delivery_method === m} onChange={() => setCustomer({ ...customer, delivery_method: m })} />
                      {m === "retiro" ? "Retiro en local" : "Envío"}
                    </label>
                  ))}
                </div>
                {customer.delivery_method === "envio" && (
                  <input
                    autoComplete="street-address"
                    placeholder="Dirección de entrega"
                    value={customer.address ?? ""}
                    onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
                    className="w-full rounded-xl bg-lilac px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ink"
                  />
                )}
                <textarea
                  rows={2}
                  placeholder="Notas (opcional)"
                  value={customer.notes ?? ""}
                  onChange={(e) => setCustomer({ ...customer, notes: e.target.value })}
                  className="w-full resize-none rounded-xl bg-lilac px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ink"
                />

                <div className="flex items-center justify-between pt-1 text-lg font-bold">
                  <span className="font-display">Total</span>
                  <span className="tabular-nums">{formatARS(total)}</span>
                </div>
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => checkout("whatsapp")}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1F8F4E] py-3 font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                >
                  <WhatsAppIcon /> {busy === "whatsapp" ? "Preparando…" : "Enviar pedido por WhatsApp"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => checkout("mercadopago")}
                  className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0A6FB0] py-3 font-bold text-white transition hover:brightness-95 disabled:opacity-60"
                >
                  <CreditCard size={18} /> {busy === "mercadopago" ? "Redirigiendo…" : "Pagar con Mercado Pago"}
                </button>
              </form>
            </>
          )}
        </div>
      </dialog>
    </>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z" />
    </svg>
  );
}
