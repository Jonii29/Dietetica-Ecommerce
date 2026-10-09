// Utilidades de texto y dinero (sin dependencias, usables en server y client).

/** "Quínoa  Orgánica!" -> "quinoa organica" (mismo criterio que backend/app/utils/text.py). */
export function normalize(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ars = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 123450 -> "$ 1.234,50" ; 120000 -> "$ 1.200" */
export function formatARS(cents: number): string {
  return ars.format(cents / 100).replace(/ /g, " ");
}

/** Precio por kg / litro para comparar presentaciones. null si se vende por unidad. */
export function pricePerBaseUnit(priceCents: number, quantity: number, unit: string): string | null {
  if (unit === "u" || quantity <= 0) return null;
  const perK = (priceCents / quantity) * 1000;
  return `${formatARS(Math.round(perK))} / ${unit === "g" ? "kg" : "L"}`;
}
