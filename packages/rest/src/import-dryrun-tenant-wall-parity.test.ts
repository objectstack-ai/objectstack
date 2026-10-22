// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Import dry run == real write, for a row's ORGANIZATION under the Layer 0
 * tenant write wall (#25062).
 *
 * The dry run asks `DataProtocol.validateData` (`engine.validate()`), which
 * runs no middleware, so the tenant wall that judges a row's
 * `organization_id` on the write never judged a dry-run row. Measured at this
 * door on `origin/main` f7d740376:
 *
 *   - M5a, `group`, a row naming a sister organization: the dry run answered
 *     `ok` with `organization_id` in `droppedFields`, while the commit stored
 *     the row in that organization as sent and reported no drop;
 *   - M5b, `isolated`, a row naming a foreign organization: the dry run
 *     answered `ok`, while the commit refused the row `PERMISSION_DENIED`.
 *
 * Ruling 6336640643 (letter A): the security plugin hands the engine the
 * wall's own verdict per row, and the preview reads it. Like
 * `import-dryrun-parity.test.ts`, every case here runs the SAME payload both
 * ways against one live stack (real `ObjectQL`, real SQLite, the real
 * `SecurityPlugin`, the real protocol and route) and asserts the two row
 * reports agree. The `single` posture is the control: no wall, the strip
 * takes the value on both.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SecurityPlugin } from '@objectstack/plugin-security';
import type { PermissionSet } from '@objectstack/spec/security';
import { RestServer } from './rest-server';

const OWN_ORG = 'org_alpha';
const FOREIGN_ORG = 'org_north';
const SISTER_ORG = 'org_south';
const LEDGER = 'qa_ledger';

const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const SYS_CTX = { isSystem: true };
const MEMBER_CTX = { userId: 'usr_member', tenantId: OWN_ORG, positions: [], permissions: [], posture: 'MEMBER' };
const GROUP_CTX = { ...MEMBER_CTX, accessible_org_ids: [OWN_ORG, SISTER_ORG] };

type Posture = 'isolated' | 'group' | 'single';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot(posture: Posture, context: Record<string, unknown>) {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registry.registerObject({
    name: LEDGER,
    label: 'Ledger',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      name: { name: 'name', type: 'text', label: 'Name' },
    },
  } as any);
  await engine.syncSchemas();

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER],
    },
  };
  if (posture !== 'single') {
    services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    services.tenancy = { posture };
  }
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await security.init(ctx as never);
  await security.start(ctx as never);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
  await engine.insert(LEDGER, { id: 'r1', name: 'seeded', organization_id: OWN_ORG }, { context: SYS_CTX } as never);

  const noop = () => {};
  const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ ...context });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import',
  ) as any;

  const imp = async (body: Record<string, unknown>) => {
    const res = makeRes();
    await route.handler({ params: { object: LEDGER }, body, headers: {} } as any, res);
    return res._json;
  };
  /** The SAME rows, dry run then commit: the contract under test is agreement. */
  const bothWays = async (rows: unknown[]) => ({
    dry: await imp({ format: 'json', dryRun: true, rows }),
    real: await imp({ format: 'json', rows }),
  });
  const stored = async () => {
    const driver = (engine as unknown as { getDriver(o: string): { knex: unknown } }).getDriver(LEDGER);
    const knex = driver.knex as (t: string) => { select: (...c: string[]) => Promise<Array<Record<string, unknown>>> };
    const rows = await knex(LEDGER).select('id', 'organization_id');
    return [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  return { bothWays, stored };
}

/**
 * What a row report says about the verdict, its sentence and the drops — the
 * halves that must agree. Not `field`: a refused dry-run row names the value
 * the wall refused (`organization_id`), which the commit's row, built from a
 * thrown 403 with no field on it, does not carry.
 */
const verdictOf = (report: any, i = 0) => {
  const r = report.results[i];
  return { ok: r.ok, action: r.action, code: r.code, error: r.error, droppedFields: r.droppedFields };
};

describe('import dry run == real write, for the row\'s organization (#25062)', () => {
  it('M5a, `group`: a sister organization the wall admits — no drop on either, and the commit stores it as sent', async () => {
    const door = await boot('group', GROUP_CTX);
    const { dry, real } = await door.bothWays([{ id: 'r2', name: 'n', organization_id: SISTER_ORG }]);

    expect(verdictOf(dry)).toEqual(verdictOf(real));
    expect(verdictOf(real)).toEqual({ ok: true, action: 'created', code: undefined, error: undefined, droppedFields: undefined });
    expect(await door.stored()).toContainEqual({ id: 'r2', organization_id: SISTER_ORG });
  });

  it('M5b, `isolated`: a foreign organization the wall refuses — `PERMISSION_DENIED` on both, and nothing stored', async () => {
    const door = await boot('isolated', MEMBER_CTX);
    const { dry, real } = await door.bothWays([{ id: 'r2', name: 'n', organization_id: FOREIGN_ORG }]);

    expect(verdictOf(dry)).toEqual(verdictOf(real));
    expect(verdictOf(real)).toMatchObject({ ok: false, action: 'failed', code: 'PERMISSION_DENIED' });
    expect(dry.results[0].field, 'the dry run names the value the wall refused').toBe('organization_id');
    expect(await door.stored()).toEqual([{ id: 'r1', organization_id: OWN_ORG }]);
  });

  it('a mixed batch: each row answered as its commit answers it', async () => {
    const door = await boot('isolated', MEMBER_CTX);
    const rows = [
      { id: 'r2', name: 'mine', organization_id: OWN_ORG },
      { id: 'r3', name: 'forged', organization_id: FOREIGN_ORG },
    ];
    const { dry, real } = await door.bothWays(rows);

    expect([verdictOf(dry, 0), verdictOf(dry, 1)]).toEqual([verdictOf(real, 0), verdictOf(real, 1)]);
    expect(verdictOf(real, 1)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  it('CONTROL, `single`: no wall — the strip takes the value on both, and both report it', async () => {
    const door = await boot('single', MEMBER_CTX);
    const { dry, real } = await door.bothWays([{ id: 'r2', name: 'n', organization_id: FOREIGN_ORG }]);

    expect(verdictOf(dry)).toEqual(verdictOf(real));
    expect(verdictOf(real)).toEqual({
      ok: true, action: 'created', code: undefined, error: undefined,
      droppedFields: [{ object: LEDGER, fields: ['organization_id'], reason: 'readonly' }],
    });
  });
});
