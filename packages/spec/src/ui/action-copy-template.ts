// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import type { TypedExpressionRefusals } from '../shared/typed-expression-input';
import { InlineLocaleMapSchema } from './i18n.zod';

/**
 * @module ui/action-copy-template
 *
 * **An action's person-facing copy is a `template` slot** (#24814, ADR-0032
 * Decisions 2–3, ruling A): `confirmText`, `successMessage` and `errorMessage`
 * on the page action rows (`action:button`, `action:icon`, an `action:group` /
 * `action:menu` member — `ui/component.zod.ts`), and `confirmText` /
 * `successMessage` on `ActionSchema` (`ui/action.zod.ts`). The rows and the
 * registered action forward the same three keys to the one runner the console
 * dispatches through, so they are one family with one dialect.
 *
 * ## The roots are what the runner binds
 *
 * Each key's holes read a CLOSED scope, measured at the console's action
 * runner (objectui `ActionRunner`, the pinned `.objectui-sha`), not invented
 * here:
 *
 *  - `confirmText` — `record`, the record the action runs against (the clicked
 *    row on a list, else the page's record), and `params`, the action's
 *    STATIC parameter values when it has them: an object `params` on a page
 *    row. The values a param dialog collects do not exist yet when the
 *    confirmation shows, so an input list binds nothing
 *    ({@link actionConfirmTemplateRoots});
 *  - `successMessage` — `result`, the payload the handler answered, and
 *    `record` ({@link ACTION_SUCCESS_TEMPLATE_ROOTS});
 *  - `errorMessage` — nothing: the runner shows the text as written
 *    ({@link ACTION_ERROR_TEMPLATE_ROOTS}), so a hole there is literal text.
 *
 * The doors (`objectstack validate`, `objectstack compile`, the publish gate)
 * judge every sentence through the one template judge's closed-scope entry,
 * `closedScopeTemplateRefusal` (`automation/flow-text-slot-template.ts`), and
 * then compile it as a template. ⛔ Never a second reading of the dialect.
 *
 * ## Widening only: the blank arm, and warnings at the doors
 *
 * Each key was a plain string (`ActionSchema`'s an `I18nLabel`), so a blank
 * sentence and a sentence carrying a `${…}` or `{x}` token parsed. Both still
 * parse: the slot keeps a blank-string arm, and the doors' findings are
 * WARNINGS — an advisory at the publish gate, never a refusal. Refusing them
 * is a narrowing no ADR-0087 conversion carries, so it is its own card.
 *
 * ## The `${…}` spelling
 *
 * Until these slots were typed, the console's runner filled `${…}` in them
 * (`${record.name}` through its expression evaluator for `confirmText`,
 * `${result.email}` for `successMessage`), and the platform's own sentences
 * were written that way. The runner still fills `${…}` in a sentence that
 * carries no `{{ }}` hole, for the transition; a sentence with a `{{ }}` hole
 * is filled by the template engine alone. The judge reads a `${…}` token with
 * its `$` and prescribes the `{{ }}` hole in its place.
 */

/** The root a `confirmText` / `successMessage` hole names for the record the action runs against. */
export const ACTION_COPY_RECORD_ROOT = 'record';

/**
 * The root a `confirmText` hole names for the action's static parameter
 * values — bound only when the action HAS them ({@link actionConfirmTemplateRoots}).
 */
export const ACTION_CONFIRM_PARAMS_ROOT = 'params';

/** The root a `successMessage` hole names for the payload the action's handler answered. */
export const ACTION_SUCCESS_RESULT_ROOT = 'result';

/**
 * The roots an action's `confirmText` holes may name — its CLOSED scope:
 * {@link ACTION_COPY_RECORD_ROOT}, then {@link ACTION_CONFIRM_PARAMS_ROOT}
 * when `action.params` is an object of static values. The runner binds
 * `params` to that object only; an array `params` is the list of inputs a
 * dialog collects AFTER the confirmation, so it binds nothing, and a
 * registered action's `params` is always that list.
 */
export function actionConfirmTemplateRoots(action: { readonly params?: unknown }): string[] {
  const params = action.params;
  const staticValues = params !== null && typeof params === 'object' && !Array.isArray(params);
  return staticValues ? [ACTION_COPY_RECORD_ROOT, ACTION_CONFIRM_PARAMS_ROOT] : [ACTION_COPY_RECORD_ROOT];
}

/** The roots an action's `successMessage` holes may name: the handler's answer, then the record. */
export const ACTION_SUCCESS_TEMPLATE_ROOTS: readonly string[] = Object.freeze([
  ACTION_SUCCESS_RESULT_ROOT,
  ACTION_COPY_RECORD_ROOT,
]);

/**
 * The roots an action's `errorMessage` holes may name: none. The runner shows
 * an authored `errorMessage` as written, so no hole is filled there.
 */
export const ACTION_ERROR_TEMPLATE_ROOTS: readonly string[] = Object.freeze([]);

/** The three copy keys, as the doors name them. */
export type ActionCopyKey = 'confirmText' | 'successMessage' | 'errorMessage';

/** The sentence an example in a refusal shows for each key. */
const EXAMPLE: Record<ActionCopyKey, string> = {
  confirmText: 'Delete {{ record.name }}?',
  successMessage: 'Invitation sent to {{ result.email }}',
  errorMessage: 'The invitation could not be sent.',
};

/** The refusal of a value that is neither a template string nor a template envelope (nor, where taken, a locale map). */
function dialectOnly(key: ActionCopyKey, localeMap: boolean): string {
  return `An action's \`${key}\` is a template-typed slot: it accepts a bare template string, an envelope `
    + `declaring \`dialect: 'template'\`${localeMap ? ', or an inline locale map ({ en, "zh-CN" })' : ''} only. `
    + `Write \`'${EXAMPLE[key]}'\` or \`{ dialect: 'template', source: '${EXAMPLE[key]}' }\`.`;
}

/**
 * The two sentences one copy key's template input refuses with
 * (`templateExpressionInput`'s `refusals`): both prescribe the key's own
 * sentence, so a refusal names the slot the author wrote.
 */
export function actionCopyRefusals(key: ActionCopyKey, options: { localeMap?: boolean } = {}): TypedExpressionRefusals {
  const refusal = dialectOnly(key, options.localeMap === true);
  return { sourceRequired: refusal, dialectOnly: refusal };
}

/**
 * The slot one copy key declares, around its `template` input: ADR-0032's
 * `template` dialect, the input `TemplateExpressionInputSchema` takes — a bare
 * string is shorthand for `{ dialect: 'template', source }`, an envelope must
 * declare `dialect: 'template'` — then a blank-string arm, so the parse does
 * not narrow (the module note); then, on `ActionSchema`, the inline locale map
 * its `I18nLabel` took.
 *
 * The `template` input itself is built at each declaring `.zod.ts` file
 * (`templateExpressionInput(ExpressionSchema, actionCopyRefusals(key))`), not
 * here: the expression-surface census (the conformance ledger's scan) reads
 * `.zod.ts` files, and a slot whose input is constructed in a plain module is
 * a declared expression surface that census never sees.
 */
export function actionCopyTemplateSlot<T extends z.ZodType>(
  template: T,
  key: ActionCopyKey,
  options: { localeMap?: boolean } = {},
) {
  const { dialectOnly: refusal } = actionCopyRefusals(key, options);
  // `trim()`'s whitespace set is exactly `\s` (ECMA-262), so this arm takes the blank strings
  // `NON_BLANK_STRING` refuses — as a `pattern` the JSON Schema carries, not a dropped refinement.
  const blank = z.string().regex(/^\s*$/);
  return options.localeMap === true
    ? z.union([template, blank, InlineLocaleMapSchema], { error: () => refusal })
    : z.union([template, blank], { error: () => refusal });
}

/** What every copy key's describe says about the shared grammar and the doors. */
const GRAMMAR =
  'Formatters come from the template engine\'s whitelist (`TEMPLATE_FORMATTERS`, `@objectstack/formula`); a hole '
  + 'holds no logic (no CEL, no arithmetic).';

const DOORS =
  'at `objectstack validate`, `compile` and the publish gate, as warnings: the text still parses and saves.';

/** `confirmText`'s describe: its roots, by where the action's static values live. */
export const ACTION_CONFIRM_TEXT_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032): a bare string is shorthand for `{ dialect: 'template', source }`, and text with no "
  + 'hole is shown as written. Holes are `{{ path }}` or `{{ path | formatter[:arg] }}` over `record`, the record the '
  + 'action runs against (the clicked row on a list, else the page\'s record), and — only when the action\'s `params` '
  + 'is an object of static values — `params` (`{{ params.tier }}`); an input list binds nothing, since its values '
  + `are collected after the confirmation. ${GRAMMAR} Example: 'Delete {{ record.name }}?'. A hole over any other `
  + 'root, a `${…}` or single-brace `{x}` token (each named with its `{{ }}` spelling), a hole holding logic or an '
  + `unknown formatter, and a blank sentence are named ${DOORS}`;

/** `successMessage`'s describe. */
export const ACTION_SUCCESS_MESSAGE_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032): a bare string is shorthand for `{ dialect: 'template', source }`, and text with no "
  + 'hole is shown as written. Holes are `{{ path }}` or `{{ path | formatter[:arg] }}` over `result`, the payload '
  + 'the action\'s handler answered (`{{ result.email }}`; for an `api` or `script` action the server response), and '
  + `\`record\`, the record the action ran against. ${GRAMMAR} Example: 'Invitation sent to {{ result.email }}'. A `
  + 'hole over any other root, a `${…}` or single-brace `{x}` token (each named with its `{{ }}` spelling), a hole '
  + `holding logic or an unknown formatter, and a blank sentence are named ${DOORS}`;

/** `errorMessage`'s describe: a slot that fills no hole. */
export const ACTION_ERROR_MESSAGE_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032) that binds no root: a bare string is shorthand for `{ dialect: 'template', source }`, "
  + 'and the text is shown as written, so a `{{ }}` hole, a `${…}` or a `{x}` token in it is literal text. Each of '
  + `those, and a blank sentence, is named ${DOORS}`;
