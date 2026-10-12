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
    const knock = () => { fetch(`${url}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {}); };
    const ifVisible = () => { if (document.visibilityState === "visible") knock(); };
    knock(); // siempre al abrir la página
    const id = setInterval(ifVisible, 5 * 60_000);
    document.addEventListener("visibilitychange", ifVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", ifVisible); };
  }, [url]);
  return null;
}
