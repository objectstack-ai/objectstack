// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #11544 — the email-invite entry was UNREACHABLE from where admins actually
// look. The org record page (ADR-0081) opens on tab-0 **Members**
// (`sys_member`), whose toolbar carried exactly one action — `add_member`,
// which attaches an ALREADY-REGISTERED user by id. `invite_user` lived only on
// tab-1 Invitations. The maintainer, looking to "invite a teammate by email",
// landed on Members and concluded the product had no invite entry at all.
//
// Two halves are pinned here, because the fix has two failure modes and they
// fail in opposite directions:
//
//  1. **Reachability + mirror parity.** `invite_user` is now declared on three
//     objects (sys_user, sys_invitation, sys_member). Three copies of one
//     endpoint is exactly the shape that drifts, so the copies are compared to
//     EACH OTHER rather than to hand-copied literals.
//  2. **Param resolvability — the trap this card walked into.** A field-backed
//     action param inherits its type / options / label from a field on the
//     action's parent object, or on `objectOverride` when it names another.
//     `sys_member` has no `email` field, so the sys_invitation copy could NOT
//     be mirrored verbatim: objectui's `resolveActionParam` answers an
//     unresolvable field-backed param with a `type: 'text'` fallback labelled
//     by the raw field name. Nothing throws, nothing goes red, and the dialog
//     still submits — the ADR-0078 valid-but-inert class. So the pin is
//     generic: EVERY field-backed param of EVERY mirror must name a field that
//     really exists on the object it resolves against.
import { describe, expect, it } from 'vitest';
import { SysInvitation } from './sys-invitation.object.js';
import { SysMember } from './sys-member.object.js';
import { SysUser } from './sys-user.object.js';

const INVITE_ENDPOINT = '/api/v1/auth/organization/invite-member';

/** The objects a param's `objectOverride` may resolve against, by name. */
const OBJECTS_BY_NAME: Record<string, unknown> = {
  sys_user: SysUser,
  sys_member: SysMember,
  sys_invitation: SysInvitation,
};

interface AnyAction {
  name?: string;
  label?: string;
  icon?: string;
  variant?: string;
  type?: string;
  target?: string;
  locations?: string[];
  visible?: { source?: string };
  params?: Array<{ name?: string; field?: string; objectOverride?: string; required?: boolean }>;
}

/** Named action on an object, asserted present. */
function action(object: unknown, name: string): AnyAction {
  const found = (((object as { actions?: AnyAction[] }).actions) ?? []).find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return found as AnyAction;
}

/** Declared `list_toolbar` actions, in declaration order. */
function toolbarActions(object: unknown): AnyAction[] {
  return (((object as { actions?: AnyAction[] }).actions) ?? [])
    .filter((a) => (a.locations ?? []).includes('list_toolbar'));
}

/** The three declaration sites of `invite_user`, as [label, object] rows. */
const MIRRORS: Array<[string, unknown]> = [
  ['sys_user', SysUser],
  ['sys_invitation', SysInvitation],
  ['sys_member', SysMember],
];

describe('invite_user — reachable from the default Members tab (#11544)', () => {
  it('is declared on sys_member, in the toolbar the Members tab renders', () => {
    // The regression itself: the whole defect was this action's ABSENCE from
    // this one object. `list_toolbar` is what the org record page's
    // `record:related_list` over sys_member surfaces as header buttons
    // (objectui `RelatedRecordActionsBridge.deriveActions` → `RelatedList`).
    const invite = action(SysMember, 'invite_user');
    expect(invite.locations).toContain('list_toolbar');
    expect(invite.type).toBe('api');
    expect(invite.target).toBe(INVITE_ENDPOINT);
  });

  it('renders before add_member — declaration order IS render order', () => {
    // The bridge filters the child object's actions in array order and the
    // related list maps them in that order, so "which button is leftmost" is
    // decided here and nowhere else. A later reader appending the mirror to
    // the end of the array would restore the defect's visual half while every
    // other assertion in this file stayed green.
    const names = toolbarActions(SysMember).map((a) => a.name);
    expect(names).toContain('invite_user');
    expect(names).toContain('add_member');
    expect(names.indexOf('invite_user')).toBeLessThan(names.indexOf('add_member'));
  });

  it('is the ONE primary button on the Members toolbar', () => {
    // The other half of the defect: two `variant: 'primary'` + `user-plus`
    // buttons side by side read as one affordance duplicated, not as two
    // different flows. objectui's `RelatedToolbarButton` draws `primary` as a
    // FILLED button and every other variant as an `outline` one, so this
    // assertion is about pixels an admin really sees, not about a key nobody
    // reads.
    const primaries = toolbarActions(SysMember).filter((a) => a.variant === 'primary');
    expect(primaries.map((a) => a.name)).toEqual(['invite_user']);
  });

  it('does not share its icon with add_member', () => {
    // Icon and variant are pinned separately on purpose: either one alone
    // still leaves two buttons a glance cannot tell apart.
    const invite = action(SysMember, 'invite_user');
    const add = action(SysMember, 'add_member');
    expect(invite.icon).toBe('user-plus');
    expect(add.icon).not.toBe(invite.icon);
    expect(add.variant).not.toBe('primary');
  });

  it('leaves add_member itself intact — still the attach-an-existing-user flow', () => {
    // Differentiating the chrome must not have touched the behaviour. The two
    // buttons are only worth distinguishing because they really do different
    // things: one mails an invitation, one binds an existing account.
    const add = action(SysMember, 'add_member');
    expect(add.target).toBe('/api/v1/auth/organization/add-member');
    expect((add.params ?? []).map((p) => p.name ?? p.field)).toContain('userId');
  });
});

describe('invite_user — the three mirrors agree (#11544)', () => {
  it.each(MIRRORS)('%s dispatches the same endpoint from the same location', (_name, object) => {
    const invite = action(object, 'invite_user');
    expect(invite.type).toBe('api');
    expect(invite.target).toBe(INVITE_ENDPOINT);
    expect(invite.locations).toContain('list_toolbar');
  });

  it.each(MIRRORS)('%s carries the same lowered `organization` capability gate', (_name, object) => {
    // `requiresFeature: 'organization'` is authoring sugar — it is lowered to a
    // CEL predicate at ObjectSchema.create time and the sugar key does not
    // survive (pinned in platform-objects.test.ts), so the gate is read from
    // its lowered form. A mirror that lost the gate would render a button that
    // 404s wherever the org capability is off.
    expect(action(object, 'invite_user').visible?.source).toBe('features.organization != false');
  });

  it.each(MIRRORS)('%s asks for the same two inputs, email and role', (_name, object) => {
    const keys = (action(object, 'invite_user').params ?? []).map((p) => p.name ?? p.field);
    expect(keys).toEqual(['email', 'role']);
  });

  it.each(MIRRORS)('%s requires both of them', (_name, object) => {
    // The endpoint has no default for either; an optional param here is a
    // dialog that submits an incomplete body and answers with a server error.
    for (const p of action(object, 'invite_user').params ?? []) {
      expect(p.required, `${String(p.field ?? p.name)} is required`).toBe(true);
    }
  });
});

describe('invite_user — every field-backed param resolves to a real field (#11544)', () => {
  // THE load-bearing pin. Stated over all three mirrors rather than over the
  // one that was wrong, because the defect is a property of the DECLARATION
  // SHAPE, not of sys_member: any future mirror of any action that copies a
  // `{ field }` param onto an object that lacks that field lands here.
  it.each(MIRRORS)('%s', (name, object) => {
    const params = action(object, 'invite_user').params ?? [];
    expect(params.length).toBeGreaterThan(0);
    for (const p of params) {
      if (!p.field) continue; // inline param — nothing to resolve
      const ownerName = p.objectOverride ?? name;
      const owner = OBJECTS_BY_NAME[ownerName];
      expect(owner, `${ownerName} is a known object`).toBeDefined();
      const fields = (owner as { fields?: Record<string, unknown> }).fields ?? {};
      expect(
        Object.prototype.hasOwnProperty.call(fields, p.field),
        `${name}.invite_user param "${p.field}" resolves against ${ownerName}`,
      ).toBe(true);
    }
  });

  it('sys_member reaches sys_invitation for `email`, and its OWN field for `role`', () => {
    // Spelled out as its own case because it is the asymmetry a reader will
    // want to delete: sys_member declares `role` (from the same
    // BUILTIN_MEMBERSHIP_ROLE_OPTIONS constant sys_invitation reads) but has
    // no `email` column at all, so exactly one of the two params needs the
    // override. Dropping it is silent — see this file's header.
    const [email, role] = action(SysMember, 'invite_user').params ?? [];
    expect(email.field).toBe('email');
    expect(email.objectOverride).toBe('sys_invitation');
    expect(role.field).toBe('role');
    expect(role.objectOverride).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(SysMember.fields ?? {}, 'email')).toBe(false);
  });
});
