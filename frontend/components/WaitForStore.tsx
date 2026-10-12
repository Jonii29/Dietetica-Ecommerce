"use client";
/** Pantalla mientras el servidor de la tienda despierta: espera y recarga sola. */
import { useEffect, useState } from "react";

export function WaitForStore({ storeName }: { storeName: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 4 && alive; i++) {
        try {
          const r = await fetch("/api/catalog", { cache: "no-store" });
          if (r.ok) { window.location.reload(); return; }
        } catch { /* reintentar */ }
        await new Promise((res) => setTimeout(res, 3000));
      }
      if (alive) setFailed(true);
    })();
    return () => { alive = false; };
  }, []);

  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="max-w-md">
        <p className="font-display text-3xl font-extrabold">{storeName}</p>
        {!failed ? (
          <>
            <span aria-hidden className="mx-auto mt-6 block size-10 animate-spin rounded-full border-4 border-lilac-200 border-t-ink" />
            <p role="status" className="mt-4 text-ink-soft">Abriendo la tienda… puede tardar hasta un minuto la primera vez.</p>
          </>
        ) : (
          <>
            <p className="mt-3 text-ink-soft">La tienda está tardando más de lo normal. Probá de nuevo en un ratito.</p>
            <a href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-6 font-bold text-white">Volver a cargar</a>
          </>
        )}
      </div>
    </main>
  );
}
