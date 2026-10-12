import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // El navegador llama a /api/... en el MISMO dominio y app/api/[...path]/route.ts lo reenvía
  // al backend (esperando a que despierte si Render lo durmió). Así la cookie de sesión es
  // "first-party" y no hace falta CORS para el panel.
};

export default nextConfig;
