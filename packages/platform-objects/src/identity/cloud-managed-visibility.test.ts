// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cloud-managed environment (`features.cloudManaged`, the hide-when-on flag
 * of `PUBLIC_AUTH_FEATURES`) takes the console's doors for adding people away:
 * its people arrive from the organisation's identity provider. Six actions are
 * hidden while the flag is on — the four `invite_user` mirrors, `create_user`
 * and `set_user_password` — and each is offered as before when the flag is
 * off (ruling 6341690661 on #25083, Q3 A and Q4 A). `resend_invitation`
 * rides the invite mirrors' door, so it is hidden the same way (its own
 * block below).
 *
 * Not pinned here: a payload that omits the flag. plugin-auth's drift guard
 * holds the served boolean key set stable, and this engine faults on ANY
 * flag the payload lacks (`default-on` ones too), so that case is the
 * consumer's fault handling, the same for every flag.
 *
 * Five of the six also carry another flag's gate (`organization` or `admin`)
 * through `requiresFeature`, so the `cloudManaged` gate is written in
 * `visible` and the two compose. `set_user_password` carries none: its door
 * works without the better-auth admin plugin (the admin block header in
 * `sys-user.object.ts`), so `cloudManaged` is its only flag. The predicates are EVALUATED through the
 * canonical engine the console delegates to (`@objectstack/formula`), on the
 * parsed object, so the lowered envelope is what is judged; a string match
 * would stay green on a predicate that faults or never answers true.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { SysUser } from './sys-user.object.js';
import { SysMember } from './sys-member.object.js';
import { SysInvitation } from './sys-invitation.object.js';
import { SysOrganization } from './sys-organization.object.js';

/** Holds every standing the six doors ask for: the platform-admin rung and the owner grade. */
const ADMIN = { id: 'u_admin', email: 'admin@example.com', positions: ['org_owner'], isPlatformAdmin: true };

/** The other flags five of the six inputs are gated on, all on, so `cloudManaged` alone decides. */
const OTHER_FLAGS = { organization: true, admin: true };

const SIX: ReadonlyArray<[string, { actions?: unknown }, string]> = [
  ['sys_user.invite_user', SysUser, 'invite_user'],
  ['sys_member.invite_user', SysMember, 'invite_user'],
  ['sys_invitation.invite_user', SysInvitation, 'invite_user'],
  ['sys_organization.invite_user', SysOrganization, 'invite_user'],
  ['sys_user.create_user', SysUser, 'create_user'],
  ['sys_user.set_user_password', SysUser, 'set_user_password'],
];

function visibleOf(def: { actions?: unknown }, name: string): string {
  const action = ((def.actions ?? []) as Array<Record<string, unknown>>).find((a) => a.name === name);
  if (!action) throw new Error(`no action ${name}`);
  const raw = action.visible;
  const source = typeof raw === 'string' ? raw : (raw as { source?: unknown } | undefined)?.source;
  if (typeof source !== 'string') throw new Error(`action ${name} has no CEL source`);
  return source;
}

/** The verdict, or the fault spelled out so a faulting predicate fails loudly. */
function offered(source: string, features: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record: {}, extra: { current_user: ADMIN, user: ADMIN, ctx: { user: ADMIN }, features } },
  );
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

describe('features.cloudManaged hides the six doors that add people', () => {
  it.each(SIX)('%s is hidden while the environment is cloud-managed', (_site, def, name) => {
    expect(offered(visibleOf(def, name), { ...OTHER_FLAGS, cloudManaged: true })).toBe(false);
  });

  it.each(SIX)('%s is offered as before when the flag is off', (_site, def, name) => {
    expect(offered(visibleOf(def, name), { ...OTHER_FLAGS, cloudManaged: false })).toBe(true);
  });

  /** The five that carry another flag; `set_user_password` carries only `cloudManaged`. */
  const GATED_TWICE = SIX.filter(([site]) => site !== 'sys_user.set_user_password');

  it.each(GATED_TWICE)('%s keeps its other flag: off hides it whatever cloudManaged says', (_site, def, name) => {
    expect(offered(visibleOf(def, name), { organization: false, admin: false, cloudManaged: false })).toBe(false);
  });

  it('sys_user.set_user_password reads no other flag: offered with the admin plugin off, hidden managed', () => {
    const source = visibleOf(SysUser, 'set_user_password');
    expect(offered(source, { organization: false, admin: false, cloudManaged: false })).toBe(true);
    expect(offered(source, { organization: false, admin: false, cloudManaged: true })).toBe(false);
  });
});

/**
 * `sys_invitation.resend_invitation` is not a door that adds a person, so it
 * is not among the six above, but it rides the same door: a resend IS a call
 * to invite-member, which a cloud-managed environment refuses (`409
 * RESOURCE_CONFLICT`, resends included). So it carries the same gate as the
 * invite mirrors: hidden while managed, offered as before on a pending row
 * (unexpired or past its `expires_at`) when the flag is off.
 */
describe('features.cloudManaged hides Resend Invitation, whose door it refuses', () => {
  const resendOffered = (record: Record<string, unknown>, features: Record<string, unknown>): boolean | string => {
    const r = celEngine.evaluate(
      { dialect: 'cel', source: visibleOf(SysInvitation, 'resend_invitation') },
      { record, extra: { current_user: ADMIN, user: ADMIN, ctx: { user: ADMIN }, features } },
    );
    if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
    return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
  };
  const DAY_MS = 24 * 60 * 60 * 1000;
  const ROWS: ReadonlyArray<[string, Record<string, unknown>]> = [
    ['an unexpired pending row', { id: 'inv_1', status: 'pending', email: 'b@example.com', role: 'member', expires_at: new Date(Date.now() + DAY_MS).toISOString() }],
    ['a pending row past its expires_at', { id: 'inv_1', status: 'pending', email: 'b@example.com', role: 'member', expires_at: new Date(Date.now() - DAY_MS).toISOString() }],
  ];

  it.each(ROWS)('is hidden on %s while the environment is cloud-managed', (_row, record) => {
    expect(resendOffered(record, { ...OTHER_FLAGS, cloudManaged: true })).toBe(false);
  });

  it.each(ROWS)('is offered on %s as before when the flag is off', (_row, record) => {
    expect(resendOffered(record, { ...OTHER_FLAGS, cloudManaged: false })).toBe(true);
  });

  it('keeps its organization gate: off hides it whatever cloudManaged says', () => {
    expect(resendOffered(ROWS[0][1], { organization: false, admin: true, cloudManaged: false })).toBe(false);
  });
});

/**
 * The managed counterparts (cloud#4465 child 1b): `add_sso_user` and
 * `import_sso_users` add a PENDING person through plugin-auth's
 * `admin/add-sso-user` / `admin/import-sso-users`, which answer only on a
 * cloud-managed environment (`409 RESOURCE_CONFLICT` elsewhere) and only to a
 * platform administrator. So each is offered exactly there: the flag on AND
 * the standing; hidden off a managed environment, hidden while the console
 * holds no served flag (a `false`, never a fault), and hidden from every
 * caller below the rung, the organization owner included.
 */
const MANAGED_ADD: ReadonlyArray<[string, string, string]> = [
  ['sys_user.add_sso_user', 'add_sso_user', '/api/v1/auth/admin/add-sso-user'],
  ['sys_user.import_sso_users', 'import_sso_users', '/api/v1/auth/admin/import-sso-users'],
];

/** An organization owner: every grade the invitation mirrors ask for, without the platform-admin rung. */
const ORG_OWNER = { id: 'u_owner', email: 'owner@example.com', positions: ['org_owner'], isPlatformAdmin: false };

function offeredTo(subject: typeof ADMIN, source: string, features: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record: {}, extra: { current_user: subject, user: subject, ctx: { user: subject }, features } },
  );
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

function declared(name: string): Record<string, unknown> {
  const action = ((SysUser.actions ?? []) as Array<Record<string, unknown>>).find((a) => a.name === name);
  if (!action) throw new Error(`no action ${name}`);
  return action;
}

describe('features.cloudManaged offers the two doors that add a pending person', () => {
  it.each(MANAGED_ADD)('%s targets its pending-person door and declares no admin-plugin gate', (_site, name, target) => {
    const action = declared(name);
    expect(action.type).toBe('api');
    expect(action.target).toBe(target);
    // The doors mount with or without the better-auth admin plugin (#33227), so
    // an `admin` gate would hide them on the Free and Team kernels they serve.
    expect(action.requiresFeature).toBeUndefined();
  });

  it.each(MANAGED_ADD)('%s is offered to the platform admin while the environment is cloud-managed', (_site, name) => {
    expect(offeredTo(ADMIN, visibleOf(SysUser, name), { ...OTHER_FLAGS, cloudManaged: true })).toBe(true);
  });

  it.each(MANAGED_ADD)('%s is hidden when the flag is off: its door answers 409 there', (_site, name) => {
    expect(offeredTo(ADMIN, visibleOf(SysUser, name), { ...OTHER_FLAGS, cloudManaged: false })).toBe(false);
  });

  it.each(MANAGED_ADD)('%s is hidden, not faulted, while no flag is served', (_site, name) => {
    expect(offeredTo(ADMIN, visibleOf(SysUser, name), { ...OTHER_FLAGS })).toBe(false);
  });

  it.each(MANAGED_ADD)('%s is hidden from an organization owner below the platform-admin rung, even when managed', (_site, name) => {
    expect(offeredTo(ORG_OWNER, visibleOf(SysUser, name), { ...OTHER_FLAGS, cloudManaged: true })).toBe(false);
  });

  it('on a managed environment the platform admin is offered the two pending-person doors and none of the six', () => {
    const managed = { ...OTHER_FLAGS, cloudManaged: true };
    const offeredSites = [...SIX.map(([site, def, name]) => [site, def, name] as const), ...MANAGED_ADD.map(([site, name]) => [site, SysUser, name] as const)]
      .filter(([, def, name]) => offeredTo(ADMIN, visibleOf(def, name), managed) === true)
      .map(([site]) => site);
    expect(offeredSites).toEqual(['sys_user.add_sso_user', 'sys_user.import_sso_users']);
  });

  it('off a managed environment the platform admin is offered the six as before and neither pending-person door', () => {
    const unmanaged = { ...OTHER_FLAGS, cloudManaged: false };
    const offeredSites = [...SIX.map(([site, def, name]) => [site, def, name] as const), ...MANAGED_ADD.map(([site, name]) => [site, SysUser, name] as const)]
      .filter(([, def, name]) => offeredTo(ADMIN, visibleOf(def, name), unmanaged) === true)
      .map(([site]) => site);
    expect(offeredSites).toEqual(SIX.map(([site]) => site));
  });
});

/**
 * Membership and roles on a cloud-managed environment are managed by the
 * organisation that hosts it, so the three row actions that change them are
 * hidden while the flag is on: Change Role and Make Owner (both call
 * update-member-role) and Remove Member (remove-member), each of whose doors
 * refuses there. Each is offered as before when the flag is off. Add Member
 * stays offered to a platform administrator on a managed environment: its
 * door is the one left open, to restore a membership the environment lost.
 */
describe('features.cloudManaged hides the row actions that change a membership or its role', () => {
  const MEMBER_ROW = { id: 'mem_1', user_id: 'u_member', organization_id: 'org_1', role: 'member' };
  const THREE: ReadonlyArray<[string]> = [['update_member_role'], ['remove_member'], ['transfer_ownership']];

  const rowOffered = (name: string, features: Record<string, unknown>): boolean | string => {
    const r = celEngine.evaluate(
      { dialect: 'cel', source: visibleOf(SysMember, name) },
      { record: MEMBER_ROW, extra: { current_user: ADMIN, user: ADMIN, ctx: { user: ADMIN }, features } },
    );
    if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
    return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
  };

  it.each(THREE)('sys_member.%s is hidden while the environment is cloud-managed', (name) => {
    expect(rowOffered(name, { ...OTHER_FLAGS, cloudManaged: true })).toBe(false);
  });

  it.each(THREE)('sys_member.%s is offered to the owner as before when the flag is off', (name) => {
    expect(rowOffered(name, { ...OTHER_FLAGS, cloudManaged: false })).toBe(true);
  });

  it.each(THREE)('sys_member.%s keeps its organization gate: off hides it whatever cloudManaged says', (name) => {
    expect(rowOffered(name, { organization: false, admin: true, cloudManaged: false })).toBe(false);
  });

  it('sys_member.add_member stays offered to a platform administrator while the environment is cloud-managed', () => {
    expect(rowOffered('add_member', { ...OTHER_FLAGS, cloudManaged: true })).toBe(true);
  });
});

/**
 * The rest of the membership census: every other action whose door writes or
 * deletes a membership row is hidden while the flag is on, each offered as
 * before when it is off. Leave Organization ends the caller's membership,
 * Create Organization makes the caller an owner, Delete Organization ends
 * every membership of the organization, and Accept Invitation creates one.
 * Decline Invitation writes no membership, so it is not gated.
 */
describe('features.cloudManaged hides every other action whose door writes or deletes a membership row', () => {
  const ORG_ROW = { id: 'org_1', name: 'Org', slug: 'org' };
  const INVITATION_ROW = { id: 'inv_1', email: ADMIN.email, status: 'pending', role: 'member', organization_id: 'org_1' };
  const MULTI = { ...OTHER_FLAGS, multiOrgEnabled: true };
  const FOUR: ReadonlyArray<[string, { actions?: unknown }, string, Record<string, unknown>]> = [
    ['sys_organization.leave_organization', SysOrganization, 'leave_organization', ORG_ROW],
    ['sys_organization.create_organization', SysOrganization, 'create_organization', {}],
    ['sys_organization.delete_organization', SysOrganization, 'delete_organization', ORG_ROW],
    ['sys_invitation.accept_invitation', SysInvitation, 'accept_invitation', INVITATION_ROW],
  ];

  const offeredOn = (def: { actions?: unknown }, name: string, record: Record<string, unknown>, features: Record<string, unknown>): boolean | string => {
    const r = celEngine.evaluate(
      { dialect: 'cel', source: visibleOf(def, name) },
      { record, extra: { current_user: ADMIN, user: ADMIN, ctx: { user: ADMIN }, features } },
    );
    if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
    return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
  };

  it.each(FOUR)('%s is hidden while the environment is cloud-managed', (_site, def, name, record) => {
    expect(offeredOn(def, name, record, { ...MULTI, cloudManaged: true })).toBe(false);
  });

  it.each(FOUR)('%s is offered as before when the flag is off', (_site, def, name, record) => {
    expect(offeredOn(def, name, record, { ...MULTI, cloudManaged: false })).toBe(true);
  });

  // Each keeps its other gate: the three organization actions their
  // `multiOrgEnabled` gate, Accept Invitation its pending-row predicate.
  const OTHER_GATE_OFF: ReadonlyArray<[string, { actions?: unknown }, string, Record<string, unknown>, Record<string, unknown>]> = [
    ['sys_organization.leave_organization', SysOrganization, 'leave_organization', ORG_ROW, { ...OTHER_FLAGS, multiOrgEnabled: false, cloudManaged: false }],
    ['sys_organization.create_organization', SysOrganization, 'create_organization', {}, { ...OTHER_FLAGS, multiOrgEnabled: false, cloudManaged: false }],
    ['sys_organization.delete_organization', SysOrganization, 'delete_organization', ORG_ROW, { ...OTHER_FLAGS, multiOrgEnabled: false, cloudManaged: false }],
    ['sys_invitation.accept_invitation', SysInvitation, 'accept_invitation', { ...INVITATION_ROW, status: 'accepted' }, { ...MULTI, cloudManaged: false }],
  ];

  it.each(OTHER_GATE_OFF)('%s keeps its other gate: closed, it hides the action whatever cloudManaged says', (_site, def, name, record, features) => {
    expect(offeredOn(def, name, record, features)).toBe(false);
  });

  it('sys_invitation.reject_invitation, which writes no membership, stays offered while the environment is cloud-managed', () => {
    expect(offeredOn(SysInvitation, 'reject_invitation', INVITATION_ROW, { ...MULTI, cloudManaged: true })).toBe(true);
  });
});

/**
 * objectstack#33187: the import door answers one report row per CSV line
 * (plugin-auth `ImportSsoUserRowResult`: `row`, `email`, `ok`,
 * `alreadyPending`, `host`, `error`, `notApplied`, `managerError`), and the
 * result dialog draws that report as a `table`, one cell per member a reader
 * needs, instead of a block of JSON. The columns are the contract's
 * (`resultDialog.fields[].columns`), so the declaration parses as the
 * console's `ResultField` reads it.
 */
describe('import_sso_users draws the per-row report as a table', () => {
  const rowsField = () => {
    const dialog = declared('import_sso_users').resultDialog as { fields?: Array<Record<string, unknown>> };
    return (dialog.fields ?? []).find((field) => field.path === 'rows');
  };

  it('declares `rows` as a `table` whose columns read the door row members, in reading order', () => {
    const field = rowsField();
    expect(field?.format).toBe('table');
    expect((field?.columns as Array<{ path: string }>).map((column) => column.path)).toEqual([
      'row',
      'email',
      'ok',
      'alreadyPending',
      'host.notified',
      'host.reason',
      'error.message',
      'notApplied',
      'managerError',
    ]);
  });

  it('CONTROL: the summary counts stay fields of their own, ahead of the table', () => {
    const dialog = declared('import_sso_users').resultDialog as { fields?: Array<{ path: string; format?: string }> };
    expect(dialog.fields?.map((field) => [field.path, field.format])).toEqual([
      ['summary.added', 'text'],
      ['summary.alreadyPending', 'text'],
      ['summary.failed', 'text'],
      ['rows', 'table'],
    ]);
  });
});
