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
// remediation UI. Matched against the request path (query stripped).
//
// [#16839] Every test below is ANCHORED to a mount boundary, because the
// allow-list is a set of ROUTES and a route is identified by where it sits,
// not by text appearing somewhere in a path. The two predicates this replaced
// were unanchored — `path.includes('/auth/')` matched at ANY position and a
// suffix test matched at ANY depth — so a segment whose VALUE happened to
// spell an allow-listed token carried the exemption: `/data/auth/123` (an
// object named `auth`), `/data/x/health` (a record whose id is `health`),
// `/data/xyz/me/apps`. Both seams pass a data-plane path straight in
// (`HttpDispatcher.enforceAuthGate`, `RestServer.enforceAuth`), so those were
// reachable requests, and object + record names are tenant-controlled.

/**
 * The mount bases an allow-listed route can sit at, as SEGMENT lists, longest
 * first. `[]` is the dispatcher shape: the hono adapter hands
 * `HttpDispatcher.dispatch` the app prefix already stripped, so a dispatcher
 * path arrives as `/auth/…`, `/health`, `/environments/<id>/auth/…`. The other
 * two are the REST/better-auth mounts (`${basePath}/${version}` and
 * better-auth's own `${basePath}/auth`) at their shipped defaults — the same
 * three bases the pre-anchoring `ALLOW_PREFIXES` enumerated.
 *
 * ⚠️ A host that moves `api.basePath`/`api.version` off those defaults is no
 * longer named here. That is the deliberate price of anchoring and it cannot
 * be avoided: `/rest/v2/health` and `/data/xyz/health` are the SAME SHAPE, so
 * a rule that accepts an arbitrary base is the defect. It costs nothing at
 * either live seam — the dispatcher's path is base-stripped (matched by `[]`),
 * and REST registers its control-plane routes without `enforceAuth` at all.
 */
const MOUNT_BASES: readonly (readonly string[])[] = [['api', 'v1'], ['api'], []];

/**
 * Segments that open an environment scope between the base and the route
 * (`/api/v1/environments/<id>/auth/…`). The dispatcher evaluates the gate
 * BEFORE its scoped-URL strip, so the scoped spelling reaches this predicate;
 * `projects` is ADR-0006's superseded spelling, which the REST scope strip
 * still accepts.
 */
const SCOPE_SEGMENTS: readonly string[] = ['environments', 'projects'];

/**
 * The bootstrap reads, as EXACT routes at a mount (replaces the old
 * `ALLOW_SUFFIXES` endsWith test). `/health`, `/ready` and `/discovery` are
 * the dispatcher's probes and discovery document; `/me/apps` and
 * `/me/localization` are the current-user reads the remediation UI needs
 * (`plugin-hono-server/src/current-user-endpoints.ts`).
 */
const ALLOW_ROUTES: readonly (readonly string[])[] = [
  ['health'],
  ['ready'],
  ['discovery'],
  ['me', 'apps'],
  ['me', 'localization'],
];

/** Do `segments` start with every segment of `prefix`? */
function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  if (segments.length < prefix.length) return false;
  for (let k = 0; k < prefix.length; k++) if (segments[k] !== prefix[k]) return false;
  return true;
}

/** True when `path` is exempt from the auth gate (auth + remediation + health). */
export function isAuthGateAllowlisted(rawPath: string | undefined | null): boolean {
  if (!rawPath) return true;
  // Strip query + trailing slashes WITHOUT a regex (avoids ReDoS on a
  // path of many '/'). char 47 = '/'.
  let path = rawPath.split('?')[0] || '/';
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  path = path.slice(0, end) || '/';
  // Segment view — `''` entries dropped so `//auth//me` cannot smuggle an
  // empty segment past the position tests below.
  const segments = path.split('/').filter((s) => s !== '');
  for (const base of MOUNT_BASES) {
    if (!startsWithSegments(segments, base)) continue;
    let i = base.length;
    let scoped = false;
    // One optional environment scope, and only immediately after the base —
    // which is why `/data/environments/x/health` is NOT a scoped `/health`.
    if (i + 1 < segments.length && SCOPE_SEGMENTS.includes(segments[i] as string)) {
      i += 2;
      scoped = true;
    }
    if (segments[i] === 'auth') {
      // `<base>[/<scope>/<id>]/auth/…` — the remediation surface. This is the
      // anchored replacement for `path.includes('/auth/')`.
      if (i + 1 < segments.length) return true;
      // Bare `<base>/auth`, exempt only UNSCOPED: that is exactly what the old
      // `ALLOW_PREFIXES` equality branch admitted (`/auth`, `/api/auth`,
      // `/api/v1/auth`). The scoped spelling was never exempt and must not
      // become so here — this repair only ever removes exemptions.
      if (!scoped) return true;
    }
    for (const route of ALLOW_ROUTES) {
      if (segments.length - i === route.length && startsWithSegments(segments.slice(i), route)) {
        return true;
      }
    }
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
