// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#7367 — `description` on the action contract.
//
// The renderer half predates the key. objectui's param dialog has rendered an
// action description since before this schema could carry one
// (`ActionParamDialog.tsx:215` → `DialogDescription`, fed by
// `actionDescription(objectName, actionName, action.description)` from
// `useConsoleActionRuntime.tsx:206` and `RecordDetailView.tsx:586`, resolved
// through `objects.{o}._actions.{a}.description` in `useObjectLabel.ts:463`).
// What was missing was the PRODUCER: `ActionSchema` is a `strictObject` and
// refused `description` outright, and `actionTranslationSchema` refused the
// matching bundle key — so the resolver was looking for a string nothing could
// author. The mirror image of declared-but-unenforced.
//
// These pins hold the key open in the exact shape `label` has, and hold the
// three things this change must NOT do: relax the strict shape, widen the
// INLINE action surface ahead of its renderer, or re-point the action PARAM's
// `description` → `helpText` alias, which is a different surface and still
// correct.

import { describe, it, expect } from 'vitest';
import { ActionSchema, ActionParamSchema, InlineActionSchema } from './action.zod';
import { ObjectTranslationDataSchema, TranslationDataSchema } from '../system/translation.zod';

/**
 * Minimum legal registered action — identity, menu label, and something to
 * dispatch to. `type` defaults to `script`, whose refinement requires an inline
 * `body` or a registered bundle function `target`; leaving both off fails for a
 * reason that has nothing to do with `description` and would make every pin
 * below unreadable.
 */
const base = { name: 'approval_reject', label: 'Reject', target: 'rejectApproval' } as const;

describe('ActionSchema.description (#7367)', () => {
  it('accepts a plain string, matching `label`\'s I18nLabel contract', () => {
    const result = ActionSchema.safeParse({
      ...base,
      description: 'Reject this request? Say why — the requester sees it.',
      params: [{ name: 'reason', label: 'Reason', type: 'textarea', required: true }],
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.description).toBe(
      'Reject this request? Say why — the requester sees it.',
    );
  });

  it('accepts the localized-map form, matching `label`\'s I18nLabel contract', () => {
    const localized = { en: 'Reject this request?', 'zh-CN': '拒绝该请求？' };
    const result = ActionSchema.safeParse({ ...base, description: localized });

    expect(result.success).toBe(true);
    expect(result.success && result.data.description).toEqual(localized);
  });

  it('is optional — an action that declares none still parses', () => {
    const result = ActionSchema.safeParse(base);

    expect(result.success).toBe(true);
    expect(result.success && result.data.description).toBeUndefined();
  });

  it('takes exactly the shapes `label` takes, and refuses the ones it refuses', () => {
    // The contract claim is "I18nLabel-shaped exactly as `label` is", so it is
    // asserted against `label` rather than restated — a divergence in either
    // direction (a form only one of them accepts) fails here.
    for (const value of [
      'A string',
      { en: 'A map', 'zh-CN': '一个映射' },
      42,
      null,
      ['an array'],
      { en: 7 },
    ] as unknown[]) {
      const asLabel = ActionSchema.safeParse({ ...base, label: value }).success;
      const asDescription = ActionSchema.safeParse({ ...base, description: value }).success;

      expect({ value, asLabel, asDescription }).toEqual({ value, asLabel, asDescription: asLabel });
    }
  });

  it('does not relax the strict shape — an unknown sibling is still refused, by code and message', () => {
    const result = ActionSchema.safeParse({
      ...base,
      description: 'Legal now.',
      descriptionText: 'Still not a key.',
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    // Asserted as the SUGGESTION arrow, not as `toContain('description')` —
    // the latter is satisfied by the substring inside `descriptionText` and
    // would stay green with the key removed. The arrow can only be produced
    // when `description` is a DECLARED key to resolve the near-miss against.
    expect(issue?.message).toContain('Unrecognized key(s) on this action: `descriptionText`');
    expect(issue?.message).toContain('Did you mean `descriptionText` → `description`?');
  });

  it('leaves `ai.description` alone — the LLM contract and the dialog line are different keys', () => {
    const both = ActionSchema.safeParse({
      ...base,
      description: 'Reject this request?',
      ai: {
        exposed: true,
        description: 'Reject a pending approval request on behalf of the current user, with a reason.',
      },
    });

    expect(both.success).toBe(true);
    expect(both.success && both.data.description).toBe('Reject this request?');
    expect(both.success && both.data.ai?.description).toContain('Reject a pending approval request');

    // The ≥40-char LLM contract is unaffected: a top-level `description` does
    // not satisfy `ai.exposed`.
    const missingAi = ActionSchema.safeParse({
      ...base,
      description: 'Reject this request?',
      ai: { exposed: true },
    });
    expect(missingAi.success).toBe(false);
    expect(missingAi.success ? undefined : missingAi.error.issues[0]?.message)
      .toContain('ai.description is required');
  });
});

describe('the surfaces #7367 deliberately does NOT widen', () => {
  it('an action PARAM still routes `description` to `helpText`', () => {
    // `ACTION_PARAM_KEY_ALIASES.description = 'helpText'` is a PARAM-surface
    // entry and stays correct: the param's help line is `helpText`, and the key
    // this PR legalises lives one level up on the action. If the alias were
    // ever dropped as "stale now that description is legal", this goes red.
    const result = ActionParamSchema.safeParse({
      name: 'reason',
      label: 'Reason',
      type: 'textarea',
      description: 'Shown under the input',
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('helpText');
  });

  it('an INLINE action still refuses it — the pick widens when a renderer widens, not before', () => {
    // `InlineActionSchema` forwards exactly what `element:button`'s renderer
    // honours. That renderer has no description slot, so picking the key here
    // would declare a field no renderer reads — the failure that schema exists
    // to stop (`bodyExtra` is the one knowing exception, ruled in #5777).
    const result = InlineActionSchema.safeParse({
      type: 'url',
      target: '/docs',
      label: 'Docs',
      description: 'Not honoured by element:button',
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('description');
  });
});

describe('actionTranslationSchema.description (#7367)', () => {
  it('accepts the key at the object-scoped address the resolver walks first', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: {
        approval_reject: { label: '拒绝', description: '拒绝该请求？请说明原因。' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data._actions?.approval_reject?.description)
      .toBe('拒绝该请求？请说明原因。');
  });

  it('accepts it at the globalActions address the resolver falls back to', () => {
    const result = TranslationDataSchema.safeParse({
      globalActions: {
        approval_reject: { label: '拒绝', description: '拒绝该请求？' },
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.globalActions?.approval_reject?.description)
      .toBe('拒绝该请求？');
  });

  it('is a flat string here — the bundle is already per-locale, so no nested map', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: { approval_reject: { description: { en: 'Nope', 'zh-CN': '不' } } },
    });

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.issues[0]?.code).toBe('invalid_type');
  });

  it('does not relax the strict translation shape — an unknown sibling is still refused', () => {
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: {
        approval_reject: { description: '拒绝该请求？', descriptionText: '不是键' },
      },
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('Unrecognized key(s) on this object action translation: `descriptionText`');
    // Same reasoning as the ActionSchema pin: the arrow, not the substring.
    expect(issue?.message).toContain('Did you mean `descriptionText` → `description`?');
  });

  it('keeps the action description and the result-dialog description distinct', () => {
    // `resultDialog.description` is a different string on a different dialog
    // (the post-success reveal). Both must be carryable at once.
    const result = ObjectTranslationDataSchema.safeParse({
      _actions: {
        approval_reject: {
          description: '拒绝该请求？',
          resultDialog: { title: '已拒绝', description: '该请求已被拒绝。' },
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data._actions?.approval_reject?.description).toBe('拒绝该请求？');
    expect(result.success && result.data._actions?.approval_reject?.resultDialog?.description)
      .toBe('该请求已被拒绝。');
  });
});
