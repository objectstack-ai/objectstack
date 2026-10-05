// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0093 D7 — the session seam recognises the user its request CREATED from
 * the adapter's own `create` result, with no read of the store. These cases
 * pin the real wiring: the AuthManager's adapter factory, a `sys_user` create
 * inside a better-auth endpoint context, and the session hook of that context.
 */

import { describe, it, expect, vi } from 'vitest';
import { runWithEndpointContext } from '@better-auth/core/context';
import { AuthManager } from './auth-manager.js';
import { createObjectQLAdapterFactory } from './objectql-adapter.js';
import { assertEngineFindOnePredicate } from '@objectstack/objectql';

const DEFAULT_ORG = 'org_default';

function makeEngine() {
  const tables: Record<string, any[]> = { sys_user: [], sys_member: [] };
  let seq = 0;
  const match = (r: any, where: any = {}) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported combinator ${k}`);
      return r[k] === v;
    });
  return {
    tables,
    insert: vi.fn(async (object: string, data: any) => {
      const row = { ...data, id: data.id ?? `${object}_${++seq}` };
      (tables[object] ??= []).push(row);
      return row;
    }),
    find: vi.fn(async (object: string, q: any) =>
      (tables[object] ?? []).filter((r) => match(r, q?.where)).slice(0, q?.limit ?? 100),
    ),
    findOne: vi.fn(async (object: string, q: any) => {
      assertEngineFindOnePredicate(object, q);
      return (tables[object] ?? []).find((r) => match(r, q?.where)) ?? null;
    }),
  };
}

async function setup() {
  const engine = makeEngine();
  const manager = new AuthManager({
    secret: 'test-secret-at-least-32-chars-long',
    baseUrl: 'http://localhost:3000',
    dataEngine: engine,
    getTenancy: () => ({ defaultOrgId: async () => DEFAULT_ORG }),
  } as any);
  const factory = await (manager as any).createDatabaseConfig();
  const adapter: any = factory({} as any);
  const hooks: any = (manager as any).composeDatabaseHooks(undefined);
  const createUser = (request: object) =>
    runWithEndpointContext(request as any, () =>
      adapter.create({
        model: 'user',
        data: { email: 'created.here@example.com', name: 'Created Here', emailVerified: false },
      }),
    );
  return { engine, hooks, createUser };
}

describe('the creating request is recognised from the adapter create result (ADR-0093 D7)', () => {
  it('a user created through the adapter in this request is settled by its session', async () => {
    const { engine, hooks, createUser } = await setup();
    const request = {};
    const created = await createUser(request);
    const reads = engine.findOne.mock.calls.length;
    const result = await hooks.session.create.before({ userId: created.id }, request);
    expect(result?.data?.activeOrganizationId).toBe(DEFAULT_ORG);
    expect(engine.tables.sys_member).toEqual([
      expect.objectContaining({ organization_id: DEFAULT_ORG, user_id: created.id }),
    ]);
    // Recognising the user read nothing from `sys_user`.
    const userReads = engine.findOne.mock.calls.slice(reads).filter((c) => c[0] === 'sys_user');
    expect(userReads).toHaveLength(0);
  });

  it('a request that created one user does not settle a DIFFERENT pre-existing member-less user', async () => {
    const { engine, hooks, createUser } = await setup();
    engine.tables.sys_user.push({ id: 'usr_preexisting', email: 'pre@example.com' });
    const request = {};
    await createUser(request);
    const result = await hooks.session.create.before({ userId: 'usr_preexisting' }, request);
    expect(result?.data?.activeOrganizationId).toBeUndefined();
    expect(engine.tables.sys_member).toHaveLength(0);
  });

  it('CONTROL: the same user signing in from another request is not settled', async () => {
    const { engine, hooks, createUser } = await setup();
    const created = await createUser({});
    const result = await hooks.session.create.before({ userId: created.id }, {});
    expect(result?.data?.activeOrganizationId).toBeUndefined();
    expect(engine.tables.sys_member).toHaveLength(0);
  });
});

describe('objectql-adapter onRecordCreated', () => {
  it('reports the protocol object name and the stored row', async () => {
    const engine = makeEngine();
    const onRecordCreated = vi.fn();
    const adapter: any = (createObjectQLAdapterFactory(engine as any, { onRecordCreated }) as any)({} as any);
    const row = await adapter.create({ model: 'user', data: { email: 'a@example.com', name: 'A', emailVerified: false } });
    expect(onRecordCreated).toHaveBeenCalledTimes(1);
    expect(onRecordCreated.mock.calls[0]![0]).toBe('sys_user');
    expect(onRecordCreated.mock.calls[0]![1]).toMatchObject({ id: row.id });
  });

  it('a throwing callback does not fail a write that landed', async () => {
    const engine = makeEngine();
    const onRecordCreated = vi.fn(async () => {
      throw new Error('bookkeeping down');
    });
    const adapter: any = (createObjectQLAdapterFactory(engine as any, { onRecordCreated }) as any)({} as any);
    await expect(
      adapter.create({ model: 'user', data: { email: 'b@example.com', name: 'B', emailVerified: false } }),
    ).resolves.toMatchObject({ email: 'b@example.com' });
    expect(engine.tables.sys_user).toHaveLength(1);
  });
});
