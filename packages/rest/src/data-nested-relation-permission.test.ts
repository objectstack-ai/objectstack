// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20802] The nested-relation form reads the related object AS THE CALLER:
 * the related object's row scope and field permissions apply to the condition
 * exactly as they apply to a direct read of it — with the REAL security layer
 * (`SecurityPlugin` on a real `ObjectQL` over a real `SqlDriver`), through
 * `POST /api/v1/data/:object/query`.
 *
 * The ruling's permission axis, measured:
 *
 * - **A field the caller cannot read.** A direct filter on it is refused today
 *   — `403 PERMISSION_DENIED`, the security layer's filter-oracle guard
 *   (`assertReadableQueryFields`), naming the field. The nested form reaches
 *   that SAME check through the related read, so it answers the same refusal,
 *   loudly — ⛔ never a `200` with no rows, and ⛔ never the rows a system read
 *   would have matched (which is filtering by a value the caller may not see).
 *   There is no second copy of the rule in the engine.
 * - **The related object's row scope.** A related record the caller's RLS
 *   hides matches no condition: the rows it would have selected are not
 *   selected, and a system caller still gets them.
 *
 * SQLite only: the checks are the security layer's, before any driver
 * dialect is involved; `data-nested-object-door.test.ts` carries the dialect
 * axis of the lowering itself.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';

const OBJECT = 'rest_nested_perm_ledger';
const OWNER = 'rest_nested_perm_owner';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  // The field the caller may not read, on the RELATED object.
  fields: { [`${OWNER}.secret`]: { readable: false, editable: false } },
  // The related object's row scope: the caller sees owners outside region HIDDEN only.
  rowLevelSecurity: [{ name: 'owner_scope', object: OWNER, operation: 'all', using: "record.region != 'HIDDEN'" }],
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const OWNERS = [
  { id: 'u1', region: 'NA', secret: 's1' },
  { id: 'u2', region: 'EU', secret: 's2' },
  { id: 'u3', region: 'HIDDEN', secret: 's3' },
];
const ROWS = [
  { id: 'd1', title: 'a', owner: 'u1' },
  { id: 'd2', title: 'b', owner: 'u2' },
  { id: 'd3', title: 'c', owner: 'u1' },
  { id: 'd4', title: 'd', owner: 'u3' },
];

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

const idsOf = (rows: any): string[] => (Array.isArray(rows) ? rows : rows?.records ?? []).map((r: any) => r.id).sort();
const envelopeOf = (e: any) => ({ code: e?.code, status: e?.statusCode ?? e?.status });

describe('[#20802] the nested-relation form reads the related object as the caller — the real security layer', () => {
  let engine: ObjectQL;
  let query: (where: FilterCondition, object?: string) => Promise<{ status: number; body: any }>;

  beforeAll(async () => {
    engine = new ObjectQL();
    engine.registerDriver(
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
      true,
    );
    await engine.init();
    engine.registerApp({
      id: 'com.objectstack.qa.nested-relation-permission-20802',
      name: 'Nested relation permission',
      version: '1.0.0',
      type: 'plugin',
      scope: 'system',
      objects: [
        {
          name: OWNER,
          label: 'Owner',
          sharingModel: 'public_read_write',
          fields: {
            region: { name: 'region', type: 'text' },
            secret: { name: 'secret', type: 'text' },
          },
        },
        {
          name: OBJECT,
          label: 'Ledger',
          sharingModel: 'public_read_write',
          fields: {
            title: { name: 'title', type: 'text' },
            owner: { name: 'owner', type: 'lookup', reference: OWNER },
          },
        },
      ],
    } as never);
    await engine.syncSchemas();

    const services: Record<string, unknown> = {
      manifest: { register: vi.fn() },
      objectql: engine,
      metadata: {
        get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
        list: async () => [MEMBER_SET],
      },
    };
    const ctx = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    await plugin.init(ctx as never);
    await plugin.start(ctx as never);
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

    await engine.insert(OWNER, OWNERS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
    await engine.insert(OBJECT, ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => MEMBER_CTX;
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/query');
    expect(route).toBeDefined();
    query = async (where, object = OBJECT) => {
      const res = makeRes();
      await route!.handler({ params: { object }, body: JSON.parse(JSON.stringify({ where })), query: {}, headers: {} } as any, res);
      return { status: res._status ?? 200, body: res._json };
    };
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('CONTROL a condition on a field the caller can read is served under the security layer', async () => {
    const res = await query({ owner: { region: 'NA' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(idsOf(res.body)).toEqual(['d1', 'd3']);
  });

  it('a field the caller cannot read: the direct filter is refused today, and the nested form answers the SAME refusal — never an empty result', async () => {
    // The one check, measured on a direct read of the related object.
    const direct = await engine.find(OWNER, { where: { secret: 's1' }, context: MEMBER_CTX } as never).then(() => null, (e: any) => e);
    expect(envelopeOf(direct)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(String(direct?.message)).toContain('secret');

    // The nested form, in-process and at the public door.
    const nested = await engine.find(OBJECT, { where: { owner: { secret: 's1' } }, context: MEMBER_CTX } as never)
      .then((rows) => ({ rows }), (e: any) => e);
    expect(envelopeOf(nested)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(String(nested?.message)).toContain('secret');
    expect(String(nested?.message)).toContain(OWNER);

    const res = await query({ owner: { secret: 's1' } });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(JSON.stringify(res.body)).toContain('PERMISSION_DENIED');
    expect(res.body?.records, 'no rows are served beside the refusal').toBeUndefined();

    // What the refusal withholds: a system read CAN filter by the value.
    const system = await engine.find(OBJECT, { where: { owner: { secret: 's1' } }, context: SYS_CTX } as never);
    expect(idsOf(system)).toEqual(['d1', 'd3']);
  });

  it('the related object\'s row scope applies: a related record the caller cannot see matches no condition', async () => {
    const res = await query({ owner: { region: 'HIDDEN' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(idsOf(res.body)).toEqual([]);
    // The record is there, and a system caller's condition finds it.
    const system = await engine.find(OBJECT, { where: { owner: { region: 'HIDDEN' } }, context: SYS_CTX } as never);
    expect(idsOf(system)).toEqual(['d4']);
  });
});
