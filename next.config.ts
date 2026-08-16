import type { NextConfig } from "next";

/**
 * Content Security Policy.
 *
 * The shop takes names, phone numbers and addresses, and sends customers to a
 * payment page. The attack this closes is a script that gets onto the page —
 * through a dependency, a comment, an injected string — and quietly reads the
 * checkout form or rewrites where "Pay" goes. A policy that names the only
 * places content may come from makes that script have nowhere to send what it
 * reads.
 *
 * `'unsafe-inline'` on styles is Tailwind and Next's own injected styles.
 * `'unsafe-inline'` on scripts is what Next's hydration payload needs without a
 * per-request nonce, which would mean giving up static rendering on the
 * storefront — the pages that carry no customer data at all. The valuable half
 * of the policy is not script-src anyway: it is `connect-src`, `form-action`
 * and `frame-ancestors`, which decide where data can be *sent*.
 */
/**
 * `eval` is what the dev server's hot reloading runs on. Allowing it in
 * production would hand an injected string the one primitive that turns "some
 * text ended up on the page" into "some code ran".
 */
const scriptSrc =
  process.env.NODE_ENV === "production"
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";

const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // Nothing in the browser should be talking to a third party. The gateway is
  // reached by redirecting the customer, not by fetch.
  "connect-src 'self'",
  // Where a form may post. Keeps an injected form from posting the checkout
  // fields somewhere else.
  "form-action 'self'",
  // The shop is never framed, so it cannot be clickjacked.
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  // A year, and only ever served over HTTPS in production.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  // Referrers leak order references out of URLs otherwise.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // Both drivers must stay outside the bundler: pg resolves optional native
  // dependencies at runtime, and PGlite ships a WASM binary the bundler would
  // otherwise try to inline.
  serverExternalPackages: ["pg", "@electric-sql/pglite"],

  // Version and framework fingerprint, given away for nothing.
  poweredByHeader: false,

  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      {
        // An order page shows a customer's name, phone number and address.
        // Nothing between them and it may keep a copy.
        source: "/orders/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
    ];
  },
};

export default nextConfig;
