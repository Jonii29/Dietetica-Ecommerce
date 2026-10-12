/** Al arrancar el servidor de la tienda (p. ej. al despertar en Render) despierta también al
 *  backend, así para cuando el navegador pide datos ya está listo. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureBackendAwake } = await import("./lib/backendWake");
    void ensureBackendAwake(120_000);
  }
}
