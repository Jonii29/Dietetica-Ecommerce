"use client";
/**
 * Inicio de sesión del panel. Diseño "Lista": panel cobalto con renglones (como una lista de
 * precios) y el resaltador amarillo; en el celular el bloque azul queda arriba del formulario.
 *
 * - Ver/ocultar contraseña, aviso de Bloq Mayús y "Mantener la sesión iniciada".
 * - Recuerda el último usuario en este dispositivo (nunca la contraseña).
 * - Mensajes claros: datos incorrectos, demasiados intentos, sin conexión, servidor despertando
 *   (el plan gratis de Render tarda hasta un minuto en arrancar).
 * - "¿Olvidaste tu contraseña?" explica cómo restablecerla desde Render.
 */
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleAlert, Eye, EyeOff, Info, KeyRound, LoaderCircle } from "lucide-react";
import { AdminError, adminFetch } from "@/lib/admin";

const LAST_USER_KEY = "dietetica_admin_user";
const NOTICES: Record<string, string> = {
  vencida: "Tu sesión venció. Volvé a entrar para seguir.",
  salio: "Cerraste sesión.",
  todos: "Cerraste la sesión en todos los dispositivos.",
};

function readLastUser(): string {
  try { return localStorage.getItem(LAST_USER_KEY) ?? ""; } catch { return ""; }
}
function saveLastUser(u: string) {
  try { localStorage.setItem(LAST_USER_KEY, u); } catch { /* modo privado */ }
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const notice = NOTICES[params.get("motivo") ?? ""];

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [forgot, setForgot] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  // Último usuario usado en este dispositivo: se completa y el foco va directo a la contraseña
  useEffect(() => {
    const last = readLastUser();
    if (last) setUsername(last);
    // En el celular no se enfoca solo: el teclado taparía la mitad de la pantalla
    if (!window.matchMedia("(pointer: fine)").matches) return;
    (last ? passRef : userRef).current?.focus();
  }, []);

  // Si ya hay una sesión válida, no tiene sentido mostrar el login
  useEffect(() => {
    fetch("/api/admin/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => { if (r.ok) router.replace(nextUrl()); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nextUrl() {
    const next = params.get("next");
    return next && next.startsWith("/admin") && !next.startsWith("/admin/login") ? next : "/admin";
  }

  function checkCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCaps(e.getModifierState?.("CapsLock") ?? false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const slowTimer = setTimeout(() => setSlow(true), 4000);
    try {
      await adminFetch("/login", { method: "POST", body: JSON.stringify({ username: username.trim(), password, remember }) });
      saveLastUser(username.trim());
      router.replace(nextUrl());
      router.refresh();
    } catch (err) {
      if (err instanceof AdminError && err.status === 401) {
        setError("El usuario o la contraseña no coinciden. Revisá que no esté activado Bloq Mayús.");
        setPassword("");
        passRef.current?.focus();
      } else if (err instanceof AdminError && err.status === 429) {
        setError(err.message);
      } else if (err instanceof AdminError && err.status === 422) {
        setError("Completá el usuario y la contraseña.");
      } else if (err instanceof AdminError) {
        setError("El servidor no respondió bien. Esperá unos segundos y probá de nuevo.");
      } else {
        setError("No pudimos conectarnos. Revisá tu conexión a internet y probá de nuevo.");
      }
      setBusy(false);
    } finally {
      clearTimeout(slowTimer);
      setSlow(false);
    }
  }

  return (
    <div className="w-full max-w-[400px]">
      <h1 className="leading-none text-stone-900">Iniciar sesión</h1>
      <p className="mt-2 text-[15px] text-stone-500">Entrá con el usuario del panel.</p>

      {notice && !error && (
        <p role="status" className="mt-5 flex items-start gap-2 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-900">
          <Info size={17} className="mt-px shrink-0" aria-hidden /> {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-800">
          <CircleAlert size={17} className="mt-px shrink-0" aria-hidden /> {error}
        </p>
      )}

      <form onSubmit={submit} className="mt-6 space-y-5" noValidate={false}>
        <div>
          <label htmlFor="username" className="text-sm font-semibold text-stone-700">Usuario</label>
          <input
            ref={userRef} id="username" name="username" autoComplete="username" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} required value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1.5 block h-12 w-full rounded-lg border border-stone-300 bg-white px-3.5 text-[16px] outline-none transition-[border-color,box-shadow] focus:border-brand-600 focus:ring-4 focus:ring-brand-100"
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="text-sm font-semibold text-stone-700">Contraseña</label>
            <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} aria-controls="forgot-help"
              className="min-h-9 text-sm font-semibold text-brand-700 underline-offset-4 hover:underline">
              ¿Olvidaste tu contraseña?
            </button>
          </div>
          <div className="relative mt-1.5">
            <input
              ref={passRef} id="password" name="password" type={show ? "text" : "password"}
              autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} onKeyUp={checkCaps} onKeyDown={checkCaps}
              onBlur={() => setCaps(false)} aria-describedby={caps ? "caps-warning" : undefined}
              className="block h-12 w-full rounded-lg border border-stone-300 bg-white pl-3.5 pr-12 text-[16px] outline-none transition-[border-color,box-shadow] focus:border-brand-600 focus:ring-4 focus:ring-brand-100"
            />
            <button type="button" onClick={() => { setShow((v) => !v); passRef.current?.focus(); }}
              aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg text-stone-500 hover:text-stone-800">
              {show ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
            </button>
          </div>
          {caps && (
            <p id="caps-warning" className="mt-1.5 text-sm font-medium text-amber-800">Bloq Mayús está activado.</p>
          )}
        </div>

        {forgot && (
          <div id="forgot-help" className="rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
            <p className="flex items-center gap-2 font-semibold text-stone-900"><KeyRound size={16} aria-hidden /> Restablecer la contraseña</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Entrá a <a href="https://dashboard.render.com" target="_blank" rel="noreferrer" className="font-semibold text-brand-700 underline underline-offset-2">dashboard.render.com</a> y abrí el servicio <strong>dietetica-api</strong>.</li>
              <li>En <strong>Environment</strong>, cambiá el valor de <code className="rounded bg-white px-1 py-0.5 text-[13px] ring-1 ring-stone-200">ADMIN_PASSWORD</code> por una contraseña nueva.</li>
              <li>Tocá <strong>Save, rebuild and deploy</strong> y esperá 2 o 3 minutos.</li>
              <li>Entrá acá con la contraseña nueva. Por seguridad se cierran las sesiones abiertas.</li>
            </ol>
          </div>
        )}

        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[15px]">
          <input id="remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-brand-700" />
          <span>
            Mantener la sesión iniciada
            <span className="block text-sm text-stone-500">Desmarcalo si la compu o el celular no es tuyo.</span>
          </span>
        </label>

        <button disabled={busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-700 font-semibold text-white transition-colors hover:bg-brand-900 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-100 disabled:cursor-wait disabled:opacity-80">
          {busy ? <><LoaderCircle size={18} className="animate-spin" aria-hidden /> Entrando…</> : <>Entrar <ArrowRight size={18} aria-hidden /></>}
        </button>
        {slow && (
          <p role="status" className="text-center text-sm text-stone-500">
            El servidor se está despertando después de un rato sin uso. Puede tardar hasta un minuto.
          </p>
        )}
      </form>
    </div>
  );
}

function today() {
  const s = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function LoginPage() {
  const [date, setDate] = useState("");
  useEffect(() => setDate(today()), []);

  return (
    <main className="grid min-h-dvh grid-rows-[auto_1fr] bg-white md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:grid-rows-1">
      {/* Marca: renglones como una lista de precios */}
      <section
        className="relative overflow-hidden bg-brand-700 px-6 pb-8 pt-[calc(env(safe-area-inset-top)+28px)] text-white md:flex md:flex-col md:justify-between md:px-12 md:py-12"
        style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 39px, rgb(255 255 255 / 0.09) 39px 40px)" }}
      >
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white/70">Dietética</p>
        <div className="mt-3 md:mt-0">
          <p className="font-[family-name:var(--font-condensed)] text-[44px] font-bold leading-[0.95] md:text-[72px]">
            Panel de{" "}
            <span className="bg-[linear-gradient(transparent_80%,var(--color-highlight)_80%,var(--color-highlight)_94%,transparent_94%)] px-1 text-white [box-decoration-break:clone]">
              gestión
            </span>
          </p>
          <p className="mt-4 hidden max-w-sm text-[17px] leading-relaxed text-white/85 md:block">
            Pedidos, productos, precios y ventas de la tienda en un solo lugar.
          </p>
        </div>
        <p className="mt-4 hidden text-sm text-white/70 md:block" suppressHydrationWarning>{date}</p>
      </section>

      <section className="flex items-start justify-center px-6 py-10 md:items-center md:px-12">
        <Suspense>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
