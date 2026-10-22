// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cloud-managed environment (`features.cloudManaged`, the hide-when-on flag
 * of `PUBLIC_AUTH_FEATURES`) takes the console's doors for adding people away:
 * its people arrive from the organisation's identity provider. Six actions are
 * hidden while the flag is on — the four `invite_user` mirrors, `create_user`
 * and `set_user_password` — and each is offered as before when the flag is
 * off (ruling 6341690661 on #25083, Q3 A and Q4 A).
 *
 * Not pinned here: a payload that omits the flag. plugin-auth's drift guard
 * holds the served boolean key set stable, and this engine faults on ANY
 * flag the payload lacks (`default-on` ones too), so that case is the
 * consumer's fault handling, the same for every flag.
 *
 * Each of the six already carries another flag's gate (`organization` or
 * `admin`) through `requiresFeature`, so the `cloudManaged` gate is written in
 * `visible` and the two compose. The predicates are EVALUATED through the
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

/** The other flags the six inputs are gated on, all on, so `cloudManaged` alone decides. */
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

  it.each(SIX)('%s keeps its other flag: off hides it whatever cloudManaged says', (_site, def, name) => {
    expect(offered(visibleOf(def, name), { organization: false, admin: false, cloudManaged: false })).toBe(false);
  });
});
