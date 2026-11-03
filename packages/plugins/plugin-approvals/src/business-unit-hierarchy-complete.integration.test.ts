// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29655] The approver business-unit expansion's `sys_business_unit` reads —
 * the seed check and the child-unit descent — answer EVERY unit, or refuse.
 * #29606 closed the member read; this closes the unit reads it is keyed by.
 *
 * The seed check answered `[]` on a read that threw, and the descent read
 * each parent's child units once at a 1,000-row bound and answered `[]` on any
 * failure: a failed seed read logged "expanded to nobody", indistinguishable
 * from an unstaffed unit, and a failed or cut descent routed to a shrunk slate
 * with no signal at all.
 *
 * What a caller sees now: the expansion throws, the approver-spec resolver's
 * directory catch takes it, and the slot falls back to its literal with the
 * warning that names the failed read and carries its `error`. A unit object
 * that does not exist is still no members.
 *
 * Measured on a REAL engine (ObjectQL + SqlDriver over in-memory SQLite)
 * carrying the shipped `SysBusinessUnit` and `SysBusinessUnitMember`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysBusinessUnit, SysBusinessUnitMember, SysMember, SysOrganization } from '@objectstack/platform-objects/identity';
import { ApprovalService } from './approval-service.js';

const ORG = 'org_tree';
const ROOT = 'bu_root';
const CHILD = 'bu_child';
/** The bound each child-unit read is paged at. */
const PAGE = 1000;

const pad = (n: number) => String(n).padStart(5, '0');

/** Which `sys_business_unit` read a fault targets. */
type UnitRead = 'seed' | 'descent';

interface Rig {
  engine: ObjectQL;
  driver: SqlDriver;
  svc: ApprovalService;
  warn: ReturnType<typeof vi.fn>;
  /** Every member of the tree, sorted. */
  members: string[];
  /** The child-unit reads the driver ran for ROOT's children. */
  rootChildReads: () => number;
  /** Fail every read of one kind; every other read runs as before. */
  failUnitReads: (which: UnitRead) => void;
}

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/**
 * ROOT, its child CHILD, and `extra` more child units of ROOT, each with one
 * member. Unit ids are scrambled against creation order.
 */
async function boot(extra: number, opts: { omit?: string[] } = {}): Promise<Rig> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
  const engine = new ObjectQL();
  engine.registerDriver(driver as never, true);
  await engine.init();
  const omit = new Set(opts.omit ?? []);
  engine.registerApp({
    id: 'com.objectstack.qa.business-unit-hierarchy-complete',
    name: 'business unit hierarchy complete',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysOrganization, SysMember, SysBusinessUnit, SysBusinessUnitMember].filter((o) => !omit.has(o.name)),
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const e = engine as any;
  await e.insert('sys_organization', { id: ORG, name: ORG, slug: 'tree' }, { context: { isSystem: true } });
  const kids = Array.from({ length: extra }, (_, i) => `bu_kid_${pad((i * 7919) % 100003)}`);
  const units = [ROOT, CHILD, ...kids];
  if (!omit.has('sys_business_unit')) {
    const rows: Record<string, unknown>[] = [
      { id: ROOT, name: 'Root', kind: 'division', active: true, organization_id: ORG },
      { id: CHILD, name: 'Child', kind: 'department', active: true, parent_business_unit_id: ROOT, organization_id: ORG },
      ...kids.map((id) => ({ id, name: id, kind: 'department', active: true, parent_business_unit_id: ROOT, organization_id: ORG })),
    ];
    const d = e.getDriverForObject('sys_business_unit');
    for (let i = 0; i < rows.length; i += 250) await d.bulkCreate('sys_business_unit', rows.slice(i, i + 250));
  }
  const members = units.map((u) => `usr_of_${u}`);
  const memberRows = units.map((u, i) => ({
    id: `bum_${pad(i)}`, user_id: `usr_of_${u}`, business_unit_id: u, organization_id: ORG,
  }));
  const md = e.getDriverForObject('sys_business_unit_member');
  for (let i = 0; i < memberRows.length; i += 250) await md.bulkCreate('sys_business_unit_member', memberRows.slice(i, i + 250));

  let rootChildReads = 0;
  (driver as any).knex.on('query', (q: { sql: string; bindings?: unknown[] }) => {
    if (/^select .* from [`"]sys_business_unit[`"]/i.test(q.sql) && /parent_business_unit_id/.test(q.sql)
      && (q.bindings ?? []).includes(ROOT)) rootChildReads += 1;
  });
  const failUnitReads = (which: UnitRead) => {
    const d = e.getDriverForObject('sys_business_unit');
    const real = d.find.bind(d);
    vi.spyOn(d, 'find').mockImplementation(((obj: string, ...rest: unknown[]) => {
      const descent = JSON.stringify(rest).includes('parent_business_unit_id');
      if (obj === 'sys_business_unit' && (which === 'descent') === descent) {
        return Promise.reject(Object.assign(new Error('SQLITE_IOERR: disk I/O error'), { code: 'SQLITE_IOERR' }));
      }
      return real(obj, ...rest);
    }) as never);
  };
  const warn = vi.fn();
  const svc = new ApprovalService({
    engine: engine as any,
    logger: { warn, info: () => {}, error: () => {}, debug: () => {} } as any,
  });
  return { engine, driver, svc, warn, members: [...members].sort(), rootChildReads: () => rootChildReads, failUnitReads };
}

/** The private expansion and the resolver, as the request opener calls them. */
const department = (rig: Rig, value = ROOT) =>
  (rig.svc as any).expandBusinessUnitUsers(value, ORG) as Promise<string[]>;
const resolveSpec = (rig: Rig, a: { type: string; value: string }) =>
  (rig.svc as any).resolveApproverSpec(a, undefined, ORG, Date.now()) as Promise<string[]>;
const failureWarnings = (rig: Rig) => rig.warn.mock.calls.filter(([, meta]) => typeof meta?.error === 'string');

describe('[#29655] approvals business-unit expansion: a failed seed read refuses', () => {
  it('⛔ the expansion refuses — it never answers an invented empty slate', async () => {
    const rig = await boot(0);
    rig.failUnitReads('seed');

    await expect(department(rig)).rejects.toThrow(
      /\[approvals\] business unit 'bu_root' in organization 'org_tree' could not be read: SQLITE_IOERR/,
    );
  });

  it('⛔ what the caller sees: the department slot falls back to its literal, and the warning names the failed read', async () => {
    const rig = await boot(0);
    rig.failUnitReads('seed');

    expect(await resolveSpec(rig, { type: 'department', value: ROOT })).toEqual([`department:${ROOT}`]);
    const failed = failureWarnings(rig);
    expect(failed.map(([, meta]) => meta.type)).toEqual(['department']);
    expect(failed[0][0]).toMatch(/could not be expanded — a directory or read-filter lookup failed/);
    expect(failed[0][1].error).toMatch(/SQLITE_IOERR/);
  });
});

describe('[#29655] approvals business-unit expansion: a failed descent read refuses', () => {
  it('⛔ the expansion refuses — the slate never shrinks to the seed unit', async () => {
    const rig = await boot(0);
    rig.failUnitReads('descent');

    await expect(department(rig)).rejects.toThrow(
      /\[approvals\] the child units of business unit 'bu_root' in organization 'org_tree' could not be read: SQLITE_IOERR/,
    );
  });

  it('⛔ what the caller sees: the literal and the failed-read warning, not a shrunk slate', async () => {
    const rig = await boot(0);
    rig.failUnitReads('descent');

    expect(await resolveSpec(rig, { type: 'department', value: ROOT })).toEqual([`department:${ROOT}`]);
    expect(failureWarnings(rig).map(([, meta]) => meta.type)).toEqual(['department']);
  });
});

describe('[#29655] approvals business-unit expansion reads every child unit past the 1,000-row bound', () => {
  it('⭐ 1,001 child units: every member of every child is on the slate', async () => {
    // CHILD plus 1,000 more: 1,001 children of ROOT.
    const rig = await boot(PAGE);

    expect([...(await department(rig))].sort()).toEqual(rig.members);
    expect(rig.members).toHaveLength(PAGE + 2);
    expect(rig.rootChildReads()).toBe(2);
  }, 60_000);

  it('control — under the bound: one child-unit read, the same slate as before', async () => {
    // CHILD plus 998 more: 999 children of ROOT.
    const rig = await boot(PAGE - 2);

    expect([...(await department(rig))].sort()).toEqual(rig.members);
    expect(rig.rootChildReads()).toBe(1);
  }, 60_000);
});

describe('[#29655] approvals business-unit expansion: absence still answers nobody', () => {
  it('a composition that never registers sys_business_unit has no departments: the literal, with no failure warning', async () => {
    const rig = await boot(0, { omit: ['sys_business_unit'] });

    expect(await department(rig)).toEqual([]);
    expect(await resolveSpec(rig, { type: 'department', value: ROOT })).toEqual([`department:${ROOT}`]);
    expect(failureWarnings(rig)).toEqual([]);
  });

  it('a stack whose sys_business_unit table was never created has no departments', async () => {
    const rig = await boot(0);
    await (rig.driver as any).knex.schema.dropTable('sys_business_unit');

    expect(await department(rig)).toEqual([]);
  });
});
