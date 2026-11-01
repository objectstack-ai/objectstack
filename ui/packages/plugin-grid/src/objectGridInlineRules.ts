/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The field rules an inline grid edit is checked against before it is sent
 * (objectstack-ai/objectstack#27520): the ones the record form checks, read
 * through the same `buildValidationRules` — `required`, `min` / `max`,
 * `minLength` / `maxLength` and the email / URL pattern — so a value the form
 * would refuse is refused here too, by the same rule, without a round trip.
 *
 * A row that breaks one is refused in the shape the server refuses it in, a
 * `VALIDATION_FAILED` error carrying one `fields[]` entry per broken rule, so
 * the table marks its cells and says its reasons exactly as it does for a
 * server refusal. The server stays the judge: everything it checks that is not
 * listed above (validation rules, uniqueness, state machines) still reaches it.
 */
import { buildValidationRules } from '@object-ui/fields';

/** One rule an edited value breaks: the server's `fields[]` entry shape. */
export interface InlineRuleRefusal {
  field: string;
  code: string;
  message: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A rule as `buildValidationRules` emits it: an authored message, or a key the caller localizes. */
interface EmittedRule {
  value?: unknown;
  message?: string;
  messageKey?: string;
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

/** The number an inline number editor staged, or `undefined` when it is not one. */
function numericValue(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function ruleMessage(
  rule: EmittedRule,
  t: Translate,
  label: string,
  interp: Record<string, unknown> = {},
): string {
  if (typeof rule.message === 'string' && rule.message) return rule.message;
  return t(rule.messageKey ?? 'validation.pattern', { field: label, ...interp });
}

/**
 * The rules `changes` breaks, one entry per broken rule, judged against each
 * changed field's declaration in `fields` (a field with no declaration is not
 * judged). `labelOf` names a field the way the grid's header does.
 */
export function inlineEditRuleRefusals(
  changes: Record<string, unknown>,
  fields: Record<string, unknown> | null | undefined,
  labelOf: (field: string) => string,
  t: Translate,
): InlineRuleRefusal[] {
  const refusals: InlineRuleRefusal[] = [];
  if (!fields) return refusals;
  for (const [field, value] of Object.entries(changes)) {
    const def = fields[field];
    if (!def || typeof def !== 'object') continue;
    // A rule set that cannot be read judges nothing: the server stays the judge.
    const rules = (buildValidationRules(def) ?? {}) as Record<string, unknown>;
    const label = labelOf(field);
    if (isBlank(value)) {
      if (rules.required) {
        refusals.push({
          field,
          code: 'required',
          message: typeof rules.required === 'string' ? rules.required : t('validation.required', { field: label }),
        });
      }
      continue;
    }
    const min = rules.min as EmittedRule | undefined;
    const max = rules.max as EmittedRule | undefined;
    const n = numericValue(value);
    if (n !== undefined && min && typeof min.value === 'number' && n < min.value) {
      refusals.push({ field, code: 'min_value', message: ruleMessage(min, t, label, { min: min.value }) });
    }
    if (n !== undefined && max && typeof max.value === 'number' && n > max.value) {
      refusals.push({ field, code: 'max_value', message: ruleMessage(max, t, label, { max: max.value }) });
    }
    if (typeof value === 'string') {
      const minLength = rules.minLength as EmittedRule | undefined;
      const maxLength = rules.maxLength as EmittedRule | undefined;
      const pattern = rules.pattern as (EmittedRule & { value?: RegExp }) | undefined;
      if (minLength && typeof minLength.value === 'number' && value.length < minLength.value) {
        refusals.push({ field, code: 'min_length', message: ruleMessage(minLength, t, label, { min: minLength.value }) });
      }
      if (maxLength && typeof maxLength.value === 'number' && value.length > maxLength.value) {
        refusals.push({ field, code: 'max_length', message: ruleMessage(maxLength, t, label, { max: maxLength.value }) });
      }
      if (pattern && pattern.value instanceof RegExp && !pattern.value.test(value)) {
        refusals.push({ field, code: 'pattern', message: ruleMessage(pattern, t, label) });
      }
    }
  }
  return refusals;
}

/**
 * A row refused before it was sent, in the shape the server's refusal arrives
 * in: `code: 'VALIDATION_FAILED'`, the reasons `; `-joined on `message`, and
 * the entries on `fields`.
 */
export function inlineRuleRefusalError(refusals: InlineRuleRefusal[]): Error {
  return Object.assign(new Error(refusals.map((r) => r.message).join('; ')), {
    code: 'VALIDATION_FAILED',
    fields: refusals,
  });
}
