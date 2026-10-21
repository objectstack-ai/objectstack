// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which `OS_CORS_ORIGIN` entries reach better-auth's trusted origins.
 *
 * `AuthManager` trusts the origins listed in `OS_CORS_ORIGIN`, so one variable
 * covers a cross-origin front-end that signs in (`docs/HARDENING.md` § CORS).
 * The governing text is the same section: never `'*'` with credentials, and an
 * explicit list. So each entry is judged on its own, and an entry that admits
 * every host — `'*'`, or a pattern whose host part is the bare `*` — never
 * enters the trusted set, however the list around it is spelled. That is the
 * same class the transport refuses with credentials (`isAllHostOriginPattern`
 * in `@objectstack/plugin-hono-server`); `@objectstack/http-conformance` holds
 * the doors to one answer.
 *
 * Read off a REAL `betterAuth()` instance: `options.trustedOrigins` is what
 * `createAuthInstance` actually handed it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthManager } from './auth-manager';
import type { AuthManagerOptions } from './auth-manager';

const CONFIGURED = 'https://app.example.com';
const ENV_KEYS = ['NODE_ENV', 'OS_CORS_ORIGIN', 'CORS_ORIGIN', 'OS_SSO_ENABLED'] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  // Production: no development substitution, so the set is exactly what the
  // configuration contributed.
  process.env.NODE_ENV = 'production';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k]!;
  }
});

/** The trusted origins a real better-auth instance was configured with (`[]` when the key is omitted). */
async function trustedWith(corsOrigin: string): Promise<string[]> {
  process.env.OS_CORS_ORIGIN = corsOrigin;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const manager = new AuthManager({
      secret: 'x'.repeat(40),
      baseUrl: CONFIGURED,
    } as unknown as AuthManagerOptions);
    const auth = await manager.getAuthInstance();
    const trusted = auth.options.trustedOrigins;
    expect(typeof trusted === 'function').toBe(false);
    return (trusted as string[] | undefined) ?? [];
  } finally {
    warn.mockRestore();
  }
}

describe('OS_CORS_ORIGIN entries reach the trusted set one by one', () => {
  it("a '*' entry beside real origins does not enter the trusted set; the real origins do", async () => {
    expect(await trustedWith(`${CONFIGURED},*`)).toEqual([CONFIGURED]);
    expect(await trustedWith(`*, ${CONFIGURED}`)).toEqual([CONFIGURED]);
  });

  it("a '*' spelled with surrounding space is judged as '*'", async () => {
    expect(await trustedWith(' * ')).toEqual([]);
    expect(await trustedWith(`${CONFIGURED}, * `)).toEqual([CONFIGURED]);
  });

  it('a pattern whose host part is the bare `*` is judged as `*`', async () => {
    for (const entry of ['https://*', '*://*', 'http://*:*', 'https://*:8443']) {
      expect(await trustedWith(`${CONFIGURED},${entry}`)).toEqual([CONFIGURED]);
    }
  });

  it('a pattern that names part of the host still enters, verbatim', async () => {
    expect(await trustedWith(`${CONFIGURED},https://*.example.net`)).toEqual([
      CONFIGURED,
      'https://*.example.net',
    ]);
  });
});
