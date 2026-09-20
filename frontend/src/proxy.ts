import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Optimistic gate: everything except the home page (which doubles as sign-in) needs a session cookie.
// The backend still verifies the signed cookie on every API call.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  if (!request.cookies.has("session") && pathname !== "/") {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\.svg$).*)"],
};
