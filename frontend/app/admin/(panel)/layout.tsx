"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, LogOut, UserRound } from "lucide-react";
import { adminFetch } from "@/lib/admin";

const NAV = [
  { href: "/admin", label: "Resumen" },
  { href: "/admin/pedidos", label: "Pedidos" },
  { href: "/admin/productos", label: "Productos" },
  { href: "/admin/importar", label: "Importar" },
];

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    adminFetch<{ username: string }>("/me").then((u) => setUser(u.username)).catch(() => {});
  }, []);

  // Pedidos a confirmar: cartelito amarillo en "Pedidos" (se actualiza al cambiar de sección)
  useEffect(() => {
    adminFetch<{ counts: Record<string, number> }>("/orders?page_size=1")
      .then((r) => setPending(r.counts?.pending ?? 0)).catch(() => {});
  }, [pathname]);

  async function logout() {
    await adminFetch("/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login?motivo=salio");
  }

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh">
      {/* Marco de madera */}
      <header className="sticky top-0 z-30 bg-[var(--wood)] pt-[env(safe-area-inset-top)] text-[#fbf3df] shadow-[inset_0_-4px_0_var(--wood-dark),0_2px_10px_rgb(0_0_0/0.25)]">
        <div className="mx-auto flex max-w-[1240px] items-center gap-x-4 px-3 md:px-6">
          <Link href="/admin" className="flex min-h-14 items-center whitespace-nowrap font-[family-name:var(--font-chalk)] text-[26px] font-bold leading-none text-[#fbf3df] sm:text-[36px]">
            Panel de la dietética
          </Link>
          <div className="ml-auto flex items-center gap-0.5 font-[family-name:var(--font-hand)] text-[16px]">
            <Link href="/admin/cuenta" aria-label="Mi cuenta" aria-current={pathname.startsWith("/admin/cuenta") ? "page" : undefined}
              className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[#fbf3df] hover:bg-black/10 aria-[current=page]:bg-black/15">
              <UserRound size={18} aria-hidden /> <span className="hidden sm:inline">{user ?? "Mi cuenta"}</span>
            </Link>
            <a href="/" target="_blank" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[#fbf3df] hover:bg-black/10">
              <ExternalLink size={18} aria-hidden /> <span className="hidden sm:inline">Ver tienda</span>
            </a>
            <button onClick={logout} aria-label="Cerrar sesión" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 hover:bg-black/10">
              <LogOut size={18} aria-hidden /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>
      {/* Secciones escritas en tiza */}
      <nav className="border-b-2 border-dashed border-[rgb(244_241_230/0.25)]">
        <div className="mx-auto flex max-w-[1240px] gap-1 overflow-x-auto px-2 pt-1 font-[family-name:var(--font-hand)] [scrollbar-width:none] md:px-5">
          {NAV.map(({ href, label }) => (
            <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}
              className={`flex min-h-12 shrink-0 items-center gap-1.5 border-b-4 px-2.5 text-[18px] md:px-3 transition-colors md:text-[21px] ${
                isActive(href) ? "border-[var(--chalk-yellow)] text-[var(--chalk)]" : "border-transparent text-[rgb(244_241_230/0.72)] hover:text-[var(--chalk)]"}`}>
              {label}
              {href === "/admin/pedidos" && pending > 0 && (
                <span className="rounded-full bg-[var(--chalk-yellow)] px-2 font-[family-name:var(--font-condensed)] text-[13px] font-bold leading-5 text-[var(--board)]" aria-label={`${pending} a confirmar`}>{pending}</span>
              )}
            </Link>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-[1240px] px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
