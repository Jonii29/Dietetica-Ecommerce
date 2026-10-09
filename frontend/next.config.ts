import type { NextConfig } from "next";
import { backendUrl } from "./lib/apiUrl";

const API_URL = backendUrl();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
  // El panel llama a /api/... en el MISMO dominio y Next lo reenvía al backend.
  // Así la cookie de sesión es "first-party" y no hace falta CORS para el admin.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
