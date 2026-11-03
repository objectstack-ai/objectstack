// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7428 — the authoring-time guard on the `confirmText` + `params` PAIR.
 *
 * #7278 and #7309 repaired the 16 shipped sites that opened two dialogs for one
 * decision (PRs #7592 and #7827). Repairing instances does not stop the next one
 * being written; this refusal is the structural half, and it is the reason the
 * card exists as a separate issue from either migration.
 *
 * **What these tests pin is the BOUNDARY, not just the refusal.** The pair is
 * wrong on `ActionSchema` and CORRECT on `BulkActionDefSchema` — measured on
 * #7428 (2026-08-11), and the distinction is the schema the def is validated by,
 * not a heuristic about whether the params happen to be optional. A guard
 * written against the raw `confirmText` + `params: [` key pair would land red on
 * four correct `examples/app-showcase` bulk defs on day one, which is the
 * permanently-noisy-check shape the card was filed to avoid. So the acceptance
 * direction is pinned as hard as the rejection direction: a future "helpful"
 * widening of this guard onto the bulk surface goes RED here.
 *
 * `InlineActionSchema` refuses the pair too (#29383, ruling record 6595808462
 * letter A): an inline page action runs through the same runner, so the same
 * two dialogs open, and its pick carries the `description` remedy. So does the
 * page `action:button` row, `ActionButtonPropsSchema` (#29844, ruling record
 * 6597621758 letter A), for an ARRAY `params` only: an object `params` there is
 * the static values and opens no dialog. The three doors share one predicate
 * and one message (`./action-confirm-beside-params.ts`), pinned equal below.
 *
 * The rejection tests assert the issue PATH and the MESSAGE SUBSTANCE rather
 * than a bare `success === false`. One condition, one wording: a refusal whose
 * message does not name both keys and point at the remedy sends the author
 * looking for a different bug.
 */

import { describe, expect, it } from 'vitest';
import { ActionSchema, InlineActionSchema, defineAction } from './action.zod';
import { BulkActionDefSchema } from './bulk-action.zod';
import { ActionButtonPropsSchema } from './component.zod';

/**
 * Minimum legal registered action. `type` defaults to `script`, whose own
 * refinement requires an inline `body` or a `target` naming a bundle function —
 * leaving both off would fail for a reason that has nothing to do with this
 * guard and would make every assertion below unreadable.
 */
const base = { name: 'approval_reject', label: 'Reject', target: 'rejectApproval' } as const;

// `type` is narrowed rather than widened to `string` so this literal is also
// assignable to `defineAction`'s typed input, which the last test below calls.
const oneParam = [{ name: 'reason', label: 'Reason', type: 'textarea' as const, required: true }];

/** The single issue this guard raises, or `undefined` if it did not fire. */
const guardIssue = (result: ReturnType<typeof ActionSchema.safeParse>) =>
  result.success
    ? undefined
    : result.error.issues.find((i) => i.path.join('.') === 'confirmText');

describe('`confirmText` + non-empty `params` is refused on ActionSchema', () => {
  it('refuses the pair, at the `confirmText` path', () => {
    const result = ActionSchema.safeParse({
      ...base,
      confirmText: 'Reject this request?',
      params: oneParam,
    });

    expect(result.success).toBe(false);
    // The path is asserted because it is what an editor/CLI underlines. Pointing
    // at `params` would tell the author to delete the inputs they need; the key
    // that has to go is `confirmText`.
    expect(guardIssue(result)?.path).toEqual(['confirmText']);
  });

  it('says WHY, naming both keys and the remedy — not a bare rejection', () => {
    const result = ActionSchema.safeParse({
      ...base,
      confirmText: 'Reject this request?',
      params: oneParam,
    });
    const message = guardIssue(result)?.message ?? '';

    // Both halves of the offending pair, so the author can see what collided.
    expect(message).toContain('`confirmText`');
    expect(message).toContain('`params`');
    // The consequence, in user-visible terms rather than schema terms.
    expect(message).toContain('TWO dialogs');
    // The remedy, which is the whole point of the #7278 ruling.
    expect(message).toContain('`description`');
    // …and the remedy's own trap: the LLM-facing key one level down is NOT it.
    expect(message).toContain('ai.description');
    // The exception that keeps `confirmText` a live key rather than a retired
    // one — an author who reads only this message must not conclude otherwise.
    expect(message).toContain('param-LESS');
  });

  it('fires on the localized-map form of `confirmText` too, not just a string', () => {
    // `confirmText` is `I18nLabelSchema`, so a bare truthiness check written
    // against a string would miss the map form and let the defect back in
    // through the localized door.
    const result = ActionSchema.safeParse({
      ...base,
      confirmText: { en: 'Reject this request?', 'zh-CN': '拒绝该请求？' },
      params: oneParam,
    });

    expect(result.success).toBe(false);
    expect(guardIssue(result)?.path).toEqual(['confirmText']);
  });

  it('cannot be smuggled in through an ALIAS spelling — that door is shut upstream', () => {
    // `confirm` → `confirmText` and `inputs` → `params` are declared aliases on
    // this surface, and this repo REJECTS a near-miss with a rename arrow rather
    // than folding it silently (Prime Directive #12 — one contract, no dialects).
    // So the aliased pair never reaches this refinement at all: it is refused one
    // layer earlier, by key recognition. Pinned because the guard's coverage claim
    // depends on it — if aliases ever became a silent fold, the pair would arrive
    // post-fold and this test is where that change gets noticed.
    const result = ActionSchema.safeParse({
      ...base,
      confirm: 'Reject this request?',
      inputs: oneParam,
    });

    expect(result.success).toBe(false);
    const issue = result.success ? undefined : result.error.issues[0];
    expect(issue?.code).toBe('unrecognized_keys');
    expect(issue?.message).toContain('Did you mean `confirm` → `confirmText`');
    expect(issue?.message).toContain('`inputs` → `params`');
  });

  it('throws from `defineAction`, which is where an author meets it', () => {
    // A refusal is only worth having if it reaches the authoring call site —
    // `defineAction` is what the platform objects and every app actually call.
    expect(() =>
      defineAction({ ...base, confirmText: 'Reject this request?', params: oneParam }),
    ).toThrow(/TWO dialogs/);
  });
});

describe('what the `confirmText` + `params` guard must NOT touch', () => {
  it('accepts `confirmText` on a param-LESS action — the confirm is the only dialog', () => {
    const result = ActionSchema.safeParse({
      ...base,
      confirmText: 'Reject this request?',
    });

    expect(result.success).toBe(true);
  });

  it('accepts `confirmText` beside an EMPTY `params` array', () => {
    // An empty array collects nothing, so no second dialog opens. Refusing it
    // would be a refusal with no user-visible defect behind it.
    const result = ActionSchema.safeParse({ ...base, confirmText: 'Sure?', params: [] });

    expect(result.success).toBe(true);
  });

  it('accepts `params` + `description` — the one-dialog shape the confirm question migrated TO', () => {
    // If this ever goes red the guard has swallowed its own remedy and the two
    // migrations have nowhere to land.
    const result = ActionSchema.safeParse({
      ...base,
      description: 'Reject this request? Say why — the requester sees it.',
      params: oneParam,
    });

    expect(result.success).toBe(true);
  });

  it('does NOT additionally require `description` when `params` is present', () => {
    // Deliberately not widened (#7428 ruling 3): forbidding the pair is the
    // narrowest guard with measured pull behind it. Requiring dialog copy on
    // every param-collecting action is a strictly bigger authoring demand with
    // no measured failure behind it — it would need its own card.
    const result = ActionSchema.safeParse({ ...base, params: oneParam });

    expect(result.success).toBe(true);
  });
});

describe('the pair guard is scoped by SCHEMA BOUNDARY — the bulk def keeps the pair', () => {
  it('BulkActionDefSchema still ACCEPTS `confirmText` + non-empty `params`', () => {
    // The pinning test the boundary ruling asks for. This pairing is INTENDED
    // on the bulk surface: per that schema's own describe() text the params are
    // "inputs collected once before the run", `confirmText` is shown "above the
    // affected-record summary", and a `required` param "blocks the Confirm
    // button until a value is present" — one dialog, so there is no second one
    // to collapse. `examples/app-showcase`'s four defs are this shape and are
    // correct as written. A widening of the guard onto this schema lands here.
    const result = BulkActionDefSchema.safeParse({
      name: 'set_labels',
      label: 'Set Labels',
      operation: 'update',
      confirmText: 'Set these labels on every selected project?',
      params: [
        {
          name: 'labels',
          label: 'Labels',
          type: 'select',
          multiple: true,
          required: true,
          options: [{ label: 'Frontend', value: 'frontend' }],
        },
      ],
    });

    expect(result.success).toBe(true);
    // [#24798] The bulk def's `confirmText` is a `template` slot: the bare
    // string parses to its envelope, text unchanged.
    expect(result.success && result.data.confirmText)
      .toEqual({ dialect: 'template', source: 'Set these labels on every selected project?' });
    expect(result.success && result.data.params?.length).toBe(1);
  });

  it('the two schemas are independent — the bulk def is not validated by ActionSchema', () => {
    // The structural claim behind the pin above, asserted rather than assumed:
    // `BulkActionDefSchema` is its own `strictObject`, so the same literal is
    // not even a legal ACTION (no `operation` key on that surface). If the two
    // were ever unified, this goes red before the guard silently widens.
    const asAction = ActionSchema.safeParse({
      name: 'set_labels',
      label: 'Set Labels',
      operation: 'update',
      confirmText: 'Set these labels on every selected project?',
      params: [{ name: 'labels', label: 'Labels', type: 'select' }],
    });

    expect(asAction.success).toBe(false);
  });

});

describe('`confirmText` + non-empty `params` is refused on InlineActionSchema too', () => {
  // #29383 (ruling record 6595808462, letter A). An inline page action runs
  // through the registered action's runner — the `element:button` renderer
  // hands both keys to the same `ActionRunner`, which awaits the confirm and
  // THEN the param prompt — so the pair opens the same two dialogs here. The
  // inline pick carries `description`, so the remedy has a slot on this door.
  // Same predicate, same refusal: asserted against ActionSchema's own issue,
  // so a second wording drifting onto one door goes red.
  const inlineReject = {
    type: 'url',
    target: '/approvals?reject=1',
    label: 'Reject',
    params: [{ name: 'reason', label: 'Reason', type: 'textarea' }],
  } as const;

  it('refuses the pair at the `confirmText` path, with ActionSchema\'s own message', () => {
    const result = InlineActionSchema.safeParse({ ...inlineReject, confirmText: 'Reject this request?' });

    expect(result.success).toBe(false);
    const issue = result.success
      ? undefined
      : result.error.issues.find((i) => i.path.join('.') === 'confirmText');
    expect(issue?.code).toBe('custom');
    expect(issue?.path).toEqual(['confirmText']);

    const registered = guardIssue(ActionSchema.safeParse({
      ...base,
      confirmText: 'Reject this request?',
      params: oneParam,
    }));
    expect(issue?.message).toBe(registered?.message);
    expect(issue?.message).toContain('TWO dialogs');
    expect(issue?.message).toContain('`description`');
  });

  it('refuses the localized-map form of `confirmText` too', () => {
    const result = InlineActionSchema.safeParse({
      ...inlineReject,
      confirmText: { en: 'Reject this request?', 'zh-CN': '拒绝该请求？' },
    });

    expect(result.success).toBe(false);
    expect(result.success ? undefined : result.error.issues.map((i) => i.path.join('.')))
      .toContain('confirmText');
  });

  it('accepts the same action with the question on `description` and no `confirmText` — the remedy', () => {
    const result = InlineActionSchema.safeParse({
      ...inlineReject,
      description: 'Reject this request? Say why — the requester sees it.',
    });

    expect(result.success, JSON.stringify((result as { error?: unknown }).error)).toBe(true);
  });

  it('accepts `confirmText` on a param-LESS inline action — the confirm is the only dialog', () => {
    const result = InlineActionSchema.safeParse({
      type: 'url',
      target: '/approvals?reject=1',
      label: 'Reject',
      confirmText: 'Reject this request?',
    });

    expect(result.success, JSON.stringify((result as { error?: unknown }).error)).toBe(true);
  });

  it('accepts `confirmText` beside an EMPTY `params` array — nothing is collected, no second dialog', () => {
    const result = InlineActionSchema.safeParse({ ...inlineReject, params: [], confirmText: 'Reject this request?' });

    expect(result.success, JSON.stringify((result as { error?: unknown }).error)).toBe(true);
  });
});

describe('`confirmText` + non-empty ARRAY `params` is refused on the `action:button` row too', () => {
  // #29844 (ruling record 6597621758, letter A). The `action:button` block
  // forwards its row's `confirmText` and an array `params` (as `actionParams`)
  // to the same `ActionRunner`, which awaits the confirm and THEN the param
  // prompt — the same two dialogs. Same predicate, same refusal: asserted
  // against both other doors' issues, so a wording drifting onto one door goes
  // red. An object `params` on this row is the static values, which open no
  // dialog, so it keeps `confirmText`.
  const buttonReject = {
    label: 'Reject',
    actionType: 'api',
    target: '/api/v1/approvals/reject',
    params: [{ name: 'reason', label: 'Reason', type: 'textarea' }],
  } as const;

  const parseErrorOf = (result: { success: boolean; error?: unknown }) => JSON.stringify(result.error);

  it('refuses the pair at the `confirmText` path, with the other two doors\' message', () => {
    const result = ActionButtonPropsSchema.safeParse({ ...buttonReject, confirmText: 'Reject this request?' });

    expect(result.success).toBe(false);
    const issues = result.success ? [] : result.error.issues.filter((i) => i.path.join('.') === 'confirmText');
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('custom');
    expect(issues[0]?.path).toEqual(['confirmText']);

    const registered = guardIssue(ActionSchema.safeParse({
      ...base,
      confirmText: 'Reject this request?',
      params: oneParam,
    }));
    const inline = InlineActionSchema.safeParse({
      type: 'url',
      target: '/approvals?reject=1',
      label: 'Reject',
      params: oneParam,
      confirmText: 'Reject this request?',
    });
    const inlineIssue = inline.success ? undefined : inline.error.issues.find((i) => i.path.join('.') === 'confirmText');
    expect(registered?.message).toBeDefined();
    expect(issues[0]?.message).toBe(registered?.message);
    expect(issues[0]?.message).toBe(inlineIssue?.message);
  });

  it('accepts `description` beside an array `params` and no `confirmText` — the remedy', () => {
    const result = ActionButtonPropsSchema.safeParse({
      ...buttonReject,
      description: 'Reject this request? Say why — the requester sees it.',
    });

    expect(result.success, parseErrorOf(result)).toBe(true);
  });

  it('accepts `confirmText` on a row with no `params` — the confirm is the only dialog', () => {
    const { params: _params, ...paramless } = buttonReject;
    const result = ActionButtonPropsSchema.safeParse({ ...paramless, confirmText: 'Reject this request?' });

    expect(result.success, parseErrorOf(result)).toBe(true);
  });

  it('accepts `confirmText` beside an EMPTY `params` array — nothing is collected, no second dialog', () => {
    const result = ActionButtonPropsSchema.safeParse({ ...buttonReject, params: [], confirmText: 'Reject this request?' });

    expect(result.success, parseErrorOf(result)).toBe(true);
  });

  it('accepts `confirmText` beside an OBJECT `params` — static values, no param dialog opens', () => {
    const result = ActionButtonPropsSchema.safeParse({
      ...buttonReject,
      params: { reason: 'duplicate' },
      confirmText: 'Reject this request?',
    });

    expect(result.success, parseErrorOf(result)).toBe(true);
  });
});
