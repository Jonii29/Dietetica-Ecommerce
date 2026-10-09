import { revalidateTag } from "next/cache";
import { backendUrl } from "@/lib/apiUrl";

/**
 * El panel lo llama después de guardar algo (producto, precio, stock, importación, pedido)
 * para que la tienda muestre el cambio al instante, sin esperar al vencimiento del caché.
 * Solo funciona con una sesión de administrador válida (se verifica contra el backend).
 */
export async function POST(req: Request) {
  const me = await fetch(`${backendUrl()}/api/admin/me`, {
    headers: { cookie: req.headers.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!me.ok) return new Response(null, { status: 401 });
  revalidateTag("catalog");
  return Response.json({ ok: true });
}
