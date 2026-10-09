import { CatalogSearch } from "@/components/CatalogSearch";
import { CartDrawer } from "@/components/CartDrawer";
import { getCatalog, STORE_NAME, WHATSAPP_NUMBER } from "@/lib/api";

// Se arma en cada visita (el catálogo queda cacheado 60 s), así el build no necesita el backend.
export const dynamic = "force-dynamic";

function prettyPhone(n: string) {
  const d = n.replace(/\D/g, "");
  // 5491112345678 -> 11 1234-5678 (formato AR habitual)
  const local = d.startsWith("549") ? d.slice(3) : d;
  return local.length === 10 ? `${local.slice(0, 2)} ${local.slice(2, 6)}-${local.slice(6)}` : n;
}

export default async function HomePage() {
  let catalog;
  try {
    catalog = await getCatalog();
  } catch {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-md">
          <p className="font-display text-3xl font-extrabold">{STORE_NAME}</p>
          <p className="mt-3 text-ink-soft">Estamos preparando la tienda. Volvé a cargar la página en unos segundos.</p>
          <a href="/" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-6 font-bold text-white">Volver a cargar</a>
        </div>
      </main>
    );
  }

  return (
    <>
      <main>
        <CatalogSearch catalog={catalog} storeName={STORE_NAME} />
      </main>
      <footer className="bg-ink text-white">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-6 px-4 py-8 md:px-6">
          <p className="font-display text-2xl font-extrabold">¿Dudas con tu pedido? Escribinos.</p>
          <p className="text-white/85">
            {WHATSAPP_NUMBER && (
              <a href={`https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g, "")}`} className="font-bold text-white underline underline-offset-2">
                WhatsApp {prettyPhone(WHATSAPP_NUMBER)}
              </a>
            )}{" "}
            · Mercado Pago · Envíos y retiro
          </p>
        </div>
      </footer>
      <CartDrawer />
    </>
  );
}
