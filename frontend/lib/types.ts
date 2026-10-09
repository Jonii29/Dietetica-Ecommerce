// Contratos compartidos con el backend (ver backend/app/schemas.py). Montos en CENTAVOS.

export type TagKind = "dietary" | "general";

export interface Tag {
  slug: string;
  name: string;
  kind: TagKind;
}

export interface Category {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
}

export interface Variant {
  sku: string;
  label: string; // "500 g", "Frasco 380 g"
  sale_type: "peso" | "unidad";
  quantity: number; // 500
  unit: "g" | "ml" | "u";
  price: number; // centavos
  compare_at_price: number | null;
  in_stock: boolean;
}

export interface CatalogProduct {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  image: string | null;
  category: string | null; // slug categoría madre
  subcategory: string | null;
  tags: string[]; // slugs
  search: string; // texto normalizado para búsqueda
  variants: Variant[];
}

export interface Catalog {
  version: string;
  categories: Category[];
  tags: Tag[];
  products: CatalogProduct[];
}

export interface CartLine {
  sku: string;
  slug: string;
  name: string;
  label: string;
  unitPrice: number; // centavos (precio al momento de agregar; el server recalcula)
  quantity: number;
  image: string | null;
}

export interface CustomerInfo {
  name: string;
  phone?: string;
  delivery_method: "retiro" | "envio";
  address?: string;
  notes?: string;
}
