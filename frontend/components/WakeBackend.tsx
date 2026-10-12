"use client";
/**
 * Despierta el backend desde el NAVEGADOR.
 *
 * En el plan gratis de Render, un servicio dormido solo arranca con visitas de afuera: los
 * pedidos que le hace la tienda desde el propio Render no lo despiertan. Por eso, al abrir
 * cualquier página, el navegador le manda un "toc toc" a /health (sin leer la respuesta) y,
 * mientras la pestaña está abierta, lo repite cada 5 minutos para que no se vuelva a dormir.
 */
import { useEffect } from "react";

export function WakeBackend({ url }: { url: string }) {
  useEffect(() => {
    if (!url) return;
    const ping = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`${url}/health`, { mode: "no-cors", cache: "no-store", keepalive: true }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 5 * 60_000);
    document.addEventListener("visibilitychange", ping);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", ping); };
  }, [url]);
  return null;
}
