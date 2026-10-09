"use client";

import { Leaf, Sprout, WheatOff, CandyOff, Flame, MilkOff, Tag as TagIcon } from "lucide-react";
import type { Tag } from "@/lib/types";

const ICONS: Record<string, typeof Leaf> = {
  "sin-tacc": WheatOff,
  vegano: Leaf,
  organico: Sprout,
  "sin-azucar": CandyOff,
  keto: Flame,
  "sin-lactosa": MilkOff,
};

interface Props {
  tags: Tag[];
  selected: string[];
  counts: Record<string, number>;
  onToggle: (slug: string) => void;
}

/** Chips de filtro dietario (se combinan: Sin TACC + Vegano). Muestran cuántos productos quedarían. */
export function DietaryFilter({ tags, selected, counts, onToggle }: Props) {
  return (
    <div role="group" aria-label="Filtrar por condición alimentaria" className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {tags.map((t) => {
        const Icon = ICONS[t.slug] ?? TagIcon;
        const active = selected.includes(t.slug);
        const count = counts[t.slug] ?? 0;
        return (
          <button key={t.slug} type="button" aria-pressed={active} disabled={!active && count === 0} onClick={() => onToggle(t.slug)}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border-2 border-ink px-4 text-sm font-bold transition-colors ${
              active ? "bg-ink text-white" : "bg-white text-ink hover:bg-lilac"
            } disabled:border-lilac-200 disabled:text-ink-soft disabled:opacity-60`}>
            <Icon size={15} aria-hidden />
            {t.name}
            <span className={`text-xs tabular-nums ${active ? "text-white/75" : "text-ink-soft"}`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}
