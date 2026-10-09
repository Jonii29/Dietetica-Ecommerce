import Link from "next/link";
import { ProductForm } from "@/components/admin/ProductForm";

export default function NewProductPage() {
  return (
    <div className="max-w-5xl space-y-4">
      <Link href="/admin/productos" className="text-sm text-stone-500 hover:underline">← Productos</Link>
      <h1 className="text-2xl font-bold">Nuevo producto</h1>
      <ProductForm />
    </div>
  );
}
