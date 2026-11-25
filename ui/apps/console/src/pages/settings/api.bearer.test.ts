// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `/api/settings` call — and the judged-address read the auth and
 * access-policy namespaces make — goes out through the console's authenticated
 * fetch (`createAuthenticatedFetch` in `@object-ui/auth`), so it carries the
 * session's bearer token as every other console request does, beside the
 * session cookie.
 *
 * The state this protects: a session held by its bearer token alone (the
 * cookie was replaced by a second runtime on the same host, blocked as a
 * third-party cookie, or cleared). The rest of the console works there; a
 * cookie-only call answers `401`.
 *
 * The control: with no token stored, the same calls go out exactly as a
 * cookie session needs them — `credentials: 'include'`, no `Authorization`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import {
  getJudgedClientAddress,
  getSettingsNamespace,
  listSettingsManifests,
  runSettingsAction,
  saveSettingsNamespace,
} from './api';

const TOKEN = 'stored-session-token';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** One fake per route: the body each call reads as success. */
function answer(url: string, method: string): Response {
  const path = new URL(url, 'http://console.test').pathname;
  if (path.startsWith('/api/v1/auth/')) return reply({ clientAddress: '203.0.113.7', trustProxy: false });
  if (path === '/api/settings') return reply({ success: true, data: { manifests: [] } });
  if (method === 'PUT') return reply({ success: true, data: { values: {} } });
  if (method === 'POST') return reply({ success: true, data: { ok: true } });
  return reply({ success: true, data: { manifest: { namespace: 'company' }, values: {} } });
}

type Sent = { url: string; method: string; credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      sent.push({
        url,
        method,
        credentials: init?.credentials,
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      return answer(url, method);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

/** Every call this module makes, each driven once. */
const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['GET /api/settings', () => listSettingsManifests()],
  ['GET /api/settings/:namespace', () => getSettingsNamespace('company')],
  ['PUT /api/settings/:namespace', () => saveSettingsNamespace('company', { name: 'Acme' })],
  ['POST /api/settings/:namespace/:action', () => runSettingsAction('mail', 'send_test')],
  ['GET /api/v1/auth/admin/client-address', () => getJudgedClientAddress('/admin/client-address')],
  ['GET /api/v1/auth/client-address', () => getJudgedClientAddress('/client-address')],
];

describe('the settings client sends the stored bearer token', () => {
  it.each(CALLS)('%s carries `Authorization: Bearer <token>` and the cookie', async (_name, call) => {
    TokenStorage.set(TOKEN);
    await call();
    expect(sent).toHaveLength(1);
    expect(sent[0].authorization).toBe(`Bearer ${TOKEN}`);
    expect(sent[0].credentials).toBe('include');
  });

  it.each(CALLS)('%s with no token stored goes out cookie-only, as before', async (_name, call) => {
    TokenStorage.clear();
    await call();
    expect(sent).toHaveLength(1);
    expect(sent[0].authorization).toBeNull();
    expect(sent[0].credentials).toBe('include');
  });
});
