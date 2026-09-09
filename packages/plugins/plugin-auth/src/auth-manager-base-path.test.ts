// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16025 — `AuthManager.getBasePath()`: the string an HTTP adapter reads to
// learn where better-auth serves.
//
// ⛔ NOT "the one definition" of that value, which an earlier spelling of this
// header claimed. #16399 gave the file one, a layer down: `configuredBasePath()`
// is now the ONLY read of `this.config.basePath`, `rootedBasePath()` the only
// place a leading slash is added, and `getBasePath()` the only place a trailing
// one is stripped. `getAuthIssuer()` and `getMcpResourceUrl()` read that chain
// instead of each re-deriving. Their two values still DIFFER on purpose — see
// the #16399 block at the bottom of this file, which pins why.
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

/**
 * #16399 — the three derivations are ONE chain, and the MCP resource identifier
 * is a URL for every spelling of `basePath`.
 *
 * ## What was wrong, measured on `origin/main` before this card
 *
 *     basePath 'api/v1/auth'   getMcpResourceUrl() -> http://localhost:3000api/v1/mcp
 *     basePath 'api/v1/auth/'  getMcpResourceUrl() -> http://localhost:3000api/v1/mcp
 *
 * That is not an alternative spelling of the identifier, it is not a URL:
 * `new URL()` throws on it (`3000api` is not a port), so `auth-plugin.ts`'s
 * `new URL(manager.getMcpResourceUrl()).pathname` — which mounts the RFC 9728
 * §3.1 path-inserted well-known route — throws too, and
 * `@better-auth/oauth-provider` 1.7.2 refuses to seed the `sys_oauth_resource`
 * row from it at plugin init:
 *
 *     oauth-provider: skipping resource seed for http://localhost:3000api/v1/mcp
 *     — resource identifier ... must be an absolute URI (RFC 8707 §2)
 *
 * ⇒ under that configuration no token could ever have been minted OR matched,
 * so the repair re-selects nothing.
 *
 * ## ⛔ Why the ASSERTION is `new URL(...)` and not a string literal
 *
 * A literal is only as right as whoever typed it: writing
 * `toBe('http://localhost:3000api/v1/mcp')` would have pinned the defect. These
 * cases assert the PROPERTY that failed — that the value parses as an absolute
 * URL, and that its path is the one the mount actually serves — and only then
 * compare it with the canonical answer.
 */
describe('#16399 one normalisation chain, and an MCP resource URL that is always a URL', () => {
  const withOrigin = (basePath?: string) =>
    new AuthManager({
      ...(basePath === undefined ? {} : { basePath }),
      baseUrl: 'http://localhost:3000',
    } as unknown as AuthManagerOptions);

  /** Every spelling of "mount better-auth under /api/v1/auth" a host might write. */
  const EQUIVALENT_SPELLINGS = [
    undefined,          // unset -> the shipped default
    '',                 // empty -> treated as unset
    '/api/v1/auth',     // canonical
    'api/v1/auth',      // ⭐ no leading slash  — defect 1
    '/api/v1/auth/',    // trailing slash
    'api/v1/auth/',     // ⭐ both              — defect 1
    '/api/v1/auth///',  // repeated trailing slashes
  ] as const;

  it('⭐ builds a parseable absolute URL for EVERY spelling — the property that failed', () => {
    for (const spelling of EQUIVALENT_SPELLINGS) {
      const manager = withOrigin(spelling);
      // `new URL` throws on a malformed value; letting it throw IS the assertion.
      const resource = new URL(manager.getMcpResourceUrl());
      const issuer = new URL(manager.getAuthIssuer());
      expect(resource.protocol).toBe('http:');
      expect(resource.host).toBe('localhost:3000');
      expect(issuer.host).toBe('localhost:3000');
    }
  });

  it('⭐ answers the SAME resource identifier for every spelling of the same mount', () => {
    for (const spelling of EQUIVALENT_SPELLINGS) {
      expect(withOrigin(spelling).getMcpResourceUrl()).toBe('http://localhost:3000/api/v1/mcp');
    }
  });

  it("the resource path is where the mount actually serves — auth-plugin's `new URL(...).pathname`", () => {
    // auth-plugin.ts registers `/.well-known/oauth-protected-resource${mcpPath}`
    // off exactly this expression. Under the defect it threw instead.
    for (const spelling of EQUIVALENT_SPELLINGS) {
      const manager = withOrigin(spelling);
      expect(new URL(manager.getMcpResourceUrl()).pathname).toBe('/api/v1/mcp');
      expect(manager.getBasePath()).toBe('/api/v1/auth');
    }
  });

  it('a base path that is not an auth path keeps its whole prefix', () => {
    expect(withOrigin('/api/v9/identity').getMcpResourceUrl()).toBe(
      'http://localhost:3000/api/v9/identity/mcp',
    );
    expect(withOrigin('api/v9/identity/').getMcpResourceUrl()).toBe(
      'http://localhost:3000/api/v9/identity/mcp',
    );
  });

  it('a configured root yields the bare /mcp resource, not a doubled slash', () => {
    // `'/'` normalises to `''` (pinned above), so the resource is `/mcp`.
    // Before this card it was `http://localhost:3000//mcp` — parseable, but a
    // `//mcp` path that no mount serves.
    expect(withOrigin('/').getMcpResourceUrl()).toBe('http://localhost:3000/mcp');
    expect(new URL(withOrigin('/').getMcpResourceUrl()).pathname).toBe('/mcp');
  });

  /**
   * ⭐ NEGATIVE CONTROL — an already-canonical `basePath` must answer byte for
   * byte what it answered before this card, on ALL THREE getters. These are the
   * values in the card's own "measured, on the real manager" table, row 1.
   * If a canonical deployment's `iss` or `aud` moved, this card changed which
   * tokens are accepted and the claim's `Clause-②: no` no longer holds.
   */
  it('⭐ negative control — a canonical basePath moves NOTHING on all three getters', () => {
    const manager = withOrigin('/api/v1/auth');
    expect(manager.getBasePath()).toBe('/api/v1/auth');
    expect(manager.getAuthIssuer()).toBe('http://localhost:3000/api/v1/auth');
    expect(manager.getMcpResourceUrl()).toBe('http://localhost:3000/api/v1/mcp');

    const dflt = withOrigin();
    expect(dflt.getBasePath()).toBe('/api/v1/auth');
    expect(dflt.getAuthIssuer()).toBe('http://localhost:3000/api/v1/auth');
    expect(dflt.getMcpResourceUrl()).toBe('http://localhost:3000/api/v1/mcp');
  });

  /**
   * ⭐ The pin that stops defect 2 from being "fixed" into existence.
   *
   * The card and its triage both read PR #16380 as having created a divergence
   * — better-auth handed the STRIPPED form while `getAuthIssuer()` broadcast
   * the RETAINED one. That is not what landed: #16380's last commit ("hand
   * better-auth the configured basePath verbatim again") reverted exactly that,
   * because it rejects every token minted under a trailing-slash `basePath`.
   *
   * So there is nothing to align, and this case says so by measurement rather
   * than by prose: it reads better-auth's OWN `ctx.context.baseURL` — the value
   * `@better-auth/oauth-provider` 1.7.2 stamps as the access-token `iss` — off
   * a real instance built by `createAuthInstance`, and requires
   * `getAuthIssuer()` to equal it. Canonicalising `getAuthIssuer()` turns this
   * RED, which is the point.
   */
  it('⭐ getAuthIssuer() equals the issuer the AS is ACTUALLY configured with', async () => {
    const withSecret = (basePath: string) =>
      new AuthManager({
        basePath,
        secret: 'x'.repeat(40),
        baseUrl: 'http://localhost:3000',
      } as unknown as AuthManagerOptions);

    for (const configured of [
      '/api/v1/auth',
      'api/v1/auth',
      '/api/v1/auth/',
      'api/v1/auth/',
      '/api/v1/auth///',
      '/api/v9/identity/',
    ]) {
      const manager = withSecret(configured);
      const auth = (await manager.getAuthInstance()) as unknown as {
        $context: Promise<{ baseURL: string }>;
      };
      const stamped = (await auth.$context).baseURL;
      expect(manager.getAuthIssuer()).toBe(stamped);
    }
  });
});
