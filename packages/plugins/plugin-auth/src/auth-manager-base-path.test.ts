// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16025 — `AuthManager.getBasePath()`: the string an HTTP adapter reads to
// learn where better-auth serves.
//
// ⛔ NOT "the one definition" of that value, which an earlier spelling of this
// header claimed. Two more readers of `this.config.basePath` are live in
// `auth-manager.ts` — `getAuthIssuer()` and `getMcpResourceUrl()`, each with its
// own normaliser — and they are deliberately untouched: they are published OAuth
// identifiers, compared by exact string. The accessor's docblock carries the
// measurement and the reason.
//
// ## Why this member is public, and why a rename is a breaking change
//
// An HTTP adapter that mounts this service has to know where its routes live,
// and no member answered THAT question. (The value was not unreachable —
// `getAuthIssuer()` is public and its URL path is the configured base path — but
// parsing a path back out of an issuer identifier is reading a different
// contract that happens to contain the answer.) So `@objectstack/hono`'s
// `createHonoApp` mounted the auth surface under its OWN `prefix` option, whose
// default (`/api`) does not compose with this one (`/api/v1/auth`). Measured on
// a real boot with the documented embed `createHonoApp({ kernel })`, before the
// fix:
//
//     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
//
// `createHonoApp` now derives the mount from this method, by name, through a
// structural interface (the adapter does not depend on this package). ⇒ A
// rename or removal here silently returns that adapter to the mount above.
//
// ## ⛔ getBasePath() is NOT the string better-auth is handed
//
// `createAuthInstance` passes `configuredBasePath()` — the configured value
// VERBATIM — and the two differ exactly when a trailing slash is configured or
// a leading one is missing. That gap is deliberate: better-auth stamps the
// OAuth access-token `iss` from `baseURL + the string it was handed`, and
// `verifyMcpAccessToken` compares `iss` against `getAuthIssuer()`, which keeps
// the configured trailing slash. A draft of this card normalised the handed
// string and every MCP access token minted under a trailing-slash `basePath`
// was then rejected by this manager's own verifier. The cases below pin that
// pair on a REAL `betterAuth()` instance — `getAuthInstance().options.basePath`
// is what `createAuthInstance` actually passed, not a copy of the expression.
//
// ⛔ What is still NOT assertable from this package: that better-auth ROUTES
// under `getBasePath()`'s normalised answer on a real kernel boot. That runs in
// `@objectstack/verify` (`auth-base-path-contract.test.ts`), the nearest package
// that can hold a live better-auth and this manager at once.

import { describe, it, expect } from 'vitest';
import { AuthManager } from './auth-manager';
import type { AuthManagerOptions } from './auth-manager';

const managerWith = (basePath?: unknown) =>
  new AuthManager({ ...(basePath === undefined ? {} : { basePath }) } as unknown as AuthManagerOptions);

describe('#16025 AuthManager.getBasePath', () => {
  it('is a public member — the surface @objectstack/hono reads by name', () => {
    expect(typeof managerWith().getBasePath).toBe('function');
  });

  it('defaults to the shipped base path when nothing is configured', () => {
    expect(managerWith().getBasePath()).toBe('/api/v1/auth');
  });

  it('answers the CONFIGURED base path, which is the point of asking', () => {
    expect(managerWith('/api/v9/identity').getBasePath()).toBe('/api/v9/identity');
  });

  it('normalises every spelling of the base path to the one an adapter can mount', () => {
    // This is exactly the normalisation `betterAuthEndpointPath` has always
    // applied; the method gives it a name and makes it public. ⛔ It does NOT
    // change what better-auth is handed — see the real-instance cases at the
    // bottom of this file. A configured `api/v1/auth` still reaches better-auth
    // WITHOUT its leading slash while the ownership walk tests `/api/v1/auth`;
    // they disagree as STRINGS and not as behaviour, because better-auth and
    // better-call tolerate the missing slash, so `handleRequest` answers `200`
    // and `ownsRoute` answers `true` on the same request. That divergence is
    // latent and is NOT repaired here.
    expect(managerWith('api/v1/auth').getBasePath()).toBe('/api/v1/auth');
    expect(managerWith('/api/v1/auth/').getBasePath()).toBe('/api/v1/auth');
    expect(managerWith('/api/v1/auth///').getBasePath()).toBe('/api/v1/auth');
    expect(managerWith('api/v1/auth/').getBasePath()).toBe('/api/v1/auth');
  });

  it('treats an empty configured value as unset, exactly as the pre-#16025 readers did', () => {
    expect(managerWith('').getBasePath()).toBe('/api/v1/auth');
  });

  it('leaves a configured root as the empty base — unchanged behaviour, pinned so it is a decision', () => {
    // `'/'` normalises to `''`, which is what `betterAuthEndpointPath` has
    // always computed for it. The hono adapter rejects that answer as unusable
    // and keeps its previous mount rather than mounting at the app root.
    expect(managerWith('/').getBasePath()).toBe('');
  });
});

/**
 * The pair that broke, pinned where it broke.
 *
 * `getAuthInstance()` builds the real `betterAuth()` from `createAuthInstance`,
 * so `options.basePath` is the string that site actually passed — an edit that
 * normalises it again turns these red no matter which expression it uses.
 */
describe('#16025 what better-auth is actually configured with', () => {
  const withSecret = (basePath: string) =>
    new AuthManager({ basePath, secret: 'x'.repeat(40) } as unknown as AuthManagerOptions);

  it('is the configured base path VERBATIM — a trailing slash survives', async () => {
    const auth = await withSecret('/api/v1/auth/').getAuthInstance();
    expect(auth.options.basePath).toBe('/api/v1/auth/');
  });

  it('⭐ agrees with getAuthIssuer() for every spelling — the iss verifyMcpAccessToken compares', async () => {
    // better-auth's `ctx.baseURL` is `baseURL` + this string (adding a leading
    // slash if absent), and @better-auth/oauth-provider stamps the access-token
    // `iss` from it. `verifyMcpAccessToken` hands jose `issuer:
    // getAuthIssuer()`, compared by EXACT string. So this is the pair whose
    // disagreement rejects live tokens.
    for (const configured of ['/api/v1/auth', '/api/v1/auth/', '/api/v9/identity/', 'api/v1/auth']) {
      const manager = withSecret(configured);
      const handed = (await manager.getAuthInstance()).options.basePath as string;
      const rooted = handed.startsWith('/') ? handed : `/${handed}`;
      expect(new URL(manager.getAuthIssuer()).pathname).toBe(rooted);
    }
  });

  it('⛔ and is NOT getBasePath() when a trailing slash is configured — the gap is the point', async () => {
    const manager = withSecret('/api/v1/auth/');
    expect((await manager.getAuthInstance()).options.basePath).toBe('/api/v1/auth/');
    expect(manager.getBasePath()).toBe('/api/v1/auth');
  });
});

/**
 * The MIRROR direction of the same split, pinned where it breaks.
 *
 * The three real-instance cases above guard ONE side: an edit that normalises
 * the string handed to better-auth turns them red. Nothing guarded the other
 * side. Point `betterAuthEndpointPath` at `configuredBasePath()` instead of
 * `getBasePath()` — the mistake in the same shape, one method along — and
 * every pin in this package stays green while `ownsRoute` stops recognising
 * better-auth's own routes on every configured spelling that is not ALREADY
 * normalised.
 *
 * ⚠️ That is #15928's class returning, not a cosmetic drift. `ownsRoute`
 * answering `false` is what lets the auth catch-all YIELD better-auth's own
 * 404s (`auth-catchall-yield.test.ts`), so a downstream wildcard answers
 * `200 {}` where a real refusal stood — under a trailing-slash or
 * no-leading-slash deployment only, which is exactly why no existing pin and no
 * default composition could see it.
 *
 * ⭐ The two cases below discriminate BECAUSE the configured spelling is not
 * the normalised one; the control that follows them does not, and is here to
 * say so. `${getBasePath()}/get-session` is the URL an adapter that mounts on
 * `getBasePath()` actually produces, so these ask the shipped question.
 */
describe('#16025 the ownership walk follows getBasePath(), not the configured spelling', () => {
  const withSecret = (basePath: string) =>
    new AuthManager({ basePath, secret: 'x'.repeat(40) } as unknown as AuthManagerOptions);

  /** `ownsRoute` for a route better-auth really routes, addressed at the mount. */
  const ownsGetSession = (configured: string) => {
    const manager = withSecret(configured);
    const url = `http://localhost:3000${manager.getBasePath()}/get-session`;
    return manager.ownsRoute(new Request(url, { method: 'GET' }));
  };

  it('⭐ owns …/get-session when a TRAILING SLASH is configured', async () => {
    await expect(ownsGetSession('/api/v1/auth/')).resolves.toBe(true);
  });

  it('⭐ owns …/get-session when the LEADING SLASH is missing', async () => {
    await expect(ownsGetSession('api/v1/auth')).resolves.toBe(true);
  });

  it('control — the already-normalised spelling, which the mirror mutation cannot move', async () => {
    await expect(ownsGetSession('/api/v1/auth')).resolves.toBe(true);
  });
});
