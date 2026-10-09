import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWhatsAppMessage, buildWhatsAppUrl } from "./whatsapp";
import { runSearch, buildIndex, similarity } from "./search";
import type { CartLine, CatalogProduct } from "./types";

const lines: CartLine[] = [
  { sku: "CHIA-250", slug: "chia", name: "Semillas de chía", label: "250 g", unitPrice: 180000, quantity: 1, image: null },
  { sku: "ALM-500", slug: "alm", name: "Almendras peladas", label: "500 g", unitPrice: 810000, quantity: 2, image: null },
];

test("mensaje de WhatsApp ordenado y totalizado", () => {
  const msg = buildWhatsAppMessage(lines, {
    storeName: "Dietética", orderCode: "D-ABC123",
    customer: { name: "Ana", delivery_method: "envio", address: "Av. Siempre Viva 742" },
  });
  assert.match(msg, /Pedido: \*D-ABC123\*/);
  assert.ok(msg.indexOf("Almendras") < msg.indexOf("chía"), "orden alfabético");
  assert.match(msg, /2 × Almendras peladas \(500 g\)/);
  assert.match(msg, /\*TOTAL: \$ 18\.000\*/);
  assert.match(msg, /Envío a: Av\. Siempre Viva 742/);
  console.log(msg);
});

test("URL de wa.me codificada", () => {
  const url = buildWhatsAppUrl("+54 9 11 1234-5678", "Hola & chau\n#1");
  assert.equal(url, "https://wa.me/5491112345678?text=Hola%20%26%20chau%0A%231");
});

test("búsqueda tolerante a tildes, typos y sinónimos", () => {
  const mk = (id: number, name: string, search: string, tags: string[] = []): CatalogProduct => ({
    id, slug: String(id), name, brand: null, image: null, category: "c", subcategory: null, tags, search,
    variants: [{ sku: `S${id}`, label: "1 kg", sale_type: "peso", quantity: 1000, unit: "g", price: 100, compare_at_price: null, in_stock: true }],
  });
  const idx = buildIndex([
    mk(1, "Quinoa blanca", "quinoa blanca lavada quinua cereales sin tacc vegano", ["sin-tacc"]),
    mk(2, "Harina de almendras", "harina de almendras almond flour harinas sin tacc", ["sin-tacc"]),
    mk(3, "Harina integral", "harina integral de trigo harinas"),
  ]);
  const q = (query: string, tags: string[] = []) =>
    runSearch(idx, { query, tags, category: null, sort: "relevance" }).items.map((d) => d.product.id);
  assert.deepEqual(q("quínoa"), [1]);
  assert.deepEqual(q("harina almendras"), [2]);
  assert.deepEqual(q("harina", ["sin-tacc"]), [2]);
  assert.deepEqual(q("almedras"), [2]); // typo
  assert.deepEqual(q("gluten free harina"), [2]);
  assert.ok(similarity("almedras", "almendras") > 0.9);
});
