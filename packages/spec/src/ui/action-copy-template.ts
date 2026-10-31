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
 * The param dialog's copy and the per-outcome toast joined the family
 * (#27948, ruling A, step 2): `ActionSchema.description`, each
 * `params[].helpText` (`ActionParamSchema`) and each `outcomeMessages` entry.
 * The same runner fills them, over the same roots as the key they stand
 * beside — the dialog copy over `confirmText`'s, an outcome over
 * `successMessage`'s — so one action speaks one hole syntax in all five keys.
 *
 * ## The roots are what the runner binds
 *
 * Each key's holes read a CLOSED scope, measured at the console's action
 * runner (`ActionRunner` in the `ui/` tree), not invented here:
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
 *    ({@link ACTION_ERROR_TEMPLATE_ROOTS}), so a hole there is literal text;
 *  - `description` and a param's `helpText` — `confirmText`'s roots: the
 *    param dialog opens before the run, over the record the action runs
 *    against, and a registered action's `params` is the input list the dialog
 *    collects, so it binds nothing ({@link actionConfirmTemplateRoots});
 *  - an `outcomeMessages` entry — `successMessage`'s roots, since it is the
 *    success toast for one `outcome` ({@link ACTION_SUCCESS_TEMPLATE_ROOTS}).
 *
 * The doors (`objectstack validate`, `objectstack compile`, the publish gate)
 * judge every sentence through the one template judge's closed-scope entry,
 * `closedScopeTemplateRefusal` (`automation/flow-text-slot-template.ts`), and
 * then compile it as a template. ⛔ Never a second reading of the dialect.
 *
 * ## The doors refuse; the parse keeps the blank arm
 *
 * Each key was a plain string (`ActionSchema`'s an `I18nLabel`, a param's
 * `helpText` a plain string), so a blank
 * sentence and a sentence carrying a `${…}` or `{x}` token parsed. They still
 * parse: the slot keeps a blank-string arm, because the boot load and the read
 * path judge a stored row with this parse, and dropping the arm would make a
 * stored blank sentence an invalid row on load, a narrowing wider than the
 * doors. The doors refuse instead (#25680): a blank sentence, a hole over a
 * root the key does not bind, a single-brace `{x}` token, a hole holding logic
 * or an unknown formatter, and a `${…}` token (the next section) are ERRORS,
 * so `objectstack validate` and `compile` fail and the publish gate answers
 * its 422. A stored row keeps loading until its next save, and that save is
 * judged.
 *
 * ## The `${…}` spelling
 *
 * Until these slots were typed, the console's runner filled `${…}` in them
 * (`${record.name}` through its expression evaluator for `confirmText`,
 * `${result.email}` for `successMessage`), and the platform's own sentences
 * were written that way. It no longer does (objectui#13476): a sentence with
 * no `{{ }}` hole is shown as written, and one with a hole is filled by the
 * template engine alone, so a `${…}` token is shown raw in every sentence of
 * every key, and the doors refuse it wherever it stands (#25709). The judge
 * reads a `${…}` token with its `$` and prescribes the `{{ }}` hole in its
 * place.
 *
 * `description`, `helpText` and `outcomeMessages` took the same road one step
 * later (#27948): the runner filled `${…}` in them until they were typed, and
 * still fills it in a sentence with no `{{ }}` hole, so copy stored before the
 * rewrite keeps reading until its next save. The rewrite is by hand: the
 * semantic migration entry `action-dialog-outcome-copy-template-holes` names it
 * and registers no conversion. The doors refuse a `${…}` token there as in the
 * other keys, so new copy is written with `{{ }}`.
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

/** The copy keys, as the doors name them. */
export type ActionCopyKey =
  | 'confirmText'
  | 'successMessage'
  | 'errorMessage'
  | 'description'
  | 'helpText'
  | 'outcomeMessages';

/** The copy keys a page action row carries (`ui/component.zod.ts`): the first three, the runner's own toast and dialog copy. */
export type ActionRowCopyKey = Extract<ActionCopyKey, 'confirmText' | 'successMessage' | 'errorMessage'>;

/** The sentence an example in a refusal shows for each key. */
const EXAMPLE: Record<ActionCopyKey, string> = {
  confirmText: 'Delete {{ record.name }}?',
  successMessage: 'Invitation sent to {{ result.email }}',
  errorMessage: 'The invitation could not be sent.',
  description: 'Choose the new role for {{ record.name }}.',
  helpText: 'Why {{ record.name }} is paused',
  outcomeMessages: 'Invitation resent to {{ result.email }}',
};

/** How a refusal names the slot: an `outcomeMessages` value is one entry, a `helpText` a param's. */
const SLOT_NAME: Record<ActionCopyKey, string> = {
  confirmText: "An action's `confirmText`",
  successMessage: "An action's `successMessage`",
  errorMessage: "An action's `errorMessage`",
  description: "An action's `description`",
  helpText: "An action param's `helpText`",
  outcomeMessages: "An action's `outcomeMessages` entry",
};

/** The refusal of a value that is neither a template string nor a template envelope (nor, where taken, a locale map). */
function dialectOnly(key: ActionCopyKey, localeMap: boolean): string {
  return `${SLOT_NAME[key]} is a template-typed slot: it accepts a bare template string, an envelope `
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
 * declare `dialect: 'template'` — then a blank-string arm, so a stored blank
 * sentence still loads while the doors refuse it (the module note); then, on
 * `ActionSchema`, the inline locale map its `I18nLabel` took.
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
  // Kept so a stored blank sentence still loads; the doors refuse it (#25680, the module note).
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
  'and refused at `objectstack validate`, `compile` and the publish gate; the text still parses, so a stored one '
  + 'loads until its next save.';

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

/** `description`'s describe: the param dialog's line, over `confirmText`'s roots (#27948). */
export const ACTION_DESCRIPTION_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032): a bare string is shorthand for `{ dialect: 'template', source }`, and text with no "
  + 'hole is shown as written. Holes are `{{ path }}` or `{{ path | formatter[:arg] }}` over `record`, the record the '
  + 'action runs against (the clicked row on a list, else the page\'s record); the values the dialog collects are not '
  + `bound, since the line shows before they exist. ${GRAMMAR} Example: 'Choose the new role for {{ record.name }}.'. A `
  + 'hole over any other root, a `${…}` or single-brace `{x}` token (each named with its `{{ }}` spelling), a hole '
  + `holding logic or an unknown formatter, and a blank sentence are named ${DOORS}`;

/** A param's `helpText` describe: the hint under one dialog input, over `confirmText`'s roots (#27948). */
export const ACTION_PARAM_HELP_TEXT_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032): a bare string is shorthand for `{ dialect: 'template', source }`, and text with no "
  + 'hole is shown as written. Holes are `{{ path }}` or `{{ path | formatter[:arg] }}` over `record`, the record the '
  + `action runs against; the dialog's own values are not bound. ${GRAMMAR} Example: 'Why {{ record.name }} is `
  + 'paused\'. A hole over any other root, a `${…}` or single-brace `{x}` token (each named with its `{{ }}` '
  + `spelling), a hole holding logic or an unknown formatter, and a blank sentence are named ${DOORS}`;

/** An `outcomeMessages` entry's describe: the success toast for one outcome, over `successMessage`'s roots (#27948). */
export const ACTION_OUTCOME_MESSAGE_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032): a bare string is shorthand for `{ dialect: 'template', source }`, and text with no "
  + 'hole is shown as written. Holes are `{{ path }}` or `{{ path | formatter[:arg] }}` over `result`, the payload '
  + 'the action\'s handler answered (`{{ result.email }}`), and `record`, the record the action ran against — the '
  + `roots \`successMessage\` reads. ${GRAMMAR} Example: 'Invitation resent to {{ result.email }}'. A hole over any `
  + 'other root, a `${…}` or single-brace `{x}` token (each named with its `{{ }}` spelling), a hole holding logic or '
  + `an unknown formatter, and a blank sentence are named ${DOORS}`;

/** `errorMessage`'s describe: a slot that fills no hole. */
export const ACTION_ERROR_MESSAGE_TEMPLATE_DESCRIBE =
  "a `template` slot (ADR-0032) that binds no root: a bare string is shorthand for `{ dialect: 'template', source }`, "
  + 'and the text is shown as written, so a `{{ }}` hole, a `${…}` or a `{x}` token in it is literal text. Each of '
  + `those, and a blank sentence, is named ${DOORS}`;
