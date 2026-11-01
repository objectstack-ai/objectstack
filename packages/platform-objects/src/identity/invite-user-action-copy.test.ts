// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `invite_user`'s user-facing copy — the parameter dialog's subtitle and the
// success toast — on all four declaration sites (sys_user, sys_invitation,
// sys_member, sys_organization).
//
// What the console does with each key, measured on the pinned objectui:
//
//  - `description` is the parameter dialog's subtitle. With none declared the
//    dialog falls back to a generic "Please provide the required information
//    to continue.", which says nothing about what Confirm will do.
//  - `successMessage` is the toast after Confirm, a `template` slot (#24814):
//    the runner fills its `{{ result.* }}` holes from the answer
//    (ActionSchema.successMessage). `/api/v1/auth/organization/invite-member`
//    answers the bare invitation row, whose top-level `email` is the invitee's
//    address, so `{{ result.email }}` names the person invited. A copy without
//    the hole names nobody.
//
// The translated bundles are pinned as well, because the extractor cannot keep
// them honest by itself: `--fill=default` seeds a NEW key (the description)
// with the English source in every locale, and merge mode keeps every existing
// translated value forever, so a revised `successMessage` would go on serving
// the old, invitee-less sentence. Both states are "in sync" to `check:i18n`.
import { describe, expect, it } from 'vitest';
import { translateMetadataDocument } from '@objectstack/spec/system';
import { templateSlotSource } from '@objectstack/spec/automation';
import { SetupAppTranslations } from '../apps/translations/setup.translation.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { SysInvitation } from './sys-invitation.object.js';
import { SysMember } from './sys-member.object.js';
import { SysOrganization } from './sys-organization.object.js';
import { SysUser } from './sys-user.object.js';

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


interface CopyAction {
  name?: string;
  description?: unknown;
  successMessage?: unknown;
}

/** The hole the console runner fills from the invite-member answer. */
const INVITEE = '{{ result.email }}';

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

// [#24814] `successMessage` is a `template` slot: the parsed
// object carries the `{ dialect: 'template', source }` envelope, so the copy is
// read through the template judge's one reader, `templateSlotSource`.
function invite(object: unknown): CopyAction {
  const found = ((object as { actions?: CopyAction[] }).actions ?? []).find(
    (a) => a.name === 'invite_user',
  );
  expect(found, 'invite_user is declared').toBeDefined();
  return { ...copyAsWritten(found), successMessage: templateSlotSource(found?.successMessage) } as CopyAction;
}

const bundleNode = (bundle: unknown, object: string): CopyAction | undefined =>
  (bundle as Record<string, { _actions?: Record<string, CopyAction> }>)?.[object]?._actions
    ?.invite_user;

describe('invite_user — declared copy', () => {
  it.each(MIRRORS)('%s declares a description for the parameter dialog', (_name, object) => {
    const { description } = invite(object);
    expect(typeof description).toBe('string');
    expect((description as string).trim()).not.toBe('');
  });

  it.each(MIRRORS)('%s names the invitee in its success message', (_name, object) => {
    expect(invite(object).successMessage).toContain(INVITEE);
  });

  it('the mirrors say the same thing', () => {
    // One action, four declaration sites: compared to EACH OTHER, so a mirror
    // edited alone goes red without any literal copied into this file.
    const [first, ...rest] = MIRRORS.map(([, object]) => invite(object));
    for (const other of rest) {
      expect(other.description).toBe(first.description);
      expect(other.successMessage).toBe(first.successMessage);
    }
  });
});

describe('invite_user — translated bundles follow the source', () => {
  it.each(MIRRORS)('en carries the source copy for %s', (name, object) => {
    const node = bundleNode(enObjects, name);
    expect(node?.description).toBe(invite(object).description);
    expect(node?.successMessage).toBe(invite(object).successMessage);
  });

  for (const [locale, bundle] of TRANSLATED) {
    it.each(MIRRORS)(`${locale} translates the description for %s`, (name, object) => {
      const translated = bundleNode(bundle, name)?.description;
      expect(translated, `${locale} ${name}.invite_user.description missing`).toBeTruthy();
      expect(
        translated,
        `${locale} ${name}.invite_user.description is the English source the extractor seeds a new key with`,
      ).not.toBe(invite(object).description);
    });

    it.each(MIRRORS)(`${locale} keeps the invitee token in the success message for %s`, (name) => {
      // The old translation ("invitation sent") survives every re-extract in
      // merge mode; only the token proves the leaf was revised with the source.
      expect(bundleNode(bundle, name)?.successMessage).toContain(INVITEE);
    });
  }
});

describe('invite_user — the served object metadata', () => {
  // The object-metadata read the console uses localizes through
  // `translateMetadataDocument('object', …)` over the i18n service's bundle;
  // `SetupAppTranslations` is the bundle this package hands that service.
  const served = (object: unknown, locale: string): CopyAction => {
    const doc = translateMetadataDocument('object', object, SetupAppTranslations, { locale });
    return invite(doc);
  };

  it.each(MIRRORS)('zh-CN serves the translated description for %s', (name, object) => {
    const zh = served(object, 'zh-CN');
    expect(zh.description).toBe(bundleNode(zhCNObjects, name)?.description);
    expect(zh.description).not.toBe(invite(object).description);
    expect(zh.successMessage).toContain(INVITEE);
  });

  it.each(MIRRORS)('en serves the declared copy for %s', (_name, object) => {
    const en = served(object, 'en');
    expect(en.description).toBe(invite(object).description);
    expect(en.successMessage).toBe(invite(object).successMessage);
  });
});
