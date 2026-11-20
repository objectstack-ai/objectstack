// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SSO discovery connects only to addresses that are public at connect time.
 *
 * ## The rule
 *
 * Every server-side read an SSO provider's OpenID Connect configuration has
 * this server make (the discovery document a registration reads, the
 * discovery a sign-in runs for a provider stored without its endpoints, the
 * token, key-set and userinfo reads of a sign-in, and the discovery read of
 * the "sign out of the company sign-in too" check) is sent through the
 * platform's outbound-request guard (`@objectstack/core/egress`): the
 * connection itself resolves the host, judges every address it resolves to,
 * and connects to an address it judged, never resolving again. So the address
 * judged is the address connected, whatever any earlier check of the same
 * name answered. A host with an address that is not public
 * (`classifyAddress`: loopback, private, link-local, cloud metadata and
 * host-platform addresses, and every other non-public range) is refused and
 * nothing is sent to it.
 *
 * The one way out is the deployment's configured trusted origins
 * (`OS_TRUSTED_ORIGINS`), as it is for every other SSO discovery check: a read
 * of an origin they list is sent as it always was. An origin a registration
 * body names is trusted for that registration's origin verdicts only, and
 * never stands in for this rule (`sso-discovery-companion-origins.ts`).
 * `OS_EGRESS_ALLOWED_TARGETS`, the allow-list of webhook and flow `http`
 * requests, does not open SSO discovery.
 *
 * ## How the reads reach the guard
 *
 * `@better-auth/sso` (1.7.12) takes no fetch and no dispatcher: its reads go
 * through `betterFetch`, which reads `globalThis.fetch` when it is called, and
 * through a bare `fetch` for the key set. So the reads are routed here by a
 * wrapper over the global fetch that does nothing outside an SSO discovery
 * scope: a scope is opened around the vendor endpoints that read
 * ({@link SSO_DISCOVERY_EGRESS_ENDPOINTS}) and around this package's own
 * sign-out read, and inside it only a read of an origin the scope names is
 * judged; every other request (a database driver over HTTP, a host's own
 * call) passes through untouched. The vendor endpoints' scope names the
 * origins of the provider configuration the request reads, declared by the
 * global before-hook ({@link declareSsoDiscoveryReadsOf}); until it has, the
 * scope judges every read, so a request whose origins were never declared is
 * judged whole rather than not at all.
 *
 * A refused read rejects with the vendor's own `DiscoveryError`
 * (`discovery_private_host`, or `discovery_unexpected_error` for a name that
 * did not resolve), so every vendor path answers it as its own refusal of a
 * non-public host. The refusal names the host and the rule, never the
 * resolved address; that goes to the server log through the guard's logger.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { EgressGuard, EgressLogger, EgressPolicy, EgressResolver } from '@objectstack/core/egress';
import {
  SSO_REGISTER_PATH,
  ssoDiscoveryCompanionOrigins,
  ssoDiscoveryHostRefusal,
  ssoRegisterDiscoveryRead,
  type SsoDiscoveryJudge,
} from './sso-discovery-companion-origins.js';

/** The `source` every SSO discovery read is judged under. */
export const SSO_DISCOVERY_EGRESS_SOURCE = 'sso-discovery';

/**
 * The vendor endpoint paths whose handlers read an identity provider: the
 * registration (`/sso/register`), and the OIDC sign-in and its callbacks
 * (`/sign-in/sso`, `/sso/callback/:providerId`, `/sso/callback`). The vendor's
 * `/sso/update-provider` reads nothing (`@better-auth/sso` 1.7.12).
 */
export const SSO_DISCOVERY_EGRESS_ENDPOINTS: readonly string[] = Object.freeze([
  '/sso/register',
  '/sign-in/sso',
  '/sso/callback',
]);

/** Whether a vendor endpoint path (as the request names it) reads an identity provider. */
export function isSsoDiscoveryEgressPath(endpointPath: string | undefined): boolean {
  if (!endpointPath) return false;
  if (endpointPath === '/sso/register' || endpointPath === '/sign-in/sso' || endpointPath === '/sso/callback') return true;
  return endpointPath.startsWith('/sso/callback/');
}

/** The before-hook paths ({@link isSsoDiscoveryEgressPath}'s, as the endpoint declares them) whose reads are a stored provider's. */
export const SSO_SIGN_IN_READ_HOOK_PATHS: ReadonlySet<string> = new Set([
  '/sign-in/sso',
  '/sso/callback/:providerId',
  '/sso/callback',
]);

/**
 * The guard SSO discovery sends through: the platform's outbound-request
 * guard with a policy that refuses every address that is not public and
 * opens none. `resolve` replaces name resolution (tests); `logger` receives
 * each refusal with its privileged reason (the resolved address and its class).
 */
export async function createSsoDiscoveryEgressGuard(
  options: { resolve?: EgressResolver; logger?: EgressLogger } = {},
): Promise<EgressGuard> {
  const { createEgressGuard, parseAddress, classifyAddress } = await import('@objectstack/core/egress');
  const policy: EgressPolicy = {
    describe: () => 'SSO discovery: public addresses only; OS_TRUSTED_ORIGINS is the one way to an internal identity provider',
    canConnect(target) {
      const parsed = parseAddress(target.address);
      if (!parsed) return { allow: false, denyClass: 'reserved', reason: `'${target.address}' is not an IP address` };
      const denyClass = classifyAddress(parsed);
      if (denyClass === null) return { allow: true };
      return {
        allow: false,
        denyClass,
        reason:
          `${target.hostname} resolves to ${target.address} (${denyClass}), which SSO discovery does not connect to; `
          + 'an identity provider on an internal network is reached once OS_TRUSTED_ORIGINS lists its origin',
      };
    },
  };
  return createEgressGuard({ policy, ...(options.resolve ? { resolve: options.resolve } : {}), ...(options.logger ? { logger: options.logger } : {}) });
}

/** A read the guard refused, as the scope keeps it. */
export interface SsoDiscoveryConnectRefusal {
  /** The URL whose read was refused. */
  url: string;
  /** Its host name, as the URL names it. */
  hostname: string;
  /** Its origin. */
  origin: string;
  /** The name did not resolve (nothing was judged); otherwise an address was refused. */
  unresolved: boolean;
}

type DiscoveryErrorClass = new (
  code: string,
  message: string,
  details?: Record<string, unknown>,
  options?: { cause?: unknown },
) => Error;

interface SsoDiscoveryEgressScope {
  readonly guard: EgressGuard;
  readonly DiscoveryError: DiscoveryErrorClass;
  /** The origins whose reads are judged; `every` judges every read the configured trust does not list. */
  targets: Set<string> | 'every';
  /** Whether `targets` was named; an undeclared scope judges every read. */
  declared: boolean;
  /** The deployment's configured trusted-origin predicate: a read of an origin it trusts is sent as before. */
  isConfiguredTrusted?: (url: string) => boolean;
  /** The first read the guard refused. */
  refused?: SsoDiscoveryConnectRefusal;
}

const scopeStore = new AsyncLocalStorage<SsoDiscoveryEgressScope>();

/** The wrapper this module last installed over the global fetch. */
let installedFetch: typeof globalThis.fetch | undefined;

function readUrl(input: unknown): URL | undefined {
  try {
    if (typeof input === 'string') return new URL(input);
    if (input instanceof URL) return input;
    if (input && typeof (input as { url?: unknown }).url === 'string') return new URL((input as { url: string }).url);
  } catch {
    return undefined;
  }
  return undefined;
}

function judges(scope: SsoDiscoveryEgressScope, url: URL): boolean {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (scope.targets !== 'every' && !scope.targets.has(url.origin)) return false;
  return !(scope.isConfiguredTrusted?.(url.href) === true);
}

/** The refusal text: the host and the rule, the same for every cause, never the resolved address. */
export function ssoDiscoveryConnectRefusalText(url: { hostname: string; origin: string }): string {
  return (
    `The request to "${url.hostname}" was not sent: SSO discovery connects only to a host whose every address is public `
    + 'when the connection is made. An identity provider on an internal network is reached once the deployment\'s '
    + `trusted origins (OS_TRUSTED_ORIGINS) list its origin, ${url.origin}.`
  );
}

async function sendThroughGuard(scope: SsoDiscoveryEgressScope, url: URL, input: unknown, init: unknown): Promise<Response> {
  const request = new Request(input as RequestInfo | URL, init as RequestInit | undefined);
  const method = request.method;
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    headers[name] = value;
  });
  const body = method === 'GET' || method === 'HEAD' ? undefined : await request.text();
  const { findEgressRefusal } = await import('@objectstack/core/egress');
  try {
    // Outside the scope: a guard that hands the request on (a test's stand-in)
    // reaches the next fetch, not this wrapper again.
    return await scopeStore.exit(() =>
      scope.guard.fetch(
        request.url,
        { method, headers, ...(body === undefined ? {} : { body }), signal: request.signal, redirect: request.redirect },
        { source: SSO_DISCOVERY_EGRESS_SOURCE },
      ),
    );
  } catch (error) {
    const refusal = findEgressRefusal(error);
    if (!refusal) throw error;
    const record: SsoDiscoveryConnectRefusal = {
      url: request.url,
      hostname: url.hostname,
      origin: url.origin,
      unresolved: refusal.unresolved,
    };
    scope.refused ??= record;
    throw new scope.DiscoveryError(
      refusal.unresolved ? 'discovery_unexpected_error' : 'discovery_private_host',
      ssoDiscoveryConnectRefusalText(url),
      { url: request.url, hostname: url.hostname },
      { cause: error },
    );
  }
}

/**
 * Put the wrapper over the global fetch, unless it is the one there. A fetch
 * someone set after the last install (a test's stub, another wrapper) becomes
 * the one this wrapper hands every other request to. Throws when the global
 * fetch cannot be replaced: the reads could not be judged.
 */
function installFetchWrapper(): void {
  const current = globalThis.fetch;
  if (typeof current !== 'function') {
    throw new Error('SSO discovery cannot be judged: this runtime has no global fetch to route its reads through.');
  }
  if (current === installedFetch) return;
  const underlying = current;
  const wrapper = function ssoDiscoveryEgressFetch(...args: Parameters<typeof globalThis.fetch>): Promise<Response> {
    const scope = scopeStore.getStore();
    const url = scope ? readUrl(args[0]) : undefined;
    if (!scope || !url || !judges(scope, url)) return Reflect.apply(underlying, globalThis, args) as Promise<Response>;
    return sendThroughGuard(scope, url, args[0], args[1]);
  } as typeof globalThis.fetch;
  globalThis.fetch = wrapper;
  if (globalThis.fetch !== wrapper) {
    throw new Error('SSO discovery cannot be judged: the global fetch could not be replaced to route its reads through the outbound-request guard.');
  }
  installedFetch = wrapper;
}

/**
 * Run `run` inside an SSO discovery scope sending through `guard`. With
 * `targets: 'every'` every read the configured trust does not list is judged
 * (this package's own reads, whose scope holds nothing else); with no
 * `targets` the scope judges every read until {@link declareSsoDiscoveryReads}
 * names the origins (the vendor endpoints, whose request may send other
 * requests too), and then only reads of those. Answers `run`'s value and the
 * first refused read.
 */
export async function runInSsoDiscoveryEgressScope<T>(
  guard: EgressGuard,
  run: () => Promise<T>,
  options: { targets?: 'every'; isConfiguredTrusted?: (url: string) => boolean } = {},
): Promise<{ value: T; refused?: SsoDiscoveryConnectRefusal }> {
  const { DiscoveryError } = (await import('@better-auth/sso')) as unknown as { DiscoveryError: DiscoveryErrorClass };
  installFetchWrapper();
  const scope: SsoDiscoveryEgressScope = {
    guard,
    DiscoveryError,
    targets: 'every',
    declared: options.targets === 'every',
    ...(options.isConfiguredTrusted ? { isConfiguredTrusted: options.isConfiguredTrusted } : {}),
  };
  const value = await scopeStore.run(scope, run);
  return { value, ...(scope.refused ? { refused: scope.refused } : {}) };
}

/** Whether this request runs inside an SSO discovery scope. */
export function inSsoDiscoveryEgressScope(): boolean {
  return scopeStore.getStore() !== undefined;
}

/**
 * Name, for the request's SSO discovery scope, the URLs whose origins its
 * reads go to, and the deployment's configured trusted-origin predicate.
 * `every` judges every read the configured trust does not list (a request
 * whose provider configuration could not be read). No-op outside a scope.
 */
export function declareSsoDiscoveryReads(
  urls: Iterable<unknown> | 'every',
  isConfiguredTrusted: (url: string) => boolean,
): void {
  const scope = scopeStore.getStore();
  if (!scope) return;
  scope.isConfiguredTrusted = isConfiguredTrusted;
  if (urls === 'every') {
    scope.targets = 'every';
    scope.declared = true;
    return;
  }
  if (!scope.declared) {
    scope.targets = new Set<string>();
    scope.declared = true;
  }
  if (scope.targets === 'every') return;
  for (const candidate of urls) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' || url.protocol === 'http:') scope.targets.add(url.origin);
    } catch {
      /* not a URL: nothing reads it */
    }
  }
}

/** The first read the request's SSO discovery scope refused, if any. */
export function ssoDiscoveryConnectRefused(): SsoDiscoveryConnectRefusal | undefined {
  return scopeStore.getStore()?.refused;
}

/**
 * The URLs an OIDC configuration has the server read, and the issuer's: the
 * discovery document (explicit, else the issuer's well-known URL), the token,
 * key-set and userinfo endpoints, and the authorization endpoint. `config` is
 * a parsed `oidcConfig` (a stored one is JSON text).
 */
export function oidcConfigReadUrls(
  issuer: unknown,
  config: unknown,
  computeDiscoveryUrl: (issuer: string) => string,
): string[] {
  let parsed: Record<string, unknown> | undefined;
  if (typeof config === 'string') {
    try {
      const value: unknown = JSON.parse(config);
      if (value && typeof value === 'object') parsed = value as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }
  } else if (config && typeof config === 'object') {
    parsed = config as Record<string, unknown>;
  }
  const urls: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.length > 0) urls.push(value);
  };
  push(issuer);
  push(parsed?.issuer);
  for (const member of ['discoveryEndpoint', 'authorizationEndpoint', 'tokenEndpoint', 'jwksEndpoint', 'userInfoEndpoint']) {
    push(parsed?.[member]);
  }
  for (const value of [issuer, parsed?.issuer]) {
    if (typeof value === 'string' && value.length > 0) {
      try {
        urls.push(computeDiscoveryUrl(value));
      } catch {
        /* not an issuer the vendor reads */
      }
    }
  }
  return urls;
}

/** The guard a judgement outside any scope uses: the default one, built once. */
let defaultGuard: Promise<EgressGuard> | undefined;

/**
 * Judge, without sending anything, whether SSO discovery may read `url`: the
 * guard of the request's scope, else the default guard, resolving its host
 * and judging every address as a connection would. A name that does not
 * resolve is answered `unresolved` and allowed here: the connection itself
 * refuses it, and nothing is sent.
 */
export const judgeSsoDiscoveryUrl: SsoDiscoveryJudge = async (url) => {
  let guard = scopeStore.getStore()?.guard;
  if (!guard) {
    defaultGuard ??= createSsoDiscoveryEgressGuard();
    defaultGuard.catch(() => {
      defaultGuard = undefined;
    });
    guard = await defaultGuard;
  }
  return guard.judgeUrl(url, { source: SSO_DISCOVERY_EGRESS_SOURCE });
};

/** The configured trusted-origin predicate of a hook's or endpoint's context (before any body-named origin joins it). */
function configuredTrustOf(ctx: any): (url: string) => boolean {
  const isTrustedOrigin = ctx?.context?.isTrustedOrigin;
  return (url) => typeof isTrustedOrigin === 'function' && isTrustedOrigin.call(ctx.context, url) === true;
}

/**
 * Global before-hook half: name, for the request's SSO discovery scope, the
 * origins its reads go to. A registration's are the ones its body names (the
 * issuer, every `oidcConfig` endpoint, the discovery document) and its
 * issuer's companion origins; a sign-in's or callback's are those of the
 * stored provider configuration it reads (every stored provider when the
 * request names none). When the stored providers cannot be read, every read
 * the configured trust does not list is judged. No-op outside a scope.
 */
export async function declareSsoDiscoveryReadsOf(ctx: any): Promise<void> {
  if (!inSsoDiscoveryEgressScope()) return;
  const path = ctx?.path;
  const isConfiguredTrusted = configuredTrustOf(ctx);
  const { computeDiscoveryUrl } = await import('@better-auth/sso');
  if (path === SSO_REGISTER_PATH) {
    const body = ctx?.body as { issuer?: unknown; oidcConfig?: unknown } | undefined;
    declareSsoDiscoveryReads(
      [...oidcConfigReadUrls(body?.issuer, body?.oidcConfig, computeDiscoveryUrl), ...ssoDiscoveryCompanionOrigins(body?.issuer)],
      isConfiguredTrusted,
    );
    return;
  }
  if (!SSO_SIGN_IN_READ_HOOK_PATHS.has(path)) return;
  try {
    const adapter = ctx.context.adapter as {
      findMany: (query: { model: string; where?: Array<{ field: string; value: unknown }> }) => Promise<unknown[]>;
    };
    const providerId = typeof ctx?.params?.providerId === 'string' && ctx.params.providerId
      ? ctx.params.providerId
      : typeof ctx?.body?.providerId === 'string' && ctx.body.providerId ? ctx.body.providerId : undefined;
    let rows = providerId
      ? await adapter.findMany({ model: 'ssoProvider', where: [{ field: 'providerId', value: providerId }] })
      : [];
    if (rows.length === 0) rows = await adapter.findMany({ model: 'ssoProvider' });
    const urls: string[] = [];
    for (const row of rows as Array<{ issuer?: unknown; oidcConfig?: unknown }>) {
      urls.push(...oidcConfigReadUrls(row?.issuer, row?.oidcConfig, computeDiscoveryUrl));
    }
    declareSsoDiscoveryReads(urls, isConfiguredTrusted);
  } catch {
    declareSsoDiscoveryReads('every', isConfiguredTrusted);
  }
}

/**
 * After-hook half: a `/sso/register` whose discovery read the connection
 * refused is answered as the before-hook answers a discovery host that is not
 * public: `400 VALIDATION_FAILED` on the member that names the host
 * ({@link ssoDiscoveryHostRefusal}). A host whose name did not resolve keeps
 * the vendor's answer (`discovery_unexpected_error`), as does a refusal of
 * any other read.
 */
export async function explainSsoDiscoveryConnectRefusal(ctx: any): Promise<void> {
  if (ctx?.path !== SSO_REGISTER_PATH) return;
  const refused = ssoDiscoveryConnectRefused();
  if (!refused || refused.unresolved) return;
  const { APIError, isAPIError } = await import('better-auth/api');
  if (!isAPIError(ctx?.context?.returned)) return;
  const refusal = await registerDiscoveryRefusalFor(ctx?.body, refused);
  if (!refusal) return;
  throw new APIError(refusal.status, { code: refusal.code, message: refusal.message, field: refusal.field });
}

/**
 * The register refusal for a refused read, when that read is the one the
 * registration's discovery makes (its host is the one the body names for it).
 */
export async function registerDiscoveryRefusalFor(
  body: unknown,
  refused: SsoDiscoveryConnectRefusal,
): Promise<ReturnType<typeof ssoDiscoveryHostRefusal> | undefined> {
  const { computeDiscoveryUrl } = await import('@better-auth/sso');
  const read = ssoRegisterDiscoveryRead(body, computeDiscoveryUrl);
  if (!read) return undefined;
  let url: URL;
  try {
    url = new URL(read.url);
  } catch {
    return undefined;
  }
  if (url.origin !== refused.origin) return undefined;
  return ssoDiscoveryHostRefusal(read.member, url);
}
