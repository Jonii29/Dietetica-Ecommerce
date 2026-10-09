"use client";
/**
 * Importación en dos pasos: 1) se revisa el archivo sin guardar (dry-run) y se muestran los
 * errores por fila; 2) si está todo bien, se confirma y se aplica.
 */
import { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { adminFetch, type ImportReport } from "@/lib/admin";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sync, setSync] = useState(false);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await adminFetch<ImportReport>(`/import?dry_run=${dryRun}&sync=${sync}`, { method: "POST", body: form });
      if (dryRun) setPreview(r);
      else { setDone(r); setPreview(null); setFile(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el archivo");
    } finally {
      setBusy(false);
    }
  }

  function pick(f: File | null) {
    setFile(f);
    setPreview(null);
    setDone(null);
    setError(null);
  }

  return (
    <div className="max-w-3xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Importar productos</h1>
        <p className="text-sm text-stone-500">
          Subí un Excel (.xlsx) o CSV con una fila por presentación. Los productos existentes se actualizan por SKU; los nuevos se crean.
        </p>
      </header>

      <a href="/api/admin/import/template" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <Download size={15} /> Descargar plantilla
      </a>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0] ?? null); }}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 bg-white p-8 text-center hover:border-brand-600">
        {file ? <FileSpreadsheet size={28} className="text-brand-700" /> : <UploadCloud size={28} className="text-stone-400" />}
        <span className="text-sm font-medium">{file ? file.name : "Arrastrá el archivo acá o hacé clic para elegirlo"}</span>
        <span className="text-xs text-stone-500">.xlsx, .csv · hasta 10 MB</span>
        <input id="import-file" type="file" accept=".csv,.xlsx,.xlsm" className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input id="import-sync" type="checkbox" checked={sync} onChange={(e) => { setSync(e.target.checked); setPreview(null); }} className="mt-0.5 accent-brand-700" />
        <span>
          <strong>Sincronizar:</strong> desactivar las presentaciones que no estén en el archivo.
          <span className="block text-xs text-stone-500">Usalo solo si el archivo tiene el catálogo completo.</span>
        </span>
      </label>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!preview && !done && (
        <button disabled={!file || busy} onClick={() => run(true)}
          className="rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-900 disabled:opacity-50">
          {busy ? "Revisando…" : "Revisar archivo"}
        </button>
      )}

      {preview && (
        <section className="space-y-3 rounded-xl bg-white shadow-[0_1px_0_var(--color-stone-200)] p-4">
          <h2 className="font-semibold">Vista previa (todavía no se guardó nada)</h2>
          <Summary r={preview} />
          {preview.errors.length > 0 && <Errors r={preview} />}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} onClick={() => run(false)}
              className="rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-900 disabled:opacity-50">
              {busy ? "Importando…" : preview.errors.length ? "Importar las filas correctas" : "Confirmar importación"}
            </button>
            <button onClick={() => pick(null)} className="rounded-lg px-4 py-2.5 text-stone-600 hover:bg-stone-200">Elegir otro archivo</button>
          </div>
        </section>
      )}

      {done && (
        <section className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <h2 className="flex items-center gap-2 font-semibold text-emerald-900"><CheckCircle2 size={18} /> Importación aplicada</h2>
          <Summary r={done} />
          {done.errors.length > 0 && <Errors r={done} />}
          <p className="text-sm text-emerald-900">Los cambios ya se ven en la tienda.</p>
        </section>
      )}
    </div>
  );
}

function Summary({ r }: { r: ImportReport }) {
  const items = [
    ["Filas leídas", r.rows],
    ["Productos nuevos", r.products_created],
    ["Productos actualizados", r.products_updated],
    ["Presentaciones nuevas", r.variants_created],
    ["Presentaciones actualizadas", r.variants_updated],
    ["Presentaciones desactivadas", r.variants_deactivated],
  ] as const;
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-stone-100 py-1">
          <dt className="text-stone-600">{k}</dt>
          <dd className="font-semibold tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Errors({ r }: { r: ImportReport }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="mb-2 text-sm font-semibold text-red-800">{r.errors.length} {r.errors.length === 1 ? "fila con error" : "filas con error"} (se van a saltear)</p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-red-900"><tr><th className="py-1 pr-3">Línea</th><th className="py-1 pr-3">SKU</th><th className="py-1">Problema</th></tr></thead>
          <tbody>
            {r.errors.map((e, i) => (
              <tr key={i} className="border-t border-red-100 text-red-900">
                <td className="py-1 pr-3 tabular-nums">{e.line ?? "—"}</td>
                <td className="py-1 pr-3 font-mono">{e.sku ?? "—"}</td>
                <td className="py-1">{e.error}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
