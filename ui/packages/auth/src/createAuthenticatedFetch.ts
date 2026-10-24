/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { TokenStorage } from './createAuthClient.js';
import { authGateEvents, detectAuthGate } from './auth-gate-events.js';
import { ActiveOrganizationStorage } from './ActiveOrganizationStorage.js';

/**
 * Options for creating an authenticated adapter.
 */
export interface AuthenticatedAdapterOptions {
  /** Base URL for the ObjectStack API */
  baseUrl: string;
  /** Additional adapter options */
  [key: string]: unknown;
}

/**
 * Re-exported from its own module so this file stays the WIRE lane and the
 * storage lane has one home. `ActiveOrganizationStorage` moved out when it
 * gained per-user scoping (objectui#5664); the export identity is unchanged,
 * so `@object-ui/auth`'s barrel, this package's tests and every consumer
 * import the same symbol from the same place they did before.
 */
export {
  ActiveOrganizationStorage,
  SessionUserScope,
  purgePreviousUserClientState,
  getSessionOwnerChangeCount,
  subscribeSessionOwnerChange,
} from './ActiveOrganizationStorage.js';

export interface CreateAuthenticatedFetchOptions {
  /**
   * When true, requests whose URL resolves to a different origin than the
   * current page are passed through to the bare global fetch — no
   * Authorization, X-Tenant-ID, or Accept-Language headers are attached.
   *
   * Use this for fetches whose target URL may come from metadata (a
   * `type: 'api'` action's target) or that a host hands to the renderers as
   * `apiFetch`: those may point at third-party hosts that must never see the
   * platform bearer token.
   */
  sameOriginOnly?: boolean;
}

/** True when `url` resolves to a different origin than the current page. */
function isCrossOrigin(url: string): boolean {
  if (typeof window === 'undefined' || !window.location) return true;
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

/**
 * Creates an authenticated fetch wrapper that injects the Bearer token
 * from localStorage into every request to the ObjectStack API.
 * Also injects X-Tenant-ID header when an active organization is set — see the
 * "The `X-Tenant-ID` edge contract" section of this package's README for what
 * that header means, who reads it, and the window in which it is not sent.
 *
 * @example
 * ```ts
 * import { ObjectStackAdapter } from '@object-ui/data-objectstack';
 * import { createAuthenticatedFetch } from '@object-ui/auth';
 *
 * const authenticatedFetch = createAuthenticatedFetch();
 *
 * const adapter = new ObjectStackAdapter({
 *   baseUrl: '/api/v1',
 *   fetch: authenticatedFetch,
 * });
 * ```
 */
export function createAuthenticatedFetch(
  options?: CreateAuthenticatedFetchOptions,
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (options?.sameOriginOnly && isCrossOrigin(url)) {
      return fetch(input, init);
    }
    const isApiCall = /\/api\//i.test(url);
    const token = TokenStorage.get();
    if (token && isApiCall) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    // ── `X-Tenant-ID` — the edge routing contract (objectui#5279) ────────
    //
    // WHAT IT MEANS. A routing hint for the hosting edge: "this request belongs
    // to tenant <id>". The value is the better-auth `activeOrganizationId` the
    // session already carries. It is NOT an identity claim, NOT an
    // authorization input, and NOT what scopes rows.
    //
    // DO NOT DELETE THIS ON THE STRENGTH OF A GREP. The framework
    // (`objectstack`) does not read it: `resolveAuthzContext` takes `tenantId`
    // from the API-key principal or `session.activeOrganizationId` and never
    // from a header, and environment routing reads the hostname and
    // `X-Environment-Id`. So a search confined to this repo plus the framework
    // finds zero consumers and reads as "dead stamp" — which is the false
    // premise objectui#5279 was filed on. The consumer is in the CLOUD repo,
    // which neither checkout contains: `service-tenant`'s `tenant-context.ts`
    // resolves the header, and `tenant-router`'s `turso-multi-tenant.zod.ts`
    // configures that resolution. The configuration contract IS readable from
    // here — `TenantRoutingConfigSchema` in `@objectstack/spec/cloud` defaults
    // `tenantHeaderName` to `X-Tenant-ID` and ranks `header` SECOND of six
    // identification sources, behind `subdomain`.
    //
    // THE UNSTAMPED-FIRST-REQUEST GAP. `ActiveOrganizationStorage` is filled
    // only after AuthProvider's async organization chain resolves, so early
    // requests go out with the header ABSENT — never present-and-empty. A
    // reader must fall through to its next identification source rather than
    // fail closed. Nothing about row visibility rides on this: the framework
    // scopes from the session, so a response computed inside the window is
    // still computed for the right tenant.
    //
    // Not gated on `isApiCall`, unlike `Authorization` and `Accept-Language`
    // above — recorded as the behaviour that ships, not endorsed; the
    // asymmetry is reported on objectui#5279 for triage to route. A wrapper
    // built with `sameOriginOnly` short-circuits every cross-origin request
    // before this line.
    //
    // Full contract, including what a reader may and may not assume: this
    // package's README, "The `X-Tenant-ID` edge contract".
    const activeOrgId = ActiveOrganizationStorage.get();
    if (activeOrgId) {
      headers.set('X-Tenant-ID', activeOrgId);
    }
    // Inject the active UI language so the server resolves metadata labels
    // (object/field/view labels, action-dialog text) in the right locale. The
    // i18n provider keeps `<html lang>` in sync with the in-app language
    // switcher, so reading it here means a language switch carries the new
    // `Accept-Language` on every subsequent request — closing the gap where
    // server-resolved labels stayed in the old language until a page refresh
    // (issue objectstack-ai/objectstack#1319). We only fold it in for our own API calls, and never
    // clobber an `Accept-Language` the caller set explicitly.
    if (isApiCall && !headers.has('Accept-Language') && typeof document !== 'undefined') {
      const lang = document.documentElement.lang;
      if (lang) {
        headers.set('Accept-Language', lang);
      }
    }
    const response = await fetch(input, { ...init, headers });
    // Adopt a session rotation the server declares on the response, exactly as
    // the auth lane already does (`createBearerFetch` in createAuthClient.ts).
    //
    // ## Why this lane needs it too (objectui#4467)
    //
    // The console injects the same localStorage bearer from two places: the
    // AUTH lane (sign-in / get-session / the auth endpoints) and THIS one — the
    // adapter, the renderers' `apiFetch`, and every metadata `type: 'api'`
    // action (`useConsoleActionRuntime`'s `apiHandler`). better-auth's
    // server-side bearer plugin hands a rotated session token back in
    // `set-auth-token` on whichever lane the call arrived over. Only the auth
    // lane read it, so a rotation issued to a data-lane call was dropped on the
    // floor and the browser kept sending the OLD token.
    //
    // Impersonation is exactly that call: `POST /auth/admin/impersonate-user`
    // runs as an ordinary metadata action, so the impersonated session token
    // arrived here and was discarded — while the server's bearer plugin kept
    // overwriting the impersonation cookie with the admin bearer we kept
    // sending. Impersonation was a complete no-op in the console, not merely an
    // invisible one.
    //
    // The rule is the server's declared contract and carries no knowledge of
    // which endpoint rotated: one contract, one answer, on both lanes. Gated on
    // `isApiCall` — the same condition that decided we authenticated this
    // request at all — so a response we never sent the bearer to cannot rotate
    // the session. Untrusted targets are the `sameOriginOnly` option's job (it
    // short-circuits above, before any header work).
    if (isApiCall) {
      const rotatedToken = response.headers.get('set-auth-token');
      if (rotatedToken) {
        TokenStorage.set(rotatedToken);
      }
    }
    // ADR-0069 — surface an auth-policy gate (expired password / required MFA)
    // to the remediation overlay. Clone so the caller still reads the body.
    if (isApiCall && response.status === 403) {
      try {
        const gate = detectAuthGate(response.status, await response.clone().json());
        if (gate) authGateEvents.emit(gate);
      } catch { /* not a JSON gate body — leave the response untouched */ }
    }
    return response;
  };
}
