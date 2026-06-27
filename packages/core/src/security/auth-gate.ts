// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — authentication-policy session gate.
 *
 * Some auth policies (password expiry, enforced MFA) must block an
 * authenticated user from PROTECTED RESOURCES until they remediate, while
 * still letting them reach the auth endpoints (change-password, two-factor
 * enrollment, sign-out) and a few UI-bootstrap reads.
 *
 * The posture is computed ONCE, in the auth `customSession` enrichment, and
 * attached to the session user as `user.authGate = { code, message }`. The
 * transport seams (REST middleware, dispatcher) then call
 * {@link evaluateAuthGate} to decide whether THIS request is blocked. Keeping
 * the allow-list + decision in one pure function means the seams can never
 * drift on what is blocked.
 */

export interface AuthGate {
  /** Stable machine code, e.g. `PASSWORD_EXPIRED` / `MFA_REQUIRED`. */
  code: string;
  /** Human-facing message. */
  message: string;
}

// Endpoints a gated user MUST still reach to remediate or bootstrap the
// remediation UI. Matched against the request path (query stripped). Covers
// both REST (`/api/v1/auth/…`) and dispatcher (`/auth/…`) path shapes.
const ALLOW_PREFIXES = ['/api/v1/auth/', '/api/auth/', '/auth/'];
const ALLOW_SUFFIXES = ['/health', '/ready', '/discovery', '/me/apps', '/me/localization'];

/** True when `path` is exempt from the auth gate (auth + remediation + health). */
export function isAuthGateAllowlisted(rawPath: string | undefined | null): boolean {
  if (!rawPath) return true;
  // Strip query + trailing slashes WITHOUT a regex (avoids ReDoS on a
  // path of many '/'). char 47 = '/'.
  let path = rawPath.split('?')[0] || '/';
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  path = path.slice(0, end) || '/';
  // Any path with an `/auth/` segment is an auth endpoint (covers project-
  // scoped mounts like `/api/v1/environments/:env/auth/...`).
  if (path.includes('/auth/')) return true;
  for (const p of ALLOW_PREFIXES) {
    if (path.startsWith(p) || path === p.replace(/\/$/, '')) return true;
  }
  for (const s of ALLOW_SUFFIXES) {
    if (path.endsWith(s)) return true;
  }
  return false;
}

/**
 * Returns the active gate when `sessionUser` carries an `authGate` AND `path`
 * is not allow-listed; otherwise null. Anonymous users (no `authGate`) and
 * allow-listed paths always pass.
 */
export function evaluateAuthGate(sessionUser: any, path: string): AuthGate | null {
  const gate = sessionUser?.authGate;
  if (!gate || typeof gate.code !== 'string') return null;
  if (isAuthGateAllowlisted(path)) return null;
  return {
    code: gate.code,
    message:
      typeof gate.message === 'string' && gate.message
        ? gate.message
        : 'Access is blocked by an authentication policy.',
  };
}
