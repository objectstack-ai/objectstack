// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35143 — what a select field's options are, read the way the record
 * validator judges a write (`objectql/src/validation/record-validator.ts`,
 * `optionValues`): the stored code is each option's `value` (a bare string
 * option is its own value and label), and a write of anything else is refused
 * `invalid_option`.
 *
 * Two rules read it: `flow-condition-option-label`
 * (`validate-flow-trigger-readiness.ts`, an option's label compared where the
 * row holds its value: a start condition, an edge condition, a `decision`
 * branch, a query filter's operand) and `flow-node-write-unknown-option`
 * (`validate-flow-node-writes.ts`, a CRUD write of a literal no option
 * carries). One reading, so the two cannot disagree about what an option is.
 *
 * A field is judged only when its options are in hand: an inline, non-empty
 * `options` array, no shared `picklist` (the registry folds that list in at
 * registration, so the stack does not hold it), and not a field two object
 * extensions tie on (which definition wins is registration order).
 */

import { flowFilterOperands } from '@objectstack/spec/automation';
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

/** One quoted literal, either quote (no escapes: a label with a quote in it is not judged). */
const QUOTED = String.raw`(?:'([^'\\]*)'|"([^"\\]*)")`;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * [#36964] How a condition reaches one object's fields: the variable roots a
 * read is spelled under (`record.F`, `deal.F`), and whether a bare `F` reads
 * the field too.
 */
export interface FieldReads {
  /** Roots a read may be spelled under, each followed by `.F`. */
  readonly roots: readonly string[];
  /** Whether a bare `F` reads the field (the flattened trigger record). */
  readonly bare: boolean;
  /**
   * Names a bare read does NOT reach the field by: a flow variable, node id
   * or screen field bound under the same name wins over the flattened field
   * (`seedRunVariables`), so a bare read of one is a read of that binding.
   */
  readonly shadowed?: ReadonlySet<string>;
}

/** The trigger record, as a start condition reads it: `record.F`, `previous.F` or bare `F`. */
export const TRIGGER_RECORD_READS: FieldReads = Object.freeze({ roots: ['record', 'previous'], bare: true });

/** A read of `field` under `reads`, not a member of something else. */
function readOf(field: string, reads: FieldReads): string {
  const roots = reads.roots.map(escapeRegExp).join('|');
  const bare = reads.bare && !reads.shadowed?.has(field);
  const root = roots ? String.raw`(?:(?:${roots})\.)${bare ? '?' : ''}` : '';
  if (!root && !bare) return String.raw`(?!)`;
  return String.raw`${root}${escapeRegExp(field)}(?![\w.])`;
}

/**
 * The quoted literals `src` compares with `field` itself: `F == 'L'`, `F != 'L'`,
 * `'L' == F`, `'L' != F`, and each member of `F in [...]`. A literal that sits
 * elsewhere in the source (the comparand of another field) is not one.
 */
function comparandsOf(src: string, field: string, reads: FieldReads): string[] {
  const read = readOf(field, reads);
  const lead = String.raw`(?:^|[^\w.])`;
  const out: string[] = [];
  const pick = (m: RegExpExecArray, at: number) => {
    const v = m[at] ?? m[at + 1];
    if (v !== undefined) out.push(v);
  };
  const fieldFirst = new RegExp(String.raw`${lead}${read}\s*(?:==|!=)\s*${QUOTED}`, 'g');
  for (let m = fieldFirst.exec(src); m; m = fieldFirst.exec(src)) pick(m, 1);
  const literalFirst = new RegExp(String.raw`${QUOTED}\s*(?:==|!=)\s*${read}`, 'g');
  for (let m = literalFirst.exec(src); m; m = literalFirst.exec(src)) pick(m, 1);
  const inList = new RegExp(String.raw`${lead}${read}\s+in\s*\[([^\]]*)\]`, 'g');
  for (let m = inList.exec(src); m; m = inList.exec(src)) {
    const members = new RegExp(QUOTED, 'g');
    for (let k = members.exec(m[1]); k; k = members.exec(m[1])) pick(k, 1);
  }
  return out;
}

/**
 * The option labels a CEL source compares a select field with, where the row
 * holds that option's value: the label must be the comparand of that field
 * (`F == 'L'`, `'L' != F`, `F in ['L', ...]`), not merely quoted somewhere in
 * the source. A label that is also some option's value is never reported
 * (the literal may be that value). `reads` says how the source reaches the
 * object's fields: the trigger record by default, a record variable
 * (`deal.F`) for a row a `get_record` step bound [#36964].
 */
export function optionLabelComparisons(
  src: string,
  options: ReadonlyMap<string, SelectOptions>,
  reads: FieldReads = TRIGGER_RECORD_READS,
): OptionLabelComparison[] {
  const out: OptionLabelComparison[] = [];
  for (const [field, opts] of options) {
    if (opts.labels.size === 0) continue;
    const seen = new Set<string>();
    for (const literal of comparandsOf(src, field, reads)) {
      const value = opts.labels.get(literal);
      if (value === undefined || seen.has(literal)) continue;
      seen.add(literal);
      out.push({ field, label: literal, value });
    }
  }
  return out;
}

/** [#36964] One label written as a query filter's operand where the value was meant. */
export interface OptionLabelOperand extends OptionLabelComparison {
  /** Where the operand sits inside the filter, as `flowFilterOperands` spells it. */
  readonly path: readonly (string | number)[];
  /**
   * Whether the operand excludes (`$ne`, `$nin`, or under an odd number of
   * `$not`), so the label excludes no record instead of matching none.
   */
  readonly negated: boolean;
}

/** The operators whose operand is compared with the field for (in)equality. */
const EQUALITY_OPERATORS: ReadonlySet<string> = new Set(['$eq', '$ne', '$in', '$nin']);
const EXCLUDING_OPERATORS: ReadonlySet<string> = new Set(['$ne', '$nin']);

/**
 * [#36964] The option labels a query filter (`get_record` / `update_record` /
 * `delete_record` `filter`, a time-relative sweep's `filter`) matches a select
 * field of its object against, where the row holds that option's value. The
 * filter is read the way the filter grammar reads it ({@link flowFilterOperands},
 * the spec's one walk of it): an operand counts when it is a field's implicit
 * equality, its `$eq` / `$ne` comparand or a member of its `$in` / `$nin`
 * list, at the top level or under `$and` / `$or` / `$not`. Not judged: a
 * nested-relation condition (the field is another object's), an ordering or
 * text operator, and any operand that is not a plain string — a CEL value
 * envelope is evaluated before the query, and a string carrying a brace is a
 * template or a query placeholder (`{current_user_id}`) resolved at run time.
 * A label that is also some option's value is never reported.
 */
export function optionLabelOperands(
  filter: unknown,
  options: ReadonlyMap<string, SelectOptions>,
): OptionLabelOperand[] {
  const out: OptionLabelOperand[] = [];
  for (const { path, value } of flowFilterOperands(filter)) {
    if (typeof value !== 'string' || value.includes('{')) continue;
    let at = 0;
    let negated = false;
    while (at < path.length) {
      const segment = path[at];
      if ((segment === '$and' || segment === '$or') && typeof path[at + 1] === 'number') at += 2;
      else if (segment === '$not') {
        negated = !negated;
        at += 1;
      } else break;
    }
    const field = path[at];
    if (typeof field !== 'string' || field.startsWith('$')) continue;
    const opts = options.get(field);
    const meant = opts?.labels.get(value);
    if (meant === undefined) continue;
    const rest = path.slice(at + 1);
    const operator = rest.length === 0 ? '$eq' : rest[0];
    if (typeof operator !== 'string' || !EQUALITY_OPERATORS.has(operator)) continue;
    // A list element is a member of `$in` / `$nin`; any deeper path is no operand of this field's.
    if (rest.length > 2 || (rest.length === 2 && (typeof rest[1] !== 'number' || !operator.endsWith('in')))) continue;
    out.push({
      field,
      label: value,
      value: meant,
      path,
      negated: negated !== EXCLUDING_OPERATORS.has(operator),
    });
  }
  return out;
}
