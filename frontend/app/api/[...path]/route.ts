/**
 * Reenvío de /api/* al backend (antes era un `rewrite` de next.config).
 *
 * Hace lo mismo pero aguanta el arranque en frío de Render: si el backend está dormido, espera
 * a que despierte (hasta ~90 s) en vez de devolverle un 502 al navegador. Solo se reintenta
 * cuando el pedido NO llegó al backend (conexión rechazada, o el 502/503/504 lo dio Render y no
 * nuestra API, que siempre responde JSON): así un pedido o un login nunca se procesa dos veces.
 * La cookie de sesión del panel pasa en los dos sentidos, igual que antes.
 */
import { backendUrl } from "@/lib/apiUrl";
import { ensureBackendAwake, isWakeStatus, markBackendOk } from "@/lib/backendWake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const HOP_BY_HOP = new Set([
  "host", "connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-authorization",
  "proxy-connection", "te", "trailer", "content-length", "accept-encoding",
]);
const DROP_FROM_RESPONSE = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie"]);

function sleeping(): Response {
  return Response.json(
    { detail: "El servidor se está despertando. Esperá unos segundos y probá de nuevo." },
    { status: 503, headers: { "retry-after": "10", "cache-control": "no-store" } },
  );
}

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const incoming = new URL(req.url);
  const target = `${backendUrl()}/api/${path.map(encodeURIComponent).join("/")}${incoming.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = req.method.toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";
  const body = idempotent ? undefined : await req.arrayBuffer();

  if (!idempotent && !(await ensureBackendAwake())) return sleeping();

  const deadline = Date.now() + 95_000;
  for (;;) {
    let res: Response | null = null;
    let timedOut = false;
    try {
      res = await fetch(target, {
        method, headers, body, redirect: "manual", cache: "no-store",
        signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
      });
    } catch (err) {
      timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    }

    // ¿El pedido no llegó a nuestra API? (Render dormido / reiniciando)
    const notDelivered = !res
      ? !timedOut
      : isWakeStatus(res.status) && !(res.headers.get("content-type") ?? "").includes("application/json");

    if (res && !notDelivered) {
      markBackendOk();
      const out = new Headers();
      res.headers.forEach((value, key) => {
        if (!DROP_FROM_RESPONSE.has(key.toLowerCase())) out.set(key, value);
      });
      for (const c of res.headers.getSetCookie()) out.append("set-cookie", c);
      return new Response(res.status === 204 || res.status === 304 || method === "HEAD" ? null : res.body, {
        status: res.status, headers: out,
      });
    }
    // Una consulta que tardó demasiado (timeout) sí pudo haber llegado: no se repite un envío
    if ((!res && timedOut && !idempotent) || Date.now() > deadline) return sleeping();
    if (!(await ensureBackendAwake(Math.max(1_000, deadline - Date.now()), true))) return sleeping();
  }
}

export { proxy as GET, proxy as HEAD, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
