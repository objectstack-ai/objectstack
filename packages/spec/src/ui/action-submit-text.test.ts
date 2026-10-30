// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#27944 — `submitText` on the action contract: the verb on the
// submit button of the dialog an action opens to collect its `params`, in
// place of the dialog's default "Confirm".
//
// These pins hold the spec half: the parse (both I18nLabel forms), the blank
// refusal, the refusal on an action that opens no param dialog, the aliases,
// and the translation slot with its `translateAction` overlay. The dangling
// translation half is pinned in
// `packages/lint/src/validate-translation-references.test.ts`.

import { describe, it, expect } from 'vitest';
import { ActionSchema, InlineActionSchema } from './action.zod';
import { ObjectTranslationDataSchema, TranslationDataSchema, type TranslationBundle } from '../system/translation.zod';
import { translateAction } from '../system/i18n-resolver';

/** Minimum legal registered action that collects params (HotCRM's `send_email` shape). */
const base = {
  name: 'send_email',
  label: 'Send Email',
  objectName: 'crm_contact',
  target: 'sendEmail',
  params: [
    { name: 'subject', label: 'Subject', type: 'text', required: true },
    { name: 'body', label: 'Body', type: 'textarea' },
  ],
} as const;

const firstIssue = (input: unknown) => {
  const result = ActionSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? undefined : result.error.issues[0];
};

describe('ActionSchema.submitText — the parse', () => {
  it('accepts a plain string and keeps it verbatim', () => {
    const result = ActionSchema.safeParse({ ...base, submitText: 'Send' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.submitText).toBe('Send');
  });

  it('accepts the inline locale map, as every I18nLabel does', () => {
    const localized = { en: 'Send', 'zh-CN': '发送' };
    const result = ActionSchema.safeParse({ ...base, submitText: localized });

    expect(result.success).toBe(true);
    expect(result.success && result.data.submitText).toEqual(localized);
  });

  it('is optional — an action without it parses, and the dialog keeps "Confirm"', () => {
    const result = ActionSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.success && 'submitText' in result.data).toBe(false);
  });

  it('sits beside `description`, the same dialog\'s line under its title', () => {
    const result = ActionSchema.safeParse({
      ...base,
      description: 'The email goes to the contact\'s primary address.',
      submitText: 'Send',
    });

    expect(result.success).toBe(true);
  });

  it('refuses every non-I18nLabel shape the `label` key refuses', () => {
    for (const value of [42, null, ['a list'], { en: 7 }, { key: 'actions.send' }] as unknown[]) {
      const asLabel = ActionSchema.safeParse({ ...base, label: value }).success;
      const asSubmit = ActionSchema.safeParse({ ...base, submitText: value }).success;

      expect({ value, asLabel, asSubmit }).toEqual({ value, asLabel: false, asSubmit: false });
    }
  });
});

describe('ActionSchema.submitText — the refusals', () => {
  it('refuses the empty string and a whitespace-only one, naming the default it would replace', () => {
    for (const blank of ['', '   ']) {
      const issue = firstIssue({ ...base, submitText: blank });

      expect(issue?.code).toBe('custom');
      expect(issue?.path).toEqual(['submitText']);
      expect(issue?.message).toMatch(/^a blank `submitText` would replace the param dialog's default button label, "Confirm"/);
    }
  });

  it('refuses it on an action that declares no params — no param dialog opens to show it', () => {
    const { params: _params, ...paramless } = base;
    for (const input of [{ ...paramless, submitText: 'Send' }, { ...paramless, params: [], submitText: 'Send' }]) {
      const issue = firstIssue(input);

      expect(issue?.code).toBe('custom');
      expect(issue?.path).toEqual(['submitText']);
      expect(issue?.message).toMatch(/^`submitText` labels the submit button of the dialog an action opens to collect its `params`/);
    }
  });

  it('refuses the inline locale map on a param-less action too — the rule reads the key, not its form', () => {
    const { params: _params, ...paramless } = base;
    expect(firstIssue({ ...paramless, submitText: { en: 'Send' } })?.path).toEqual(['submitText']);
  });
});

describe('ActionSchema.submitText — the shape around it', () => {
  it('renames the two measured near-miss spellings onto the key', () => {
    for (const nearMiss of ['submitLabel', 'confirmLabel']) {
      const issue = firstIssue({ ...base, [nearMiss]: 'Send' });

      expect(issue?.code).toBe('unrecognized_keys');
      expect(issue?.message).toContain(`\`${nearMiss}\` → \`submitText\``);
    }
  });

  it('is not picked onto the INLINE action — that surface has no `description` either', () => {
    const result = InlineActionSchema.safeParse({
      type: 'api',
      target: '/api/v1/send',
      label: 'Send',
      params: [{ name: 'subject', label: 'Subject', type: 'text' }],
      submitText: 'Send',
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('submitText');
  });
});

describe('the translation slot and its overlay', () => {
  it('accepts the key at the object-scoped address, beside description', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: { send_email: { label: '发送邮件', description: '邮件发往联系人的主邮箱。', submitText: '发送' } },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data._actions?.send_email?.submitText).toBe('发送');
  });

  it('accepts it at the globalActions address an object-less action reads', () => {
    const result = TranslationDataSchema.safeParse({
      globalActions: { log_call: { submitText: '记录通话' } },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.globalActions?.log_call?.submitText).toBe('记录通话');
  });

  it('renames the same near-misses inside a bundle', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: { send_email: { submitLabel: '发送' } },
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('`submitLabel` → `submitText`');
  });

  const bundle: TranslationBundle = {
    'zh-CN': {
      objects: { crm_contact: { _actions: { send_email: { submitText: '发送' }, archive: { submitText: '归档' } } } },
      globalActions: { log_call: { submitText: '记录通话' } },
    },
  };
  const action = { name: 'send_email', label: 'Send Email', objectName: 'crm_contact', params: [{ name: 'subject' }], submitText: 'Send' };

  it('translateAction overlays the translated label for the requested locale', () => {
    expect(translateAction(action, bundle, { locale: 'zh-CN' }).submitText).toBe('发送');
  });

  it('reads an object-less action at globalActions', () => {
    const logCall = { name: 'log_call', label: 'Log Call', params: [{ name: 'notes' }], submitText: 'Log Call' };
    expect(translateAction(logCall, bundle, { locale: 'zh-CN' }).submitText).toBe('记录通话');
  });

  it('falls back to the authored label when the locale has none', () => {
    expect(translateAction(action, bundle, { locale: 'ja-JP' }).submitText).toBe('Send');
  });

  it('resolves the translated label for an action that collects params but authors none', () => {
    const { submitText: _authored, ...unlabelled } = action;
    expect(translateAction(unlabelled, bundle, { locale: 'zh-CN' }).submitText).toBe('发送');
  });

  it('gives no button to an action without params, whatever the bundle carries', () => {
    const archive = { name: 'archive', label: 'Archive', objectName: 'crm_contact' };
    expect('submitText' in translateAction(archive, bundle, { locale: 'zh-CN' })).toBe(false);
  });
});
