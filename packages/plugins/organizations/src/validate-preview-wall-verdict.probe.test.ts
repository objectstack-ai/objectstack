// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MEASUREMENT PROBE for #25062 (premise check, no fix). Not a pin: it records
 * what `origin/main` does today, and is deleted before any PR.
 *
 * Question: can `engine.validate()` (the import dry run) read the Layer 0
 * write wall's OWN verdict for a row without (a) an engine-side copy of the
 * wall's predicate, (b) running any side-effecting hook or middleware, and
 * (c) a new member on a published contract?
 *
 * Real engine, real SQLite driver, real `OrganizationsPlugin` (Middleware A)
 * and real `SecurityPlugin` (step 3.7), booted the way
 * `create-explicit-organization-wall.test.ts` boots them.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SecurityPlugin } from '@objectstack/plugin-security';
import type { PermissionSet } from '@objectstack/spec/security';
import { OrganizationsPlugin } from './organizations-plugin.js';

const OWN_ORG = 'org_alpha';
const FOREIGN_ORG = 'org_north';
const SISTER_ORG = 'org_south';
const INJECTED = 'qa_ledger';

const OBJECTS = [
  {
    name: INJECTED,
    label: 'Ledger',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text' },
    },
  },
];

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true };
const MEMBER_CTX = { userId: 'usr_member', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };

type Posture = 'isolated' | 'group' | 'single';

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

interface Booted {
  engine: ObjectQL;
  security: SecurityPlugin;
  table: () => Promise<Array<Record<string, unknown>>>;
  services: Record<string, unknown>;
  errors: string[];
}

async function boot(posture: Posture): Promise<Booted> {
  const engine = new ObjectQL();
  engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' } as never) as never, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.validate-preview-wall-verdict',
    name: 'probe',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: OBJECTS,
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const errors: string[] = [];
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER],
    },
    tenancy: { posture },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: (m: unknown) => errors.push(String(m)), debug: vi.fn() },
    registerService: (name: string, service: unknown) => { services[name] = service; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
    hook: vi.fn(),
  };
  const organizations = new OrganizationsPlugin({ ensureDefaultOrganization: false });
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await organizations.init(ctx as never);
  await security.init(ctx as never);
  await organizations.start(ctx as never);
  await security.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: (m: unknown) => void } }).logger, 'warn').mockImplementation(() => {});

  await engine.insert(INJECTED, { id: 'r1', name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);

  const table = async () => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(INJECTED);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(INJECTED).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { engine, security, table, services, errors };
}

interface Outcome { ok: boolean; code?: string; status?: number }
const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try { await run(); return { ok: true }; } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number };
    return { ok: false, code: err.code, status: err.statusCode ?? err.status };
  }
};

const writeAndPreview = async (b: Booted, row: Record<string, unknown>, context: object) => {
  const dropped: unknown[] = [];
  const preview = await b.engine.validate(INJECTED, { ...row }, { mode: 'insert', context: context as never });
  const write = await attempt(() => b.engine.insert(INJECTED, { ...row } as never, {
    context, onFieldsDropped: (e: unknown) => dropped.push(e),
  } as never));
  return { preview, write, dropped, stored: await b.table() };
};

describe('#25062 PROBE: the preview and the walled write, side by side (origin/main)', () => {
  it('M1 cell (a), `group`: a sister organization is STORED as sent, and the preview says it is dropped', async () => {
    const b = await boot('group');
    const r = await writeAndPreview(b, { id: 'r2', name: 'n', organization_id: SISTER_ORG }, GROUP_CTX);
    console.log('M1', JSON.stringify({ preview: r.preview.results[0], write: r.write, dropped: r.dropped, stored: r.stored }));
    expect(r.write.ok).toBe(true);
    expect(r.dropped).toEqual([]);
    expect(r.stored).toContainEqual({ id: 'r2', organization_id: SISTER_ORG });
    expect(r.preview.results[0]?.droppedFields).toEqual([{ object: INJECTED, fields: ['organization_id'], reason: 'readonly' }]);
  });

  it('M1 cell (a), `isolated`: the active organization named explicitly, same disagreement', async () => {
    const b = await boot('isolated');
    const r = await writeAndPreview(b, { id: 'r2', name: 'n', organization_id: OWN_ORG }, MEMBER_CTX);
    console.log('M1-iso', JSON.stringify({ preview: r.preview.results[0], write: r.write, dropped: r.dropped }));
    expect(r.write.ok).toBe(true);
    expect(r.dropped).toEqual([]);
    expect(r.preview.results[0]?.droppedFields).toEqual([{ object: INJECTED, fields: ['organization_id'], reason: 'readonly' }]);
  });

  it('M2 cell (b), `isolated`: a foreign organization is REFUSED 403 by the write, answered valid by the preview', async () => {
    const b = await boot('isolated');
    const r = await writeAndPreview(b, { id: 'r2', name: 'n', organization_id: FOREIGN_ORG }, MEMBER_CTX);
    console.log('M2', JSON.stringify({ preview: r.preview.results[0], valid: r.preview.valid, write: r.write }));
    expect(r.write).toEqual({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(r.preview.valid).toBe(true);
    expect(r.stored).toEqual([{ id: 'r1', organization_id: OWN_ORG }]);
  });

  it('M2 control, `single`: the strip takes the value on the write too, so preview and write agree', async () => {
    const b = await boot('single');
    const r = await writeAndPreview(b, { id: 'r2', name: 'n', organization_id: FOREIGN_ORG }, MEMBER_CTX);
    console.log('M2-single', JSON.stringify({ preview: r.preview.results[0], write: r.write, dropped: r.dropped }));
    expect(r.write.ok).toBe(true);
    expect(r.preview.results[0]?.droppedFields).toEqual(r.dropped);
  });
});

describe('#25062 PROBE: the one existing preview seam, `registerWriteGateProbe` (security: `canWriteObject`)', () => {
  it('M3: answers one boolean for the whole set, the same `true` for an admitted, a refused and an unwalled organization', async () => {
    const answers: Record<string, unknown> = {};
    for (const [posture, ctx, org] of [
      ['isolated', MEMBER_CTX, OWN_ORG],
      ['isolated', MEMBER_CTX, FOREIGN_ORG],
      ['group', GROUP_CTX, SISTER_ORG],
      ['single', MEMBER_CTX, FOREIGN_ORG],
    ] as const) {
      const b = await boot(posture);
      const probe = (b.engine as unknown as { _writeGateProbe?: (...a: unknown[]) => Promise<unknown> })._writeGateProbe;
      expect(typeof probe, 'plugin-security registered the probe').toBe('function');
      answers[`${posture}:${org}`] = await probe!(INJECTED, 'insert', ctx, [{ name: 'n', organization_id: org }]);
    }
    console.log('M3', JSON.stringify(answers));
    expect(answers).toEqual({
      'isolated:org_alpha': true,
      'isolated:org_north': true,
      'group:org_south': true,
      'single:org_north': true,
    });
  });
});

describe('#25062 PROBE: riding the middleware chain as an `insert` with a no-op executor', () => {
  const ride = async (b: Booted, data: unknown, context: object, executor: (opCtx: any) => Promise<unknown>) => {
    const opCtx: any = { object: INJECTED, operation: 'insert', data, context };
    const before = b.engine.writeEpoch.current;
    const outcome = await attempt(() => (b.engine as any).executeWithMiddleware(opCtx, () => executor(opCtx)));
    return { opCtx, outcome, epochDelta: b.engine.writeEpoch.current - before };
  };

  it('M4a: the epoch advances, and a no-op executor is refused by the wall\'s own fail-closed "seam never ran" assertion', async () => {
    const b = await boot('isolated');
    const r = await ride(b, { name: 'n', organization_id: OWN_ORG }, MEMBER_CTX, async () => undefined);
    console.log('M4a', JSON.stringify({ outcome: r.outcome, epochDelta: r.epochDelta, errors: b.errors.length, judges: r.opCtx.postHookWriteImageCheck?.judgesOrganization }));
    expect(r.epochDelta).toBe(1);
    expect(r.outcome).toEqual({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(b.errors.some((m) => m.includes('was executed without the Layer 0'))).toBe(true);
    expect(await b.table()).toEqual([{ id: 'r1', organization_id: OWN_ORG }]);
  });

  it('M4b: an executor that runs the installed seam DOES get the wall\'s verdict (admit + judgesOrganization, or 403)', async () => {
    const b = await boot('isolated');
    const judge = async (opCtx: any) => {
      const seam = opCtx.postHookWriteImageCheck;
      seam.honoured = true;
      await seam.evaluate(Array.isArray(opCtx.data) ? opCtx.data : [opCtx.data]);
    };
    const admitted = await ride(b, { name: 'n', organization_id: OWN_ORG }, MEMBER_CTX, judge);
    const refused = await ride(b, { name: 'n', organization_id: FOREIGN_ORG }, MEMBER_CTX, judge);
    console.log('M4b', JSON.stringify({
      admitted: { outcome: admitted.outcome, judges: admitted.opCtx.postHookWriteImageCheck?.judgesOrganization, epochDelta: admitted.epochDelta },
      refused: { outcome: refused.outcome, epochDelta: refused.epochDelta },
    }));
    expect(admitted.outcome.ok).toBe(true);
    expect(admitted.opCtx.postHookWriteImageCheck?.judgesOrganization).toBe(true);
    expect(refused.outcome).toEqual({ ok: false, code: 'PERMISSION_DENIED', status: 403 });
    expect(admitted.epochDelta + refused.epochDelta).toBe(2);
  });

  it('M4c: Middleware A rewrites the ridden payload (fills an absent organization) — a mutation the preview must copy around', async () => {
    const b = await boot('isolated');
    const data: Record<string, unknown> = { name: 'n' };
    const judge = async (opCtx: any) => {
      const seam = opCtx.postHookWriteImageCheck;
      if (seam) { seam.honoured = true; await seam.evaluate([opCtx.data]); }
    };
    await ride(b, data, MEMBER_CTX, judge);
    console.log('M4c', JSON.stringify({ data }));
    expect(data.organization_id).toBe(OWN_ORG);
  });

  it('M4d: a chain middleware runs a WRITE-side effect after next() keyed only on the operation (Middleware B, sys_organization)', async () => {
    const b = await boot('isolated');
    const replayed: unknown[] = [];
    b.services['seed-replayer'] = async (orgId: string) => { replayed.push(orgId); return { inserted: 0, updated: 0 }; };
    const opCtx: any = { object: 'sys_organization', operation: 'insert', data: { id: 'org_new', name: 'New' }, context: SYS_CTX };
    const outcome = await attempt(() => (b.engine as any).executeWithMiddleware(opCtx, async () => undefined));
    console.log('M4d', JSON.stringify({ outcome, replayed }));
    expect(replayed).toEqual(['org_new']);
  });
});
