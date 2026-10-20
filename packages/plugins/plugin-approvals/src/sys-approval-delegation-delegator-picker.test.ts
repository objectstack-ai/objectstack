// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Delegator picker of `sys_approval_delegation` offers exactly what the
 * delegation write guard admits.
 *
 * `bindDelegationWriteGuard` (lifecycle-hooks.ts) admits one delegator on a
 * non-system write — the acting user — and refuses every other with 403: a
 * delegation names its own author as delegator, and acting for an absent
 * approver is the approval-level override (the guard's docstring holds the
 * ruling). The field was a free `sys_user` lookup, so the console's create
 * dialog offered every user and the server refused all but one of them. It
 * now declares `lookupFilters` on `id` = `{current_user_id}`: the picker's
 * candidate query, whose placeholder the engine resolves against the caller
 * on every read.
 *
 * Through a real `ObjectQL` over `SqlDriver` (better-sqlite3, in-memory, real
 * DDL) with the guard bound, this file asserts:
 *
 *  1. the declaration, read off the object and off the registered body;
 *  2. the picker's candidate query returns the caller and nobody else, for
 *     each caller;
 *  3. every candidate it offers is admitted by the guard;
 *  4. the guard is not widened: a create or an update naming anyone else is
 *     still refused, `FORBIDDEN` / 403, and nothing is stored;
 *  5. `required` stays: a write with no acting user and no delegator is
 *     refused.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { EngineCountOptions, EngineQueryOptions } from '@objectstack/spec/data';
import { SysApprovalDelegation } from './sys-approval-delegation.object.js';
import { bindDelegationWriteGuard } from './lifecycle-hooks.js';

const OBJECT = 'sys_approval_delegation';
const SYSTEM = { context: { isSystem: true } } as any;
const asUser = (userId: string) => ({ context: { userId, positions: [], permissions: [] } }) as any;

/** The install's people: an admin covering for Priya, and a colleague. */
const USERS = [
  { id: 'u_admin', name: 'Dev Admin' },
  { id: 'u_priya', name: 'Priya Raman' },
  { id: 'u_tomas', name: 'Tomas Okafor' },
];

/** Just enough of `sys_user` for the picker's candidate query. */
const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'Id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

type LookupFilter = { field: string; operator: string; value: unknown };

/** The one candidate the guard admits: the acting user, by id. */
const ACTING_USER_ONLY: LookupFilter[] = [{ field: 'id', operator: 'eq', value: '{current_user_id}' }];

const delegatorField = (): Record<string, any> =>
  (SysApprovalDelegation.fields as Record<string, any>).delegator_id;

/**
 * The picker's candidate query, from the declared `lookupFilters`. The
 * console lowers each `eq` entry to `{ [field]: value }` and sends it as the
 * `$filter` of its `sys_user` query (objectui `lookupFiltersToRecord`); the
 * declaration test holds that every entry here is `eq`.
 */
function pickerQuery(): EngineQueryOptions {
  const filters = (delegatorField().lookupFilters ?? []) as LookupFilter[];
  const where: Record<string, unknown> = {};
  for (const f of filters) where[f.field] = f.value;
  return { where };
}

/** The delegations that name Priya as delegator. */
const PRIYA_AS_DELEGATOR: EngineCountOptions = { where: { delegator_id: 'u_priya' } };

const byId = (id: string): EngineQueryOptions => ({ where: { id } });

describe('sys_approval_delegation — the Delegator picker offers only what the write guard admits', () => {
  let engine: ObjectQL;

  beforeAll(async () => {
    engine = new ObjectQL();
    const driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysUser as any, 'com.objectstack.test.delegator-picker');
    engine.registry.registerObject(SysApprovalDelegation as any, 'com.objectstack.test.delegator-picker');
    await engine.syncSchemas();
    bindDelegationWriteGuard(engine as any);
    for (const u of USERS) await engine.insert('sys_user', u, SYSTEM);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('declares the acting user as the picker\'s only candidate, and stays a required sys_user lookup', () => {
    const field = delegatorField();
    expect(field.type).toBe('lookup');
    expect(field.reference).toBe('sys_user');
    expect(field.required).toBe(true);
    expect(field.lookupFilters).toEqual(ACTING_USER_ONLY);
  });

  it('the registered body keeps the declaration', () => {
    const registered = (engine.registry.getObject(OBJECT) as any).fields.delegator_id;
    expect(registered.lookupFilters).toEqual(ACTING_USER_ONLY);
  });

  it.each(USERS.map((u) => [u.id]))('the picker offers %s themselves and nobody else', async (caller) => {
    const candidates = await engine.find('sys_user', pickerQuery(), asUser(caller));
    expect(candidates.map((r: any) => r.id)).toEqual([caller]);
  });

  it('every candidate the picker offers is admitted by the guard', async () => {
    const candidates = await engine.find('sys_user', pickerQuery(), asUser('u_admin'));
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const created = await engine.insert(
        OBJECT, { delegator_id: (candidate as any).id, delegate_id: 'u_tomas' }, asUser('u_admin'),
      );
      expect(created.delegator_id).toBe('u_admin');
    }
  });

  it('the guard is not widened: a create naming anyone else is refused FORBIDDEN / 403 and stores nothing', async () => {
    const before = await engine.count(OBJECT, PRIYA_AS_DELEGATOR, SYSTEM);
    await expect(
      engine.insert(OBJECT, { delegator_id: 'u_priya', delegate_id: 'u_tomas' }, asUser('u_admin')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    expect(await engine.count(OBJECT, PRIYA_AS_DELEGATOR, SYSTEM)).toBe(before);
  });

  it('the guard is not widened: an update relabelling the delegator is refused FORBIDDEN / 403', async () => {
    const own = await engine.insert(OBJECT, { delegator_id: 'u_admin', delegate_id: 'u_tomas' }, asUser('u_admin'));
    await expect(
      engine.update(OBJECT, { id: own.id, delegator_id: 'u_priya' }, asUser('u_admin')),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
    const row = await engine.findOne(OBJECT, byId(own.id), SYSTEM);
    expect(row?.delegator_id).toBe('u_admin');
  });

  it('`required` stays: a system write with no acting user and no delegator is refused', async () => {
    await expect(engine.insert(OBJECT, { delegate_id: 'u_tomas' }, SYSTEM)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: expect.arrayContaining([expect.objectContaining({ field: 'delegator_id', code: 'required' })]),
    });
  });
});
