// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * resolveExecutionContext — the runtime / MCP dispatcher's identity door.
 *
 * [ruling record 6227928430, letter A] The composition — the session read,
 * the tenancy-posture classification, the shared authorization resolver
 * (`resolveAuthzContext`), the localization and the ExecutionContext assembly —
 * is `resolveRequestExecutionContext` in `@objectstack/core`, the one function
 * every platform door calls. This door only does what is its own: pull `ql`
 * and the services out of the active kernel/scope, verify an OAuth access token
 * on the `/mcp` face, and state its named parameters to that function.
 *
 * Resolves for every request it can ANSWER — anonymous requests yield the
 * guest envelope (`principalKind: 'guest'`, `positions: ['guest']`,
 * `isSystem: false`, carrying the `guest` anchor's sets, ADR-0138 D3) —
 * and throws `AuthzStoreUnavailableError` (503) for the one class of fault
 * that leaves the answer undetermined: an authorization INPUT that exists and
 * could not be read (a permission-store read that failed, commit 6a180e42d; a `tenancy`
 * service that is registered and failed to build, #13906 decision 1 A). The
 * dispatcher's net (`HttpDispatcher.resolveRequestScope`) re-raises exactly
 * that class and degrades everything else to anonymous, as before.
 */

import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { IAuthService, ServiceSlotContract, ServiceSlotContracts } from '@objectstack/spec/contracts';
import { scopesToAgentPermissionSets, MCP_OAUTH_SCOPE_ACTIONS } from '@objectstack/spec/ai';
import { preferredLocaleFromHeader } from '@objectstack/spec/system';

import { resolveRequestExecutionContext, type RequestAdmission } from '@objectstack/core';
import { presentedForwardCredential, redeemForwardCredential, type ForwardAgentProvenance } from '@objectstack/rest';

/**
 * [#4127 batch 4] The lookup facade, typed by slot like the ones on
 * `DomainHandlerDeps` and `ActionExecutionDeps`. This was the THIRD copy still
 * returning `any`, and the one that mattered most: its `'auth'` lookup reads
 * members — `verifyMcpAccessToken`, `api`, `getApi` — that nothing declared,
 * on the path that decides who a request is.
 */
interface KernelServiceLookup {
  <K extends keyof ServiceSlotContracts>(name: K): Promise<ServiceSlotContract<K> | undefined>;
  (name: string): Promise<any> | any;
}

/**
 * A verified MCP OAuth access token, exactly as `IAuthService` declares the
 * verifier's result — derived from the contract rather than copied, so a
 * member the contract gains (`organizationId`, the organization the consent
 * bound) cannot be dropped here by a hand-written shape.
 */
type VerifiedMcpAccessToken = NonNullable<Awaited<ReturnType<NonNullable<IAuthService['verifyMcpAccessToken']>>>>;

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
  /**
   * [#23287, ruling C′ item 3] Told, once, which credential admitted the
   * principal and — for an API key — the key-admission seam's ADR-0069 answer
   * on the key's owner (`ResolvedAuthzContext.credential` / `.authGate`).
   *
   * The dispatcher's gate (`HttpDispatcher.enforceAuthGate`) reads it so that a
   * principal an API key admitted is judged by the KEY's answer instead of by a
   * session cookie re-read beside it. The envelope this function returns does
   * not carry either fact (its `authGate` stays withheld on this face, see
   * below), so this is the channel. Not called for an anonymous request.
   */
  onAdmission?: (admission: RequestAdmission) => void;
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

/**
 * [ADR-0090 D10 rule 5, #28367] The agent a forward credential carried to this
 * request, redeemed ONCE per request object: the credential is spent by its
 * first presentation, and a door that resolves the same request again must read
 * the same agent rather than a spent handle. Keyed weakly, so nothing outlives
 * the request.
 */
const forwardAgents = new WeakMap<object, ForwardAgentProvenance | null>();

/**
 * The agent provenance this request's forward credential redeems to, or
 * `undefined`. Only a request the action door itself injected in-process can
 * carry a redeemable one (`@objectstack/rest` `redeemForwardCredential`); a
 * request from the network presenting the header resolves as if it carried
 * nothing.
 */
function forwardAgentOf(request: any, headers: Headers): ForwardAgentProvenance | undefined {
  const presented = presentedForwardCredential(headers);
  if (!presented) return undefined;
  const key = request && typeof request === 'object' ? request : undefined;
  if (key && forwardAgents.has(key)) return forwardAgents.get(key) ?? undefined;
  const agent = redeemForwardCredential(presented, String(request?.method ?? ''), String(request?.path ?? request?.url ?? ''));
  if (key) forwardAgents.set(key, agent ?? null);
  return agent;
}

export async function resolveExecutionContext(opts: ResolveOptions): Promise<ExecutionContext> {
  const headers = toHeaders(opts.request?.headers);
  const ql = await opts.getQl();
  // The `auth` service, looked up once for every reader below: the OAuth
  // verifier, the session read and the key-admission seam's posture and
  // lifecycle sources. A lookup that rejects is a host with no auth service.
  const authService = await Promise.resolve(opts.getService('auth')).catch(() => undefined);

  // ── OAuth 2.1 access-token provenance (MCP surface only, #2698) ──
  // Verified BEFORE session resolution so the presented credential decides
  // the outcome. Verification lives in the auth service (it owns the AS +
  // JWKS); the *authorization* resolution still flows through the one shared
  // composition — OAuth is a second provenance for the principal, never a
  // second authz model. It stays at this door because the scope vocabulary
  // it is read in (`@objectstack/spec/ai`) is MCP-domain knowledge the core
  // package deliberately does not depend on.
  let oauthPrincipal: VerifiedMcpAccessToken | undefined;
  let oauthBearerPresented = false;
  // [ADR-0090 D10 rule 5, #28367] The second way this door resolves an agent:
  // a forward credential the action door minted for an agent's in-process
  // `api` forward. It is only ever minted from the first way (an agent the MCP
  // OAuth door below already admitted), and it resolves to the SAME agent
  // principal through the same assembler input: the provenance handed over at
  // the mint, never re-derived from a token. The forward carries no caller
  // header, so nothing else here can answer for it.
  const forwardAgent = forwardAgentOf(opts.request, headers);
  if (forwardAgent) {
    oauthPrincipal = {
      userId: forwardAgent.userId,
      clientId: forwardAgent.clientId,
      scopes: forwardAgent.scopes,
      ...(forwardAgent.organizationId ? { organizationId: forwardAgent.organizationId } : {}),
    };
  } else if (opts.acceptOAuthAccessToken) {
    const jwtBearer = extractJwtBearer(headers);
    if (jwtBearer) {
      oauthBearerPresented = true;
      try {
        // `verifyMcpAccessToken` is declared by `IAuthService` and reached
        // through the slot-typed lookup, so the verified result is read as the
        // contract states it — `organizationId` included.
        const verified = await authService?.verifyMcpAccessToken?.(jwtBearer);
        if (verified?.userId && Array.isArray(verified.scopes)) {
          oauthPrincipal = verified;
        }
      } catch {
        // verification error → fail closed (anonymous), handled below
      }
    }
  }

  return resolveRequestExecutionContext({
    headers,
    ql,
    authService,
    // [#8287 · #13906 decision 1 A · #16013] The EFFECTIVE tenancy posture,
    // from the kernel's `tenancy` service, classified by the shared helper.
    // ⛔ The RESOLUTION is still this door's own: `opts.getService` is this
    // facade's lookup (the dispatcher hands it the registry's own async
    // accessor for `tenancy`; other callers hand it a probe), so it is handed
    // in as the thunk and the shared function never learns how this door
    // reaches the service.
    tenancy: () => opts.getService('tenancy'),
    // [commit f586f1a89 · ADR-0138 D3/D4] The EXPLICIT GUEST entry: a sessionless
    // request on the runtime / MCP door is a first-class guest principal,
    // served the sets bound to the `guest` anchor, and enforcement consumers
    // read it (`plugin-security/explain-engine.ts`: guest ⇒ `EXTERNAL`).
    anonymous: 'guest',
    // [ADR-0069 / #7280] WITHHELD, on the record. This face enforces the
    // authentication-policy gate at its OWN seam: `HttpDispatcher.enforceAuthGate`
    // re-reads the session and calls `evaluateAuthGate(session.user, path)`
    // there, and nothing on this path ever reads `context.authGate`. [#23287]
    // The key-admission seam's answer reaches that gate through
    // `opts.onAdmission`, not through this field.
    authGate: 'withhold',
    credentials: 'api-key-and-session',
    // This door admits an API key whether or not an auth service is wired.
    sessionApi: 'optional',
    // Session by provenance:
    //  - verified OAuth token → a session established for the token's
    //    principal (positions/permissions/RLS still aggregate in the resolver);
    //  - JWT bearer presented but NOT verified → no session at all (no cookie
    //    fallback — a dead token must yield 401, not ambient session access);
    //  - otherwise → the auth service's read of this request.
    //
    // [ADR-0090 D10 · ruling record 6232069920, letter A] The established
    // session is IN the one organization the user's consent bound — the
    // verified result's `organizationId`, carried where a session carries its
    // active organization. So the session arm vets it on every request by the
    // rule it applies to a browser session (`vetOrganizationClaim`): kept while
    // a current membership backs it under a walled posture; dropped — no
    // organization, only global grants — once none does. The D10 delegator is
    // then resolved in that organization. ⛔ Never the union of the user's
    // organizations, never the organization their browser session has selected
    // now, never a widened global grant. A token minted before consents bound
    // one carries none: the principal resolves with no organization.
    session: oauthPrincipal
      ? {
        established: {
          user: { id: oauthPrincipal.userId },
          session: { userId: oauthPrincipal.userId, activeOrganizationId: oauthPrincipal.organizationId },
        },
      }
      : oauthBearerPresented ? 'none' : 'request',
    // Authenticated → resolve reference timezone/locale/currency; a settings
    // lookup that rejects reads as no settings service.
    localization: { settings: () => opts.getService('settings') },
    // [#3957] The request's OWN language preference wins over the workspace
    // default, so a rejection message is not rendered in English beside the
    // Chinese label of the very field it names.
    requestLocale: preferredLocaleFromHeader(headers.get('accept-language')),
    // A NAMED divergence (commit f586f1a89): this face has always carried the
    // session bearer down to hooks (`session.accessToken`); the REST face never has.
    accessToken: 'carry',
    // The OAuth SCOPE VOCABULARY is interpreted here, at the only door that
    // speaks it (`acceptOAuthAccessToken` is set solely by the `/mcp` path
    // match), and the shared assembler receives the already-derived grant.
    oauth: oauthPrincipal && {
      ...oauthPrincipal,
      // [ADR-0090 D10] `data:read` → read-only, `data:write` → CRUD, neither →
      // no data access. The agent's OWN grants, never the user's.
      scopePermissions: scopesToAgentPermissionSets(oauthPrincipal.scopes),
      // The `actions:execute` scope IS the user's consent to let this agent
      // invoke actions on their behalf; without it the agent holds none.
      delegatesActions: oauthPrincipal.scopes?.includes(MCP_OAUTH_SCOPE_ACTIONS) ?? false,
    },
    // [ADR-0090 D10 rule 5] A forward-credential principal reports no
    // admission: it was admitted by no credential of its own presented here,
    // and every reader of the admission (the API-key gate, the key-management
    // rule) must read it as the agent it is, never as a signed-in session.
    onAdmission: forwardAgent ? undefined : opts.onAdmission,
  });
}

/**
 * Typed sentinel error thrown by SecurityPlugin when an operation is denied.
 * The dispatcher catches it and translates to HTTP 403.
 *
 * This module used to re-declare the class and its matcher character-for-character
 * from `@objectstack/plugin-security`, with nothing enforcing the identity — two
 * declarations of an ADR-0112 envelope (`code`, `statusCode`) free to drift apart
 * silently. `@objectstack/plugin-security` is the package that THROWS these, so it
 * owns the single declaration; this is a re-export, not a copy (#7270).
 *
 * Re-exported (rather than dropped) because `http-dispatcher.ts` already imports
 * `isPermissionDeniedError` from this module path. The matcher stays duck-typed
 * upstream, so an instance crossing a package boundary is still recognized when
 * dual CJS/ESM output or bundling hands the two sides distinct class objects.
 */
export { PermissionDeniedError, isPermissionDeniedError } from '@objectstack/plugin-security';
