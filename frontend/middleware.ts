import { NextResponse, type NextRequest } from "next/server";

/** Sin cookie de sesión, cualquier página de /admin redirige al login.
 *  (La validación real la hace el backend en cada request; esto solo evita mostrar
 *  el panel vacío a quien no inició sesión.) */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/admin/login")) return NextResponse.next();
  if (!req.cookies.has("dietetica_admin")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*"] };
