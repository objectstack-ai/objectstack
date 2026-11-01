// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #27843 (ruling E on #27797) — the metadata half of "an invite on a server
// that does not deliver mail":
//
//  - the four `invite_user` mirrors and `resend_invitation` declare
//    `outcomeMessages` for the delivery `outcome` invite-member answers
//    (plugin-auth `invitation-delivery-outcome.ts`), and the `link_only` copy
//    never says the invitation was sent;
//  - `sys_invitation.copy_invitation_link` is declared for plugin-auth's
//    handler (`invitation-link-action.ts`): a `script` action bound by
//    `target`, its answer shown in a copyable text result dialog, offered on a
//    pending row to the grades that reach invite-member and hidden while the
//    environment is cloud-managed;
//  - #28384: it is not offered on a row that still reads `pending` after its
//    `expires_at` has passed (the handler refuses it too, plugin-auth
//    `invitation-delivery-outcome.test.ts`), while Resend stays offered there;
//  - the translated bundles carry a translation of every new leaf, never the
//    English source `--fill=default` seeds a new key with.
//
// The `visible` predicate is EVALUATED through the canonical engine the
// console delegates to (`@objectstack/formula`) on the PARSED object, so the
// lowered `requiresFeature` / `requiresMembershipReach` envelope is what is
// judged (the shape `cloud-managed-visibility.test.ts` uses).

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { INVITE_USER_OUTCOME_MESSAGES, RESEND_INVITATION_OUTCOME_MESSAGES } from './invite-outcome-messages.js';
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

function action(object: unknown, name: string): Action {
  const found = ((object as { actions?: Action[] }).actions ?? []).find((a) => a.name === name);
  if (!found) throw new Error(`no action ${name}`);
  return copyAsWritten(found);
}

const MIRRORS: Array<[string, unknown]> = [
  ['sys_user', SysUser],
  ['sys_invitation', SysInvitation],
  ['sys_member', SysMember],
  ['sys_organization', SysOrganization],
];

const TRANSLATED = [
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

/** Any spelling of "sent" a `link_only` copy must not carry. */
const SAYS_SENT = /\b(re)?sent\b/i;

/** The `outcomeMessages` hole the copy reads the invitee's address through. */
const INVITEE = '{{ result.email }}';

const bundleAction = (bundle: unknown, object: string, name: string): Action | undefined =>
  (bundle as Record<string, { _actions?: Record<string, Action> }>)?.[object]?._actions?.[name];

describe('the invite actions answer by delivery outcome', () => {
  it.each(MIRRORS)('%s.invite_user declares the copy for both outcomes', (_name, object) => {
    expect(action(object, 'invite_user').outcomeMessages).toEqual(INVITE_USER_OUTCOME_MESSAGES);
  });

  it('sys_invitation.resend_invitation declares the copy for both outcomes', () => {
    expect(action(SysInvitation, 'resend_invitation').outcomeMessages).toEqual(RESEND_INVITATION_OUTCOME_MESSAGES);
  });

  it.each([
    ['invite_user', INVITE_USER_OUTCOME_MESSAGES],
    ['resend_invitation', RESEND_INVITATION_OUTCOME_MESSAGES],
  ] as const)('%s: the link_only copy never says sent; both name the invitee', (_name, copy) => {
    expect(copy.link_only).not.toMatch(SAYS_SENT);
    expect(copy.sent).toMatch(SAYS_SENT);
    expect(copy.sent).toContain(INVITEE);
    expect(copy.link_only).toContain(INVITEE);
  });

  it.each(MIRRORS)('%s.invite_user keeps its successMessage as the fallback', (_name, object) => {
    expect(action(object, 'invite_user').successMessage).toBeDefined();
  });
});

describe('sys_invitation.copy_invitation_link — the declaration', () => {
  const copy = action(SysInvitation, 'copy_invitation_link');

  it('is a script action bound to its handler by target, on the row menu and the record header', () => {
    expect(copy.type).toBe('script');
    expect(copy.target).toBe('copy_invitation_link');
    expect(copy.locations).toEqual(['list_item', 'record_header']);
  });

  it('shows the answer in a copyable text dialog, the acceptUrl field', () => {
    expect(copy.resultDialog.format).toBe('text');
    expect(copy.resultDialog.fields).toEqual([{ path: 'acceptUrl', label: 'Invite link' }]);
    expect(copy.resultDialog.acknowledge).toBeTruthy();
  });
});

// ── (d) the gates, evaluated ─────────────────────────────────────────────────

const user = (positions: string[]) => ({ id: 'u1', email: 'a@example.com', positions });
const OWNER = user(['org_owner']);
const ADMIN = user(['org_admin']);
const DELEGATE = user(['delegated_admin']);
const MEMBER = user(['org_member']);
const ON = { organization: true, cloudManaged: false };

function offered(
  record: Record<string, unknown>,
  current: unknown,
  features: Record<string, unknown>,
  name = 'copy_invitation_link',
): boolean | string {
  const raw = action(SysInvitation, name).visible;
  const source = typeof raw === 'string' ? raw : raw?.source;
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    { record, extra: { current_user: current, user: current, ctx: { user: current }, features } },
  );
  if (!r.ok) return `FAULT ${r.error.message.split('\n')[0].trim()}`;
  return typeof r.value === 'boolean' ? r.value : `NON-BOOLEAN ${JSON.stringify(r.value)}`;
}

/** ISO text a day from now, or a day ago: what a list row carries for a datetime. */
const DAY_MS = 24 * 60 * 60 * 1000;
const inADay = () => new Date(Date.now() + DAY_MS).toISOString();
const aDayAgo = () => new Date(Date.now() - DAY_MS).toISOString();

describe('sys_invitation.copy_invitation_link — who is offered it', () => {
  const pending = { id: 'inv_1', status: 'pending', expires_at: inADay() };

  it.each([
    ['owner', OWNER],
    ['admin', ADMIN],
    ['delegated_admin', DELEGATE],
  ])('is offered on a pending row to an %s', (_grade, current) => {
    expect(offered(pending, current, ON)).toBe(true);
  });

  it('is not offered to a plain member (outside the invite reach)', () => {
    expect(offered(pending, MEMBER, ON)).toBe(false);
  });

  it.each(['accepted', 'rejected', 'canceled', 'expired'])('is not offered on a %s row', (status) => {
    expect(offered({ id: 'inv_1', status }, OWNER, ON)).toBe(false);
  });

  it('is not offered on a row projected without its status (sparse list face)', () => {
    expect(offered({ id: 'inv_1' }, OWNER, ON)).toBe(false);
  });

  it('#28384 — is not offered on a row still pending after its expires_at', () => {
    expect(offered({ id: 'inv_1', status: 'pending', expires_at: aDayAgo() }, OWNER, ON)).toBe(false);
  });

  it('#28384 — is not offered on a pending row projected without, or holding no, expires_at', () => {
    expect(offered({ id: 'inv_1', status: 'pending' }, OWNER, ON)).toBe(false);
    expect(offered({ id: 'inv_1', status: 'pending', expires_at: null }, OWNER, ON)).toBe(false);
  });

  it('#28384 — Resend stays offered on a pending row past its expires_at: it is the remedy', () => {
    const expired = { id: 'inv_1', status: 'pending', expires_at: aDayAgo(), email: 'b@example.com', role: 'member' };
    expect(offered(expired, OWNER, ON, 'resend_invitation')).toBe(true);
  });

  it('is hidden while the environment is cloud-managed', () => {
    expect(offered(pending, OWNER, { organization: true, cloudManaged: true })).toBe(false);
  });

  it('is hidden when the organization capability is off', () => {
    expect(offered(pending, OWNER, { organization: false, cloudManaged: false })).toBe(false);
  });
});

describe('the new copy in the translated bundles', () => {
  const leaves = (bundle: unknown) => {
    const invite = (object: string) => bundleAction(bundle, object, 'invite_user')?.outcomeMessages;
    const resend = bundleAction(bundle, 'sys_invitation', 'resend_invitation')?.outcomeMessages;
    const copy = bundleAction(bundle, 'sys_invitation', 'copy_invitation_link');
    return [
      ...MIRRORS.flatMap(([name]) => [
        [`${name}.invite_user.outcomeMessages.sent`, invite(name)?.sent],
        [`${name}.invite_user.outcomeMessages.link_only`, invite(name)?.link_only],
      ]),
      ['resend_invitation.outcomeMessages.sent', resend?.sent],
      ['resend_invitation.outcomeMessages.link_only', resend?.link_only],
      ['copy_invitation_link.label', copy?.label],
      ['copy_invitation_link.resultDialog.title', copy?.resultDialog?.title],
      ['copy_invitation_link.resultDialog.description', copy?.resultDialog?.description],
      ['copy_invitation_link.resultDialog.acknowledge', copy?.resultDialog?.acknowledge],
      ['copy_invitation_link.resultDialog.fields.acceptUrl', copy?.resultDialog?.fields?.acceptUrl],
    ] as Array<[string, unknown]>;
  };
  const english = new Map(leaves(enObjects));

  it('en carries every new leaf', () => {
    for (const [path, value] of english) expect(value, path).toBeTruthy();
  });

  for (const [locale, bundle] of TRANSLATED) {
    it(`${locale} translates every new leaf, keeping the invitee token`, () => {
      for (const [path, value] of leaves(bundle)) {
        expect(value, `${locale} ${path} missing`).toBeTruthy();
        expect(value, `${locale} ${path} is the English source`).not.toBe(english.get(path));
        if (path.includes('outcomeMessages')) expect(value, `${locale} ${path}`).toContain(INVITEE);
      }
    });
  }
});
