/** Al arrancar el servidor de la tienda intenta despertar también al backend. (En Render
 *  gratis esto no siempre alcanza: el navegador lo despierta también, ver WakeBackend.) */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureBackendAwake } = await import("./lib/backendWake");
    void ensureBackendAwake(120_000);
  }
}
