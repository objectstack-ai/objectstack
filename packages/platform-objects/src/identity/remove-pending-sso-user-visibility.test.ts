// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Users' Remove Pending User (`sys_user.remove_sso_user`) takes back a
 * person added on a cloud-managed environment who has not signed in yet, and
 * so cancels their invitation. Its door, plugin-auth's
 * `admin/remove-sso-user`, answers only a platform administrator, only on a
 * cloud-managed environment, and only for a row that is still pending
 * (`source == 'idp_pending'`). So the row action is offered exactly there:
 * pending row AND managed flag on AND the platform-admin standing. Each
 * CONTROL drops one of the three and the action is hidden, never faulted.
 *
 * The predicate is EVALUATED through the canonical engine the console
 * delegates to (`@objectstack/formula`) on the parsed object, as its sibling
 * `cloud-managed-visibility.test.ts` does for Add / Import.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { SysUser } from './sys-user.object.js';

const ADMIN = { id: 'u_admin', email: 'admin@example.com', positions: ['org_owner'], isPlatformAdmin: true };
/** Every grade below the rung: the organization owner. */
const ORG_OWNER = { id: 'u_owner', email: 'owner@example.com', positions: ['org_owner'], isPlatformAdmin: false };

const MANAGED = { organization: true, admin: true, cloudManaged: true };
const PENDING_ROW = { id: 'usr_pending', email: 'typo@example.com', source: 'idp_pending' };

function declared(): Record<string, unknown> {
  const action = ((SysUser.actions ?? []) as Array<Record<string, unknown>>).find((a) => a.name === 'remove_sso_user');
  if (!action) throw new Error('sys_user declares no action named "remove_sso_user"');
  return action;
}

function visibleSource(): string {
  const raw = declared().visible;
  const source = typeof raw === 'string' ? raw : (raw as { source?: unknown } | undefined)?.source;
  if (typeof source !== 'string') throw new Error('remove_sso_user has no CEL source');
  return source;
}

/** The verdict, or the fault spelled out so a faulting predicate fails loudly. */
function offered(subject: typeof ADMIN, record: Record<string, unknown>, features: Record<string, unknown>): boolean | string {
  const r = celEngine.evaluate(
    { dialect: 'cel', source: visibleSource() },
    { record, extra: { current_user: subject, user: subject, ctx: { user: subject }, features } },
  );
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

describe('Setup → Users offers Remove Pending User on a pending row, managed, to a platform admin only', () => {
  it('is a row action that posts the row id to the remove-sso-user door behind a confirmation', () => {
    const action = declared();
    expect(action.type).toBe('api');
    expect(action.target).toBe('/api/v1/auth/admin/remove-sso-user');
    expect(action.recordIdParam).toBe('userId');
    expect(action.locations).toEqual(['list_item', 'record_header']);
    // A confirmation is asked first (the parsed template, whatever its words).
    expect((action.confirmText as { source?: unknown } | undefined)?.source).toEqual(expect.any(String));
    // The door mounts with or without the better-auth admin plugin, as Add / Import do.
    expect(action.requiresFeature).toBeUndefined();
    // No params: the door's body is the closed key set `{ userId }`.
    expect(action.params ?? []).toEqual([]);
  });

  it('is offered to the platform admin on a pending row while the environment is cloud-managed', () => {
    expect(offered(ADMIN, PENDING_ROW, MANAGED)).toBe(true);
  });

  it.each([
    ['a person who has signed in (idp_provisioned)', { ...PENDING_ROW, source: 'idp_provisioned' }],
    ['a local account (env_native)', { ...PENDING_ROW, source: 'env_native' }],
    ['a row the console did not project source for', { id: 'usr_pending', email: 'typo@example.com' }],
  ])('CONTROL: is hidden on %s', (_row, record) => {
    expect(offered(ADMIN, record, MANAGED)).toBe(false);
  });

  it.each([
    ['the flag is off', { ...MANAGED, cloudManaged: false }],
    ['no flag is served', { organization: true, admin: true }],
  ])('CONTROL: is hidden on a pending row when %s', (_case, features) => {
    expect(offered(ADMIN, PENDING_ROW, features)).toBe(false);
  });

  it('CONTROL: is hidden from an organization owner below the platform-admin rung, on a pending managed row', () => {
    expect(offered(ORG_OWNER, PENDING_ROW, MANAGED)).toBe(false);
  });
});
