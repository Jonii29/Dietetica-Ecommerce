"use client";
/**
 * Carrito persistente en LocalStorage, sin librerías (useSyncExternalStore).
 *  - Sobrevive recargas y se sincroniza entre pestañas (evento "storage").
 *  - Snapshot inmutable => los componentes solo re-renderizan cuando cambia.
 *  - getServerSnapshot devuelve [] => sin errores de hidratación en SSR.
 */
import { useSyncExternalStore } from "react";
import type { CartLine } from "./types";

const KEY = "dietetica:cart:v1";
const MAX_QTY = 99;
const EMPTY: CartLine[] = [];

let lines: CartLine[] = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    lines = Array.isArray(parsed) ? parsed.filter((l) => l && l.sku && l.quantity > 0) : [];
  } catch {
    lines = [];
  }
}

function commit(next: CartLine[]) {
  lines = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* modo privado / cuota llena: el carrito sigue funcionando en memoria */
  }
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  load();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    loaded = false;
    load();
    cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

const getSnapshot = () => {
  load();
  return lines;
};
const getServerSnapshot = () => EMPTY;

export const cart = {
  add(line: Omit<CartLine, "quantity">, quantity = 1) {
    load();
    const existing = lines.find((l) => l.sku === line.sku);
    commit(
      existing
        ? lines.map((l) =>
            l.sku === line.sku ? { ...l, ...line, quantity: Math.min(MAX_QTY, l.quantity + quantity) } : l,
          )
        : [...lines, { ...line, quantity: Math.min(MAX_QTY, quantity) }],
    );
  },
  setQuantity(sku: string, quantity: number) {
    load();
    commit(
      quantity <= 0
        ? lines.filter((l) => l.sku !== sku)
        : lines.map((l) => (l.sku === sku ? { ...l, quantity: Math.min(MAX_QTY, quantity) } : l)),
    );
  },
  remove(sku: string) {
    this.setQuantity(sku, 0);
  },
  clear() {
    commit([]);
  },
};

export function useCart() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const total = items.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const count = items.reduce((a, l) => a + l.quantity, 0);
  return { items, total, count, ...cart };
}
