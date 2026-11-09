// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31898] The own-row delete doors' caller resolution
 * (`ownRowDeleteCallerResolver`) hands where the request came from to the
 * key's use stamp: the transport's peer and the headers go to the auth
 * service's trust rule, and the address it establishes is what the
 * `credential_use` row records, with the user agent. The door reads no
 * forwarded header itself.
 */

import { describe, expect, it } from 'vitest';
import type { IHttpRequest } from '@objectstack/spec/contracts';

import { hashApiKey } from './api-key.js';
import { currentCredentialUseClient } from './credential-use-client.js';
import { ownRowDeleteCallerResolver } from './own-row-delete-routes.js';

const KEY = 'osk_own_row_delete_31898';
const OWNER = 'u_key_owner';

describe('[#31898] the own-row delete doors hand their client facts to the key\'s use stamp', () => {
  it('the stamp runs with the address the trust rule established from the peer, and the user agent', async () => {
    const stamps: unknown[] = [];
    const handed: Array<{ headers?: Record<string, unknown>; remoteAddress?: string }> = [];
    const keyHash = hashApiKey(KEY);
    const engine = {
      find: async (object: string, q: any = {}) =>
        object === 'sys_api_key' && q?.where?.key === keyHash
          ? [{ id: 'key_1', key: keyHash, user_id: OWNER, revoked: false, scopes: '[]', expires_at: '2999-01-01T00:00:00Z' }]
          : object === 'sys_user' && q?.where?.id === OWNER
            ? [{ id: OWNER }]
            : [],
      // The key's use stamp: what plugin-audit's hook reads, read here.
      update: async () => {
        stamps.push(currentCredentialUseClient() ?? null);
        return {};
      },
    };
    const resolveCaller = ownRowDeleteCallerResolver({
      getEngine: () => engine,
      getAuth: () => ({
        api: { getSession: async () => null },
        resolveClientAddress: (transport: { headers?: Record<string, unknown>; remoteAddress?: string }) => {
          handed.push(transport);
          return '203.0.113.7';
        },
      }) as never,
      tenancy: undefined,
    });
    const context = await resolveCaller({
      params: {},
      query: {},
      headers: { 'x-api-key': KEY, 'user-agent': 'ci-agent/3.1', 'x-forwarded-for': '198.51.100.9' },
      remoteAddress: '10.0.0.5',
      method: 'DELETE',
      path: '/api/v1/views/v1',
    } as unknown as IHttpRequest);
    expect(context?.userId).toBe(OWNER);
    expect(handed).toHaveLength(1);
    expect(handed[0].remoteAddress).toBe('10.0.0.5');
    expect(handed[0].headers?.['x-forwarded-for'], 'handed over raw: the auth service decides whether it counts').toBe('198.51.100.9');
    expect(stamps).toEqual([{ ipAddress: '203.0.113.7', userAgent: 'ci-agent/3.1' }]);
  });
});
