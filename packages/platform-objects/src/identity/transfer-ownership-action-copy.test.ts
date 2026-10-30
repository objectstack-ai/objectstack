// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `sys_member.transfer_ownership`'s copy says what its door does.
//
// The action sends better-auth's `update-member-role` with `role: 'owner'`, and
// that endpoint writes the TARGET's role and nothing else: the caller stays an
// owner (measured on a booted stack by
// `packages/qa/dogfood/test/member-transfer-ownership-step-down.dogfood.test.ts`).
// The copy used to promise the caller "You will be demoted to admin"; nothing
// demoted anyone, and the organization ended with two owners. So the copy may
// promise neither a demotion nor a transfer, and the confirm must name the step
// that really steps the caller down — Change Role (`update_member_role`) on
// their own row — by that action's own label, in every locale.
//
// The translated bundles are pinned as well: merge mode keeps every existing
// translated value, so a revised English source leaves the old promise served
// in zh-CN / ja-JP / es-ES while `check:i18n` reads "in sync".
import { describe, expect, it } from 'vitest';
import { templateSlotSource } from '@objectstack/spec/automation';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';
import { SysMember } from './sys-member.object.js';

interface CopyAction {
  name?: string;
  label?: string;
  confirmText?: string;
  successMessage?: string;
  outcomeMessages?: Record<string, string>;
  target?: string;
  bodyExtra?: Record<string, unknown>;
  recordIdParam?: string;
  variant?: string;
  visible?: unknown;
}

// [#24814] `confirmText` / `successMessage` are `template` slots: the parsed
// object carries the `{ dialect: 'template', source }` envelope, so the copy is
// read through the template judge's one reader, `templateSlotSource`.
function declared(name: string): CopyAction {
  const found = ((SysMember as { actions?: CopyAction[] }).actions ?? []).find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return {
    ...found,
    confirmText: templateSlotSource(found?.confirmText),
    successMessage: templateSlotSource(found?.successMessage),
  } as CopyAction;
}

const bundled = (bundle: unknown, name: string): CopyAction | undefined =>
  (bundle as Record<string, { _actions?: Record<string, CopyAction> }>)?.sys_member?._actions?.[name];

const LOCALES = [
  ['en', enObjects],
  ['zh-CN', zhCNObjects],
  ['ja-JP', jaJPObjects],
  ['es-ES', esESObjects],
] as const;

describe('sys_member.transfer_ownership — declared copy', () => {
  const action = declared('transfer_ownership');

  it('keeps the request and the identity consumers name', () => {
    expect(action.target).toBe('/api/v1/auth/organization/update-member-role');
    expect(action.bodyExtra).toEqual({ role: 'owner' });
    expect(action.recordIdParam).toBe('memberId');
    expect(action.variant).toBe('danger');
    // `requiresMembershipReach: 'transfer_ownership'`, lowered: the owner alone.
    expect(String((action.visible as { source?: string })?.source)).toContain("'org_owner' in current_user.positions");
  });

  it('promises neither a demotion nor a transfer', () => {
    for (const text of [action.label, action.confirmText, action.successMessage, ...Object.values(action.outcomeMessages ?? {})]) {
      expect(text).not.toMatch(/demot|transfer/i);
    }
    expect(action.confirmText).toContain('You stay an owner');
  });

  it('names the step-down by the Change Role action\'s own label', () => {
    expect(action.confirmText).toContain(declared('update_member_role').label);
  });
});

describe('sys_member.transfer_ownership — every locale bundle', () => {
  it.each(LOCALES)('%s names its own Change Role label in the confirm', (_locale, bundle) => {
    const copy = bundled(bundle, 'transfer_ownership');
    const changeRole = bundled(bundle, 'update_member_role')?.label;
    expect(changeRole, 'update_member_role is translated').toBeTruthy();
    expect(copy?.confirmText).toContain(changeRole);
  });

  it('en is the declared copy', () => {
    const copy = bundled(enObjects, 'transfer_ownership');
    const action = declared('transfer_ownership');
    expect(copy).toEqual({
      label: action.label,
      confirmText: action.confirmText,
      successMessage: action.successMessage,
      outcomeMessages: action.outcomeMessages,
    });
  });
});
