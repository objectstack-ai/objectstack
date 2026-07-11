// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * resolveExecutionContext — REST/dispatcher entry-point identity resolver.
 *
 * Thin adapter over the SINGLE shared authorization resolver
 * (`resolveAuthzContext` in `@objectstack/core/security`). This function only
 * does the transport-specific plumbing — pull `ql` and the better-auth session
 * getter out of the active kernel/scope — then delegates ALL identity +
 * position/permission/RLS aggregation to the shared resolver, and layers the
 * reference localization (timezone/locale) on top.
 *
 * The actual table reads (`sys_member` / `sys_user_position` /
 * `sys_*_permission_set`), the platform-admin derivation and the `ai_seat`
 * synthesis live in ONE place now (`@objectstack/core`), shared with the REST
 * server, so the two entry points can never drift on authorization again.
 *
 * Always resolves — never throws. Anonymous requests yield
 * `{ isSystem: false, positions: [], permissions: [] }`.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import { scopesToAgentPermissionSets, MCP_OAUTH_SCOPE_ACTIONS } from '@objectstack/spec/ai';

import {
  resolveAuthzContext,
  resolveLocalizationContext,
} from '@objectstack/core';

interface ResolveOptions {
  /** Function returning a service from the active kernel (or undefined). */
  getService: (name: string) => Promise<any> | any;
  /** Function returning the data engine (ObjectQL) for the active scope. */
  getQl: () => Promise<any> | any;
  /** The raw incoming HTTP request (Fetch Request, Node IncomingMessage, …). */
  request: any;
  /**
   * Opt-in (#2698): also accept an OAuth 2.1 ACCESS TOKEN as the Bearer
   * credential, verified against this deployment's embedded authorization
   * server (`authService.verifyMcpAccessToken`). ONLY the MCP dispatch path
   * sets this — OAuth tokens carry coarse tool-family scopes that are
   * enforced at MCP tool dispatch, so honouring them on other surfaces
   * (REST/GraphQL) would bypass that scope model entirely.
   *
   * Fail-closed: when a JWT-shaped Bearer is presented and does NOT verify
   * (unknown/expired/revoked/wrong audience), the request resolves as
   * ANONYMOUS — it never falls back to a cookie session, so a dead token
   * can't ride along on ambient browser state.
   */
  acceptOAuthAccessToken?: boolean;
}

/**
 * A compact-JWS-shaped Bearer token (three dot-separated segments) that is
 * not an ObjectStack API key. better-auth session bearers are opaque (no
 * dots) and API keys carry the `osk_` prefix, so the shape alone routes the
 * token to the right verifier without ambiguity.
 */
function extractJwtBearer(headers: Headers): string | undefined {
  const auth = headers.get('authorization');
  const bearer = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer || bearer.startsWith('osk_')) return undefined;
  return bearer.split('.').length === 3 ? bearer : undefined;
}

/**
 * Convert the dispatcher's plain `Record<string,string>` headers map into a Web
 * `Headers` instance so better-auth (which reads via `headers.get('cookie')`)
 * works uniformly.
 */
function toHeaders(input: any): any {
  if (!input) return new Headers();
  if (typeof Headers !== 'undefined' && input instanceof Headers) return input;
  const h = new Headers();
  if (typeof input.entries === 'function') {
    for (const [k, v] of input.entries()) h.set(String(k), String(v));
    return h;
  }
  for (const k of Object.keys(input)) {
    const v = (input as any)[k];
    if (v == null) continue;
    h.set(String(k), Array.isArray(v) ? v.join(',') : String(v));
  }
  return h;
}

export async function resolveExecutionContext(opts: ResolveOptions): Promise<ExecutionContext> {
  const headers = toHeaders(opts.request?.headers);
  const ql = await opts.getQl();

  // ── OAuth 2.1 access-token provenance (MCP surface only, #2698) ──
  // Verified BEFORE session resolution so the presented credential decides
  // the outcome. Verification lives in the auth service (it owns the AS +
  // JWKS); the *authorization* resolution below still flows through the
  // single shared resolver — OAuth is a second provenance for the
  // principal, never a second authz model.
  let oauthPrincipal: { userId: string; scopes: string[]; clientId?: string } | undefined;
  let oauthBearerPresented = false;
  if (opts.acceptOAuthAccessToken) {
    const jwtBearer = extractJwtBearer(headers);
    if (jwtBearer) {
      oauthBearerPresented = true;
      try {
        const authService: any = await opts.getService('auth');
        const verified = await authService?.verifyMcpAccessToken?.(jwtBearer);
        if (verified?.userId && Array.isArray(verified.scopes)) {
          oauthPrincipal = verified;
        }
      } catch {
        // verification error → fail closed (anonymous), handled below
      }
    }
  }

  // The auth service surfaces better-auth either as `.api` (legacy direct mount)
  // or via `await getApi()` (lazy plugin). Build a session getter that tolerates
  // both, and degrades to anonymous when auth isn't wired up.
  const getSession = async (h: any) => {
    try {
      const authService: any = await opts.getService('auth');
      let api: any = authService?.api;
      if (!api && typeof authService?.getApi === 'function') api = await authService.getApi();
      return await api?.getSession?.({ headers: h });
    } catch {
      return undefined;
    }
  };

  // Session getter by provenance:
  //  - verified OAuth token → synthetic session for the token's principal
  //    (roles/permissions/RLS still aggregate through resolveAuthzContext);
  //  - JWT bearer presented but NOT verified → hard anonymous (no cookie
  //    fallback — a dead token must yield 401, not ambient session access);
  //  - otherwise → the regular better-auth session path.
  const getSessionForProvenance = oauthPrincipal
    ? async () => ({ user: { id: oauthPrincipal!.userId } })
    : oauthBearerPresented
      ? async () => undefined
      : getSession;

  const authz = await resolveAuthzContext({ ql, headers, getSession: getSessionForProvenance });

  const ctx: ExecutionContext = {
    positions: authz.positions,
    permissions: authz.permissions,
    systemPermissions: authz.systemPermissions,
    isSystem: false,
  };
  // [ADR-0090 D9/D10] Principal taxonomy at the HTTP entry: a session-backed
  // request is a human principal; a sessionless one is a guest, holding the
  // built-in `guest` position implicitly and exclusively. Internal engine
  // calls that construct bare contexts are untouched (they never pass
  // through this resolver), so the security plugin's empty-context skip
  // path keeps its meaning.
  if (authz.userId) {
    if (oauthPrincipal?.clientId) {
      // [ADR-0090 D10 — agent principal] An OAuth access token that names an
      // authorized client (`azp`) is an AI agent acting ON BEHALF OF the human
      // `sub` (OAuth bearers reach here only on the `/mcp` surface — a
      // deliberately agent-only door). The agent's OWN grants are its
      // scope-derived CEILING (`data:read`→read-only, `data:write`→CRUD,
      // neither→no data), NOT the user's — so we REPLACE the user-derived
      // positions/permissions/systemPermissions with that ceiling. The human
      // is the delegator (`onBehalfOf`); the security engine intersects the
      // two so the agent can never exceed EITHER its consented scope OR the
      // user's own reach (confused-deputy prevention). `userId` stays the human
      // so owner-stamping and `current_user.*` RLS resolve to them.
      ctx.principalKind = 'agent';
      ctx.onBehalfOf = { userId: authz.userId, principalKind: 'human' };
      ctx.permissions = scopesToAgentPermissionSets(oauthPrincipal.scopes);
      ctx.positions = [];
      // [ADR-0090 D10] System capabilities on the agent principal gate business
      // ACTION invocation (`actionPermissionError` reads `ctx.systemPermissions`)
      // — a door SEPARATE from the object CRUD/FLS/RLS intersection, which is
      // driven by the resolved ceiling SETS (they carry no caps, so cap-gated
      // OBJECT access stays denied to the agent regardless of this line).
      //
      // The `actions:execute` scope IS the user's consent to let this agent
      // invoke actions on their behalf, so when it is granted we DELEGATE the
      // user's action capabilities to the gate; without it the agent holds none
      // (and the MCP tool surface hides the action tools anyway). This never
      // widens data reach: whatever an action reads/writes still flows through
      // the object ceiling ∩ user intersection — e.g. a `data:read` agent that
      // invokes a writing action is still blocked at the write, and even a
      // `data:write` agent cannot touch better-auth-managed tables. The residual
      // is a cap-gated action whose effect is purely EXTERNAL (email, webhook) —
      // exactly what `actions:execute` consents to. Per-action agent scoping
      // (tighter than this all-or-nothing scope) is the per-client-grants
      // follow-up.
      ctx.systemPermissions =
        oauthPrincipal.scopes?.includes(MCP_OAUTH_SCOPE_ACTIONS)
          ? (authz.systemPermissions ?? [])
          : [];
    } else {
      ctx.principalKind = 'human';
    }
  } else {
    ctx.principalKind = 'guest';
    ctx.positions = ['guest'];
  }
  if (authz.userId) ctx.userId = authz.userId;
  if (authz.tenantId) ctx.tenantId = authz.tenantId;
  if (authz.email) ctx.email = authz.email;
  if (authz.accessToken) ctx.accessToken = authz.accessToken;
  if (authz.tabPermissions) ctx.tabPermissions = authz.tabPermissions;
  (ctx as any).org_user_ids = authz.org_user_ids;

  // OAuth provenance: surface the token's granted scopes so the MCP
  // dispatcher can narrow the exposed tool families (undefined for every
  // other provenance = not scope-limited).
  if (oauthPrincipal && ctx.userId === oauthPrincipal.userId) {
    ctx.oauthScopes = oauthPrincipal.scopes;
  }

  // Anonymous → skip localization (no scope to resolve against); keep the engine
  // default. Authenticated → resolve reference timezone/locale/currency.
  if (authz.userId) {
    const settings = await Promise.resolve(opts.getService('settings')).catch(() => undefined);
    const localization = await resolveLocalizationContext({
      ql,
      settings,
      tenantId: authz.tenantId,
      userId: authz.userId,
    });
    ctx.timezone = localization.timezone;
    ctx.locale = localization.locale;
    if (localization.currency) ctx.currency = localization.currency;
  }

  return ctx;
}

/**
 * Typed sentinel error thrown by SecurityPlugin (and re-thrown here) when an
 * operation is denied. The dispatcher catches it and translates to HTTP 403.
 *
 * Kept structurally identical to `@objectstack/plugin-security`'s
 * `PermissionDeniedError` so `isPermissionDeniedError` matches whichever class
 * instance crosses the boundary, regardless of which package owns the actual
 * class identity at runtime.
 */
export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED';
  readonly statusCode = 403;
  readonly details?: Record<string, unknown>;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'PermissionDeniedError';
    this.details = details;
  }
}

export function isPermissionDeniedError(e: unknown): e is PermissionDeniedError {
  if (!e || typeof e !== 'object') return false;
  const anyE = e as any;
  return (
    anyE.name === 'PermissionDeniedError' ||
    anyE.code === 'PERMISSION_DENIED' ||
    (typeof anyE.message === 'string' && anyE.message.startsWith('[Security] Access denied'))
  );
}
