// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37242 — the AI chat page's object read (`appOfObject`: which app
 * a record hand-off opens under) rides the console's authenticated fetch.
 *
 * The defect: it sent the bare global `fetch` with `credentials: 'include'`,
 * the session cookie and nothing else. A session held by its bearer token alone
 * was answered `401`, and every record hand-off from the chat fell back to the
 * `setup` shell instead of the record's own app. Against a server that refuses
 * any request without the bearer:
 *
 *   - with a token stored, the read carries `Authorization: Bearer <token>`
 *     beside the cookie, and the record's owning app comes back;
 *   - CONTROL, no token stored (a cookie session): the read goes out
 *     cookie-only, as before, and the best-effort fallback still answers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import { appOfObject } from '../appOfObject';

const TOKEN = 'stored-session-token';

type Sent = { path: string; credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A server that answers only the bearer: no cookie rides in a unit test, so a request without it is refused. */
function bearerOnlyServer(input: RequestInfo | URL, init?: RequestInit): Response {
  const path = new URL(String(input instanceof Request ? input.url : input), 'http://console.test').pathname;
  const authorization = new Headers(init?.headers).get('Authorization');
  sent.push({ path, credentials: init?.credentials, authorization });
  if (authorization !== `Bearer ${TOKEN}`) {
    return reply({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required to access this endpoint.' } }, 401);
  }
  if (path === '/api/v1/meta/object/crm_lead') return reply({ item: { name: 'crm_lead', _packageId: 'com.example.crm' } });
  return reply({ error: { code: 'NOT_FOUND' } }, 404);
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => bearerOnlyServer(input, init)));
});

afterEach(() => {
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

describe("the AI chat page's object read under a bearer-only session (objectstack#37242)", () => {
  it("finds the record's owning app, sending the stored bearer beside the cookie", async () => {
    TokenStorage.set(TOKEN);
    expect(await appOfObject('crm_lead')).toBe('com.example.crm');
    expect(sent).toEqual([
      { path: '/api/v1/meta/object/crm_lead', credentials: 'include', authorization: `Bearer ${TOKEN}` },
    ]);
  });

  it('CONTROL: with no token stored the read goes out cookie-only and falls back to setup', async () => {
    expect(await appOfObject('crm_lead')).toBe('setup');
    expect(sent).toEqual([{ path: '/api/v1/meta/object/crm_lead', credentials: 'include', authorization: null }]);
  });
});
