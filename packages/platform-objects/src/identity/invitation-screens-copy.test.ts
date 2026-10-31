// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27521 — the metadata half of the Invitations screens (rows 7, 8 and 9 of
// the 18.3.0 RC walkthrough):
//
//  - row 7: `sys_invitation.status` options carry display labels, read from a
//    map keyed by the spec enum, instead of the raw lowercase values;
//  - row 8: every picker that grants a membership role explains each role in
//    one shared help text, and Change Role names the member it changes;
//  - row 9: Resend Invitation is a confirmation, not an editable form: its
//    email and role are carried over from the row, and every list of
//    invitations projects both;
//  - the translated bundles carry a translation of every new leaf, never the
//    English source `--fill=default` seeds a new key with.

import { describe, expect, it } from 'vitest';
import { BUILTIN_MEMBERSHIP_ROLE_OPTIONS, InvitationStatus } from '@objectstack/spec/identity';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { MEMBERSHIP_ROLE_PARAM_HELP } from './membership-role-help.js';
import { SysInvitation } from './sys-invitation.object.js';
import { SysMember } from './sys-member.object.js';
import { SysOrganization } from './sys-organization.object.js';
import { SysUser } from './sys-user.object.js';
import { templateSlotSource } from '@objectstack/spec/automation';

// [#27948] An action's `description`, each param's `helpText` and each
// `outcomeMessages` entry are `template` slots: the parsed object carries the
// `{ dialect: 'template', source }` envelope, so the copy is read as written
// through the template judge's one reader, `templateSlotSource` (a locale map
// is kept as it is).
function copyAsWritten<T>(declared: T): T {
  const a = declared as Record<string, any> | undefined;
  if (!a) return declared;
  const text = (v: unknown) => templateSlotSource(v) ?? v;
  return {
    ...a,
    ...(a.description !== undefined ? { description: text(a.description) } : {}),
    ...(Array.isArray(a.params)
      ? { params: a.params.map((p: any) => (p && p.helpText !== undefined ? { ...p, helpText: text(p.helpText) } : p)) }
      : {}),
    ...(a.outcomeMessages && typeof a.outcomeMessages === 'object'
      ? { outcomeMessages: Object.fromEntries(Object.entries(a.outcomeMessages).map(([k, v]) => [k, text(v)])) }
      : {}),
  } as T;
}


type Action = Record<string, any>;
type Param = Record<string, any>;

function action(object: unknown, name: string): Action {
  const found = copyAsWritten(((object as { actions?: Action[] }).actions ?? []).find((a) => a.name === name));
  if (!found) throw new Error(`no action ${name}`);
  return found;
}

function param(declared: Action, name: string): Param {
  const found = ((declared.params ?? []) as Param[]).find((p) => (p.field ?? p.name) === name);
  if (!found) throw new Error(`no param ${name} on ${declared.name}`);
  return found;
}

/** Every role picker that grants a membership role, as `[object, action, declaration]`. */
const ROLE_PICKERS: Array<[string, string, unknown]> = [
  ['sys_user', 'invite_user', SysUser],
  ['sys_member', 'invite_user', SysMember],
  ['sys_invitation', 'invite_user', SysInvitation],
  ['sys_organization', 'invite_user', SysOrganization],
  ['sys_member', 'add_member', SysMember],
  ['sys_member', 'update_member_role', SysMember],
];

const TRANSLATED = [
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

const bundleObject = (bundle: unknown, object: string): Record<string, any> | undefined =>
  (bundle as Record<string, Record<string, any>>)?.[object];

describe('row 7 — invitation status options are labelled', () => {
  const options = (SysInvitation as any).fields.status.options as Array<{ value: string; label: string }>;

  it('labels every value of the spec enum, in its order', () => {
    expect(options.map((o) => o.value)).toEqual([...InvitationStatus.options]);
    for (const option of options) {
      expect(option.label, option.value).not.toBe(option.value);
      expect(option.label[0], option.value).toBe(option.label[0].toUpperCase());
    }
  });

  it('reads `rejected` as "Declined", the invitee\'s own action', () => {
    expect(options.find((o) => o.value === 'rejected')?.label).toBe('Declined');
  });

  it('serves the labels in the English bundle', () => {
    const en = bundleObject(enObjects, 'sys_invitation')?.fields?.status?.options;
    expect(en).toEqual(Object.fromEntries(options.map((o) => [o.value, o.label])));
  });
});

describe('row 8 — one role help text, a line per role', () => {
  it('has one line per membership role, labelled and ordered as the options are', () => {
    const lines = MEMBERSHIP_ROLE_PARAM_HELP.split('\n');
    expect(lines.map((line) => line.split(': ')[0])).toEqual(BUILTIN_MEMBERSHIP_ROLE_OPTIONS.map((o) => o.label));
    for (const line of lines) expect(line.split(': ')[1]?.length, line).toBeGreaterThan(10);
  });

  it.each(ROLE_PICKERS)('%s.%s declares it on its role param', (_object, name, declaration) => {
    expect(param(action(declaration, name), 'role').helpText).toBe(MEMBERSHIP_ROLE_PARAM_HELP);
  });

  it('Change Role names the member it changes, with a fallback for a row without the user', () => {
    const changeRole = action(SysMember, 'update_member_role');
    // The whole sentence, not just its hole: the console's pin
    // (`ActionParamDialog.invitationScreens-27521.test.tsx`) runs this exact
    // text through a real `ActionRunner`, and reads "this member" for a row
    // that does not expand `user_id`. A reworded declaration reds here first.
    // Written with `{{ }}` since #27948: the `default` formatter reads "this
    // member" for a row that does not expand `user_id`.
    expect(changeRole.description).toBe("Choose the new organization role for {{ record.user_id.name | default:'this member' }}.");
    expect(changeRole.confirmText).toBeUndefined();
  });
});

describe('row 9 — Resend Invitation is a confirmation', () => {
  const resend = action(SysInvitation, 'resend_invitation');

  it('asks its question in `description`, naming the invitee', () => {
    expect(resend.description).toContain('{{ record.email }}');
    // The spec refuses `confirmText` beside `params` on a registered action.
    expect(resend.confirmText).toBeUndefined();
  });

  it.each(['email', 'role'])('carries %s over from the row, unchanged', (name) => {
    expect(param(resend, name)).toMatchObject({ required: true, defaultFromRow: true, carryOver: true });
  });

  it.each(Object.keys((SysInvitation as any).listViews))(
    'the %s list projects both carried-over columns, so its rows can resend',
    (view) => {
      const columns = ((SysInvitation as any).listViews[view].columns as Array<string | { field: string }>)
        .map((c) => (typeof c === 'string' ? c : c.field));
      expect(columns).toEqual(expect.arrayContaining(['email', 'role']));
    },
  );
});

describe('the new copy in the translated bundles', () => {
  const leaves = (bundle: unknown): Array<[string, unknown]> => [
    ...ROLE_PICKERS.map(([object, name]): [string, unknown] => [
      `${object}.${name}.params.role.helpText`,
      bundleObject(bundle, object)?._actions?.[name]?.params?.role?.helpText,
    ]),
    ['sys_invitation.resend_invitation.description', bundleObject(bundle, 'sys_invitation')?._actions?.resend_invitation?.description],
    ['sys_member.update_member_role.description', bundleObject(bundle, 'sys_member')?._actions?.update_member_role?.description],
  ];

  const english = new Map(leaves(enObjects));

  it.each(TRANSLATED)('%s translates every new leaf', (_locale, bundle) => {
    for (const [path, value] of leaves(bundle)) {
      expect(typeof value, path).toBe('string');
      expect(value, path).not.toBe(english.get(path));
    }
  });

  it.each(TRANSLATED)('%s keeps the holes the console fills', (_locale, bundle) => {
    const byPath = new Map(leaves(bundle));
    expect(byPath.get('sys_invitation.resend_invitation.description')).toContain('{{ record.email }}');
    expect(byPath.get('sys_member.update_member_role.description')).toMatch(/\{\{ record\.user_id\.name \| default:'[^']+' \}\}/);
  });

  it.each(TRANSLATED)('%s keeps one help line per role', (_locale, bundle) => {
    const help = bundleObject(bundle, 'sys_member')?._actions?.add_member?.params?.role?.helpText as string;
    expect(help.split('\n')).toHaveLength(BUILTIN_MEMBERSHIP_ROLE_OPTIONS.length);
  });
});
