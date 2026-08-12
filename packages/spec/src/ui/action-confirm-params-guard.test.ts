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
 * The rejection tests assert the issue PATH and the MESSAGE SUBSTANCE rather
 * than a bare `success === false`. One condition, one wording: a refusal whose
 * message does not name both keys and point at the remedy sends the author
 * looking for a different bug.
 */

import { describe, expect, it } from 'vitest';
import { ActionSchema, InlineActionSchema, defineAction } from './action.zod';
import { BulkActionDefSchema } from './bulk-action.zod';

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

describe('#7428 — `confirmText` + non-empty `params` is refused on ActionSchema', () => {
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

describe('#7428 — what the guard must NOT touch', () => {
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

  it('accepts `params` + `description` — the shape #7278 migrated TO', () => {
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

describe('#7428 — the guard is scoped to ActionSchema by SCHEMA BOUNDARY', () => {
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
    expect(result.success && result.data.confirmText)
      .toBe('Set these labels on every selected project?');
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

  it('InlineActionSchema is out of reach too — it picks fields, not this refine chain', () => {
    // Recording the guard's real blast radius rather than assuming it. Inline
    // actions derive from the shared field factory via `.pick()`, so no
    // refinement on `ActionSchema` reaches them — and the pick deliberately
    // omits `description`, so the #7278 remedy has no slot on that surface to
    // move a question into. Same reason the bulk defs were struck from the
    // target set: a refusal whose remedy is unreachable is a dead end, not a
    // guard. Whether the inline surface should gain `description` FIRST and the
    // guard SECOND is left open on #7428 rather than presumed here.
    const result = InlineActionSchema.safeParse({
      type: 'url',
      target: '/approvals?reject=1',
      label: 'Reject',
      confirmText: 'Reject this request?',
      params: [{ name: 'reason', label: 'Reason', type: 'textarea' }],
    });

    expect(result.success).toBe(true);
  });
});
