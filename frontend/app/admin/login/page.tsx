"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { adminFetch } from "@/lib/admin";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminFetch("/login", { method: "POST", body: JSON.stringify({ username, password }) });
      const next = params.get("next");
      router.replace(next && next.startsWith("/admin") ? next : "/admin");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-xl bg-white shadow-[0_1px_0_var(--color-stone-200)] p-6 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-brand-100 p-2 text-brand-700"><LockKeyhole size={20} /></span>
        <div>
          <h1 className="text-lg font-bold">Panel de gestión</h1>
          <p className="text-sm text-stone-500">Dietética</p>
        </div>
      </div>
      <label className="block text-sm font-medium">
        Usuario
        <input id="username" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-100" />
      </label>
      <label className="block text-sm font-medium">
        Contraseña
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-100" />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button disabled={busy} className="w-full rounded-lg bg-brand-700 py-2.5 font-semibold text-white hover:bg-brand-900 disabled:opacity-60">
        {busy ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
