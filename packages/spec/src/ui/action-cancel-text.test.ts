// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#28519 — `cancelText` on the action contract: the label of the
// dismiss button on the dialog an action opens before it runs (its confirm
// dialog, or its param dialog), in place of the dialog's default "Cancel".
//
// These pins hold the spec half: the parse on both host dialogs (both
// I18nLabel forms), the blank refusal, the refusal on an action that opens no
// dialog, the alias, and the translation slot with its `translateAction`
// overlay. The dangling translation half is pinned in
// `packages/lint/src/validate-translation-references.test.ts`; its twin, the
// param dialog's submit label, in `action-submit-text.test.ts`.

import { describe, it, expect } from 'vitest';
import { ActionSchema, InlineActionSchema } from './action.zod';
import { ObjectTranslationDataSchema, TranslationDataSchema, type TranslationBundle } from '../system/translation.zod';
import { translateAction, type ActionLike } from '../system/i18n-resolver';

/**
 * A param-LESS action that asks first — the confirm dialog's host, in the
 * shape of `sys_invitation`'s Cancel Invitation, the row that started this.
 */
const confirmHost = {
  name: 'cancel_invitation',
  label: 'Cancel Invitation',
  objectName: 'sys_invitation',
  type: 'api',
  target: '/api/v1/auth/organization/cancel-invitation',
  confirmText: 'Cancel this invitation? The recipient will no longer be able to accept it.',
} as const;

/** An action that collects params — the param dialog's host. */
const paramHost = {
  name: 'close_case',
  label: 'Close Case',
  objectName: 'crm_case',
  target: 'closeCase',
  params: [{ name: 'resolution', label: 'Resolution', type: 'textarea', required: true }],
} as const;

/** An action that opens neither dialog: it runs on click. */
const { confirmText: _confirmText, ...noDialog } = confirmHost;

const firstIssue = (input: unknown) => {
  const result = ActionSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? undefined : result.error.issues[0];
};

describe('ActionSchema.cancelText — the parse', () => {
  it('accepts a plain string on the confirm dialog\'s host and keeps it verbatim', () => {
    const result = ActionSchema.safeParse({ ...confirmHost, cancelText: 'Keep invitation' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.cancelText).toBe('Keep invitation');
  });

  it('accepts it on the param dialog\'s host, beside that dialog\'s `submitText`', () => {
    const result = ActionSchema.safeParse({ ...paramHost, submitText: 'Close Case', cancelText: 'Keep open' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.cancelText).toBe('Keep open');
  });

  it('accepts the inline locale map, as every I18nLabel does', () => {
    const localized = { en: 'Keep invitation', 'zh-CN': '保留邀请' };
    const result = ActionSchema.safeParse({ ...confirmHost, cancelText: localized });

    expect(result.success).toBe(true);
    expect(result.success && result.data.cancelText).toEqual(localized);
  });

  it('is optional — an action without it parses, and the dialog keeps "Cancel"', () => {
    for (const host of [confirmHost, paramHost]) {
      const result = ActionSchema.safeParse(host);

      expect(result.success).toBe(true);
      expect(result.success && 'cancelText' in result.data).toBe(false);
    }
  });

  it('refuses every non-I18nLabel shape the `label` key refuses', () => {
    for (const value of [42, null, ['a list'], { en: 7 }, { key: 'actions.keep' }] as unknown[]) {
      const asLabel = ActionSchema.safeParse({ ...confirmHost, label: value }).success;
      const asCancel = ActionSchema.safeParse({ ...confirmHost, cancelText: value }).success;

      expect({ value, asLabel, asCancel }).toEqual({ value, asLabel: false, asCancel: false });
    }
  });
});

describe('ActionSchema.cancelText — the refusals', () => {
  it('refuses the empty string and a whitespace-only one on either host, naming the default it would replace', () => {
    for (const host of [confirmHost, paramHost]) {
      for (const blank of ['', '   ']) {
        const issue = firstIssue({ ...host, cancelText: blank });

        expect(issue?.code).toBe('custom');
        expect(issue?.path).toEqual(['cancelText']);
        expect(issue?.message).toMatch(/^a blank `cancelText` would replace the dialog's default dismiss button label, "Cancel"/);
      }
    }
  });

  it('refuses it on an action that declares neither `confirmText` nor params — no dialog opens to show it', () => {
    for (const input of [{ ...noDialog, cancelText: 'Keep' }, { ...noDialog, params: [], cancelText: 'Keep' }]) {
      const issue = firstIssue(input);

      expect(issue?.code).toBe('custom');
      expect(issue?.path).toEqual(['cancelText']);
      expect(issue?.message).toMatch(/^`cancelText` labels the dismiss button of the dialog an action opens before it runs/);
    }
  });

  it('refuses the inline locale map on a dialog-less action too — the rule reads the key, not its form', () => {
    expect(firstIssue({ ...noDialog, cancelText: { en: 'Keep' } })?.path).toEqual(['cancelText']);
  });

  it('the control: the same dialog-less action parses once the key is dropped', () => {
    expect(ActionSchema.safeParse(noDialog).success).toBe(true);
  });
});

describe('ActionSchema.cancelText — the shape around it', () => {
  it('renames the measured near-miss spelling onto the key', () => {
    const issue = firstIssue({ ...confirmHost, cancelLabel: 'Keep invitation' });

    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('`cancelLabel` → `cancelText`');
  });

  it('is not picked onto the INLINE action — that surface does not pick `submitText` either', () => {
    const result = InlineActionSchema.safeParse({
      type: 'api',
      target: '/api/v1/archive',
      label: 'Archive',
      confirmText: 'Archive this record?',
      cancelText: 'Keep it',
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('cancelText');
  });
});

describe('the translation slot and its overlay', () => {
  it('accepts the key at the object-scoped address, beside confirmText', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: { cancel_invitation: { label: '取消邀请', confirmText: '取消此邀请？', cancelText: '保留邀请' } },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data._actions?.cancel_invitation?.cancelText).toBe('保留邀请');
  });

  it('accepts it at the globalActions address an object-less action reads', () => {
    const result = TranslationDataSchema.safeParse({
      globalActions: { close_session: { cancelText: '保持登录' } },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.globalActions?.close_session?.cancelText).toBe('保持登录');
  });

  it('renames the same near-miss inside a bundle', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: { cancel_invitation: { cancelLabel: '保留邀请' } },
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('`cancelLabel` → `cancelText`');
  });

  const bundle: TranslationBundle = {
    'zh-CN': {
      objects: {
        sys_invitation: { _actions: { cancel_invitation: { cancelText: '保留邀请' }, resend: { cancelText: '不发送' } } },
        crm_case: { _actions: { close_case: { cancelText: '保持打开' } } },
      },
      globalActions: { close_session: { cancelText: '保持登录' } },
    },
  };
  const confirmAction = {
    name: 'cancel_invitation',
    label: 'Cancel Invitation',
    objectName: 'sys_invitation',
    confirmText: 'Cancel this invitation?',
    cancelText: 'Keep invitation',
  };

  it('translateAction overlays the translated label on the confirm dialog\'s host', () => {
    expect(translateAction(confirmAction, bundle, { locale: 'zh-CN' }).cancelText).toBe('保留邀请');
  });

  it('overlays it on the param dialog\'s host too', () => {
    const closeCase = { name: 'close_case', label: 'Close Case', objectName: 'crm_case', params: [{ name: 'resolution' }] };
    expect(translateAction<ActionLike>(closeCase, bundle, { locale: 'zh-CN' }).cancelText).toBe('保持打开');
  });

  it('reads an object-less action at globalActions', () => {
    const closeSession = { name: 'close_session', label: 'Close Session', confirmText: 'Sign out everywhere?', cancelText: 'Stay signed in' };
    expect(translateAction(closeSession, bundle, { locale: 'zh-CN' }).cancelText).toBe('保持登录');
  });

  it('falls back to the authored label when the locale has none', () => {
    expect(translateAction(confirmAction, bundle, { locale: 'ja-JP' }).cancelText).toBe('Keep invitation');
  });

  it('resolves the translated label for an action that opens a dialog but authors none', () => {
    const { cancelText: _authored, ...unlabelled } = confirmAction;
    const translated: ActionLike = translateAction<ActionLike>(unlabelled, bundle, { locale: 'zh-CN' });
    expect(translated.cancelText).toBe('保留邀请');
  });

  it('gives no button to an action that opens no dialog, whatever the bundle carries', () => {
    const resend = { name: 'resend', label: 'Resend', objectName: 'sys_invitation' };
    expect('cancelText' in translateAction(resend, bundle, { locale: 'zh-CN' })).toBe(false);
  });
});
