import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

const intlMiddleware = createIntlMiddleware(routing);

const PUBLIC_PATHS = ["/auth/signin", "/auth/signup"];

function isPublicPath(pathname: string): boolean {
  const withoutLocale = pathname.replace(/^\/(zh|en)/, "") || "/";
  if (withoutLocale === "/") return true;
  return PUBLIC_PATHS.some((p) => withoutLocale.startsWith(p));
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const intlResponse = intlMiddleware(req);

  if (!isPublicPath(pathname)) {
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const locale = pathname.match(/^\/(zh|en)/)?.[1] || "zh";
      const signInUrl = new URL(`/${locale}/auth/signin`, req.url);
      signInUrl.searchParams.set("callbackUrl", req.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  return intlResponse;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webp)).*)",
  ],
};
