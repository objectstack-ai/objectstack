// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Position- and team-recipient sharing rules are re-evaluated for the affected
 * user when the membership behind the recipient changes
 * (`recipient-membership-recompute.ts`).
 *
 * The invariant: a write to `sys_user_position`, to the `sys_member.role`
 * transition source, or to `sys_team_member` re-evaluates every sharing rule
 * whose recipient the row names, for the user the row names, before the write
 * returns — a new holder gains the rule's grants, a former holder loses them,
 * and no other user's grants and no other rule move.
 *
 * Driven through a REAL `ObjectQL` over `SqlDriver` (better-sqlite3), so the
 * hook context each assertion depends on — the inserted row, the update and
 * delete pre-image, the per-row dispatch of a batch insert — is the engine's
 * own, not a fixture's idea of it. Every membership write goes through
 * `ql.insert` / `ql.update` / `ql.delete`; the fixture's starting state is
 * seeded straight through the driver, so no hook runs for it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { SHARING_RULE_HOOK_PACKAGE } from './rule-hooks.js';
import {
  bindRecipientMembershipRecompute,
  unbindRecipientMembershipRecompute,
  writeCanChangeHolders,
  ruleReadsRowsOf,
  RECIPIENT_MEMBERSHIP_RECOMPUTE_PACKAGE,
  RECIPIENT_MEMBERSHIP_SOURCES,
} from './recipient-membership-recompute.js';

const OBJECT = 'rmr_account';
const ORG_A = 'org_a';
const ORG_B = 'org_b';

const SYSTEM: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

const text = (name: string) => ({ type: 'text', name, label: name });

const ACCOUNT_FIELDS = {
  id: { ...text('id'), primary: true },
  region: text('region'),
  owner_id: text('owner_id'),
  organization_id: text('organization_id'),
};
const SHARE_FIELDS = {
  id: { ...text('id'), primary: true },
  organization_id: text('organization_id'),
  object_name: text('object_name'),
  record_id: text('record_id'),
  recipient_type: text('recipient_type'),
  recipient_id: text('recipient_id'),
  access_level: text('access_level'),
  source: text('source'),
  source_id: text('source_id'),
  reason: text('reason'),
  granted_by: text('granted_by'),
  created_at: text('created_at'),
  updated_at: text('updated_at'),
};
const RULE_FIELDS = {
  id: { ...text('id'), primary: true },
  organization_id: text('organization_id'),
  name: text('name'),
  label: text('label'),
  description: text('description'),
  object_name: text('object_name'),
  criteria_json: text('criteria_json'),
  recipient_type: text('recipient_type'),
  recipient_id: text('recipient_id'),
  access_level: text('access_level'),
  active: { type: 'boolean', name: 'active', label: 'active' },
  managed_by: text('managed_by'),
  customized: { type: 'boolean', name: 'customized', label: 'customized' },
  created_at: text('created_at'),
  updated_at: text('updated_at'),
};
const USER_POSITION_FIELDS = {
  id: { ...text('id'), primary: true },
  organization_id: text('organization_id'),
  user_id: text('user_id'),
  position: text('position'),
  valid_from: text('valid_from'),
  valid_until: text('valid_until'),
  reason: text('reason'),
  created_at: text('created_at'),
  updated_at: text('updated_at'),
};
const MEMBER_FIELDS = {
  id: { ...text('id'), primary: true },
  organization_id: text('organization_id'),
  user_id: text('user_id'),
  role: text('role'),
  created_at: text('created_at'),
  updated_at: text('updated_at'),
};
const TEAM_MEMBER_FIELDS = {
  id: { ...text('id'), primary: true },
  organization_id: text('organization_id'),
  team_id: text('team_id'),
  user_id: text('user_id'),
  created_at: text('created_at'),
  updated_at: text('updated_at'),
};

const TABLES: Array<[string, Record<string, unknown>, Record<string, unknown>?]> = [
  [OBJECT, ACCOUNT_FIELDS, { sharingModel: 'private' }],
  ['sys_record_share', SHARE_FIELDS, { isSystem: true }],
  ['sys_sharing_rule', RULE_FIELDS, { isSystem: true }],
  ['sys_user_position', USER_POSITION_FIELDS, { isSystem: true }],
  ['sys_member', MEMBER_FIELDS, { isSystem: true }],
  ['sys_team_member', TEAM_MEMBER_FIELDS, { isSystem: true }],
];

/** The rules every case reasons about, all owned by ORG_A. */
const RULES = [
  { id: 'srule_eu', name: 'eu_territory', recipient_type: 'position', recipient_id: 'eu_sales', region: 'eu', access_level: 'edit' },
  { id: 'srule_na', name: 'na_territory', recipient_type: 'position', recipient_id: 'na_sales', region: 'na', access_level: 'read' },
  { id: 'srule_team', name: 'eu_team', recipient_type: 'team', recipient_id: 'team_eu', region: 'eu', access_level: 'read' },
] as const;

const open: SqlDriver[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (open.length) await open.pop()?.disconnect?.();
});

/**
 * A fresh database: three accounts in ORG_A (two `eu`, one `na`), the three
 * rules above, and `u_na` already holding `na_sales` — materialised once, the
 * way the boot backfill does, before the hooks are bound.
 */
async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(driver);
  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.setTenancyPostureProvider(() => 'isolated');
  for (const [name, fields, extra] of TABLES) ql.registerObject({ name, label: name, fields, ...(extra ?? {}) } as never);
  await driver.initObjects(TABLES.map(([name, fields]) => ({ name, fields }) as never));

  const now = '2026-01-01T00:00:00Z';
  for (const [id, region] of [['acct_eu_1', 'eu'], ['acct_eu_2', 'eu'], ['acct_na_1', 'na']]) {
    await driver.create(OBJECT, { id, region, owner_id: 'u_owner', organization_id: ORG_A } as never);
  }
  for (const r of RULES) {
    await driver.create('sys_sharing_rule', {
      id: r.id, organization_id: ORG_A, name: r.name, label: r.name, object_name: OBJECT,
      criteria_json: JSON.stringify({ region: r.region }), recipient_type: r.recipient_type,
      recipient_id: r.recipient_id, access_level: r.access_level, active: true, managed_by: 'admin',
      customized: false, created_at: now, updated_at: now,
    } as never);
  }
  await driver.create('sys_user_position', { id: 'up_na', organization_id: ORG_A, user_id: 'u_na', position: 'na_sales' } as never);

  const warn = vi.fn();
  const info = vi.fn();
  const sharing = new SharingService({ engine: ql as never });
  const rules = new SharingRuleService({ engine: ql as never, sharing, logger: { warn, info } });
  for (const r of RULES) await rules.evaluateRule(r.id, SYSTEM);
  bindRecipientMembershipRecompute(ql as never, rules, { warn, info });

  /** `record_id:access_level` of every grant `ruleId` holds for `userId`, sorted. */
  const grantsOf = async (userId: string, ruleId = 'srule_eu'): Promise<string[]> => {
    const rows = (await driver.find('sys_record_share', {} as never)) as any[];
    return rows
      .filter((r) => r.source === 'rule' && r.source_id === ruleId && r.recipient_id === userId)
      .map((r) => `${r.record_id}:${r.access_level}`)
      .sort();
  };
  const shareIds = async (ruleId: string): Promise<string[]> => {
    const rows = (await driver.find('sys_record_share', {} as never)) as any[];
    return rows.filter((r) => r.source_id === ruleId).map((r) => String(r.id)).sort();
  };
  const member = (userId: string): ExecutionContext =>
    ({ userId, tenantId: ORG_A, positions: [], permissions: [] }) as unknown as ExecutionContext;
  /** The account ids `userId`'s own read path admits. */
  const readable = async (userId: string): Promise<string[]> => {
    const filter = await sharing.buildReadFilter(OBJECT, member(userId));
    expect(filter).not.toBeNull(); // a member context never bypasses — else this reads nothing
    const rows = (await ql.find(OBJECT, { where: filter as any, context: SYSTEM } as never)) as any[];
    return rows.map((r) => String(r.id)).sort();
  };
  const canEdit = (userId: string, recordId: string) => sharing.checkEdit(OBJECT, recordId, member(userId));
  const assign = (id: string, userId: string, position: string, extra: Record<string, unknown> = {}) =>
    ql.insert('sys_user_position', { id, organization_id: ORG_A, user_id: userId, position, ...extra }, { context: SYSTEM } as never);

  return { driver, ql, sharing, rules, warn, info, grantsOf, shareIds, readable, canEdit, assign };
}

const EU_GRANTS = ['acct_eu_1:edit', 'acct_eu_2:edit'];

describe('position assignment writes re-evaluate position-recipient rules for the affected user', () => {
  it('a new holder gains the rule\'s grants in the write that assigns the position', async () => {
    const t = await boot();
    expect(await t.grantsOf('u_new')).toEqual([]);

    await t.assign('up_new', 'u_new', 'eu_sales');

    expect(await t.grantsOf('u_new')).toEqual(EU_GRANTS);
    expect(await t.readable('u_new')).toEqual(['acct_eu_1', 'acct_eu_2']);
    expect(await t.canEdit('u_new', 'acct_eu_1')).toBe('allow');
  });

  it('a removed holder loses the rule\'s grants in the write that removes the position — read and edit both refused', async () => {
    const t = await boot();
    await t.assign('up_old', 'u_old', 'eu_sales');
    expect(await t.readable('u_old')).toEqual(['acct_eu_1', 'acct_eu_2']);
    expect(await t.canEdit('u_old', 'acct_eu_2')).toBe('allow');

    await t.ql.delete('sys_user_position', { where: { id: 'up_old' }, context: SYSTEM } as never);

    expect(await t.grantsOf('u_old')).toEqual([]);
    expect(await t.readable('u_old')).toEqual([]);
    expect(await t.canEdit('u_old', 'acct_eu_1')).toBe('deny');
    expect(await t.canEdit('u_old', 'acct_eu_2')).toBe('deny');
  });

  it('an assignment moved to another user moves the grants with it', async () => {
    const t = await boot();
    await t.assign('up_move', 'u_old', 'eu_sales');

    await t.ql.update('sys_user_position', { id: 'up_move', user_id: 'u_next' }, { context: SYSTEM } as never);

    expect(await t.grantsOf('u_old')).toEqual([]);
    expect(await t.grantsOf('u_next')).toEqual(EU_GRANTS);
  });

  it('an assignment moved to another position swaps the two rules\' grants', async () => {
    const t = await boot();
    await t.assign('up_swap', 'u_swap', 'eu_sales');

    await t.ql.update('sys_user_position', { id: 'up_swap', position: 'na_sales' }, { context: SYSTEM } as never);

    expect(await t.grantsOf('u_swap', 'srule_eu')).toEqual([]);
    expect(await t.grantsOf('u_swap', 'srule_na')).toEqual(['acct_na_1:read']);
  });

  it('an assignment whose validity window closes is a removal', async () => {
    const t = await boot();
    await t.assign('up_window', 'u_window', 'eu_sales');
    expect(await t.grantsOf('u_window')).toEqual(EU_GRANTS);

    await t.ql.update('sys_user_position', { id: 'up_window', valid_until: '2000-01-01T00:00:00Z' }, { context: SYSTEM } as never);

    expect(await t.grantsOf('u_window')).toEqual([]);
  });

  it('a holder who still holds the position through a second assignment keeps the grants', async () => {
    const t = await boot();
    await t.assign('up_first', 'u_twice', 'eu_sales');
    await t.assign('up_second', 'u_twice', 'eu_sales', { reason: 'second anchor' });

    await t.ql.delete('sys_user_position', { where: { id: 'up_first' }, context: SYSTEM } as never);

    expect(await t.grantsOf('u_twice')).toEqual(EU_GRANTS);
  });

  it('an unrelated position\'s grants are untouched, and its rule is never re-evaluated', async () => {
    const t = await boot();
    const naBefore = await t.shareIds('srule_na');
    expect(naBefore).toHaveLength(1); // u_na's standing grant — a count of 0 would make this vacuous
    const spy = vi.spyOn(t.rules, 'reconcileRuleForUser');

    await t.assign('up_new', 'u_new', 'eu_sales');
    await t.ql.delete('sys_user_position', { where: { id: 'up_new' }, context: SYSTEM } as never);

    expect(await t.shareIds('srule_na')).toEqual(naBefore);
    expect(new Set(spy.mock.calls.map((c) => c[0].id))).toEqual(new Set(['srule_eu']));
  });

  it('only the named user\'s grants move — the other holders of the position keep theirs', async () => {
    const t = await boot();
    await t.assign('up_keep', 'u_keep', 'eu_sales');
    const kept = (await t.shareIds('srule_eu'));

    await t.assign('up_new', 'u_new', 'eu_sales');
    await t.ql.delete('sys_user_position', { where: { id: 'up_new' }, context: SYSTEM } as never);

    expect(await t.shareIds('srule_eu')).toEqual(kept);
  });

  it('an assignment in another organization does not re-evaluate an organization\'s rule', async () => {
    const t = await boot();
    const spy = vi.spyOn(t.rules, 'reconcileRuleForUser');

    await t.ql.insert('sys_user_position', { id: 'up_b', organization_id: ORG_B, user_id: 'u_b', position: 'eu_sales' }, { context: SYSTEM } as never);

    expect(spy).not.toHaveBeenCalled();
    expect(await t.grantsOf('u_b')).toEqual([]);
  });

  it('an update that cannot change who holds the position re-evaluates nothing', async () => {
    const t = await boot();
    await t.assign('up_note', 'u_note', 'eu_sales');
    const spy = vi.spyOn(t.rules, 'reconcileRuleForUser');

    await t.ql.update('sys_user_position', { id: 'up_note', reason: 'annual review' }, { context: SYSTEM } as never);

    expect(spy).not.toHaveBeenCalled();
    expect(await t.grantsOf('u_note')).toEqual(EU_GRANTS);
  });

  it('a bulk assignment import re-evaluates each assigned user once, scoped to that user, and never a whole rule', async () => {
    const t = await boot();
    const reconcile = vi.spyOn(t.rules, 'reconcileRuleForUser');
    const evaluate = vi.spyOn(t.rules, 'evaluateRule');
    const retired = vi.spyOn(t.rules, 'revokeRuleGrantsForRetiredRecipients');
    const reads: Array<{ object: string; where: any }> = [];
    const find = t.ql.find.bind(t.ql);
    vi.spyOn(t.ql, 'find').mockImplementation((async (object: string, query?: any, options?: any) => {
      reads.push({ object, where: query?.filter ?? query?.where ?? {} });
      return find(object, query, options);
    }) as never);

    const N = 20;
    const rows = [
      ...Array.from({ length: N }, (_, i) => ({ id: `up_eu_${i}`, organization_id: ORG_A, user_id: `u_eu_${i}`, position: 'eu_sales' })),
      ...Array.from({ length: N }, (_, i) => ({ id: `up_x_${i}`, organization_id: ORG_A, user_id: `u_x_${i}`, position: 'unnamed_position' })),
    ];
    await t.ql.insert('sys_user_position', rows, { context: SYSTEM } as never);

    // One user-scoped pass per assigned user of the named position; none for
    // the position no rule names; no whole-rule pass of any kind.
    expect(reconcile).toHaveBeenCalledTimes(N);
    expect(new Set(reconcile.mock.calls.map((c) => c[0].id))).toEqual(new Set(['srule_eu']));
    expect(evaluate).not.toHaveBeenCalled();
    expect(retired).not.toHaveBeenCalled();
    // Every assignment read the import caused is narrowed to one user — the
    // position's whole holder list is never read per row.
    const assignmentReads = reads.filter((r) => r.object === 'sys_user_position');
    expect(assignmentReads.length).toBeGreaterThan(0);
    expect(assignmentReads.every((r) => typeof r.where.user_id === 'string')).toBe(true);
    // And the outcome is complete: every new holder, every matched account.
    for (let i = 0; i < N; i++) expect(await t.grantsOf(`u_eu_${i}`)).toEqual(EU_GRANTS);
    expect(await t.grantsOf('u_x_0')).toEqual([]);
  });

  it('after the user-scoped passes, the whole-rule pass has nothing left to reconcile', async () => {
    const t = await boot();
    await t.assign('up_a', 'u_a', 'eu_sales');
    await t.assign('up_b', 'u_b2', 'eu_sales');
    await t.ql.delete('sys_user_position', { where: { id: 'up_a' }, context: SYSTEM } as never);
    await t.ql.update('sys_user_position', { id: 'up_b', user_id: 'u_c' }, { context: SYSTEM } as never);

    const pass = await t.rules.evaluateRule('srule_eu', SYSTEM);

    expect(pass.grantsCreated).toBe(0);
    expect(pass.grantsUpdated).toBe(0);
    expect(pass.grantsRevoked).toBe(0);
  });
});

describe('the membership role transition source and team membership move the holding too', () => {
  it('a membership role naming the position grants, and a role change away from it revokes', async () => {
    const t = await boot();
    await t.ql.insert('sys_member', { id: 'm_1', organization_id: ORG_A, user_id: 'u_member', role: 'eu_sales' }, { context: SYSTEM } as never);
    expect(await t.grantsOf('u_member')).toEqual(EU_GRANTS);

    await t.ql.update('sys_member', { id: 'm_1', role: 'member' }, { context: SYSTEM } as never);

    expect(await t.grantsOf('u_member')).toEqual([]);
  });

  it('a new team member gains the team rule\'s grants, and a removed one loses them', async () => {
    const t = await boot();
    await t.ql.insert('sys_team_member', { id: 'tm_1', organization_id: ORG_A, team_id: 'team_eu', user_id: 'u_team' }, { context: SYSTEM } as never);
    expect(await t.grantsOf('u_team', 'srule_team')).toEqual(['acct_eu_1:read', 'acct_eu_2:read']);

    await t.ql.delete('sys_team_member', { where: { id: 'tm_1' }, context: SYSTEM } as never);

    expect(await t.grantsOf('u_team', 'srule_team')).toEqual([]);
    expect(await t.readable('u_team')).toEqual([]);
  });
});

describe('binding and write classification', () => {
  const fakeEngine = () => {
    const hooks: Array<{ event: string; options: Record<string, any> }> = [];
    return {
      hooks,
      registerHook(event: string, _handler: unknown, options: Record<string, any> = {}) { hooks.push({ event, options }); },
      unregisterHooksByPackage(pkg: string) {
        let n = 0;
        for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].options.packageId === pkg) { hooks.splice(i, 1); n++; }
        return n;
      },
    };
  };
  const service = { listRules: async () => [], reconcileRuleForUser: async () => ({}) as never };

  it('binds afterInsert / afterUpdate / afterDelete on every membership table, under its own package', () => {
    const engine = fakeEngine();
    bindRecipientMembershipRecompute(engine, service);
    expect(engine.hooks).toHaveLength(RECIPIENT_MEMBERSHIP_SOURCES.length * 3);
    for (const { object } of RECIPIENT_MEMBERSHIP_SOURCES) {
      expect(engine.hooks.filter((h) => h.options.object === object).map((h) => h.event).sort())
        .toEqual(['afterDelete', 'afterInsert', 'afterUpdate']);
    }
    expect(engine.hooks.every((h) => h.options.packageId === RECIPIENT_MEMBERSHIP_RECOMPUTE_PACKAGE)).toBe(true);
    // What a rule rebind removes cannot take these down.
    engine.unregisterHooksByPackage(SHARING_RULE_HOOK_PACKAGE);
    expect(engine.hooks).toHaveLength(RECIPIENT_MEMBERSHIP_SOURCES.length * 3);
    expect(unbindRecipientMembershipRecompute(engine)).toBe(RECIPIENT_MEMBERSHIP_SOURCES.length * 3);
  });

  it('watches exactly the membership tables the position and team expansions read', () => {
    expect(RECIPIENT_MEMBERSHIP_SOURCES.map((s) => `${s.object}.${s.recipientColumn}->${s.recipientType}`)).toEqual([
      'sys_user_position.position->position',
      'sys_member.role->position',
      'sys_team_member.team_id->team',
    ]);
  });

  it('treats an unreadable update payload as one that may have changed the holding', () => {
    const [positions] = RECIPIENT_MEMBERSHIP_SOURCES;
    expect(writeCanChangeHolders(positions, 'afterUpdate', {})).toBe(true);
    expect(writeCanChangeHolders(positions, 'afterUpdate', { input: { data: 'x' } })).toBe(true);
    expect(writeCanChangeHolders(positions, 'afterInsert', { input: { data: { reason: 'x' } } })).toBe(true);
    expect(writeCanChangeHolders(positions, 'afterDelete', {})).toBe(true);
    expect(writeCanChangeHolders(positions, 'afterUpdate', { input: { data: { reason: 'x' } } })).toBe(false);
    for (const column of positions.expansionColumns) {
      expect(writeCanChangeHolders(positions, 'afterUpdate', { input: { data: { [column]: null } } })).toBe(true);
    }
  });

  it('pins a rule to the organizations of the rows it can read', () => {
    const [positions, , teams] = RECIPIENT_MEMBERSHIP_SOURCES;
    const orgs = new Set<string | null>([ORG_A]);
    expect(ruleReadsRowsOf(positions, { organization_id: ORG_A }, orgs)).toBe(true);
    expect(ruleReadsRowsOf(positions, { organization_id: ORG_B }, orgs)).toBe(false);
    expect(ruleReadsRowsOf(positions, { organization_id: null }, orgs)).toBe(true); // platform-global reads every row
    expect(ruleReadsRowsOf(positions, { organization_id: ORG_B }, new Set([null]))).toBe(false);
    expect(ruleReadsRowsOf(positions, { organization_id: ORG_B }, null)).toBe(true); // unreadable organization
    expect(ruleReadsRowsOf(teams, { organization_id: ORG_B }, orgs)).toBe(true); // team expansion is not organization-scoped
  });
});
