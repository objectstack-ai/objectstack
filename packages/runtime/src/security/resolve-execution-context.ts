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
import type { ServiceSlotContract, ServiceSlotContracts } from '@objectstack/spec/contracts';
import { scopesToAgentPermissionSets, MCP_OAUTH_SCOPE_ACTIONS } from '@objectstack/spec/ai';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';

import {
  resolveAuthzContext,
  resolveLocalizationContext,
  assembleExecutionContextOrGuest,
  type EntryLocalization,
} from '@objectstack/core';

/**
 * [#4127 batch 4] The lookup facade, typed by slot like the ones on
 * `DomainHandlerDeps` and `ActionExecutionDeps`. This was the THIRD copy still
 * returning `any`, and the one that mattered most: both of its `'auth'` callers
 * read members — `verifyMcpAccessToken`, `api`, `getApi` — that nothing
 * declared, on the path that decides who a request is.
 */
interface KernelServiceLookup {
  <K extends keyof ServiceSlotContracts>(name: K): Promise<ServiceSlotContract<K> | undefined>;
  (name: string): Promise<any> | any;
}

interface ResolveOptions {
  /** Function returning a service from the active kernel (or undefined). */
  getService: KernelServiceLookup;
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
        // [#4127 FINDING, batch 5]
        // `verifyMcpAccessToken` is implemented (auth-manager.ts) and undeclared.
        // This file's own `opts.getService: (name: string) => Promise<any> | any`
        // is a second, smaller instance of the same problem — a lookup facade
        // that returns `any` — and typing it is part of that batch too.
        const authService = await opts.getService('auth');
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
      // [#4127 FINDING, batch 5]
      // Reaches BOTH undeclared shapes in two lines — `.api` and the `getApi()`
      // fallback — which is the clearest statement of the gap in the codebase.
      const authService = await opts.getService('auth');
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

  // [#6216 — maintainer ruling 2026-08-08, Option A] The ExecutionContext
  // ASSEMBLY now lives in ONE place too (`assembleExecutionContext*`,
  // @objectstack/core), shared with the REST face. Everything above is
  // transport-specific plumbing; the field set is closed by type over there, so
  // a new `ExecutionContext` field can no longer reach one face and miss
  // another (the #6071 drift class), and the per-face divergences are named
  // inputs rather than silent omissions.
  //
  // This face takes the EXPLICIT GUEST entry: a sessionless request on the
  // runtime / MCP door is a first-class guest principal, and enforcement
  // consumers read it (`plugin-security/explain-engine.ts`: guest ⇒ `EXTERNAL`
  // posture). The REST face takes the fail-closed default entry instead
  // (no session → no ctx → 401), unchanged.

  // Anonymous → skip localization (no scope to resolve against); keep the engine
  // default. Authenticated → resolve reference timezone/locale/currency.
  let localization: EntryLocalization | undefined;
  if (authz.userId) {
    const settings = await Promise.resolve(opts.getService('settings')).catch(() => undefined);
    localization = await resolveLocalizationContext({
      ql,
      settings,
      tenantId: authz.tenantId,
      userId: authz.userId,
    });
  }

  return assembleExecutionContextOrGuest({
    authz,
    // The OAuth SCOPE VOCABULARY is interpreted here, at the only door that
    // speaks it (`acceptOAuthAccessToken` is set solely by the `/mcp` path
    // match), and the shared assembler receives the already-derived grant. It
    // decides what that ceiling REPLACES on the envelope — the part that
    // drifted — without `@objectstack/core` taking a dependency on the AI
    // subdomain. See `OAuthTokenProvenance`.
    oauth: oauthPrincipal && {
      ...oauthPrincipal,
      // [ADR-0090 D10] `data:read` → read-only, `data:write` → CRUD, neither →
      // no data access. The agent's OWN grants, never the user's.
      scopePermissions: scopesToAgentPermissionSets(oauthPrincipal.scopes),
      // The `actions:execute` scope IS the user's consent to let this agent
      // invoke actions on their behalf; without it the agent holds none.
      delegatesActions: oauthPrincipal.scopes?.includes(MCP_OAUTH_SCOPE_ACTIONS) ?? false,
    },
    localization,
    // [#3957] The request's OWN language preference wins over the workspace
    // default — `ExecutionContext.locale` drives the write path's message
    // catalog, and metadata is already translated per `Accept-Language`, so
    // reading only the workspace locale would put an English rejection next to
    // the Chinese label of the very field it names. The PRECEDENCE lives in the
    // shared assembler so the two faces cannot disagree about it.
    requestLocale: preferredLocaleFromHeader(headers.get('accept-language')),
    // A NAMED divergence (#6216): this face has always carried the session
    // bearer down to hooks (`session.accessToken`); the REST face never has.
    // Both are preserved — see the assembler's `accessToken` doc.
    accessToken: authz.accessToken,
  });
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
