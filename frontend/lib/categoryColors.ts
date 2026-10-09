/** Color de fondo por categoría madre (diseño "Feria"). Siempre con texto ink encima. */
const BY_SLUG: Record<string, string> = {
  "frutos-secos": "var(--color-cat-ochre)",
  harinas: "var(--color-cat-wheat)",
  semillas: "var(--color-cat-olive)",
  cereales: "var(--color-cat-olive)",
  suplementos: "var(--color-cat-lavender)",
  endulzantes: "var(--color-cat-sky)",
  untables: "var(--color-cat-coral)",
  galletitas: "var(--color-cat-wheat)",
};
const FALLBACK = ["ochre", "olive", "lavender", "sky", "coral", "wheat"].map((c) => `var(--color-cat-${c})`);

export function categoryColor(slug: string | null | undefined): string {
  if (!slug) return "var(--color-lilac-200)";
  if (BY_SLUG[slug]) return BY_SLUG[slug];
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
