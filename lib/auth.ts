// lib/auth.ts
//
// Shared logic for the site's single-password lock, used by both
// middleware.ts (checks the cookie on every page) and
// app/api/login/route.ts (sets the cookie when you type the right
// password).
//
// We just store the password itself as the cookie's value. That's safe
// here because: (1) the cookie is marked `httpOnly`, so JavaScript running
// in the browser (including any malicious script from a bug or extension)
// can't read it — only the server can; and (2) it's marked `secure` in
// production, so it's only ever sent over encrypted HTTPS, never in
// plain text over the network. (We originally hashed it with SHA-256
// instead of storing it directly, but Next.js's middleware runs in a
// restricted "Edge Runtime" that doesn't support Node's crypto module —
// so we keep this simple instead.)

export const AUTH_COOKIE_NAME = "ta_auth";

// Returns the value the cookie should hold when you're logged in, or
// null if SITE_PASSWORD isn't configured at all.
export function expectedCookieValue(): string | null {
  const password = process.env.SITE_PASSWORD;
  if (!password) return null;
  return password;
}
