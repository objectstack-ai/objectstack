// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#26619 — `disabledReason` on the action contract (ruling
// 6442737825, letter A).
//
// A greyed action could only say "Not available for this record". The ruled
// key is the sentence that says WHY, beside the `disabled` predicate that greys
// it: an I18nLabel, translated under `objects.OBJECT._actions.ACTION` with the
// copy keys, display only. These pins hold the four things the ruling names:
// the parse (both I18nLabel forms), the blank refusal, the translation slot and
// its overlay, and that the key is a sentence, never a condition. The extract
// half is pinned in `packages/cli/test/i18n-extract-action-disabled-reason.test.ts`
// and the lint half in `packages/lint/src/validate-expressions.test.ts`.

import { describe, it, expect } from 'vitest';
import { ActionSchema, InlineActionSchema } from './action.zod';
import { ObjectTranslationDataSchema, TranslationDataSchema, type TranslationBundle } from '../system/translation.zod';
import { translateAction } from '../system/i18n-resolver';

/**
 * Minimum legal registered action, greyed by a predicate. `type` defaults to
 * `script`, which needs a dispatch `target`.
 */
const base = {
  name: 'submit_for_approval',
  label: 'Submit for approval',
  objectName: 'clm_contract',
  target: 'submitForApproval',
  disabled: "record.legal_review_status != 'approved'",
} as const;

const REASON = 'An approved legal review is required before the contract enters approval.';

describe('ActionSchema.disabledReason — the parse', () => {
  it('accepts a plain string and keeps it verbatim', () => {
    const result = ActionSchema.safeParse({ ...base, disabledReason: REASON });

    expect(result.success).toBe(true);
    expect(result.success && result.data.disabledReason).toBe(REASON);
  });

  it('accepts the inline locale map, as every I18nLabel does', () => {
    const localized = { en: REASON, 'zh-CN': '需要一条通过的法务审查后才能送审。' };
    const result = ActionSchema.safeParse({ ...base, disabledReason: localized });

    expect(result.success).toBe(true);
    expect(result.success && result.data.disabledReason).toEqual(localized);
  });

  it('is optional — an action without it parses, and the console keeps its default reason', () => {
    const result = ActionSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.success && 'disabledReason' in result.data).toBe(false);
  });

  it('is a sentence, never a condition — a predicate-looking value is not normalized', () => {
    // `disabled` lowers a CEL string into its `{ dialect: 'cel' }` envelope at
    // parse; `disabledReason` must come out as the same string it went in as,
    // or something downstream would be invited to evaluate it.
    const predicateLooking = "record.legal_review_status != 'approved'";
    const result = ActionSchema.safeParse({ ...base, disabledReason: predicateLooking });

    expect(result.success).toBe(true);
    expect(result.success && result.data.disabledReason).toBe(predicateLooking);
    expect(result.success && result.data.disabled).toEqual(
      expect.objectContaining({ dialect: 'cel', source: predicateLooking }),
    );
  });

  it('refuses every non-I18nLabel shape the `label` key refuses', () => {
    for (const value of [42, null, ['a list'], { en: 7 }, { key: 'actions.reason' }] as unknown[]) {
      const asLabel = ActionSchema.safeParse({ ...base, label: value }).success;
      const asReason = ActionSchema.safeParse({ ...base, disabledReason: value }).success;

      expect({ value, asLabel, asReason }).toEqual({ value, asLabel: false, asReason: false });
    }
  });
});

describe('ActionSchema.disabledReason — the blank refusal', () => {
  const refusal = (disabledReason: unknown) => {
    const result = ActionSchema.safeParse({ ...base, disabledReason });
    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues.find((i) => i.path[0] === 'disabledReason');
    expect(issue?.code).toBe('custom');
    expect(issue?.path).toEqual(['disabledReason']);
    return issue?.message ?? '';
  };

  it('refuses the empty string, naming the default it would have replaced', () => {
    const message = refusal('');
    expect(message).toMatch(/^a blank `disabledReason` would replace the console's default reason/);
    expect(message).toContain('omit the key to keep the default');
  });

  it('refuses a whitespace-only string — it renders exactly as blank', () => {
    expect(refusal('   ')).toMatch(/^a blank `disabledReason`/);
  });

  it('refuses a locale map with a blank value, naming the locale', () => {
    expect(refusal({ en: REASON, 'zh-CN': ' ' })).toMatch(/^the inline `disabledReason` map gives a blank reason for `zh-CN`/);
  });

  it('refuses an empty locale map — it gives no reason in any locale', () => {
    expect(refusal({})).toMatch(/^an empty inline `disabledReason` map gives no reason in any locale/);
  });
});

describe('ActionSchema.disabledReason — the shape around it', () => {
  it('renames the near-miss spellings onto the key', () => {
    for (const nearMiss of ['disabledMessage', 'disabledTooltip', 'disabledHint', 'disabledText']) {
      const result = ActionSchema.safeParse({ ...base, [nearMiss]: REASON });

      expect(result.success).toBe(false);
      const issue = result.success ? undefined : result.error.issues[0];
      expect(issue?.code).toBe('unrecognized_keys');
      expect(issue?.message).toContain(`\`${nearMiss}\` → \`disabledReason\``);
    }
  });

  it('is not picked onto the INLINE action — that surface has no `disabled` to explain', () => {
    const result = InlineActionSchema.safeParse({
      type: 'url',
      target: '/docs',
      label: 'Docs',
      disabledReason: REASON,
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('disabledReason');
  });
});

describe('the translation slot and its overlay', () => {
  it('accepts the key at the object-scoped address, beside confirmText / successMessage', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: {
        submit_for_approval: { label: '送审', confirmText: '确认送审？', disabledReason: '需要一条通过的法务审查后才能送审。' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data._actions?.submit_for_approval?.disabledReason)
      .toBe('需要一条通过的法务审查后才能送审。');
  });

  it('accepts it at the globalActions address an object-less action reads', () => {
    const result = TranslationDataSchema.safeParse({
      globalActions: { leave_organization: { disabledReason: '你是唯一的所有者，不能退出组织。' } },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.globalActions?.leave_organization?.disabledReason)
      .toBe('你是唯一的所有者，不能退出组织。');
  });

  it('renames the same near-misses inside a bundle', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: { submit_for_approval: { disabledTooltip: '需要法务审查。' } },
    });

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.issues[0]?.message)
      .toContain('`disabledTooltip` → `disabledReason`');
  });

  const bundle: TranslationBundle = {
    'zh-CN': {
      objects: {
        clm_contract: {
          _actions: { submit_for_approval: { disabledReason: '需要一条通过的法务审查后才能送审。' } },
        },
      },
      globalActions: {
        leave_organization: { disabledReason: '你是唯一的所有者，不能退出组织。' },
      },
    },
  };
  const action = { name: 'submit_for_approval', label: 'Submit', objectName: 'clm_contract', disabledReason: REASON };

  it('translateAction overlays the translated reason for the requested locale', () => {
    expect(translateAction(action, bundle, { locale: 'zh-CN' }).disabledReason)
      .toBe('需要一条通过的法务审查后才能送审。');
  });

  it('reads an object-less action at globalActions', () => {
    const leave = { name: 'leave_organization', label: 'Leave', disabledReason: 'You are the sole owner.' };
    expect(translateAction(leave, bundle, { locale: 'zh-CN' }).disabledReason)
      .toBe('你是唯一的所有者，不能退出组织。');
  });

  it('falls back to the authored reason when the locale has none', () => {
    expect(translateAction(action, bundle, { locale: 'ja-JP' }).disabledReason).toBe(REASON);
  });

  it('adds no key to an action that declares none and has no translation', () => {
    const bare = { name: 'archive', label: 'Archive', objectName: 'clm_contract' };
    expect('disabledReason' in translateAction(bare, bundle, { locale: 'zh-CN' })).toBe(false);
  });
});
