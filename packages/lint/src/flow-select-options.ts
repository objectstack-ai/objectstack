// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35143 — what a select field's options are, read the way the record
 * validator judges a write (`objectql/src/validation/record-validator.ts`,
 * `optionValues`): the stored code is each option's `value` (a bare string
 * option is its own value and label), and a write of anything else is refused
 * `invalid_option`.
 *
 * Two rules read it: `flow-condition-option-label`
 * (`validate-flow-trigger-readiness.ts`, a start condition comparing an
 * option's label) and `flow-node-write-unknown-option`
 * (`validate-flow-node-writes.ts`, a CRUD write of a literal no option
 * carries). One reading, so the two cannot disagree about what an option is.
 *
 * A field is judged only when its options are in hand: an inline, non-empty
 * `options` array, no shared `picklist` (the registry folds that list in at
 * registration, so the stack does not hold it), and not a field two object
 * extensions tie on (which definition wins is registration order).
 */

import { isMultiValueField } from '@objectstack/spec/data';
import { objectsAsServed, objectsWithoutTiedFields, recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Field types whose value is one or more option codes. */
const OPTION_FIELD_TYPES: ReadonlySet<string> = new Set(['select', 'radio', 'multiselect', 'checkboxes']);

/** One judgeable field's options. */
export interface SelectOptions {
  /** Every stored code, as text (the validator compares `String(value)`). */
  readonly values: ReadonlySet<string>;
  /** label → value, for options whose label is not also a value. */
  readonly labels: ReadonlyMap<string, string>;
  /** Whether the stored value is a list of codes. */
  readonly multiple: boolean;
  /** `readonly: true` — the validator judges such a value by shape only. */
  readonly readonly: boolean;
}

/** The options of one field definition, or `undefined` when they are not in hand. */
export function selectOptionsOf(def: unknown): SelectOptions | undefined {
  if (!isRec(def) || typeof def.type !== 'string' || !OPTION_FIELD_TYPES.has(def.type)) return undefined;
  if (typeof def.picklist === 'string' && def.picklist.length > 0) return undefined;
  if (!Array.isArray(def.options) || def.options.length === 0) return undefined;
  const values = new Set<string>();
  const pairs: Array<[string, string]> = [];
  for (const option of def.options) {
    if (typeof option === 'string') {
      values.add(option);
      continue;
    }
    if (!isRec(option) || option.value === undefined || option.value === null) continue;
    const value = String(option.value);
    values.add(value);
    if (typeof option.label === 'string') pairs.push([option.label, value]);
  }
  if (values.size === 0) return undefined;
  const labels = new Map<string, string>();
  for (const [label, value] of pairs) {
    if (label !== value && !values.has(label) && !labels.has(label)) labels.set(label, value);
  }
  return {
    values,
    labels,
    multiple: isMultiValueField(def as { type: string; multiple?: boolean }),
    readonly: def.readonly === true,
  };
}

/** object name → field name → its options, for every judgeable field of the stack's served objects. */
export function indexSelectOptions(stack: unknown): ReadonlyMap<string, ReadonlyMap<string, SelectOptions>> {
  const out = new Map<string, Map<string, SelectOptions>>();
  for (const obj of objectsWithoutTiedFields(objectsAsServed(stack))) {
    if (typeof obj.name !== 'string' || !obj.name) continue;
    const byField = new Map<string, SelectOptions>();
    for (const field of recordsOf(obj.fields)) {
      if (typeof field.name !== 'string' || !field.name) continue;
      const options = selectOptionsOf(field);
      if (options) byField.set(field.name, options);
    }
    out.set(obj.name, byField);
  }
  return out;
}

/** One label compared where the value was meant. */
export interface OptionLabelComparison {
  readonly field: string;
  readonly label: string;
  readonly value: string;
}

/** Is `literal` written in `src` as a quoted string, either quote? */
function hasQuotedLiteral(src: string, literal: string): boolean {
  return src.includes(`'${literal}'`) || src.includes(`"${literal}"`);
}

/** Is `field` read in `src` (`record.F`, `previous.F`, or bare `F`)? */
function readsField(src: string, field: string): boolean {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w.])(?:(?:record|previous)\\.)?${escaped}(?![\\w])`).test(src);
}

/**
 * The option labels a CEL source compares where the row holds values: a
 * select field of the object is read, one of its option labels is written as
 * a quoted literal, and that option's value is not. A label that is also some
 * option's value is never reported (the literal may be that value).
 */
export function optionLabelComparisons(
  src: string,
  options: ReadonlyMap<string, SelectOptions>,
): OptionLabelComparison[] {
  const out: OptionLabelComparison[] = [];
  for (const [field, opts] of options) {
    if (opts.labels.size === 0 || !readsField(src, field)) continue;
    for (const [label, value] of opts.labels) {
      if (hasQuotedLiteral(src, label) && !hasQuotedLiteral(src, value)) out.push({ field, label, value });
    }
  }
  return out;
}
