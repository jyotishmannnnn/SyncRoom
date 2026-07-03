/**
 * Origin allow-list for split deployments (SPA on Vercel, sockets here).
 *
 * `CLIENT_ORIGIN` accepts a comma-separated list. Each entry is either an
 * exact origin (`https://syncroom.vercel.app`) or a wildcard-subdomain
 * pattern (`https://*.vercel.app`) so Vercel preview deployments work
 * without reconfiguring the server. Wildcards match subdomains only —
 * `https://*.vercel.app` allows `https://x.vercel.app` but never
 * `https://evilvercel.app`.
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin: string, allowed: string[]): boolean {
  return allowed.some((pattern) => {
    if (pattern === origin) return true;
    const wildcard = pattern.match(/^(https?):\/\/\*(\..+)$/);
    if (!wildcard) return false;
    const [, scheme, suffix] = wildcard;
    if (!origin.startsWith(`${scheme}://`)) return false;
    const host = origin.slice(`${scheme}://`.length);
    // Require at least one label before the suffix (a real subdomain).
    return host.endsWith(suffix!) && host.length > suffix!.length;
  });
}

/** Socket.IO/Express-compatible origin callback. */
export function makeOriginCheck(
  allowed: string[],
): (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void {
  return (origin, cb) => {
    // No Origin header = same-origin request or non-browser client (curl,
    // health checks) — always allowed.
    if (!origin || isOriginAllowed(origin, allowed)) cb(null, true);
    else cb(new Error('Origin not allowed by CLIENT_ORIGIN'));
  };
}
