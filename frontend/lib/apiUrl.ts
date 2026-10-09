/**
 * URL del backend vista desde el SERVIDOR de Next (render del catálogo y reenvío de /api).
 * - NEXT_PUBLIC_API_URL / API_URL: URL completa (local: http://localhost:8000)
 * - API_HOST: solo el host, como lo entrega Render con `fromService` (se le agrega https://)
 * El navegador nunca la usa: llama a /api/... en el mismo dominio.
 */
export function backendUrl(): string {
  const full = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (full) return full.replace(/\/$/, "");
  const host = process.env.API_HOST;
  if (host) return host.includes("://") ? host : `https://${host}`;
  return "http://localhost:8000";
}
