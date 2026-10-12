"use client";
/** Mi cuenta: cambiar la contraseña y cerrar la sesión en todos los dispositivos. */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Eye, EyeOff, LogOut, MonitorSmartphone } from "lucide-react";
import { AdminError, adminFetch, formatDateTime } from "@/lib/admin";

interface Me { username: string; last_login_at: string | null; sessions: number }

function strength(pw: string): { label: string; tone: string; ok: boolean } {
  if (!pw) return { label: "", tone: "", ok: false };
  if (pw.length < 8) return { label: `Faltan ${8 - pw.length} caracteres`, tone: "text-red-700", ok: false };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (pw.length >= 12 && kinds >= 2) return { label: "Buena", tone: "text-emerald-700", ok: true };
  return { label: "Aceptable. Más larga es más segura (12 o más).", tone: "text-amber-800", ok: true };
}

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  useEffect(() => { adminFetch<Me>("/me").then(setMe).catch(() => {}); }, []);

  const s = strength(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!s.ok || mismatch) return;
    setBusy(true);
    setMsg(null);
    try {
      await adminFetch("/password", { method: "POST", body: JSON.stringify({ current_password: current, new_password: next }) });
      setCurrent(""); setNext(""); setConfirm("");
      setMsg({ ok: true, text: "Listo, cambiaste la contraseña. Los otros dispositivos van a tener que volver a entrar." });
      adminFetch<Me>("/me").then(setMe).catch(() => {});
    } catch (err) {
      setMsg({ ok: false, text: err instanceof AdminError ? err.message : "No se pudo cambiar la contraseña." });
    } finally {
      setBusy(false);
    }
  }

  async function logoutAll() {
    await adminFetch("/logout-all", { method: "POST" }).catch(() => {});
    router.replace("/admin/login?motivo=todos");
  }

  const type = show ? "text" : "password";
  const field = "mt-1.5 block h-12 w-full rounded-lg border border-stone-300 bg-white px-3.5 text-[16px] outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-100";

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1>Mi cuenta</h1>
        {me && (
          <p className="mt-1 text-sm text-stone-500">
            Usuario <strong className="text-stone-800">{me.username}</strong>
            {me.last_login_at && <> · último inicio de sesión {formatDateTime(me.last_login_at)}</>}
          </p>
        )}
      </header>

      <section className="rounded-xl bg-white p-5 shadow-[0_1px_0_var(--color-stone-200)]">
        <h2>Cambiar contraseña</h2>
        <form onSubmit={changePassword} className="mt-4 space-y-4">
          <div>
            <label htmlFor="pw-current" className="text-sm font-semibold text-stone-700">Contraseña actual</label>
            <input id="pw-current" type={type} autoComplete="current-password" required value={current}
              onChange={(e) => setCurrent(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="pw-new" className="text-sm font-semibold text-stone-700">Contraseña nueva</label>
            <input id="pw-new" type={type} autoComplete="new-password" required minLength={8} value={next}
              onChange={(e) => setNext(e.target.value)} aria-describedby="pw-strength" className={field} />
            <p id="pw-strength" className={`mt-1.5 min-h-5 text-sm ${s.tone || "text-stone-500"}`}>
              {s.label || "Mínimo 8 caracteres. Una frase de varias palabras es fácil de recordar."}
            </p>
          </div>
          <div>
            <label htmlFor="pw-confirm" className="text-sm font-semibold text-stone-700">Repetí la contraseña nueva</label>
            <input id="pw-confirm" type={type} autoComplete="new-password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} className={field} />
            {mismatch && <p className="mt-1.5 text-sm text-red-700">No coincide con la contraseña nueva.</p>}
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input id="pw-show" type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="size-5 accent-brand-700" />
            {show ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />} Mostrar contraseñas
          </label>
          {msg && (
            <p role={msg.ok ? "status" : "alert"}
              className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
              {msg.ok && <CheckCircle2 size={17} className="mt-px shrink-0" aria-hidden />} {msg.text}
            </p>
          )}
          <button disabled={busy || !current || !s.ok || mismatch || !confirm}
            className="h-12 rounded-lg bg-brand-700 px-5 font-semibold text-white hover:bg-brand-900 disabled:opacity-50">
            {busy ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      </section>

      <section className="rounded-xl bg-white p-5 shadow-[0_1px_0_var(--color-stone-200)]">
        <h2 className="flex items-center gap-2"><MonitorSmartphone size={20} aria-hidden /> Dispositivos</h2>
        <p className="mt-2 text-sm text-stone-600">
          {me ? (me.sessions <= 1 ? "Tenés la sesión abierta solo en este dispositivo." : `Tenés la sesión abierta en ${me.sessions} dispositivos o navegadores.`) : "…"}
          {" "}Si perdiste el celular o entraste desde una compu ajena, cerrá la sesión en todos.
        </p>
        {!confirmAll ? (
          <button onClick={() => setConfirmAll(true)}
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-lg border border-stone-300 px-4 font-semibold text-stone-800 hover:bg-stone-100">
            <LogOut size={16} aria-hidden /> Cerrar sesión en todos los dispositivos
          </button>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <span className="basis-full">Vas a tener que volver a entrar también en este dispositivo.</span>
            <button onClick={logoutAll} className="h-11 rounded-lg bg-red-700 px-4 font-semibold text-white hover:bg-red-800">Sí, cerrar en todos</button>
            <button onClick={() => setConfirmAll(false)} className="h-11 rounded-lg px-4 font-semibold text-stone-700 hover:bg-amber-100">Cancelar</button>
          </div>
        )}
      </section>
    </div>
  );
}
