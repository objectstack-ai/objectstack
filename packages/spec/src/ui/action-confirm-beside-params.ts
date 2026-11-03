// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `confirmText` beside a non-empty `params`: TWO sequential dialogs for ONE
 * decision. ONE predicate and ONE refusal, read by the three doors that refuse
 * the pair: `ActionSchema` and `InlineActionSchema` (`action.zod.ts`), and the
 * page `action:button` row, `ActionButtonPropsSchema` (`component.zod.ts`).
 * Pinned in `action-confirm-params-guard.test.ts`, which asserts the three
 * messages equal.
 *
 * The console action runner awaits the confirm, THEN the param prompt (objectui
 * `packages/core/src/actions/ActionRunner.ts`), so the first dialog already
 * reads as "the action ran" while nothing has been sent. The `element:button`
 * renderer hands an inline action to that same runner, and the `action:button`
 * block forwards its row's `confirmText` and an array `params` (as
 * `actionParams`) to it too, so the pair opens the same two dialogs on all
 * three doors.
 *
 * An empty `params` collects nothing and opens no second dialog, so it is not
 * the pair. Nor is an object-form `params`: on an `action:button` row an object
 * is the static parameter values, which open no dialog, and the
 * `Array.isArray` read below leaves it alone.
 *
 * Lives in its own module, not in `action.zod.ts`, so `component.zod.ts` can
 * read it without the `export *` in `ui/index.ts` publishing it.
 */
export function declaresConfirmBesideParams(data: { confirmText?: unknown; params?: unknown }): boolean {
  return data.confirmText != null && Array.isArray(data.params) && data.params.length > 0;
}

export const CONFIRM_BESIDE_PARAMS_REFUSAL = {
  message:
    'An action that declares `confirmText` beside a non-empty `params` shows the user TWO dialogs '
    + 'for one decision — the confirm, then the param prompt, with nothing sent until the second. '
    + "Carry the confirm question in the action's top-level `description` instead (it renders under "
    + 'the param dialog\'s title) and drop `confirmText`: one condition, one wording, one dialog. '
    + 'Not `ai.description` — that is the LLM-facing tool contract. `confirmText` stays '
    + 'correct for a param-LESS action, where the confirm IS the only dialog, and for a view\'s '
    + '`bulkActionDefs`, where the pair renders one dialog by that schema\'s own contract.',
  path: ['confirmText'],
};
