// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23813] A minted principal session is not REFRESHED by a read — not merely
 * held to its expiry (#23772's pins), but never renewed at all.
 *
 * The renewal #23772 clamps still wrote the row (`updatedAt`), re-set the
 * session cookie and so made `bearer()` answer `set-auth-token` on every
 * request. The console reads that header as a token rotation and re-resolves
 * identity, then re-reads its organizations, whose session reads renew again:
 * measured on the real console, it never left "Opening your console...". So
 * the pin is the wire a client sees: on both lanes, `get-session` and an
 * endpoint that reads the session through better-auth's middleware answer
 * with no `set-auth-token`, no session `Set-Cookie`, and the row unwritten.
 * The controls prove the same reads DO refresh an unbranded short session,
 * so the pins cannot pass on a fixture that never renews.
 *
 * Real better-auth, real request seam (`AuthManager.handleRequest`), the
 * `sys_session` row read straight off the engine's table.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createMemoryEngine } from './impersonation-bearer-rotation.test';
import { bootMintFixture, expiresAtMs, MINT_BASE, rawTokenOf, type MintFixture } from './principal-session-mint-test-support';
import { carriesPrincipalSession, PRINCIPAL_SESSION_TOKEN_PREFIX } from './principal-session-mint';

let fx: MintFixture;
let cookieName: string;

beforeAll(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fx = await bootMintFixture(createMemoryEngine as any);
  cookieName = (await fx.manager.getAuthContext()).authCookies.sessionToken.name;
});

afterAll(() => vi.restoreAllMocks());

/** What a client sees of one request: the status and whether it was handed a (re)issued session. */
async function wire(path: string, headers: Record<string, string>) {
  const res = await fx.manager.handleRequest(
    new Request(`${fx.origin}${MINT_BASE}${path}`, { method: 'GET', headers: { origin: fx.origin, ...headers } }),
  );
  const setCookie = res.headers.get('set-cookie') ?? '';
  return {
    status: res.status,
    setAuthToken: res.headers.has('set-auth-token'),
    setsSessionCookie: setCookie.split(/,(?=\s*[^;,=\s]+=)/).some((c) => c.trim().startsWith(`${cookieName}=`)),
  };
}

const updatedAtMs = (token: string): number => {
  const row = fx.row(token);
  if (!row) throw new Error('pin: the session row is gone');
  return new Date(row.updated_at as string | Date).getTime();
};

/** A short session WITHOUT the brand, signed as the cookie carries it. */
async function plainShortSession(): Promise<{ token: string; signed: string }> {
  const ctx: any = await fx.manager.getAuthContext();
  const plain = await ctx.internalAdapter.createSession(
    fx.userId, false, { expiresAt: new Date(Date.now() + 120_000) }, true,
  );
  const { makeSignature } = await import('better-auth/crypto');
  return { token: plain.token, signed: encodeURIComponent(`${plain.token}.${await makeSignature(plain.token, ctx.secret)}`) };
}

const LANES = {
  cookie: (signed: string) => ({ cookie: `${cookieName}=${signed}` }),
  bearer: (signed: string) => ({ authorization: `Bearer ${signed}` }),
} as const;

// `/get-session` is the console's boot read; `/list-sessions` reads the session
// through better-auth's `sessionMiddleware`, as the organization reads do.
const PATHS = ['/get-session', '/list-sessions'] as const;

describe('[#23813] a minted session is never refreshed by a read', () => {
  for (const [lane, headersOf] of Object.entries(LANES)) {
    for (const path of PATHS) {
      it(`control (${lane}, ${path}): the same read refreshes a short session WITHOUT the brand`, async () => {
        const plain = await plainShortSession();
        const before = updatedAtMs(plain.token);
        await new Promise((r) => setTimeout(r, 5));

        const seen = await wire(path, headersOf(plain.signed));

        expect(seen.status).toBe(200);
        expect(
          { setAuthToken: seen.setAuthToken, setsSessionCookie: seen.setsSessionCookie },
          'the fixture does not refresh — the pin below would pass vacuously',
        ).toEqual({ setAuthToken: true, setsSessionCookie: true });
        expect(updatedAtMs(plain.token)).toBeGreaterThan(before);
      });

      it(`${lane}, ${path}: answers with no reissued session and leaves the row unwritten`, async () => {
        const minted = await fx.manager.mintPrincipalSession(fx.human());
        const token = rawTokenOf(minted);
        const updatedAt = updatedAtMs(token);
        const expiresAt = expiresAtMs(fx.row(token));

        for (let i = 0; i < 3; i++) {
          await new Promise((r) => setTimeout(r, 5));
          const seen = await wire(path, headersOf(minted.token));
          expect(seen, `read ${i + 1} reissued the minted session`).toEqual({
            status: 200,
            setAuthToken: false,
            setsSessionCookie: false,
          });
          expect(updatedAtMs(token), `read ${i + 1} wrote the minted session row`).toBe(updatedAt);
          expect(expiresAtMs(fx.row(token)), `read ${i + 1} moved the minted expiry`).toBe(expiresAt);
        }
        await minted.revoke();
      });
    }
  }
});

describe('[#23813] carriesPrincipalSession', () => {
  const ctxOf = (headers: Record<string, string>) => ({
    headers: new Headers(headers),
    context: { authCookies: { sessionToken: { name: 'better-auth.session_token' } } },
  });
  const minted = `${PRINCIPAL_SESSION_TOKEN_PREFIX}abc123`;

  it('reads the brand on the cookie lane and on every bearer spelling', () => {
    expect(carriesPrincipalSession(ctxOf({ cookie: `a=b; better-auth.session_token=${minted}.sig%3D` }))).toBe(true);
    expect(carriesPrincipalSession(ctxOf({ authorization: `Bearer ${minted}.sig` }))).toBe(true);
    expect(carriesPrincipalSession(ctxOf({ authorization: `Bearer ${minted}` }))).toBe(true);
    expect(carriesPrincipalSession(ctxOf({ authorization: `Bearer ${encodeURIComponent(`${minted}.sig=`)}` }))).toBe(true);
  });

  it('answers false for every other session, and for the brand under another cookie name', () => {
    expect(carriesPrincipalSession(ctxOf({ cookie: 'better-auth.session_token=AbC123.sig' }))).toBe(false);
    expect(carriesPrincipalSession(ctxOf({ authorization: 'Bearer AbC123.sig' }))).toBe(false);
    expect(carriesPrincipalSession(ctxOf({ cookie: `other_cookie=${minted}` }))).toBe(false);
    expect(carriesPrincipalSession(ctxOf({}))).toBe(false);
    expect(carriesPrincipalSession(undefined)).toBe(false);
  });
});
