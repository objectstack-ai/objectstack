// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30918, #31048] `oauth.authorizedClients` — the URL each method builds and
 * the answer it hands back. The server half (who may read and withdraw whose
 * grants) is pinned in plugin-auth's `authorized-clients-read.real-plugin.test.ts`;
 * this file pins only what the SDK puts on the wire and what it returns.
 */

import { describe, it, expect, expectTypeOf, vi } from 'vitest';
import { ObjectStackClient, type AuthorizedClientsList, type AuthorizedClientWithdrawal } from './index';

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

describe('#31048 oauth.authorizedClients withdraws', () => {
  const WITHDRAWN: AuthorizedClientWithdrawal = { id: 'consent_1' };

  it('withdraw(id) posts exactly { id } to the own door and unwraps the envelope', async () => {
    const { client, fetchMock } = clientAnswering({ success: true, data: WITHDRAWN });
    const answer = await client.oauth.authorizedClients.withdraw('consent_1');
    expect(answer).toEqual(WITHDRAWN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/auth/authorized-clients/withdraw`);
    expect(init.method).toBe('POST');
    // The route refuses any other body key, so the method sends only the id.
    expect(JSON.parse(String(init.body))).toEqual({ id: 'consent_1' });
  });

  it('withdrawForUser(userId, id) posts exactly { userId, id } to the admin door', async () => {
    const { client, fetchMock } = clientAnswering({ success: true, data: WITHDRAWN });
    const answer = await client.oauth.authorizedClients.withdrawForUser('user_2', 'consent_1');
    expect(answer).toEqual(WITHDRAWN);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/api/v1/auth/admin/authorized-clients/withdraw`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ userId: 'user_2', id: 'consent_1' });
  });

  it('a not-found or refused withdraw reaches the caller as a throw, never as a withdrawn answer', async () => {
    const notFound = clientAnswering(
      { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'No authorized assistant you may withdraw matches the supplied id.' } },
      404,
    );
    await expect(notFound.client.oauth.authorizedClients.withdraw('consent_x')).rejects.toThrow();
    const refused = clientAnswering(
      { success: false, error: { code: 'PERMISSION_DENIED', message: 'Platform administrator access required.' } },
      403,
    );
    await expect(refused.client.oauth.authorizedClients.withdrawForUser('user_2', 'consent_1')).rejects.toThrow();
  });

  it('both withdraws are typed with the answer they unwrap', () => {
    const client = new ObjectStackClient({ baseUrl: BASE, fetch: vi.fn() as never });
    expectTypeOf(client.oauth.authorizedClients.withdraw).returns.toEqualTypeOf<Promise<AuthorizedClientWithdrawal>>();
    expectTypeOf(client.oauth.authorizedClients.withdrawForUser).returns.toEqualTypeOf<Promise<AuthorizedClientWithdrawal>>();
  });
});
