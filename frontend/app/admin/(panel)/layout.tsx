"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, LogOut } from "lucide-react";
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

  useEffect(() => {
    adminFetch<{ username: string }>("/me").then((u) => setUser(u.username)).catch(() => {});
  }, []);

  async function logout() {
    await adminFetch("/logout", { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
  }

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-brand-700 pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-4 gap-y-0 px-4 pt-1.5 md:px-6 md:pt-3">
          <Link href="/admin" className="flex min-h-11 items-center font-[family-name:var(--font-condensed)] text-[22px] font-bold leading-none text-white sm:text-[26px]">
            Dietética · gestión
          </Link>
          <div className="ml-auto flex items-center gap-1 text-sm">
            {user && <span className="mr-2 hidden text-white/80 sm:inline">{user}</span>}
            <a href="/" target="_blank" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 font-semibold text-white hover:bg-white/10">
              <ExternalLink size={15} aria-hidden /> <span className="hidden sm:inline">Ver tienda</span>
            </a>
            <button onClick={logout} aria-label="Cerrar sesión" className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2.5 font-semibold hover:bg-white/10">
              <LogOut size={15} aria-hidden /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
          <nav className="-mb-px flex basis-full gap-1 overflow-x-auto [scrollbar-width:none]">
            {NAV.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined}
                className={`flex min-h-11 shrink-0 items-center border-b-4 px-3 text-[15px] font-semibold transition-colors ${
                  isActive(href) ? "border-highlight text-white" : "border-transparent text-white/75 hover:text-white"}`}>
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
