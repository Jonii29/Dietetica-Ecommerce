import type { Metadata, Viewport } from "next";

export const metadata: Metadata = { title: "Gestión", robots: { index: false, follow: false } };
export const viewport: Viewport = { themeColor: "#8a5a35" }; // barra del sistema = marco de madera

/** Tema del panel (diseño "Pizarra"): pizarrón verde, marco de madera, títulos en tiza
 *  (Caveat / Kalam) y datos en Atkinson Hyperlegible, que se lee fácil hasta en el celular. */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="admin-theme min-h-dvh">
      {/* React 19 sube este <link> al <head> */}
      <link
        rel="stylesheet"
        precedence="default"
        href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Kalam:wght@400;700&family=Atkinson+Hyperlegible:wght@400;700&display=swap"
      />
      {children}
    </div>
  );
}
