// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Setup doors that read and write through their own modules — Connector
 * Credentials, Connector Connections, and the installed / org package reads of
 * the Packages page — go out through the console's authenticated fetch
 * (`createAuthenticatedFetch` in `@object-ui/auth`), the one every other
 * console request goes through.
 *
 *   - With a token stored, every call carries `Authorization: Bearer <token>`
 *     beside the cookie (`credentials: 'include'`), so a session held by its
 *     bearer token alone works here as it does on every other page.
 *   - With no token stored (a cookie session), the same calls go out
 *     cookie-only, as before.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenStorage } from '@object-ui/auth';
import { clearConnectorCredential, fetchCredentialListing, putConnectorCredential } from './connectorCredentials';
import { beginConnection, fetchConnection, fetchConnectionListing, revokeConnection } from './connectorConnections';
import {
  fetchLocalInstalls,
  listInstalledPackages,
  listOrgPackages,
} from '../../console/marketplace/marketplaceApi';

const TOKEN = 'stored-session-token';

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Sent = { path: string; method: string; credentials: RequestCredentials | undefined; authorization: string | null };
let sent: Sent[] = [];

/** One connectable instance, so the connection listing reaches every read it makes. */
const META_CONNECTOR = {
  items: [
    { name: 'crm_api', label: 'CRM', provider: 'rest', auth: { type: 'oauth2', grant: 'authorization_code' } },
  ],
};

function answer(path: string, method: string): Response {
  if (path.endsWith('/credential-refs')) return reply({ success: true, data: { credentialRefs: [] } });
  if (path.includes('/credential-refs/')) {
    return reply({ success: true, data: { ref: 'crm_key', status: 'set', connectors: [] } });
  }
  if (path.endsWith('/meta/connector')) return reply(META_CONNECTOR);
  if (path.endsWith('/automation/connectors')) return reply({ success: true, data: { connectors: [] } });
  if (path.endsWith('/connection') && method === 'POST') {
    return reply({ success: true, data: { authorizationUrl: 'https://vendor.test/authorize', expiresAt: '' } });
  }
  if (path.endsWith('/connection')) return reply({ success: true, data: { connector: 'crm_api', status: 'not_connected' } });
  if (path.endsWith('/cloud-connection/org-packages')) return reply({ success: true, data: { connected: true, items: [] } });
  if (path.endsWith('/cloud-connection/installed')) return reply({ success: true, data: { connected: true, packages: [] } });
  if (path.endsWith('/marketplace/install-local')) return reply({ success: true, data: { items: [] } });
  return reply({ success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } }, 404);
}

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      sent.push({ path, method, credentials: init?.credentials, authorization: new Headers(init?.headers).get('Authorization') });
      return answer(path, method);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  TokenStorage.clear();
});

/** Each surface's calls, driven once; every request a call makes is asserted. */
const CALLS: Array<[string, () => Promise<unknown>]> = [
  ['connector credentials: list', () => fetchCredentialListing()],
  ['connector credentials: set', () => putConnectorCredential('crm_key', 'secret-value')],
  ['connector credentials: clear', () => clearConnectorCredential('crm_key')],
  ['connector connections: list', () => fetchConnectionListing()],
  ['connector connections: status', () => fetchConnection('crm_api')],
  ['connector connections: begin', () => beginConnection('crm_api')],
  ['connector connections: begin with an installer client', () => beginConnection('crm_api', { clientId: 'cid', clientSecret: 'cs' })],
  ['connector connections: revoke', () => revokeConnection('crm_api')],
  ['packages: org packages', () => listOrgPackages()],
  ['packages: cloud-installed list', () => listInstalledPackages()],
  ['packages: local install ledger', () => fetchLocalInstalls()],
];

describe('the Setup doors send the stored bearer token', () => {
  it.each(CALLS)('%s carries `Authorization: Bearer <token>` and the cookie', async (_name, call) => {
    TokenStorage.set(TOKEN);
    await call();
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) {
      expect(request.authorization, `${request.method} ${request.path}`).toBe(`Bearer ${TOKEN}`);
      expect(request.credentials, `${request.method} ${request.path}`).toBe('include');
    }
  });

  it.each(CALLS)('%s with no token stored goes out cookie-only, as before', async (_name, call) => {
    TokenStorage.clear();
    await call();
    expect(sent.length).toBeGreaterThan(0);
    for (const request of sent) {
      expect(request.authorization, `${request.method} ${request.path}`).toBeNull();
      expect(request.credentials, `${request.method} ${request.path}`).toBe('include');
    }
  });

  it('the connection listing reaches every read it makes (declarations, registry, status)', async () => {
    TokenStorage.set(TOKEN);
    await fetchConnectionListing();
    expect(sent.map((r) => r.path)).toEqual([
      '/api/v1/meta/connector',
      '/api/v1/automation/connectors',
      '/api/v1/automation/connectors/crm_api/connection',
    ]);
  });
});
