// middleware.ts
//
// WHAT IS "MIDDLEWARE" IN NEXT.JS? It's code that runs BEFORE any page or
// API route handles a request — a checkpoint every request passes through
// first. We use it here as a simple gate: if you don't have the right
// cookie proving you already entered the password, you get redirected to
// the login page instead of the page you asked for.
//
// This is intentionally simple — one shared password for the whole app,
// not real user accounts with sign-up/sign-in/multiple users. That's a
// reasonable fit for a personal, single-user tool like this one; it just
// keeps random visitors who stumble on the URL from poking around.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, expectedCookieValue } from "./lib/auth";

export function middleware(request: NextRequest) {
  // Always allow the login page itself and its API route through —
  // otherwise nobody could ever reach the page that lets them log in.
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || pathname === "/api/login") {
    return NextResponse.next();
  }

  const cookie = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const expected = expectedCookieValue();

  // If SITE_PASSWORD isn't set at all (e.g. you forgot to add it in
  // Vercel), we deliberately DON'T lock you out — we let requests through
  // and print a warning, so a missing env var doesn't accidentally brick
  // your own app. Set SITE_PASSWORD to actually turn the lock on.
  if (!expected) {
    return NextResponse.next();
  }

  if (cookie === expected) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("from", pathname);
  return NextResponse.redirect(loginUrl);
}

// Run this check on every route EXCEPT Next.js's internal files and
// static assets (images, favicon, etc.) — there's no point password-
// protecting those, and doing so can actually break the login page's own
// styling/scripts from loading.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
