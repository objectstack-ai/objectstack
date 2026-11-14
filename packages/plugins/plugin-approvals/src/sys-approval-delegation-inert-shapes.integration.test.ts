// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An out-of-office delegation that could never reroute an approval is refused
 * at the write, naming the field.
 *
 * Two shapes used to land and then do nothing: a validity window that ends at
 * or before it starts (`isGrantActive` drops the row at every routing), and a
 * delegate who is the delegator (rerouting a slot onto the same person moves
 * nothing, so no substitute is recorded). Both were stored, and the delegator
 * believed their approvals were covered while they were not.
 *
 * The refusals are the object's declared `validations`, so every engine write
 * path judges them. An insert is judged by its own values, an update by the
 * stored row overlaid with the patch; an update that moves neither compared
 * column is not judged, so a row stored before the refusals existed keeps
 * taking unrelated edits.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver, with the
 * plugin's own delegation write guard bound: the guard stamps an omitted
 * delegator in `beforeInsert`, before validation, so a self-delegation that
 * leaves the delegator to the stamp is judged too. Refusals are read through
 * their ADR-0112 envelope (`resolveThrownHttpError`, the resolver both HTTP
 * doors answer with), never a bare `toThrow()`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { EngineQueryOptions } from '@objectstack/spec/data';

import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { bindDelegationWriteGuard } from './lifecycle-hooks.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DELEGATIONS = 'sys_approval_delegation';
const SYS = { isSystem: true, positions: [], permissions: [] } as const;
const ALICE = { userId: 'u_alice', positions: [], permissions: [] } as const;

const T0 = '2026-11-01T00:00:00.000Z';
const T1 = '2026-12-01T00:00:00.000Z';
const T2 = '2027-01-01T00:00:00.000Z';

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const def of [sysUser, SysApprovalDelegation]) {
    engine.registry.registerObject(def as any, 'approvals-test', 'approvals-test');
  }
  await engine.syncSchemas();
  await installDefaultOrganization(engine as any);
  for (const id of ['u_alice', 'u_bob']) await engine.insert('sys_user', { id, name: id }, { context: SYS } as any);
  bindDelegationWriteGuard(engine as any);
  engines.push(engine);
  return { engine, driver };
}

type Harness = Awaited<ReturnType<typeof boot>>;

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

const ruleMessage = (name: string) =>
  (SysApprovalDelegation.validations as unknown as Array<{ name: string; message: string }>)
    .find((r) => r.name === name)!.message;

/** The ADR-0112 envelope an HTTP door answers this throw with, and the field the rule named. */
function expectRefusal(err: unknown, field: string, rule: string): void {
  const r = resolveThrownHttpError(err);
  const fields = (r.details?.fields ?? []) as any[];
  expect([r.status, r.code]).toEqual([400, 'VALIDATION_FAILED']);
  expect(fields.map((f) => [f.field, f.code])).toEqual([[field, 'rule_violation']]);
  expect(fields[0].constraint?.reason).not.toBe('unevaluable');
  const message = ruleMessage(rule);
  expect(String(fields[0].message).slice(0, message.length)).toBe(message);
}

const expectWindowRefusal = (err: unknown) => expectRefusal(err, 'valid_until', 'validity_window_order');
const expectSelfRefusal = (err: unknown) => expectRefusal(err, 'delegate_id', 'delegate_not_delegator');

async function rowsOf(h: Harness, id: string): Promise<any[]> {
  const rows = await h.engine.find(DELEGATIONS, { where: { id }, context: SYS as any } satisfies EngineQueryOptions);
  return Array.isArray(rows) ? rows : [];
}

const instant = (v: unknown) => (v == null ? v : new Date(v as string).toISOString());
const shapeOf = (row: any) => ({
  delegator_id: row?.delegator_id,
  delegate_id: row?.delegate_id,
  valid_from: instant(row?.valid_from),
  valid_until: instant(row?.valid_until),
});

describe('an insert that could never reroute an approval is refused', () => {
  for (const [who, context] of [['the delegator', ALICE], ['a system writer', SYS]] as const) {
    it(`NEGATIVE — ${who}: valid_until before valid_from is refused 400 on valid_until; nothing is stored`, async () => {
      const h = await boot();
      const err = await refusalOf(() => h.engine.insert(DELEGATIONS, {
        id: 'd_inv', delegator_id: 'u_alice', delegate_id: 'u_bob', valid_from: T1, valid_until: T0,
      }, { context } as any));
      expectWindowRefusal(err);
      expect(await rowsOf(h, 'd_inv')).toHaveLength(0);
    });

    it(`NEGATIVE — ${who}: the delegator as their own delegate is refused 400 on delegate_id; nothing is stored`, async () => {
      const h = await boot();
      const err = await refusalOf(() => h.engine.insert(DELEGATIONS, {
        id: 'd_self', delegator_id: 'u_alice', delegate_id: 'u_alice', valid_from: T0, valid_until: T1,
      }, { context } as any));
      expectSelfRefusal(err);
      expect(await rowsOf(h, 'd_self')).toHaveLength(0);
    });
  }

  it('NEGATIVE — equal bounds are refused: a window from t until t is empty', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(DELEGATIONS, {
      id: 'd_eq', delegate_id: 'u_bob', valid_from: T1, valid_until: T1,
    }, { context: ALICE } as any));
    expectWindowRefusal(err);
    expect(await rowsOf(h, 'd_eq')).toHaveLength(0);
  });

  it('NEGATIVE — a self-delegation that leaves the delegator to the write guard\'s stamp is refused', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(DELEGATIONS, {
      id: 'd_stamped', delegate_id: 'u_alice', valid_from: T0, valid_until: T1,
    }, { context: ALICE } as any));
    expectSelfRefusal(err);
    expect(await rowsOf(h, 'd_stamped')).toHaveLength(0);
  });

  it('CONTROL — a valid window and a different delegate lands', async () => {
    const h = await boot();
    await h.engine.insert(DELEGATIONS, { id: 'd_ok', delegate_id: 'u_bob', valid_from: T0, valid_until: T1 }, { context: ALICE } as any);
    expect(shapeOf((await rowsOf(h, 'd_ok'))[0])).toEqual({ delegator_id: 'u_alice', delegate_id: 'u_bob', valid_from: T0, valid_until: T1 });
  });

  it('CONTROL — an open-ended window lands: either bound alone, or none', async () => {
    const h = await boot();
    await h.engine.insert(DELEGATIONS, { id: 'd_from', delegate_id: 'u_bob', valid_from: T1 }, { context: ALICE } as any);
    await h.engine.insert(DELEGATIONS, { id: 'd_until', delegate_id: 'u_bob', valid_until: T0 }, { context: ALICE } as any);
    await h.engine.insert(DELEGATIONS, { id: 'd_none', delegate_id: 'u_bob' }, { context: ALICE } as any);
    expect(shapeOf((await rowsOf(h, 'd_from'))[0])).toMatchObject({ valid_from: T1, valid_until: null });
    expect(shapeOf((await rowsOf(h, 'd_until'))[0])).toMatchObject({ valid_from: null, valid_until: T0 });
    expect(shapeOf((await rowsOf(h, 'd_none'))[0])).toMatchObject({ valid_from: null, valid_until: null });
  });
});

describe('an update is judged by the stored row overlaid with the patch', () => {
  async function stored(h: Harness, id: string) {
    await h.engine.insert(DELEGATIONS, { id, delegate_id: 'u_bob', valid_from: T1, valid_until: T2 }, { context: ALICE } as any);
  }
  const STORED = { delegator_id: 'u_alice', delegate_id: 'u_bob', valid_from: T1, valid_until: T2 };

  it('NEGATIVE — moving valid_until to before the stored valid_from is refused; the row is unchanged', async () => {
    const h = await boot();
    await stored(h, 'd_move_until');
    expectWindowRefusal(await refusalOf(() => h.engine.update(DELEGATIONS, { id: 'd_move_until', valid_until: T0 }, { context: ALICE } as any)));
    expect(shapeOf((await rowsOf(h, 'd_move_until'))[0])).toEqual(STORED);
  });

  it('NEGATIVE — changing the delegate to the delegator is refused; the row is unchanged', async () => {
    const h = await boot();
    await stored(h, 'd_move_delegate');
    expectSelfRefusal(await refusalOf(() => h.engine.update(DELEGATIONS, { id: 'd_move_delegate', delegate_id: 'u_alice' }, { context: ALICE } as any)));
    expect(shapeOf((await rowsOf(h, 'd_move_delegate'))[0])).toEqual(STORED);
  });

  it('CONTROL — moving a bound within a valid window lands', async () => {
    const h = await boot();
    await stored(h, 'd_extend');
    await h.engine.update(DELEGATIONS, { id: 'd_extend', valid_from: T0 }, { context: ALICE } as any);
    expect(shapeOf((await rowsOf(h, 'd_extend'))[0])).toEqual({ ...STORED, valid_from: T0 });
  });

  it('a row stored inert before the refusals existed takes an unrelated edit; repairing it lands', async () => {
    const h = await boot();
    // Stored beneath the engine, the way a row written before the refusals
    // existed sits in a deployed table.
    await h.driver.create(DELEGATIONS, {
      id: 'd_legacy', delegator_id: 'u_alice', delegate_id: 'u_alice', valid_from: T2, valid_until: T1,
      organization_id: 'org_default',
    });
    await h.engine.update(DELEGATIONS, { id: 'd_legacy', reason: 'unrelated edit' }, { context: ALICE } as any);
    expect((await rowsOf(h, 'd_legacy'))[0]).toMatchObject({ reason: 'unrelated edit' });

    await h.engine.update(DELEGATIONS, { id: 'd_legacy', delegate_id: 'u_bob', valid_until: T2.replace('2027', '2028') }, { context: ALICE } as any);
    expect(shapeOf((await rowsOf(h, 'd_legacy'))[0])).toEqual({
      delegator_id: 'u_alice', delegate_id: 'u_bob', valid_from: T2, valid_until: '2028-01-01T00:00:00.000Z',
    });
  });
});
