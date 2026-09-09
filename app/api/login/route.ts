// app/api/login/route.ts
//
// Checks the password you typed on the login page against SITE_PASSWORD
// (an environment variable you set — never hard-coded here). If it
// matches, sets the cookie that middleware.ts checks on every other page.

import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, expectedCookieValue } from "@/lib/auth";

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  const expected = expectedCookieValue();

  if (!expected) {
    // SITE_PASSWORD isn't configured on the server at all.
    return NextResponse.json(
      { error: "SITE_PASSWORD isn't set on the server, so login is disabled." },
      { status: 500 }
    );
  }

  if (password !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE_NAME, expected, {
    httpOnly: true, // JavaScript in the browser can't read this cookie — only the server can. Reduces the damage a malicious script could do.
    // Only require HTTPS in production (Vercel is always HTTPS there).
    // Requiring it during local development would silently break login,
    // since `npm run dev` serves plain http://localhost.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days — stay logged in for a month before needing to type the password again.
    path: "/",
  });
  return res;
}
