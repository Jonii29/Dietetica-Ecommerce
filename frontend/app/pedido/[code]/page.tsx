import { API_URL } from "@/lib/api";
import { formatARS } from "@/lib/format";

const LABELS: Record<string, string> = {
  pending: "Recibido", awaiting_payment: "Esperando pago", paid: "Pagado ✅",
  payment_failed: "Pago rechazado", cancelled: "Cancelado", fulfilled: "Entregado",
};

/** Página de retorno de Mercado Pago (back_urls). El estado real lo define el webhook. */
export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const res = await fetch(`${API_URL}/api/orders/${encodeURIComponent(code)}`, { cache: "no-store" });
  if (!res.ok) return <p className="p-8 text-center">Pedido no encontrado.</p>;
  const order = await res.json();
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-xl font-bold">Pedido {order.code}</h1>
      <p className="mt-1 text-stone-600">Estado: {LABELS[order.status] ?? order.status}</p>
      <ul className="mt-4 divide-y rounded-xl border bg-white">
        {order.items.map((it: { sku: string; quantity: number; product_name: string; variant_label: string; subtotal: number }) => (
          <li key={it.sku} className="flex justify-between p-3 text-sm">
            <span>{it.quantity} × {it.product_name} ({it.variant_label})</span>
            <span className="tabular-nums">{formatARS(it.subtotal)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-right text-lg font-bold">Total {formatARS(order.total)}</p>
    </main>
  );
}
