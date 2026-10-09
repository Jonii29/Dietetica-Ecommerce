import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Gestión", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#1f3fbf" }; // barra del sistema = encabezado azul

/** Tema del panel (diseño "Lista"): azul cobalto, grises fríos, Barlow y resaltador amarillo. */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-theme min-h-dvh bg-stone-100">
      {/* React 19 sube este <link> al <head> */}
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;500;600;700&display=swap"
      />
      {children}
    </div>
  );
}
