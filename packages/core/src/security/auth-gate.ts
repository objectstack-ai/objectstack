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

import type { ExecutionContext } from '@objectstack/spec/kernel';

/**
 * The gate posture, DERIVED from its declaration on `ExecutionContextSchema`
 * (`packages/spec/src/kernel/execution-context.zod.ts`) rather than restated
 * here (#7280).
 *
 * It was a hand-written interface while the envelope field was undeclared, so
 * the two could have drifted with nothing to catch it — the exact class of
 * defect the closed entry field set (#6216) exists to make unrepresentable.
 * One declaration, one type.
 */
export type AuthGate = NonNullable<ExecutionContext['authGate']>;

/** Message used when a session's gate names a `code` but no usable `message`. */
const DEFAULT_AUTH_GATE_MESSAGE = 'Access is blocked by an authentication policy.';

/**
 * Normalize the `authGate` a better-auth session user carries into the shape
 * `ExecutionContextSchema` declares — or `null` when there is no gate.
 *
 * The session user crosses an external boundary as `any`, so this is where the
 * declared contract is actually met: a gate naming no string `code` is not a
 * gate, and a missing/blank `message` is filled with the default rather than
 * riding onto the envelope (and into a `403` body) as `undefined`. Both
 * consumers normalize HERE, at the one producer, instead of tolerating a loose
 * shape downstream: {@link evaluateAuthGate} for the seams that decide per
 * path, and REST's `computeExecCtx` for the seam that lifts the posture onto
 * the execution context.
 */
export function normalizeAuthGate(sessionUser: any): AuthGate | null {
  const gate = sessionUser?.authGate;
  if (!gate || typeof gate.code !== 'string') return null;
  return {
    code: gate.code,
    message:
      typeof gate.message === 'string' && gate.message ? gate.message : DEFAULT_AUTH_GATE_MESSAGE,
  };
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
  const gate = normalizeAuthGate(sessionUser);
  if (!gate) return null;
  if (isAuthGateAllowlisted(path)) return null;
  return gate;
}
