// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Security response headers builder.
 *
 * Returns the conservative defaults every production API server should
 * send on every response. Designed to be merged with route-specific
 * headers by the dispatcher (`sendResult`) so all adapters (Hono,
 * Fastify, Express, Next.js, …) get them uniformly without each one
 * re-implementing helmet.
 *
 * What we DO opinionate:
 *   - Content-Security-Policy (api-default: deny everything but self)
 *   - Strict-Transport-Security (HSTS, prod-only — TLS is the caller's
 *     responsibility; we just emit the header)
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY (anti clickjacking)
 *   - Referrer-Policy: no-referrer
 *   - Permissions-Policy: geolocation=(), camera=(), microphone=()
 *   - Cross-Origin-Resource-Policy: same-origin
 *
 * What we DON'T opinionate:
 *   - X-XSS-Protection (deprecated)
 *   - CORS — that's an app concern, configure separately
 *   - CSP for HTML pages — set a different CSP at the SPA host
 *
 * Every header can be overridden or disabled by config.
 */

export interface SecurityHeadersOptions {
  /**
   * Enable HSTS. Set to `true` in production behind TLS. When `false`
   * the Strict-Transport-Security header is omitted.
   * @default false
   */
  hsts?: boolean | {
    /** Max-age in seconds. @default 15552000 (180 days) */
    maxAge?: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  /**
   * Override the Content-Security-Policy header. Pass `false` to omit.
   * @default "default-src 'none'; frame-ancestors 'none'"
   */
  contentSecurityPolicy?: string | false;
  /**
   * Override X-Frame-Options. @default 'DENY'
   */
  frameOptions?: 'DENY' | 'SAMEORIGIN' | false;
  /**
   * Override Referrer-Policy. @default 'no-referrer'
   */
  referrerPolicy?: string | false;
  /**
   * Override Permissions-Policy. Pass `false` to omit.
   * @default 'geolocation=(), camera=(), microphone=(), payment=()'
   */
  permissionsPolicy?: string | false;
  /**
   * Override Cross-Origin-Resource-Policy. @default 'same-origin'
   */
  corp?: 'same-origin' | 'same-site' | 'cross-origin' | false;
  /**
   * Free-form extra headers merged last.
   */
  extra?: Record<string, string>;
}

/**
 * Build a header map ready to be `Object.assign`'d into a response.
 * Idempotent and synchronous — safe to call per-request.
 */
export function buildSecurityHeaders(opts: SecurityHeadersOptions = {}): Record<string, string> {
  const h: Record<string, string> = {};

  if (opts.contentSecurityPolicy !== false) {
    h['Content-Security-Policy'] =
      opts.contentSecurityPolicy ?? "default-src 'none'; frame-ancestors 'none'";
  }

  if (opts.hsts) {
    const cfg = typeof opts.hsts === 'object' ? opts.hsts : {};
    const maxAge = cfg.maxAge ?? 15_552_000;
    const parts = [`max-age=${maxAge}`];
    if (cfg.includeSubDomains ?? true) parts.push('includeSubDomains');
    if (cfg.preload) parts.push('preload');
    h['Strict-Transport-Security'] = parts.join('; ');
  }

  h['X-Content-Type-Options'] = 'nosniff';

  if (opts.frameOptions !== false) {
    h['X-Frame-Options'] = opts.frameOptions ?? 'DENY';
  }

  if (opts.referrerPolicy !== false) {
    h['Referrer-Policy'] = opts.referrerPolicy ?? 'no-referrer';
  }

  if (opts.permissionsPolicy !== false) {
    h['Permissions-Policy'] =
      opts.permissionsPolicy ?? 'geolocation=(), camera=(), microphone=(), payment=()';
  }

  if (opts.corp !== false) {
    h['Cross-Origin-Resource-Policy'] = opts.corp ?? 'same-origin';
  }

  if (opts.extra) {
    Object.assign(h, opts.extra);
  }

  return h;
}
