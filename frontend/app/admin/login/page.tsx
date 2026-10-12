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

  const field = "block h-12 w-full border-0 border-b-[3px] border-[var(--chalk)] bg-black/10 px-2 text-[18px] text-[var(--chalk)] outline-none transition-colors focus:border-[var(--chalk-yellow)] focus:bg-black/20";

  return (
    <div className="w-full rounded-2xl border-[3px] border-dashed border-[rgb(244_241_230/0.5)] px-5 py-7 sm:px-8 sm:py-9">
      <h1 className="text-[46px] leading-none">Iniciar sesión</h1>

      {notice && !error && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg bg-black/20 px-3 py-2.5 text-[15px] text-[var(--chalk)]">
          <Info size={17} className="mt-0.5 shrink-0 text-[var(--chalk-yellow)]" aria-hidden /> {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border-2 border-dashed border-[#f2a38f] px-3 py-2.5 text-[15px] text-[#f8c7ba]">
          <CircleAlert size={17} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      <form onSubmit={submit} className="mt-5 space-y-5 font-[family-name:var(--font-hand)]">
        <div>
          <label htmlFor="username" className="text-[19px]">Usuario</label>
          <input
            ref={userRef} id="username" name="username" autoComplete="username" autoCapitalize="none"
            autoCorrect="off" spellCheck={false} required value={username}
            onChange={(e) => setUsername(e.target.value)} className={`mt-1 ${field}`}
          />
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="text-[19px]">Contraseña</label>
          </div>
          <div className="relative mt-1">
            <input
              ref={passRef} id="password" name="password" type={show ? "text" : "password"}
              autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} onKeyUp={checkCaps} onKeyDown={checkCaps}
              onBlur={() => setCaps(false)} aria-describedby={caps ? "caps-warning" : undefined}
              className={`${field} pr-12`}
            />
            <button type="button" onClick={() => { setShow((v) => !v); passRef.current?.focus(); }}
              aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={show}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[rgb(244_241_230/0.75)] hover:text-[var(--chalk)]">
              {show ? <EyeOff size={20} aria-hidden /> : <Eye size={20} aria-hidden />}
            </button>
          </div>
          {caps && (
            <p id="caps-warning" className="mt-1.5 text-[16px] text-[var(--chalk-yellow)]">Ojo: Bloq Mayús está activado.</p>
          )}
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-[18px]">
          <input id="remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)}
            className="mt-1 size-5 shrink-0 accent-[var(--chalk-yellow)]" />
          <span>
            Mantener la sesión iniciada
            <span className="block font-[family-name:var(--font-condensed)] text-[14px] text-[rgb(244_241_230/0.7)]">Desmarcalo si la compu o el celular no es tuyo.</span>
          </span>
        </label>

        <button disabled={busy}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[var(--chalk-yellow)] text-[22px] font-bold text-[var(--board)] transition-colors hover:bg-[#fff3a6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgb(243_227_124/0.35)] disabled:cursor-wait disabled:opacity-80">
          {busy ? <><LoaderCircle size={20} className="animate-spin" aria-hidden /> Entrando…</> : <>¡Entrar! <ArrowRight size={20} aria-hidden /></>}
        </button>
        {slow && (
          <p role="status" className="text-center font-[family-name:var(--font-condensed)] text-[14px] text-[rgb(244_241_230/0.75)]">
            El servidor se está despertando después de un rato sin uso. Puede tardar hasta un minuto.
          </p>
        )}

        <div className="text-center">
          <button type="button" onClick={() => setForgot((v) => !v)} aria-expanded={forgot} aria-controls="forgot-help"
            className="min-h-11 text-[18px] text-[var(--chalk-yellow)] underline-offset-4 hover:underline">
            ¿Te olvidaste la contraseña?
          </button>
        </div>
        {forgot && (
          <div id="forgot-help" className="rounded-lg bg-black/20 p-4 font-[family-name:var(--font-condensed)] text-[15px] text-[var(--chalk)]">
            <p className="flex items-center gap-2 font-bold"><KeyRound size={16} aria-hidden /> Restablecer la contraseña</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Entrá a <a href="https://dashboard.render.com" target="_blank" rel="noreferrer" className="font-bold text-[var(--chalk-yellow)] underline underline-offset-2">dashboard.render.com</a> y abrí el servicio <strong>dietetica-api</strong>.</li>
              <li>En <strong>Environment</strong>, cambiá el valor de <code className="rounded bg-black/25 px-1 py-0.5 text-[13px]">ADMIN_PASSWORD</code> por una contraseña nueva.</li>
              <li>Tocá <strong>Save, rebuild and deploy</strong> y esperá 2 o 3 minutos.</li>
              <li>Entrá acá con la contraseña nueva. Por seguridad se cierran las sesiones abiertas.</li>
            </ol>
          </div>
        )}
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="min-h-dvh bg-[var(--wood)] p-3 pt-[calc(env(safe-area-inset-top)+12px)] md:p-[22px]">
      {/* Pizarrón con marco de madera */}
      <div className="grid min-h-[calc(100dvh-24px-env(safe-area-inset-top))] items-center gap-6 rounded-md px-5 py-8 shadow-[inset_0_0_0_3px_var(--wood-dark),inset_0_0_60px_rgb(0_0_0/0.35)] md:min-h-[calc(100dvh-44px)] md:grid-cols-[minmax(0,1fr)_minmax(0,460px)] md:gap-16 md:px-[clamp(32px,6vw,88px)] md:py-12"
        style={{ backgroundColor: "var(--board)", backgroundImage: "radial-gradient(rgba(255,255,255,.035) 1px,transparent 2px),radial-gradient(rgba(255,255,255,.025) 1px,transparent 2px)", backgroundSize: "9px 9px,13px 13px" }}>
        <div className="flex flex-col gap-3 md:gap-5">
          <p className="font-[family-name:var(--font-chalk)] text-[56px] font-bold leading-[0.9] md:text-[92px]">Panel de la<br />dietética</p>
          <svg aria-hidden="true" viewBox="0 0 360 18" className="h-[14px] w-[220px] md:h-[18px] md:w-[360px]" fill="none">
            <path d="M4 12 C 80 2, 160 16, 236 7 S 340 10, 356 6" stroke="var(--chalk-yellow)" strokeWidth="5" strokeLinecap="round" />
          </svg>
          <ul className="hidden list-none flex-col gap-1.5 p-0 font-[family-name:var(--font-hand)] text-[24px] md:flex">
            <li>· Pedidos del día</li>
            <li>· Precios y stock</li>
            <li>· Importar la lista del proveedor</li>
            <li>· Resumen de ventas</li>
          </ul>
        </div>
        <div className="w-full justify-self-center md:max-w-[460px]">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </main>
  );
}
