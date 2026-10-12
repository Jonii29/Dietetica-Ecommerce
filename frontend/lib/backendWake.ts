/**
 * Despertar el backend.
 *
 * En el plan gratis de Render cada servicio se duerme tras 15 min sin visitas y tarda ~1 min
 * en arrancar. Mientras arranca, Render responde 502/503/504 (o una página HTML de espera).
 * Si la tienda despertó pero el backend no, el navegador veía "502". Acá esperamos a que el
 * backend responda /health antes de reenviarle cosas.
 */
import { backendUrl } from "./apiUrl";

const WAKE_STATUSES = new Set([502, 503, 504]);
let lastOkAt = 0;              // última vez que /health respondió bien (ms)
let waking: Promise<boolean> | null = null;

export function isWakeStatus(status: number) {
  return WAKE_STATUSES.has(status);
}

async function ping(timeoutMs: number): Promise<boolean> {
  try {
    const r = await fetch(`${backendUrl()}/health`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return false;
    const ct = r.headers.get("content-type") ?? "";
    return ct.includes("application/json"); // la página de espera de Render es HTML
  } catch {
    return false;
  }
}

/** Espera a que el backend esté despierto (hasta `maxMs`). Comparte la espera entre requests. */
export function ensureBackendAwake(maxMs = 90_000, force = false): Promise<boolean> {
  if (!force && Date.now() - lastOkAt < 60_000) return Promise.resolve(true);
  const giveUp = new Promise<boolean>((r) => setTimeout(() => r(false), maxMs));
  if (waking) return Promise.race([waking, giveUp]);
  waking = (async () => {
    const deadline = Date.now() + Math.max(maxMs, 90_000);
    let delay = 1500;
    while (Date.now() < deadline) {
      if (await ping(Math.min(20_000, deadline - Date.now()))) {
        lastOkAt = Date.now();
        return true;
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 5000);
    }
    return false;
  })().finally(() => { waking = null; });
  return Promise.race([waking, giveUp]);
}

export function markBackendOk() {
  lastOkAt = Date.now();
}
