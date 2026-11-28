// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shell's held package list, and the studio-design and timeline doors
 * beside it, go out through the console's authenticated fetch
 * (`createAuthenticatedFetch` in `@object-ui/auth`).
 *
 * The case measured in the browser: a session held by its bearer token alone
 * (no session cookie) read `GET /api/v1/packages` cookie-only, was answered
 * `401`, and the sidebar, the app header, the command palette and the Studio
 * entries lost every package with no error shown. Against a server that
 * refuses any request without the bearer:
 *
 *   - with a token stored, the list loads and every call carries
 *     `Authorization: Bearer <token>` beside the cookie
 *     (`credentials: 'include'`);
 *   - with no token stored (a cookie session), the same calls go out
 *     cookie-only, as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import { duplicatePackage, fetchListedPackageIds, fetchPackages, forgetPackageListReads } from './packages-io';
import { fetchCommits, revertCommit } from '../../preview/commitHistory';
import { listSuggestedBindings } from '../../services/suggestedBindingsApi';

const TOKEN = 'stored-session-token';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Sent = { path: string; method: string; credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

const PACKAGES = {
  success: true,
  data: { packages: [{ manifest: { id: 'com.example.crm', name: 'CRM' } }, { id: 'app.helpdesk', name: 'Helpdesk' }] },
};

function answer(path: string, method: string): Response {
  if (path === '/api/v1/packages') return reply(PACKAGES);
  if (path.endsWith('/duplicate') && method === 'POST') return reply({ success: true, data: { success: true } });
  if (path.endsWith('/commits') && method === 'GET') return reply({ success: true, data: { commits: [] } });
  if (path.endsWith('/revert') && method === 'POST') return reply({ success: true, data: { success: true } });
  if (path.startsWith('/api/v1/security/suggested-bindings')) return reply({ success: true, data: { suggestions: [] } });
  return reply({ success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } }, 404);
}

/** A server that answers only the bearer: no cookie rides in a unit test, so a request without it is refused. */
function bearerOnlyServer(input: RequestInfo | URL, init?: RequestInit): Response {
  const path = new URL(String(input), 'http://console.test').pathname;
  const method = (init?.method ?? 'GET').toUpperCase();
  const authorization = new Headers(init?.headers).get('Authorization');
  sent.push({ path, method, credentials: init?.credentials, authorization });
  if (authorization !== `Bearer ${TOKEN}`) {
    return reply({ error: 'UNAUTHENTICATED', code: 'UNAUTHENTICATED', message: 'Authentication is required to access this endpoint.' }, 401);
  }
  return answer(path, method);
}

beforeEach(() => {
  sent = [];
  forgetPackageListReads();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => bearerOnlyServer(input, init)));
});

afterEach(() => {
  forgetPackageListReads();
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

describe('the held package list under a bearer-only session', () => {
  it('loads the package list, sending the stored bearer beside the cookie', async () => {
    TokenStorage.set(TOKEN);
    const packages = await fetchPackages();
    expect(packages.map((p) => p.id)).toEqual(['com.example.crm', 'app.helpdesk']);
    expect(sent).toEqual([
      { path: '/api/v1/packages', method: 'GET', credentials: 'include', authorization: `Bearer ${TOKEN}` },
    ]);
  });

  it('answers the listed-id read from the same authenticated request', async () => {
    TokenStorage.set(TOKEN);
    const ids = await fetchListedPackageIds();
    expect([...ids].sort()).toEqual(['app.helpdesk', 'com.example.crm']);
    expect(sent.every((s) => s.authorization === `Bearer ${TOKEN}` && s.credentials === 'include')).toBe(true);
  });

  it('a cookie session (no token stored) still goes out cookie-only', async () => {
    await expect(fetchPackages()).rejects.toThrow();
    expect(sent).toEqual([{ path: '/api/v1/packages', method: 'GET', credentials: 'include', authorization: null }]);
  });
});

/** The studio-design write, the timeline and the AI doors converted beside the list read. */
const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['studio-design: duplicate a package', () => duplicatePackage('com.example.crm', 'com.example.crm_copy')],
  ['timeline: commit history', () => fetchCommits('com.example.crm')],
  ['timeline: revert a commit', () => revertCommit('com.example.crm', 'c-1')],
  ['access: suggested bindings', () => listSuggestedBindings()],
];

describe('the converted doors send the stored bearer token', () => {
  it.each(CALLS)('%s: carries the bearer beside the cookie and is answered', async (_name, call) => {
    TokenStorage.set(TOKEN);
    await call();
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      expect(s).toMatchObject({ credentials: 'include', authorization: `Bearer ${TOKEN}` });
    }
  });

  it.each(CALLS)('%s: a cookie session (no token stored) sends no Authorization header', async (_name, call) => {
    await call().catch(() => undefined);
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      expect(s).toMatchObject({ credentials: 'include', authorization: null });
    }
  });
});
