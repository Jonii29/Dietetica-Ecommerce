"use client";
/**
 * Importación en dos pasos: 1) se revisa el archivo sin guardar (dry-run): el servidor detecta
 * las columnas, muestra cómo entendió las primeras filas y los errores; si alguna columna quedó
 * mal, se corrige acá y se vuelve a revisar. 2) Se confirma y se aplica.
 *
 * Acepta la lista tal como venga: Excel (.xlsx/.xls), CSV o PDF del proveedor.
 */
import { useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Info, RefreshCw, UploadCloud } from "lucide-react";
import { adminFetch, type ImportDetected, type ImportReport } from "@/lib/admin";
import { formatARS } from "@/lib/format";

const ACCEPT = ".xlsx,.xlsm,.xls,.csv,.txt,.pdf";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [sync, setSync] = useState(false);
  const [columns, setColumns] = useState<Record<number, string | null> | null>(null);
  const [preview, setPreview] = useState<ImportReport | null>(null);
  const [done, setDone] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean, cols = columns) {
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    if (cols) form.append("columns", JSON.stringify(cols));
    try {
      const r = await adminFetch<ImportReport>(`/import?dry_run=${dryRun}&sync=${sync}`, { method: "POST", body: form });
      if (dryRun) setPreview(r);
      else { setDone(r); setPreview(null); setFile(null); setColumns(null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo procesar el archivo");
    } finally {
      setBusy(false);
    }
  }

  function pick(f: File | null) {
    setFile(f);
    setColumns(null);
    setPreview(null);
    setDone(null);
    setError(null);
  }

  function changeColumn(det: ImportDetected, index: number, field: string) {
    const base: Record<number, string | null> =
      columns ?? Object.fromEntries(det.columns.map((c) => [c.index, c.field]));
    const next: Record<number, string | null> = { ...base };
    // Un campo va en una sola columna: si ya estaba en otra, se libera
    if (field) for (const k of Object.keys(next)) if (next[+k] === field) next[+k] = null;
    next[index] = field || null;
    setColumns(next);
    run(true, next);
  }

  const canImport = preview && preview.rows > 0 && preview.errors.length < preview.rows;

  return (
    <div className="max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Importar productos</h1>
        <p className="text-sm text-stone-500">
          Subí tu lista de precios como la tengas: Excel, CSV o el PDF del proveedor. Reconozco las columnas,
          las presentaciones (“x 500 g”), los rubros y las etiquetas como “sin TACC”. Antes de guardar te muestro cómo la entendí.
        </p>
      </header>

      <a href="/api/admin/import/template" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline">
        <Download size={15} /> Descargar plantilla (opcional)
      </a>

      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files[0] ?? null); }}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 bg-white p-8 text-center hover:border-brand-600">
        {file ? <FileSpreadsheet size={28} className="text-brand-700" /> : <UploadCloud size={28} className="text-stone-400" />}
        <span className="text-sm font-medium">{file ? file.name : "Arrastrá el archivo acá o hacé clic para elegirlo"}</span>
        <span className="text-xs text-stone-500">.xlsx, .xls, .csv, .pdf · hasta 10 MB</span>
        <input id="import-file" type="file" accept={ACCEPT} className="sr-only" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
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
        <section className="space-y-4 rounded-xl bg-white p-4 shadow-[0_1px_0_var(--color-stone-200)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Vista previa (todavía no se guardó nada)</h2>
            {busy && <span className="inline-flex items-center gap-1 text-xs text-stone-500"><RefreshCw size={13} className="animate-spin" /> Actualizando…</span>}
          </div>

          {preview.detected && <Detected det={preview.detected} onChange={(i, f) => changeColumn(preview.detected!, i, f)} disabled={busy} />}
          {preview.sample && preview.sample.length > 0 && <Sample rows={preview.sample} />}

          <Summary r={preview} />
          {preview.errors.length > 0 && <Errors r={preview} />}
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !canImport} onClick={() => run(false)}
              className="rounded-lg bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-900 disabled:opacity-50">
              {busy ? "Procesando…" : preview.errors.length ? "Importar las filas correctas" : "Confirmar importación"}
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

function Detected({ det, onChange, disabled }: { det: ImportDetected; onChange: (index: number, field: string) => void; disabled: boolean }) {
  const where = [
    det.sheets.length > 1 ? `Hojas: ${det.sheets.join(", ")}` : null,
    det.header_row ? `Encabezados en la fila ${det.header_row}` : "Sin fila de encabezados",
    det.skipped ? `${det.skipped} filas de título o sección salteadas` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Así entendí tu archivo</h3>
      <p className="text-xs text-stone-500">{where}</p>
      {det.notes.map((n) => (
        <p key={n} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><Info size={16} className="mt-0.5 shrink-0" />{n}</p>
      ))}
      <p className="text-xs text-stone-500">Si alguna columna quedó mal, cambiala y se vuelve a revisar sola.</p>
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
        <li aria-hidden className="hidden bg-stone-50 px-3 py-2 text-xs text-stone-500 sm:grid sm:grid-cols-[10rem_1fr_15rem] sm:gap-3">
          <span>Columna del archivo</span><span>Ejemplos</span><span>Se usa como</span>
        </li>
        {det.columns.map((c) => (
          <li key={c.index} className="grid gap-1.5 px-3 py-2.5 sm:grid-cols-[10rem_1fr_15rem] sm:items-center sm:gap-3">
            <label htmlFor={`col-${c.index}`} className="font-medium">{c.header}</label>
            <span className="min-w-0 truncate text-sm text-stone-500">{c.examples.join(" · ") || "—"}</span>
            <select id={`col-${c.index}`} disabled={disabled}
              value={c.field ?? ""} onChange={(e) => onChange(c.index, e.target.value)}
              className={`min-h-11 w-full rounded-md border px-2 ${c.field ? "border-brand-600 bg-brand-50" : "border-stone-300 bg-white text-stone-500"}`}>
              <option value="">No usar</option>
              {Object.entries(det.fields).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sample({ rows }: { rows: Record<string, string>[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Primeros productos, como van a quedar</h3>
      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-stone-50 text-xs text-stone-500">
            <tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2">Presentación</th><th className="px-3 py-2">Categoría</th><th className="px-3 py-2 text-right">Precio</th><th className="px-3 py-2">Etiquetas</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const cents = r.precio_centavos ? Number(r.precio_centavos) : null;
              return (
                <tr key={i} className="border-t border-stone-100">
                  <td className="px-3 py-2">{r.nombre}{r.marca ? <span className="text-stone-500"> · {r.marca}</span> : null}</td>
                  <td className="px-3 py-2 text-stone-600">{r.contenido || "Unidad"}</td>
                  <td className="px-3 py-2 text-stone-600">{r.categoria}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{cents != null ? formatARS(cents) : <span className="text-red-700">{r.precio || "—"}</span>}</td>
                  <td className="px-3 py-2 text-xs text-stone-600">{(r.etiquetas || "").split("|").filter(Boolean).join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
          <thead className="text-red-900"><tr><th className="py-1 pr-3">Fila</th><th className="py-1 pr-3">Código</th><th className="py-1">Problema</th></tr></thead>
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
