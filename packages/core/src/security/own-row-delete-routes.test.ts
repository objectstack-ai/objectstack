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
import { ownRowDeleteCallerResolver, removeOwnRow, type OwnRowDeleteDoor } from './own-row-delete-routes.js';

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

describe("the own-row delete door's step 7: the object's own refusal", () => {
  const OWN = { id: 'row_1', owner_id: 'u_me' };
  const makeEngine = () => {
    const deleted: unknown[] = [];
    return {
      deleted,
      findOne: async () => ({ ...OWN }),
      delete: async (_object: string, options: { where: Record<string, unknown> }) => {
        deleted.push(options.where);
        return 1;
      },
    };
  };
  const door = (refuseRemoval?: OwnRowDeleteDoor['refuseRemoval']): OwnRowDeleteDoor => ({
    route: '/api/v1/things/:id',
    object: 'thing',
    ownerField: 'owner_id',
    words: { noun: 'thing', shortNoun: 'thing', owner: 'member' },
    ...(refuseRemoval ? { refuseRemoval } : {}),
  });
  const ME = { userId: 'u_me', tenantId: 'org_1' } as never;

  it('a refusal it throws reaches the caller and nothing is removed', async () => {
    const engine = makeEngine();
    const refusal = Object.assign(new Error('kept'), { code: 'DELETE_RESTRICTED', status: 409 });
    const seen: unknown[] = [];
    await expect(
      removeOwnRow(engine, door(async (row) => {
        seen.push(row);
        throw refusal;
      }), 'row_1', ME),
    ).rejects.toBe(refusal);
    expect(seen).toEqual([OWN]);
    expect(engine.deleted).toEqual([]);
  });

  it('is asked only after the owner check: a foreign row is refused 403 before it runs', async () => {
    const engine = { ...makeEngine(), findOne: async () => ({ id: 'row_1', owner_id: 'u_other' }) };
    let asked = false;
    await expect(
      removeOwnRow(engine, door(async () => {
        asked = true;
      }), 'row_1', ME),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(asked).toBe(false);
  });

  it('resolving admits the removal, as a door that declares none does', async () => {
    for (const refuse of [async () => undefined, undefined]) {
      const engine = makeEngine();
      await removeOwnRow(engine, door(refuse), 'row_1', ME);
      expect(engine.deleted).toEqual([{ id: 'row_1' }]);
    }
  });
});
