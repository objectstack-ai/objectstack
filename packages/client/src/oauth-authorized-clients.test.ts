// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30918] `oauth.authorizedClients` — the URL each method builds and the
 * answer it hands back. The server half (who may read whose grants) is pinned
 * in plugin-auth's `authorized-clients-read.real-plugin.test.ts`; this file
 * pins only what the SDK puts on the wire and what it returns.
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { ObjectStackClient, type AuthorizedClientsList } from './index';

const BASE = 'http://localhost:3000';

const LIST: AuthorizedClientsList = {
  clients: [
    {
      id: 'consent_1',
      clientId: 'client_1',
      name: 'Desk Assistant',
      scopes: ['openid', 'mcp:read'],
      organizationId: 'org_1',
      authorizedAt: '2026-11-01T09:12:00.000Z',
      lastUsedAt: '2026-11-06T10:00:00.000Z',
    },
  ],
  truncated: false,
};

function clientAnswering(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
  const client = new ObjectStackClient({ baseUrl: BASE, fetch: fetchMock as never });
  return { client, fetchMock };
}

describe('#30918 oauth.authorizedClients', () => {
  it('list() reads the caller\'s own grants with NO parameter and unwraps the envelope', async () => {
    const { client, fetchMock } = clientAnswering({ success: true, data: LIST });
    const answer = await client.oauth.authorizedClients.list();
    expect(answer).toEqual(LIST);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    // The route refuses any parameter, so the method sends none.
    expect(url).toBe(`${BASE}/api/v1/auth/authorized-clients`);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('listForUser(id) names the person in the one parameter the admin route takes, encoded', async () => {
    const { client, fetchMock } = clientAnswering({ success: true, data: LIST });
    const answer = await client.oauth.authorizedClients.listForUser('user a&b');
    expect(answer).toEqual(LIST);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toBe(`${BASE}/api/v1/auth/admin/authorized-clients?userId=user%20a%26b`);
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('a refusal reaches the caller as a throw, not as an empty list', async () => {
    const { client } = clientAnswering(
      { success: false, error: { code: 'PERMISSION_DENIED', message: 'Platform administrator access required.' } },
      403,
    );
    await expect(client.oauth.authorizedClients.listForUser('user_2')).rejects.toThrow();
  });

  it('both methods are typed with the answer they unwrap', () => {
    const client = new ObjectStackClient({ baseUrl: BASE, fetch: vi.fn() as never });
    expectTypeOf(client.oauth.authorizedClients.list).returns.toEqualTypeOf<Promise<AuthorizedClientsList>>();
    expectTypeOf(client.oauth.authorizedClients.listForUser).returns.toEqualTypeOf<Promise<AuthorizedClientsList>>();
  });
});
