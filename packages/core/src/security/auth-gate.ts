// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 — authentication-policy session gate.
 *
 * Some auth policies (password expiry, enforced MFA) must block an
 * authenticated user from PROTECTED RESOURCES until they remediate, while
 * still letting them reach the auth endpoints (change-password, two-factor
 * enrollment, sign-out), a few UI-bootstrap reads, and the ADR-0043 approval
 * action page, which no session authenticates at all.
 *
 * The posture is computed ONCE, in the auth `customSession` enrichment, and
 * attached to the session user as `user.authGate = { code, message }`. The
 * transport seams (REST middleware, dispatcher) then call
 * {@link evaluateAuthGate} to decide whether THIS request is blocked. Keeping
 * the allow-list + decision in one pure function means the seams can never
 * drift on what is blocked.
 */

import type { ExecutionContext, AuthGateScope } from '@objectstack/spec/kernel';
import { AUTH_GATE_SCOPES, AuthGateCodeSchema } from '@objectstack/spec/kernel';

/**
 * The gate posture, DERIVED from its declaration on `ExecutionContextSchema`
 * (`packages/spec/src/kernel/execution-context.zod.ts`) rather than restated
 * here (#7280).
 *
 * It was a hand-written interface while the envelope field was undeclared, so
 * the two could have drifted with nothing to catch it — the exact class of
 * defect the closed entry field set (commit f586f1a89) exists to make unrepresentable.
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
  // [#23287, ruling C′ item 1] The code is a member of the CLOSED posture
  // vocabulary (`AuthGateCodeSchema`) or it is not a declared posture at all —
  // the same verdict a non-string code gets. Its one producer (plugin-auth's
  // `resolveUserAuthGates`) is typed against that vocabulary, so this arm is
  // reached only by a producer that bypassed the declaration.
  const code = AuthGateCodeSchema.safeParse(gate.code);
  if (!code.success) return null;
  return {
    code: code.data,
    message:
      typeof gate.message === 'string' && gate.message ? gate.message : DEFAULT_AUTH_GATE_MESSAGE,
  };
}

/**
 * [ADR-0069 · #23287, ruling C′ item 1] What `gate` HOLDS, read off the one
 * declaration (`AUTH_GATE_SCOPES`, `@objectstack/spec/kernel`): `account` holds
 * every credential of the user, `credential` holds password sign-in alone.
 */
export function authGateScope(gate: AuthGate): AuthGateScope {
  return AUTH_GATE_SCOPES[gate.code];
}

/**
 * [ADR-0069 · #23287, ruling C′ item 3] The per-user posture computation the
 * auth service exposes (`IAuthService.resolveUserAuthGates`), as the API-key
 * admission seam asks it: every posture `userId` holds, most urgent first.
 * `organizationId` is the organization the credential operates in.
 */
export type UserAuthGateSource = (
  userId: string,
  options: { organizationId?: string },
) => Promise<readonly AuthGate[]>;

/**
 * Bind an auth service's per-user posture computation into the
 * {@link UserAuthGateSource} a transport hands `resolveAuthzContext`, or
 * `undefined` when the service implements none (a kernel composed without
 * `plugin-auth` has no policy to hold anyone with). Structural on purpose:
 * `@objectstack/core` does not depend on the plugin that provides it.
 *
 * The bound source normalizes every entry through {@link normalizeAuthGate},
 * so a posture outside the closed vocabulary never reaches a door.
 */
export function userAuthGateSourceOf(
  authService: {
    resolveUserAuthGates?(userId: string, options?: { organizationId?: string }): Promise<readonly unknown[]>;
  } | null | undefined,
): UserAuthGateSource | undefined {
  if (!authService || typeof authService.resolveUserAuthGates !== 'function') return undefined;
  const service = authService;
  return async (userId, options) => {
    const gates = await service.resolveUserAuthGates!(userId, options);
    if (!Array.isArray(gates)) return [];
    const out: AuthGate[] = [];
    for (const raw of gates) {
      const gate = normalizeAuthGate({ authGate: raw });
      if (gate) out.push(gate);
    }
    return out;
  };
}

/**
 * The first `account`-scope posture in `gates` — the one an API key whose
 * owner holds `gates` is refused with — or `null` when every posture held is
 * `credential`-scope (or none is held). Order is the source's: most urgent first.
 */
export function accountScopeAuthGate(gates: readonly AuthGate[]): AuthGate | null {
  for (const gate of gates) if (authGateScope(gate) === 'account') return gate;
  return null;
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
 *
 * `/approvals/act` is the ADR-0043 approval action page: `GET` renders the
 * confirm page, `POST` redeems. It is session-less by design. The single-use
 * token the request carries is its entire authorization, and the decision is
 * recorded as the approver that token binds, never as the session. The
 * self-hosted mount (`plugin-approvals`, `ACT_PATH = '/api/v1/approvals/act'`
 * on the raw host app) has never passed through this gate. This entry gives
 * the dispatcher's spelling of the same route the same token-only
 * authentication and nothing more (ruling A on #22438). The same holds for
 * `shouldDenyAnonymous` (`anonymous-deny.ts`), which reads this allow-list for
 * its control-plane exemption when a seam passes it a path: ADR-0043 serves
 * this page to a bearer with no session at all.
 *
 * ⛔ It is the exact route, matched like every entry above: no `approvals`
 * prefix, no wildcard, and no other approvals path. `/approvals/act/x`,
 * `/approvals/actx` and every `/approvals/requests/…` route stay gated.
 * Admitting anything wider than the self-hosted mount's authentication
 * loosens a security boundary, and that decision is the maintainer's.
 */
const ALLOW_ROUTES: readonly (readonly string[])[] = [
  ['health'],
  ['ready'],
  ['discovery'],
  ['me', 'apps'],
  ['me', 'localization'],
  ['approvals', 'act'],
];

/**
 * One PARAMETERISED row: a route of literal segments and `:name` parameters,
 * exempt for the METHODS it names and no other. A parameter matches exactly one
 * segment, of any value; a literal matches itself, unencoded.
 */
interface ParameterisedAllowRoute {
  readonly segments: readonly string[];
  readonly methods: readonly string[];
}

/**
 * `POST /automation/hooks/:flowName/:hookId` — the inbound hook a third-party
 * sender posts a signed event through to start an `api` flow (ADR-0041 Tier 1),
 * admitted with no session by ruling A on #22757 (director record `6105447950`).
 * The self-hosted raw-app mount (`@objectstack/trigger-api`, `HOOKS_PATH`) has
 * never passed through this gate, and the sender has no session at all: the
 * HMAC over the body, under the hook's own secret, is its whole credential, and
 * the trigger-api service verifies it (`ITriggerApiService.handleInboundHook`).
 * This row gives the dispatcher's spelling of the same route the same
 * signature-only authentication, read by every seam that asks this list —
 * the ADR-0069 gate, and `shouldDenyAnonymous` (`anonymous-deny.ts`), which
 * the `/automation` domain's anonymous floor calls with its path and method.
 *
 * ⛔ Ruling condition 1, exactness. Exactly four segments, `POST` only, no
 * prefix and no wildcard beyond the two parameters: `/automation/hooks`,
 * `/automation/hooks/x`, `/automation/hooks/x/y/z`, any other method and every
 * other `/automation` path stay gated. Anything wider returns to #22757.
 */
const INBOUND_HOOK_ROUTE: ParameterisedAllowRoute = {
  segments: ['automation', 'hooks', ':flowName', ':hookId'],
  methods: ['POST'],
};

/**
 * The parameterised rows. Unlike {@link ALLOW_ROUTES} they are read in the
 * DISPATCHER's spelling only, by {@link matchParameterisedRoute}: the route
 * exists on the dispatcher alone, and a row must not admit a spelling the
 * dispatcher's router reads differently.
 */
const ALLOW_PARAMETERISED_ROUTES: readonly ParameterisedAllowRoute[] = [INBOUND_HOOK_ROUTE];

/**
 * The segments of `rawPath` as a parameterised row reads them, or `null` for a
 * spelling it does not read at all. Query and trailing slashes are stripped as
 * for every row; nothing is percent-decoded.
 *
 * ⛔ A spelling with an EMPTY segment is not read, rather than read with the
 * empty segments dropped as {@link matchesAllowlistedRoute} drops them. The
 * dispatcher's scope strip (`/environments/:id`, which needs a non-empty id
 * right after its slash) and its domain claims do not drop them, so a dropped
 * reading could admit a path the router serves as a different route or as
 * none: `/environments//env_1/automation/hooks/f/h` is a scoped hook here and an
 * unrouted path there. One reading, the router's, and every other spelling
 * stays gated.
 */
function canonicalRouteSegments(rawPath: string): string[] | null {
  let path = rawPath.split('?')[0] ?? '';
  let end = path.length;
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--;
  path = path.slice(0, end);
  if (path.length < 2 || path.charCodeAt(0) !== 47) return null;
  const segments = path.slice(1).split('/');
  return segments.includes('') ? null : segments;
}

/**
 * The parameters `route` binds on `rawPath` + `method`, RAW (still
 * percent-encoded, as the path carries them), or `null` when it does not match.
 *
 * Read as the dispatcher's router reads it: no mount base (the dispatcher's path
 * arrives with the app prefix stripped), and one optional environment scope in
 * the one spelling its scope strip removes (`/environments/:id`, never the
 * retired `projects`), because the ADR-0069 gate and the membership gate both
 * run BEFORE that strip. The segment count is pinned by the route's own length.
 *
 * ⛔ No method, no match: an exemption the route earns only for the methods it
 * names cannot be earned by a caller that does not say which method it asks for.
 */
function matchParameterisedRoute(
  route: ParameterisedAllowRoute,
  rawPath: string | undefined | null,
  method: string | undefined | null,
): Record<string, string> | null {
  if (!rawPath || typeof method !== 'string' || !route.methods.includes(method.toUpperCase())) return null;
  const segments = canonicalRouteSegments(rawPath);
  if (!segments) return null;
  const rest = segments[0] === 'environments' && segments.length > 1 ? segments.slice(2) : segments;
  if (rest.length !== route.segments.length) return null;
  const params: Record<string, string> = {};
  for (let k = 0; k < rest.length; k++) {
    const want = route.segments[k] as string;
    const got = rest[k] as string;
    if (want.startsWith(':')) params[want.slice(1)] = got;
    else if (got !== want) return null;
  }
  return params;
}

/** The inbound hook's two path parameters, as {@link matchInboundHookRoute} reads them. */
export interface InboundHookRouteMatch {
  /** The flow's name, raw: still percent-encoded as the path carries it. */
  readonly flowName: string;
  /** The hook id, raw: still percent-encoded as the path carries it. */
  readonly hookId: string;
}

/**
 * Is `path` + `method` the inbound hook route the allow-list admits, and with
 * which parameters? The ONE reading of that route: the allow-list row matches
 * through it, and the dispatcher's `/automation` domain and membership gate ask
 * it too, so the readers that admit the route and the reader that serves it
 * cannot disagree on any spelling. Same reading as the row (dispatcher spelling,
 * one optional `/environments/:id` scope, no empty segment, `POST` only).
 *
 * The parameters come back RAW. Decoding them is the serving domain's job, as
 * for every dispatcher domain that reads a path segment.
 */
export function matchInboundHookRoute(
  path: string | undefined | null,
  method: string | undefined | null,
): InboundHookRouteMatch | null {
  const params = matchParameterisedRoute(INBOUND_HOOK_ROUTE, path, method);
  return params ? { flowName: params.flowName as string, hookId: params.hookId as string } : null;
}

/** Do `segments` start with every segment of `prefix`? */
function startsWithSegments(segments: readonly string[], prefix: readonly string[]): boolean {
  if (segments.length < prefix.length) return false;
  for (let k = 0; k < prefix.length; k++) if (segments[k] !== prefix[k]) return false;
  return true;
}

/**
 * Does this REAL, non-empty path name an allow-listed route?
 *
 * The ROUTE half of the decision, split out of {@link isAuthGateAllowlisted}
 * (#7898) so that predicate carries exactly ONE meaning. It used to carry two:
 * a genuine allow-list decision, and "no path" silently reusing the *allow*
 * answer. This half is reached only with a non-empty string and its body is
 * unchanged by that split — the anchoring rules below are #16839's, untouched.
 */
function matchesAllowlistedRoute(rawPath: string): boolean {
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
      // `<base>[/<scope>/<id>]/auth/…` — the auth NAMESPACE, kept reachable so
      // a held user can remediate. This is the anchored replacement for
      // `path.includes('/auth/')`.
      //
      // ⚠️ The namespace is wider than remediation: the platform-admin family
      // is mounted under it too, and administration is a protected resource
      // (ADR-0069 D3). That family is held to the gate by consulting
      // `evaluateAuthGate` PATHLESS at its own judge (`platform-admin-gate.ts`
      // in plugin-auth), so it never inherits this arm. ⛔ A protected family
      // mounted under this namespace does the same; it never passes its path.
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
 * True when `path` is exempt from the auth gate (auth + remediation + health,
 * and the ADR-0043 approval action page).
 *
 * ## FAIL-CLOSED on an absent or empty path (#7898)
 *
 * A falsy path is **not exempt**. This used to answer `true` — a fail-OPEN
 * default: any caller that reached the ADR-0069 gate with an absent or empty
 * path was silently exempted on EVERY route, and a transport author who simply
 * forgot to populate `path` disabled the gate without a single diagnostic.
 * Exemption is now something a path has to EARN by naming an allow-listed
 * route, so the failure mode of omission is a 403, not a bypass.
 *
 * ⚠️ The exemption that remains for a genuinely PATHLESS caller is explicit and
 * lives at the one seam that really routes by body: `shouldDenyAnonymous`
 * (`anonymous-deny.ts`) declares `path` optional and decides the no-path case
 * itself, ahead of this predicate. ⛔ Do not re-derive that tolerance here or
 * at any other caller — a seam that has a path passes it, and a seam that has
 * none says so in its own contract.
 *
 * ⚠️ One shipped input's answer moves: the dispatcher's bare-root `${prefix}/`
 * arrives as `cleanPath === ''` (`http-dispatcher.ts` strips the trailing
 * slash), which was exempt via the fail-open default and is not exempt now.
 * Normalising that `'' → '/'` at the dispatcher is the ruling's step 2, tracked
 * as #17625 (`domain:cli`, `Blocked-by: #7898`) — ⛔ not a tolerance to add back
 * here.
 *
 * ## `method` is read by the parameterised rows only (#22773)
 *
 * Every {@link ALLOW_ROUTES} row is exempt for every method, as before, so a
 * caller that passes no method gets exactly the answer it always got. A
 * parameterised row ({@link ALLOW_PARAMETERISED_ROUTES}) is exempt only for the
 * methods it names, and only for a caller that names one: no method, no
 * exemption on that row.
 */
export function isAuthGateAllowlisted(rawPath: string | undefined | null, method?: string | null): boolean {
  if (!rawPath) return false;
  if (matchesAllowlistedRoute(rawPath)) return true;
  return ALLOW_PARAMETERISED_ROUTES.some((route) => matchParameterisedRoute(route, rawPath, method) !== null);
}

/**
 * Returns the active gate when `sessionUser` carries an `authGate` AND `path`
 * (+ `method`, read as {@link isAuthGateAllowlisted} reads it) is not
 * allow-listed; otherwise null. Anonymous users (no `authGate`) and
 * allow-listed paths always pass.
 */
export function evaluateAuthGate(sessionUser: any, path: string, method?: string | null): AuthGate | null {
  const gate = normalizeAuthGate(sessionUser);
  if (!gate) return null;
  if (isAuthGateAllowlisted(path, method)) return null;
  return gate;
}
