// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D1] The AI service account's row rules, driven through the real
 * write path: a real `ObjectQL` engine over SQLite with the shipped identity
 * objects, the ADR-0092 D2 identity write guard, and the row guard under test.
 *
 * The rules bind EVERY writer, the system included, so most cases write in the
 * system context — the one the identity write guard lets through, and the one a
 * flow running as the system, a host or an import uses. Refusals are asserted
 * on the envelope (`VALIDATION_FAILED` + the `fields[]` entry's field and code)
 * and on the row left unchanged; the message is read only where it names the
 * road.
 *
 * The membership reconciler's exemption (ADR-0093 D7, closed by ADR-0151 D1)
 * is pinned at the bottom, on the same engine.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { authIdentityObjects } from './manifest.js';
import { registerIdentityWriteGuard, registerManagedUpdateWhitelist } from './identity-write-guard.js';
import { SYS_USER_PROFILE_EDIT_FIELDS } from './sys-user-writable-fields.js';
import { backfillMemberships, reconcileMembership } from './reconcile-membership.js';
import {
  isAgentAccountRow,
  principalKindOfRow,
  registerServiceAccountRowGuard,
} from './service-account-identity.js';

const SYS = { context: { isSystem: true } } as any;
const OWNER = 'usr_owner';
const OTHER = 'usr_other';
const AGENT = 'usr_agent';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function rig(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engines.push(engine);
  engine.registerApp({
    id: 'com.objectstack.qa.service-account-identity',
    name: 'Service account identity',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [...authIdentityObjects],
  } as any);
  await engine.syncSchemas();
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  registerManagedUpdateWhitelist('sys_user', SYS_USER_PROFILE_EDIT_FIELDS);
  registerServiceAccountRowGuard(engine, { packageId: 'test.service-account-row' });
  registerIdentityWriteGuard(engine, { packageId: 'test.identity-write-guard' });
  for (const id of [OWNER, OTHER]) {
    await engine.insert('sys_user', { id, email: `${id}@sa.example`, name: id, email_verified: true }, SYS);
  }
  return engine;
}

const insertAgent = (engine: ObjectQL, extra: Record<string, unknown> = {}) =>
  engine.insert(
    'sys_user',
    { id: AGENT, email: 'agent-31739@sa.invalid', name: 'Agent', principal_kind: 'agent', accountable_user_id: OWNER, ...extra },
    SYS,
  );

const userRow = async (engine: ObjectQL, id: string): Promise<any> =>
  ((await engine.find('sys_user', { where: { id }, ...SYS })) as any[])[0];

const refusalOf = async (write: Promise<unknown>): Promise<any> => write.then(() => undefined, (e: unknown) => e);

/** The ADR-0114 refusal: `VALIDATION_FAILED`, one `fields[]` entry naming `field` with `code`. */
const expectFieldRefusal = (err: any, field: string, code: string) => {
  expect(err, 'the write was refused').toBeDefined();
  expect(err.code).toBe('VALIDATION_FAILED');
  expect(Array.isArray(err.fields) ? err.fields : []).toContainEqual(expect.objectContaining({ field, code }));
};

describe('ADR-0151 D1 — a user is born with its principal kind', () => {
  it('an AI service account is created with its kind and a person accountable for it', async () => {
    const engine = await rig();
    await insertAgent(engine);
    const row = await userRow(engine, AGENT);
    expect(row.principal_kind).toBe('agent');
    expect(row.accountable_user_id).toBe(OWNER);
  });

  it('CONTROL: a person created without a kind reads as a person and carries no owner', async () => {
    const engine = await rig();
    const row = await userRow(engine, OWNER);
    expect(principalKindOfRow(row)).toBe('human');
    expect(row.accountable_user_id ?? null).toBeNull();
  });

  it('a kind that is not a row kind is refused at creation', async () => {
    const engine = await rig();
    const err = await refusalOf(insertAgent(engine, { principal_kind: 'service' }));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(await userRow(engine, AGENT)).toBeUndefined();
  });

  it('an AI service account with no accountable owner is refused', async () => {
    const engine = await rig();
    expectFieldRefusal(await refusalOf(insertAgent(engine, { accountable_user_id: null })), 'accountable_user_id', 'required');
    expect(await userRow(engine, AGENT)).toBeUndefined();
  });

  it('an owner who does not exist is refused', async () => {
    const engine = await rig();
    expectFieldRefusal(
      await refusalOf(insertAgent(engine, { accountable_user_id: 'usr_missing' })),
      'accountable_user_id',
      'reference_not_found',
    );
    expect(await userRow(engine, AGENT)).toBeUndefined();
  });

  it('an owner who is an AI service account is refused, and an account cannot own itself', async () => {
    const engine = await rig();
    await insertAgent(engine);
    expectFieldRefusal(
      await refusalOf(engine.insert(
        'sys_user',
        { id: 'usr_agent2', email: 'agent2@sa.invalid', name: 'Agent 2', principal_kind: 'agent', accountable_user_id: AGENT },
        SYS,
      )),
      'accountable_user_id',
      'invalid_value',
    );
    expectFieldRefusal(
      await refusalOf(engine.insert(
        'sys_user',
        { id: 'usr_self', email: 'self@sa.invalid', name: 'Self', principal_kind: 'agent', accountable_user_id: 'usr_self' },
        SYS,
      )),
      'accountable_user_id',
      'invalid_value',
    );
    expect(await userRow(engine, 'usr_agent2')).toBeUndefined();
    expect(await userRow(engine, 'usr_self')).toBeUndefined();
  });

  it('a person created with an accountable owner is refused', async () => {
    const engine = await rig();
    expectFieldRefusal(
      await refusalOf(engine.insert('sys_user', { id: 'usr_p', email: 'p@sa.example', name: 'P', accountable_user_id: OWNER }, SYS)),
      'accountable_user_id',
      'invalid_value',
    );
    expect(await userRow(engine, 'usr_p')).toBeUndefined();
  });
});

describe('ADR-0151 D1 — the kind never changes, for every writer', () => {
  it('a system write turning a person into an AI service account is refused', async () => {
    const engine = await rig();
    expectFieldRefusal(
      await refusalOf(engine.update('sys_user', { principal_kind: 'agent', accountable_user_id: OTHER }, { where: { id: OWNER }, ...SYS })),
      'principal_kind',
      'invalid_value',
    );
    expect(principalKindOfRow(await userRow(engine, OWNER))).toBe('human');
  });

  it('a system write turning an AI service account into a person is refused, by value or by clearing it', async () => {
    const engine = await rig();
    await insertAgent(engine);
    for (const value of ['human', null]) {
      expectFieldRefusal(
        await refusalOf(engine.update('sys_user', { principal_kind: value }, { where: { id: AGENT }, ...SYS })),
        'principal_kind',
        'invalid_value',
      );
    }
    expect(isAgentAccountRow(await userRow(engine, AGENT))).toBe(true);
  });

  it('a multi-row system update that would turn people into AI service accounts is refused', async () => {
    const engine = await rig();
    const err = await refusalOf(
      engine.update('sys_user', { principal_kind: 'agent' }, { where: { id: { $in: [OWNER, OTHER] } }, multi: true, ...SYS } as any),
    );
    expectFieldRefusal(err, 'principal_kind', 'invalid_value');
    for (const id of [OWNER, OTHER]) expect(principalKindOfRow(await userRow(engine, id))).toBe('human');
  });

  it('a user-context write cannot change the kind either (the readonly strip and the identity write guard)', async () => {
    const engine = await rig();
    await insertAgent(engine);
    await refusalOf(engine.update('sys_user', { principal_kind: 'human', name: 'Renamed' }, {
      where: { id: AGENT },
      context: { userId: AGENT, positions: [], permissions: [] },
    } as any));
    expect(isAgentAccountRow(await userRow(engine, AGENT))).toBe(true);
  });

  it('CONTROL: writing the kind a row already has, and every other column, saves', async () => {
    const engine = await rig();
    await insertAgent(engine);
    await engine.update('sys_user', { principal_kind: 'human', name: 'Owner renamed' }, { where: { id: OWNER }, ...SYS });
    await engine.update('sys_user', { principal_kind: 'agent', name: 'Agent renamed' }, { where: { id: AGENT }, ...SYS });
    expect((await userRow(engine, OWNER)).name).toBe('Owner renamed');
    expect((await userRow(engine, AGENT)).name).toBe('Agent renamed');
  });
});

describe('ADR-0151 D1 — an AI service account always has a person accountable for it', () => {
  it('clearing the owner of an AI service account is refused', async () => {
    const engine = await rig();
    await insertAgent(engine);
    expectFieldRefusal(
      await refusalOf(engine.update('sys_user', { accountable_user_id: null }, { where: { id: AGENT }, ...SYS })),
      'accountable_user_id',
      'required',
    );
    expect((await userRow(engine, AGENT)).accountable_user_id).toBe(OWNER);
  });

  it('changing the owner to an AI service account or to a missing user is refused', async () => {
    const engine = await rig();
    await insertAgent(engine);
    await engine.insert(
      'sys_user',
      { id: 'usr_agent2', email: 'agent2@sa.invalid', name: 'Agent 2', principal_kind: 'agent', accountable_user_id: OWNER },
      SYS,
    );
    expectFieldRefusal(
      await refusalOf(engine.update('sys_user', { accountable_user_id: 'usr_agent2' }, { where: { id: AGENT }, ...SYS })),
      'accountable_user_id',
      'invalid_value',
    );
    expectFieldRefusal(
      await refusalOf(engine.update('sys_user', { accountable_user_id: 'usr_missing' }, { where: { id: AGENT }, ...SYS })),
      'accountable_user_id',
      'reference_not_found',
    );
    expect((await userRow(engine, AGENT)).accountable_user_id).toBe(OWNER);
  });

  it('giving a person an accountable owner is refused', async () => {
    const engine = await rig();
    expectFieldRefusal(
      await refusalOf(engine.update('sys_user', { accountable_user_id: OTHER }, { where: { id: OWNER }, ...SYS })),
      'accountable_user_id',
      'invalid_value',
    );
    expect((await userRow(engine, OWNER)).accountable_user_id ?? null).toBeNull();
  });

  it('CONTROL: changing the owner to another person saves', async () => {
    const engine = await rig();
    await insertAgent(engine);
    await engine.update('sys_user', { accountable_user_id: OTHER }, { where: { id: AGENT }, ...SYS });
    expect((await userRow(engine, AGENT)).accountable_user_id).toBe(OTHER);
  });
});

describe('ADR-0151 D1 — the membership reconciler never binds an AI service account', () => {
  const deps = { policy: 'auto' as const, resolveTargetOrg: async () => 'org_default', logger: { warn: () => undefined } };

  it('reconcileMembership answers agent-account and writes no membership', async () => {
    const engine = await rig();
    await engine.insert('sys_organization', { id: 'org_default', name: 'Default', slug: 'default' }, SYS);
    await insertAgent(engine);
    expect(await reconcileMembership(engine, AGENT, deps)).toEqual({ outcome: 'agent-account' });
    expect(await engine.find('sys_member', { where: { user_id: AGENT }, ...SYS })).toHaveLength(0);
  });

  it('the backfill passes over an AI service account; CONTROL: it binds a member-less person', async () => {
    const engine = await rig();
    await engine.insert('sys_organization', { id: 'org_default', name: 'Default', slug: 'default' }, SYS);
    await insertAgent(engine);
    const result = await backfillMemberships(engine, deps);
    expect(result.bound).toBe(2);
    expect(await engine.find('sys_member', { where: { user_id: AGENT }, ...SYS })).toHaveLength(0);
    expect(await engine.find('sys_member', { where: { user_id: OWNER }, ...SYS })).toHaveLength(1);
  });

  it('CONTROL: reconcileMembership binds a member-less person', async () => {
    const engine = await rig();
    await engine.insert('sys_organization', { id: 'org_default', name: 'Default', slug: 'default' }, SYS);
    expect((await reconcileMembership(engine, OWNER, deps)).outcome).toBe('bound');
  });
});
