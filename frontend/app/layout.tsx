import type { Metadata, Viewport } from "next";
import "./globals.css";
import { WakeBackend } from "@/components/WakeBackend";
import { backendUrl } from "@/lib/apiUrl";

export const metadata: Metadata = {
  title: { default: `${process.env.NEXT_PUBLIC_STORE_NAME ?? "Dietética"}: productos naturales`, template: "%s | Dietética" },
  description: "Frutos secos, harinas, semillas y suplementos. Sin TACC, veganos, orgánicos y keto.",
};

// viewport-fit=cover + env(safe-area-inset-*) en los elementos fijos: nada queda bajo el notch.
// themeColor = color del encabezado de la tienda (blanco), así la barra del sistema combina.
export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Manrope:wght@400;500;700;800&display=swap"
        />
      </head>
      <body className="min-h-dvh bg-white font-sans text-ink antialiased">
        <WakeBackend url={backendUrl()} />
        {children}
      </body>
    </html>
  );
}
