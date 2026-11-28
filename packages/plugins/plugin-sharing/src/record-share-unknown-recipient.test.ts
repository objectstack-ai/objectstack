// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33912] A manual share — and a sharing rule — whose `user` recipient names
 * no user the gates could ever match is refused, on a REAL engine over a REAL
 * driver.
 *
 * The read and write gates look a share up by `recipient_id = <the caller's
 * user id>`. A row whose `recipient_id` names nobody therefore looks granted
 * (it is listed by `GET …/shares`) and enforces nothing: the class the
 * access-level refusal (#3865) and ADR-0111 D7 (non-user recipient types)
 * closed. `grant()` used to check only that `recipientId` was present.
 *
 * What "names a user" means is the scope the gates consult:
 *
 * - behind a wall (`isolated` / `group`) with the record's organization known:
 *   a member of THAT organization (`organizationMemberStanding`). A user of
 *   another organization is as inert as an id that does not exist, and is
 *   answered with the same sentence, so the door is no oracle for who exists
 *   in another tenant;
 * - otherwise (`single`): an existing `sys_user`.
 *
 * Every refusal is asserted by its `code` — the `CODE:` prefix the REST share
 * and rule routes map to a status (`VALIDATION_FAILED` → 400, pinned route-side
 * in `packages/rest/src/rest-share-refusal-classification.test.ts`) — and by
 * the table it must not have written to. A control beside each refusal is the
 * same call with one value changed, so a red on the refusal cannot come from
 * the harness.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';

const OBJECT = 'os33912_deal';

type Fields = Record<string, Record<string, unknown>>;
const text = (name: string, extra: Record<string, unknown> = {}) => ({ type: 'text', name, label: name, ...extra });
const fieldsOf = (...names: string[]): Fields => {
  const out: Fields = { id: text('id', { primary: true }) };
  for (const n of names) out[n] = text(n);
  return out;
};

const DEAL_FIELDS = fieldsOf('stage', 'owner_id', 'organization_id');
const SHARE_FIELDS = fieldsOf(
  'organization_id', 'object_name', 'record_id', 'recipient_type', 'recipient_id', 'access_level',
  'source', 'source_id', 'reason', 'granted_by', 'created_at', 'updated_at',
);
const RULE_FIELDS: Fields = {
  ...fieldsOf(
    'organization_id', 'name', 'label', 'description', 'object_name', 'criteria_json',
    'recipient_type', 'recipient_id', 'access_level', 'managed_by', 'created_at', 'updated_at',
  ),
  active: { type: 'boolean', name: 'active', label: 'Active' },
  customized: { type: 'boolean', name: 'customized', label: 'Customized' },
};
const USER_FIELDS = fieldsOf('name');
const MEMBER_FIELDS = fieldsOf('user_id', 'organization_id', 'role');

const ORG_A = 'org_a';
const ORG_B = 'org_b';

/** The record owner, a member of ORG_A: the caller of every manual share. */
const OWNER = 'u_owner';
/** A member of ORG_A: the control recipient. */
const MEMBER_A = 'u_member_a';
/** An existing user who is a member of ORG_B only. */
const MEMBER_B = 'u_member_b';
/** No `sys_user`, no `sys_member`: the card's reproduction id. */
const UNKNOWN = 'nobody_xyz';

const OWNER_CTX = { userId: OWNER, tenantId: ORG_A, positions: [], permissions: [] } as unknown as ExecutionContext;
const ORG_A_ADMIN = {
  userId: 'u_admin',
  tenantId: ORG_A,
  positions: [],
  permissions: [],
  systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;
const SYSTEM_A = { isSystem: true, tenantId: ORG_A, positions: [], permissions: [] } as unknown as ExecutionContext;

const WON = { stage: 'won' };

interface Booted {
  driver: SqlDriver;
  sharing: SharingService;
  rules: SharingRuleService;
  /** Every `sys_record_share` row, read straight off the driver. */
  shares: () => Promise<Array<{ recipient_id: string; record_id: string; source: string }>>;
  /** Every `sys_sharing_rule` row, read straight off the driver. */
  storedRules: () => Promise<Array<{ name: string; recipient_id: string; active: unknown }>>;
}

const open: SqlDriver[] = [];

afterEach(async () => {
  for (const d of open.splice(0)) {
    try { await d.disconnect(); } catch { /* noop */ }
  }
});

async function boot(posture: 'single' | 'isolated'): Promise<Booted> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(driver);

  const ql = new ObjectQL();
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.setTenancyPostureProvider(() => posture);
  ql.registerObject({ name: OBJECT, label: 'Deal', sharingModel: 'private', fields: DEAL_FIELDS } as never);
  ql.registerObject({ name: 'sys_record_share', label: 'Record Share', isSystem: true, fields: SHARE_FIELDS } as never);
  ql.registerObject({ name: 'sys_sharing_rule', label: 'Sharing Rule', isSystem: true, fields: RULE_FIELDS } as never);
  // The real `sys_user` carries no tenant column: a user is not an organization's row.
  ql.registerObject({ name: 'sys_user', label: 'User', isSystem: true, systemFields: { tenant: false }, fields: USER_FIELDS } as never);
  ql.registerObject({ name: 'sys_member', label: 'Member', isSystem: true, fields: MEMBER_FIELDS } as never);
  await driver.initObjects([
    { name: OBJECT, fields: DEAL_FIELDS },
    { name: 'sys_record_share', fields: SHARE_FIELDS },
    { name: 'sys_sharing_rule', fields: RULE_FIELDS },
    { name: 'sys_user', fields: USER_FIELDS },
    { name: 'sys_member', fields: MEMBER_FIELDS },
  ] as never);

  // Seeded through the driver: the fixture is the DATA at rest.
  for (const id of [OWNER, MEMBER_A, MEMBER_B, 'u_admin']) await driver.create('sys_user', { id, name: id } as never);
  await driver.create('sys_member', { id: 'm_owner', user_id: OWNER, organization_id: ORG_A, role: 'member' } as never);
  await driver.create('sys_member', { id: 'm_a', user_id: MEMBER_A, organization_id: ORG_A, role: 'member' } as never);
  await driver.create('sys_member', { id: 'm_b', user_id: MEMBER_B, organization_id: ORG_B, role: 'member' } as never);
  await driver.create(OBJECT, { id: 'deal_a1', stage: 'won', owner_id: OWNER, organization_id: ORG_A } as never);

  const sharing = new SharingService({ engine: ql as never, tenancy: () => ({ posture }) });
  const rules = new SharingRuleService({ engine: ql as never, sharing });

  return {
    driver,
    sharing,
    rules,
    shares: async () => (await driver.find('sys_record_share', {} as never)) as never,
    storedRules: async () => (await driver.find('sys_sharing_rule', {} as never)) as never,
  };
}

/** The refusal a call answers, or `null` when it was admitted. */
async function refusalOf(call: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  return call.then(
    () => null,
    (e: unknown) => {
      const raw = e instanceof Error ? e.message : String(e);
      const m = /^([A-Z_]+):\s*(.*)$/s.exec(raw);
      return m ? { code: m[1]!, message: m[2]! } : { code: '(no code prefix)', message: raw };
    },
  );
}

const share = (recipientId: string) => ({ object: OBJECT, recordId: 'deal_a1', recipientType: 'user' as const, recipientId, accessLevel: 'read' as const });

const RECORD_REFUSAL = (id: string) =>
  `recipientId ${JSON.stringify(id)} does not name a user this record can be shared with, `
  + 'so no access check would ever match the share. Name an existing user '
  + "(on a multi-organization deployment, a member of the record's organization).";

const RULE_REFUSAL = (id: string) =>
  `recipientId ${JSON.stringify(id)} does not name a user this rule can share with, `
  + 'so the rule would grant no one access. Name an existing user '
  + "(on a multi-organization deployment, a member of the rule's organization).";

describe('[#33912] a manual share to a user recipient that does not resolve is refused — walled posture', () => {
  it('an id that names no user is refused VALIDATION_FAILED, and no row is written', async () => {
    const { sharing, shares } = await boot('isolated');
    const refusal = await refusalOf(sharing.grant(share(UNKNOWN), OWNER_CTX));
    expect(refusal, 'the unknown recipient was granted').not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_FAILED');
    expect(refusal!.message).toBe(RECORD_REFUSAL(UNKNOWN));
    expect(await shares()).toEqual([]);
  });

  it('control: a member of the record\'s organization is granted, and the row is written', async () => {
    const { sharing, shares } = await boot('isolated');
    const row = await sharing.grant(share(MEMBER_A), OWNER_CTX);
    expect(row.recipient_id).toBe(MEMBER_A);
    expect((await shares()).map((r) => r.recipient_id)).toEqual([MEMBER_A]);
  });

  it('a user of ANOTHER organization is answered exactly as an id that does not exist', async () => {
    const { sharing, shares } = await boot('isolated');
    const foreign = await refusalOf(sharing.grant(share(MEMBER_B), OWNER_CTX));
    const unknown = await refusalOf(sharing.grant(share(UNKNOWN), OWNER_CTX));
    expect(foreign, 'the other-organization user was granted').not.toBeNull();
    expect(foreign!.code).toBe(unknown!.code);
    // Byte for byte, once the echoed id is set aside: nothing tells the caller
    // that `u_member_b` exists somewhere else.
    expect(foreign!.message.replace(JSON.stringify(MEMBER_B), 'ID'))
      .toBe(unknown!.message.replace(JSON.stringify(UNKNOWN), 'ID'));
    expect(await shares()).toEqual([]);
  });

  it('the system context is not judged: a rule-materialised grant to the same id is written as before', async () => {
    const { sharing, shares } = await boot('isolated');
    await sharing.grant({ ...share(UNKNOWN), source: 'rule', sourceId: 'shr_rule_1' } as never, SYSTEM_A);
    expect((await shares()).map((r) => [r.recipient_id, r.source])).toEqual([[UNKNOWN, 'rule']]);
  });
});

describe('[#33912] a manual share to a user recipient that does not resolve is refused — single posture', () => {
  it('an id that names no user is refused VALIDATION_FAILED, and no row is written', async () => {
    const { sharing, shares } = await boot('single');
    const refusal = await refusalOf(sharing.grant(share(UNKNOWN), OWNER_CTX));
    expect(refusal, 'the unknown recipient was granted').not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_FAILED');
    expect(refusal!.message).toBe(RECORD_REFUSAL(UNKNOWN));
    expect(await shares()).toEqual([]);
  });

  it('control: an existing user is granted with no membership asked — no wall stands between them and the record', async () => {
    const { sharing, shares } = await boot('single');
    await sharing.grant(share(MEMBER_B), OWNER_CTX);
    expect((await shares()).map((r) => r.recipient_id)).toEqual([MEMBER_B]);
  });
});

describe('[#33912] defineRule refuses a user recipient that does not resolve, when the recipient is new', () => {
  const rule = (name: string, recipientId: string, extra: Record<string, unknown> = {}) => ({
    name, label: name, object: OBJECT, criteria: WON, recipientType: 'user', recipientId, accessLevel: 'read', ...extra,
  }) as never;

  it('a new rule naming no user is refused VALIDATION_FAILED, and no rule is stored', async () => {
    const { rules, storedRules, shares } = await boot('isolated');
    const refusal = await refusalOf(rules.defineRule(rule('r_unknown', UNKNOWN), ORG_A_ADMIN));
    expect(refusal, 'the rule naming an unknown user was saved').not.toBeNull();
    expect(refusal!.code).toBe('VALIDATION_FAILED');
    expect(refusal!.message).toBe(RULE_REFUSAL(UNKNOWN));
    expect(await storedRules()).toEqual([]);
    expect(await shares()).toEqual([]);
  });

  it('a new rule naming a user of another organization is answered exactly as an unknown id', async () => {
    const { rules, storedRules } = await boot('isolated');
    const foreign = await refusalOf(rules.defineRule(rule('r_foreign', MEMBER_B), ORG_A_ADMIN));
    expect(foreign?.code).toBe('VALIDATION_FAILED');
    // The unknown id's sentence, with only the echoed id changed.
    expect(foreign!.message).toBe(RULE_REFUSAL(MEMBER_B));
    expect(await storedRules()).toEqual([]);
  });

  it('control: a new rule naming a member of the organization is stored', async () => {
    const { rules, storedRules } = await boot('isolated');
    await rules.defineRule(rule('r_member', MEMBER_A), ORG_A_ADMIN);
    expect((await storedRules()).map((r) => [r.name, r.recipient_id])).toEqual([['r_member', MEMBER_A]]);
  });

  it('an upsert that keeps a stored rule\'s recipient is not re-judged: a rule whose user has gone can still be switched off', async () => {
    const { driver, rules, storedRules } = await boot('isolated');
    await driver.create('sys_sharing_rule', {
      id: 'rule_stale', organization_id: ORG_A, name: 'r_stale', label: 'r_stale', object_name: OBJECT,
      criteria_json: JSON.stringify(WON), recipient_type: 'user', recipient_id: UNKNOWN, access_level: 'read',
      active: true, managed_by: 'admin',
    } as never);
    await rules.defineRule(rule('r_stale', UNKNOWN, { active: false }), ORG_A_ADMIN);
    const stored = (await storedRules()).find((r) => r.name === 'r_stale');
    expect(Boolean(stored?.active)).toBe(false);
  });

  it('…but moving a stored rule onto a user that does not resolve is judged, and refused', async () => {
    const { driver, rules, storedRules } = await boot('isolated');
    await driver.create('sys_sharing_rule', {
      id: 'rule_moved', organization_id: ORG_A, name: 'r_moved', label: 'r_moved', object_name: OBJECT,
      criteria_json: JSON.stringify(WON), recipient_type: 'user', recipient_id: MEMBER_A, access_level: 'read',
      active: true, managed_by: 'admin',
    } as never);
    const refusal = await refusalOf(rules.defineRule(rule('r_moved', UNKNOWN), ORG_A_ADMIN));
    expect(refusal?.code).toBe('VALIDATION_FAILED');
    expect((await storedRules()).find((r) => r.name === 'r_moved')?.recipient_id).toBe(MEMBER_A);
  });
});
