import React from 'react';
import { FilterBuilder, cn } from '@object-ui/components';
import { SchemaRendererContext } from '@object-ui/react';
import type { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/**
 * FilterConditionField — visual criteria builder for a stored FilterCondition
 * (e.g. `sys_sharing_rule.criteria_json`), scoped to the object chosen in a
 * sibling `object_name` field.
 *
 * Reached via the field `widget: 'filter-condition'` hint (resolves as
 * `field:filter-condition`). Reads the live `object_name` from
 * `dependentValues`, loads that object's fields via
 * `dataSource.getObjectSchema(...)`, and renders `<FilterBuilder>` over them —
 * so an admin builds `type == "customer" AND is_active == true` by picking
 * fields/operators instead of hand-writing JSON.
 *
 * Storage contract: the value round-trips as a **MongoDB-style object filter**
 * (`{ field: value }`, `{ field: { $gt: n } }`, `{ $or: [...] }`), JSON-encoded
 * — the exact shape the sharing evaluator spreads into `engine.find(object,
 * { filter })`. Criteria that can't be represented in the builder (nested
 * mixes, unknown operators) fall back to a raw-JSON editor so nothing is hidden
 * or lost; an "Edit as JSON" toggle is always available.
 */

interface FilterFieldDef {
  value: string;
  label: string;
  type?: string;
  options?: Array<{ value: string; label: string }>;
  referenceTo?: string;
}

interface BuilderCondition {
  id: string;
  field: string;
  operator: string;
  value: any;
}
interface BuilderGroup {
  id: string;
  logic: 'and' | 'or';
  conditions: BuilderCondition[];
}

const EMPTY_GROUP: BuilderGroup = { id: 'root', logic: 'and', conditions: [] };

/**
 * Opt-in FilterBuilder operators this widget offers (objectui#4736).
 *
 * The shared dropdown withholds these because two of its three consumers
 * persist into dialects that cannot carry them (see `OPT_IN_OPERATORS` in
 * `@object-ui/components`'s `filter-builder.tsx`). THIS widget can: its value
 * is a MongoDB-style `FieldOperatorsSchema` criteria that the server's engine
 * evaluates directly — never lowered through the array/triplet AST and never
 * folded into a `ViewFilterRule` — so the spec's `FILTER_OPERATORS` is the only
 * vocabulary it has to satisfy.
 *
 *   - `exists` / `notExists` author `$exists`, which `condToMongo` has emitted
 *     and `kvToCondition` has read back since objectui#2942. Naming them here
 *     is what KEEPS them reachable now that the shared dropdown no longer
 *     offers them to the list and view surfaces, whose dialects have no
 *     existence operator at all (objectui#4736). They are NOT folded onto
 *     `is_not_null` / `is_null` (objectui#9559 ruling B, objectui#9306): on the
 *     key-presence drivers that would change which records a stored sharing
 *     rule matches.
 *
 * The case-insensitive contains used to be named here too, as
 * `containsCaseInsensitive`. Since objectui#9306 it is the protocol's own
 * `icontains` and an ordinary operator every consumer is offered, so there is
 * nothing to opt into; it still authors `$icontains`, exactly as before.
 *
 * Module scope, not an inline literal: a fresh array each render would reset
 * `FilterBuilder`'s memo inputs on every keystroke.
 *
 * @internal exported for tests
 */
export const FILTER_CONDITION_EXTRA_OPERATORS: readonly string[] = [
  'exists',
  'notExists',
];

/** Field types that are not meaningfully filterable in a simple builder. */
const NON_FILTERABLE = new Set([
  'object', 'vector', 'file', 'image', 'avatar', 'signature',
  'richtext', 'html', 'markdown', 'location', 'grid', 'json', 'code',
]);

function deriveFilterFields(schema: any): FilterFieldDef[] {
  const raw = schema?.fields;
  const entries: Array<[string, any]> = Array.isArray(raw)
    ? raw.map((f: any) => [f?.name, f])
    : raw && typeof raw === 'object'
      ? Object.entries(raw)
      : [];
  const out: FilterFieldDef[] = [];
  for (const [name, f] of entries) {
    if (!name || !f || f.hidden) continue;
    const type = f.type as string | undefined;
    if (type && NON_FILTERABLE.has(type)) continue;
    out.push({
      value: name,
      label: f.label || name,
      type,
      options: Array.isArray(f.options)
        ? f.options.map((o: any) =>
            typeof o === 'string'
              ? { value: o, label: o }
              : { value: String(o?.value), label: String(o?.label ?? o?.value) },
          )
        : undefined,
      // ⚠️ objectui#6837 half 2: the READ narrows to `reference` (the only
      // spelling the protocol declares — `FieldSchema` refuses `reference_to`
      // by name). The EMITTED key is unchanged: it is what this emit's TARGET
      // contract declares, and renaming it would be a separate change.
      // Source here is `dataSource.getObjectSchema(objectName)` — an object
      // schema, i.e. the protocol. Target contract: the local `FilterFieldDef`,
      // which spells it camelCase `referenceTo`.
      referenceTo: f.reference,
    });
  }
  return out;
}

function coerceByType(value: any, type?: string): any {
  if (value == null) return value;
  if (type === 'boolean' || type === 'toggle') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  }
  if (type === 'number' || type === 'currency' || type === 'percent' || type === 'rating' || type === 'slider') {
    const n = Number(value);
    return Number.isFinite(n) && value !== '' ? n : value;
  }
  return value;
}

/**
 * The builder operators whose comparand is FREE TEXT typed into the value box,
 * and which therefore have an "operator chosen, box still empty" state
 * (objectui#8748).
 *
 * `is_empty` / `is_not_empty` / `is_null` / `exists` and their kin are not on
 * this list: they read no value at all, so an empty box is their normal resting
 * state rather than an unfinished row.
 *
 * Keyed, like every table in this file, on the builder's ids — which are the
 * protocol's canonical operator ids since objectui#9306. Rows reach this widget
 * from {@link kvToCondition} and from the builder's `onChange`, and both carry
 * those ids (the builder folds a deprecated camelCase id at its own read
 * boundary), so a camelCase key here would match nothing.
 *
 * ⚠️ This is a SECOND "is this row finished" rule, beside `isFilterValueComplete`
 * in `@object-ui/components`' `filter-builder.tsx`, and the divergence is
 * deliberate rather than a copy that drifted. That helper answers the VALUE
 * question for every operator its dropdown offers, so `equals ''` is unfinished
 * to it; here `equals ''` is a REAL predicate that has to keep being emitted
 * ("the field is the empty string" is a filter an admin can mean), and the only
 * rows that must not reach storage are the ones whose EMITTED DOCUMENT the spec
 * or the evaluator refuses — a free-text comparand the spec declares as a
 * refusal, and (objectui#9914) a range whose bound is still blank, see the
 * `between` arm of {@link condToMongo}. The test is the document, never the
 * dropdown's notion of a finished row: that is what lets `equals ''` keep being
 * emitted while `between ['1', '']` is dropped. Composing the two —
 * `TEXT_COMPARAND_OPERATORS.has(op) && !isFilterValueComplete(op, value)` — is
 * the same answer on THIS set today; it is not adopted because it would make
 * this drop depend on a helper marked `@internal` in another package, whose
 * vocabulary is the dropdown's rather than the spec's.
 */
const TEXT_COMPARAND_OPERATORS: ReadonlySet<string> = new Set([
  'contains',
  'icontains',
  'not_contains',
  'starts_with',
  'ends_with',
]);

/**
 * An unfilled cell: never typed in, or cleared back out — the ONE reading this
 * file makes of "the admin has not supplied this", for a free-text comparand
 * and for a range bound alike. Extended to the second caller by objectui#9914;
 * a second copy of the predicate is how the two would come to disagree.
 *
 * Spelled as `===` against the three unfilled shapes and never as `!value` —
 * the same reading `isValueUnset` in `@object-ui/components` spells out, and
 * for the same reason: `0` is a real bound on a number column and `false` is a
 * real value, so `!value` would drop a filter the admin can see on screen.
 */
function isUnfilledCell(value: any): boolean {
  return value === undefined || value === null || value === '';
}

function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return value == null ? [] : [value];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** `{ FIELD: { OP: comparand } }` — exactly one field and one operator — as `[FIELD, OP, comparand]`. */
function soleFieldOperator(frag: unknown): [string, string, unknown] | null {
  if (!isPlainObject(frag)) return null;
  const entries = Object.entries(frag);
  if (entries.length !== 1 || entries[0][0].startsWith('$')) return null;
  const [field, ops] = entries[0];
  if (!isPlainObject(ops)) return null;
  const opEntries = Object.entries(ops);
  return opEntries.length === 1 ? [field, opEntries[0][0], opEntries[0][1]] : null;
}

/**
 * The FIELD of a stored objectui#10790 "is empty" entry —
 * `$or: [{ FIELD: { $in: [''] } }, { FIELD: { $null: true } }]` — or `null`
 * when `v` (the value under an `$or` key) is anything else, including an `$or`
 * that means the same thing in another order or spelling, which reads back as
 * the ordinary OR group it is rather than being folded into this row.
 *
 * READ-ONLY since objectui#10813: this widget no longer WRITES that entry (see
 * the `is_empty` arm of {@link condToMongo}), but a criteria saved before then
 * still carries it, so it keeps opening as the same `is_empty` row and is
 * written in the spec's `$empty` spelling the next time the criteria is
 * edited. Reading alone rewrites nothing.
 */
function isEmptyEntryField(v: unknown): string | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const inHalf = soleFieldOperator(v[0]);
  const nullHalf = soleFieldOperator(v[1]);
  if (!inHalf || !nullHalf || inHalf[0] !== nullHalf[0]) return null;
  const [field, inOp, members] = inHalf;
  return inOp === '$in' && arraysEqual(members, ['']) && nullHalf[1] === '$null' && nullHalf[2] === true
    ? field
    : null;
}

/**
 * Builder condition → `$`-operator criteria. Exported for tests: this is the
 * chokepoint where a builder token becomes a spec `FieldOperatorsSchema` key,
 * and a wrong spelling here is rejected downstream by `convertFiltersToAST`
 * rather than at authoring time. @internal
 *
 * ⚠️ The arms are keyed on the builder's PROTOCOL ids (objectui#9306), and the
 * `default` arm stores an EQUALITY. So an operator id with no arm here is not
 * refused — it silently becomes `{ [field]: value }`, which for a
 * `greater_than_or_equal` row would share a different set of records than the
 * one on screen. Every id the dropdown can draw has its own arm, and
 * `filter-builder-protocol-ids-census-9306.test.ts` (app-shell) pins each one's
 * stored predicate, so a missing arm is a red test rather than a quiet `$eq`.
 */
export function condToMongo(c: BuilderCondition, typeOf: (f: string) => string | undefined): Record<string, any> | null {
  const { field, operator, value } = c || ({} as BuilderCondition);
  if (!field) return null;
  // objectui#8748 — an unfinished text row is DROPPED rather than emitted. This
  // widget used to emit `{ [field]: { $icontains: '' } }` verbatim for a row
  // whose operator was chosen and whose value box was still empty, and the only
  // drop on this path was the missing-FIELD guard above (`filterGroupToMongo`
  // drops null fragments, nothing else). That shape is a REFUSAL in
  // `@objectstack/spec`'s `FILTER_TEXT_CASES` — "every row contains the empty
  // substring, so evaluating it is a predicate that constrains nothing" — and
  // `ValueDataSource` now refuses it in the same change. Dropping here is what
  // makes that safe: without it the matcher's refusal would flip a half-built
  // builder row from "every row" to "no rows", the outcome that adapter's own
  // `$exists` arm names as worse than the bug. An all-empty builder therefore
  // yields NO criteria (`filterGroupToMongo` returns null), which the
  // empty-criteria guard already names out loud (objectstack#3896) rather than
  // storing a vacuous predicate.
  if (TEXT_COMPARAND_OPERATORS.has(operator) && isUnfilledCell(value)) return null;
  const t = typeOf(field);
  const cv = coerceByType(value, t);
  switch (operator) {
    case 'equals': return { [field]: cv };
    case 'not_equals': return { [field]: { $ne: cv } };
    case 'contains': return { [field]: { $contains: value } };
    // Case-insensitive contains (objectui#4023). `$contains` and its ASCII-case-
    // folding twin are two operators, not one with a flag: `contains` keeps
    // emitting `$contains` so stored criteria keep meaning what they meant.
    // The fold is ASCII-only by contract (objectstack#4706 Q1 = A) — `café` does
    // NOT match `CAFÉ` — which is why the label says "ignore case" rather than
    // promising an accent-blind search.
    case 'icontains': return { [field]: { $icontains: value } };
    // `$notContains` is the spec spelling (FieldOperatorsSchema, data/filter.zod.ts).
    // This emitted `$ncontains` — a token that appears nowhere in @objectstack/spec and
    // that convertFiltersToAST throws on, so every "does not contain" rule authored here
    // was rejected downstream. See kvToCondition for reading the old spelling back.
    case 'not_contains': return { [field]: { $notContains: value } };
    // String-specific spec operators — previously unreachable from the
    // builder UI even though FieldOperatorsSchema accepts them (#2942).
    case 'starts_with': return { [field]: { $startsWith: value } };
    case 'ends_with': return { [field]: { $endsWith: value } };
    // objectui#10813 — the spec's ONE 「is empty」 operator, `$empty` (ruling B
    // on objectstack#20311; admitted to `FILTER_OPERATORS` and made the lowering
    // of the view operators `is_empty` / `is_not_empty` by objectstack#20446).
    // What counts as empty is the field's DECLARED row of the spec's per-type
    // table — `''` on a text-like field, `[]` on a multi-value one, null alone
    // on every other type — and every evaluator expands it itself
    // (`expandEmptyOperator`). ⛔ No local copy of that table: this arm used to
    // spell its own meaning, "no value OR `''`" on EVERY type (objectui#10790's
    // `$or` of `$in: ['']` and `$null`), which reached a number or date column
    // as `IN ('')` and a JSON-stored multi-value column as an `$in` the SQL
    // driver refuses. `false` is the exact complement.
    case 'is_empty': return { [field]: { $empty: true } };
    case 'is_not_empty': return { [field]: { $empty: false } };
    // Null / existence spec operators. Distinct from is_empty/is_not_empty,
    // whose `$empty` also counts `''` (text-like) and `[]` (multi-value).
    case 'is_null': return { [field]: { $null: true } };
    case 'is_not_null': return { [field]: { $null: false } };
    case 'exists': return { [field]: { $exists: true } };
    case 'notExists': return { [field]: { $exists: false } };
    case 'greater_than':
    case 'after': return { [field]: { $gt: cv } };
    case 'less_than':
    case 'before': return { [field]: { $lt: cv } };
    case 'greater_than_or_equal': return { [field]: { $gte: cv } };
    case 'less_than_or_equal': return { [field]: { $lte: cv } };
    // objectui#9914 — a range reaches storage only once BOTH bounds are filled
    // in; a half-filled one is DROPPED, exactly as the unfinished text row
    // above is.
    //
    // This arm used to hand whatever was in the two boxes straight to
    // `coerceByType`, which returns `''` unchanged (its `value !== ''`
    // conjunct), so every unfinished range authored a document. Measured
    // against `ValueDataSource`'s matcher over four rows, the three shapes an
    // admin could produce are three DIFFERENT predicates, and not one of them
    // is the range being typed:
    //
    //   - `{ age: { $gte: 1, $lte: '' } }` matches NOTHING (`1 <= ''` is
    //     `1 <= 0`), so a sharing rule saved mid-edit silently shares nothing;
    //   - `{ age: { $gte: '', $lte: 5 } }` matches everything up to 5 —
    //     INCLUDING rows the real lower bound would have excluded, because `''`
    //     compares as `0`;
    //   - `{ age: {} }` — what an untouched `between` row emitted the moment
    //     the operator was picked, since the builder clears both bounds to `[]`
    //     and `JSON.stringify` drops the two `undefined`s — matches EVERY row.
    //     On a sharing rule that is the over-share `isMatchAllCriteria` exists
    //     to warn about and does not catch, because a field key with a nested
    //     object is not one of the vacuous shapes it recognises. That document
    //     also fails `kvToCondition`, so the widget forced ITSELF into raw-JSON
    //     mode and `between` was unreachable through the visual builder at all
    //     — objectui#8748's shape, on a second operator.
    //
    // Emitting the one bound that IS filled (`{ age: { $gte: 1 } }`) is a real
    // predicate and is deliberately NOT what happens: `isFilterValueComplete`
    // already rules that a range missing an end "is not a narrower range, it is
    // a query the server refuses", and both the view fold and the view-override
    // recovery pass drop such a row rather than narrow it. Guessing a one-sided
    // range here would author a filter the admin never typed, silently, into a
    // rule that decides who sees what.
    case 'between': {
      const [a, b] = Array.isArray(value) ? value : [undefined, undefined];
      if (isUnfilledCell(a) || isUnfilledCell(b)) return null;
      return { [field]: { $gte: coerceByType(a, t), $lte: coerceByType(b, t) } };
    }
    case 'in': return { [field]: { $in: toArray(value).map((v) => coerceByType(v, t)) } };
    case 'not_in': return { [field]: { $nin: toArray(value).map((v) => coerceByType(v, t)) } };
    default: return { [field]: cv };
  }
}

function filterGroupToMongo(group: BuilderGroup, typeOf: (f: string) => string | undefined): Record<string, any> | null {
  const frags = (group?.conditions ?? [])
    .map((c) => condToMongo(c, typeOf))
    .filter((x): x is Record<string, any> => !!x);
  // No conditions → no predicate. NOT "match all": a sharing rule with an
  // empty criteria is refused on save, and one already stored shares nothing
  // (objectstack#3896 / ADR-0049). `null` becomes an empty stored value, which
  // is what the required-criteria messaging below keys off.
  if (frags.length === 0) return null;
  if (group.logic === 'or') return { $or: frags };
  if (frags.length === 1) return frags[0];
  const keys = frags.flatMap((f) => Object.keys(f));
  const noCollision = new Set(keys).size === keys.length;
  return noCollision ? Object.assign({}, ...frags) : { $and: frags };
}

function arraysEqual(a: any, b: any[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * A criteria in its comparable form: the JSON of what is (or would be) stored,
 * with "no criteria at all" collapsed to `''` so `{}`, `null` and an empty box
 * are one key rather than three.
 *
 * This is how the builder's rows are told apart from an OUTSIDE change to the
 * stored value (objectui#8748) — see the `localGroup` state below. It compares
 * the STORED shape and not the rows, because the rows carry ids and unfinished
 * cells the stored shape never had.
 *
 * The `try` is defensive only: both inputs come from `JSON.parse` or from
 * `filterGroupToMongo` over such values, so neither can be cyclic. The sentinel
 * is a string `JSON.stringify` cannot produce, so an unserialisable criteria
 * compares equal to nothing at all — including itself — rather than passing for
 * "empty".
 */
function criteriaKey(mongo: any): string {
  if (mongo == null) return '';
  if (typeof mongo === 'object' && !Array.isArray(mongo) && Object.keys(mongo).length === 0) return '';
  try {
    return JSON.stringify(mongo) ?? '';
  } catch {
    return '[unserialisable criteria]';
  }
}

/**
 * Criteria → builder condition (the reverse of {@link condToMongo}). Returning
 * `null` makes the builder refuse to load the rule ("criteria can't be
 * represented"), so this must keep accepting spellings previously written.
 * The rows it produces carry the builder's protocol ids (objectui#9306); the
 * stored criteria are `$`-tokens, which that change did not touch.
 * @internal
 */
export function kvToCondition(field: string, v: any, idx: number): BuilderCondition | null {
  // A `$` key is a logical operator, not a field. The one such entry a builder
  // row ever stored is objectui#10790's "is empty" `$or` ({@link isEmptyEntryField},
  // read-only since objectui#10813); every other one is a criteria the builder
  // cannot draw as a row.
  if (field.startsWith('$')) {
    const target = field === '$or' ? isEmptyEntryField(v) : null;
    return target === null
      ? null
      : { id: `c_${idx}_${target}`, field: target, operator: 'is_empty', value: '' };
  }
  const id = `c_${idx}_${field}`;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { id, field, operator: 'equals', value: v };
  }
  const opKeys = Object.keys(v);
  if (opKeys.length === 1) {
    const op = opKeys[0];
    const val = v[op];
    switch (op) {
      case '$ne': return { id, field, operator: 'not_equals', value: val };
      case '$contains': return { id, field, operator: 'contains', value: val };
      // Without this arm a criteria the builder itself just wrote would fail to
      // load on reopen ("criteria can't be represented") and drop the admin into
      // the raw-JSON editor — the degradation objectui#4023 deliverable 2 names.
      case '$icontains': return { id, field, operator: 'icontains', value: val };
      // `$ncontains` is the pre-fix spelling this widget used to emit. Criteria saved
      // before the fix still carry it, so keep reading it — dropping it here would make
      // those rules fail to load ("criteria can't be represented") instead of migrating.
      case '$notContains':
      case '$ncontains': return { id, field, operator: 'not_contains', value: val };
      case '$gt': return { id, field, operator: 'greater_than', value: val };
      case '$lt': return { id, field, operator: 'less_than', value: val };
      case '$gte': return { id, field, operator: 'greater_than_or_equal', value: val };
      case '$lte': return { id, field, operator: 'less_than_or_equal', value: val };
      case '$startsWith': return { id, field, operator: 'starts_with', value: val };
      case '$endsWith': return { id, field, operator: 'ends_with', value: val };
      case '$null': return { id, field, operator: val === false ? 'is_not_null' : 'is_null', value: '' };
      case '$exists': return { id, field, operator: val === false ? 'notExists' : 'exists', value: '' };
      // objectui#10813 — what `condToMongo` writes for the empty pair. Only a
      // BOOLEAN flag reads as a row: the spec declares `$empty: z.boolean()`
      // and every evaluator refuses any other flag, so a `{ $empty: 'yes' }`
      // stays the raw criteria it is rather than opening as a row whose next
      // save would quietly turn it into a predicate that runs.
      case '$empty':
        return val === true
          ? { id, field, operator: 'is_empty', value: '' }
          : val === false
            ? { id, field, operator: 'is_not_empty', value: '' }
            : null;
      // `[null, '']` is the pre-objectui#10790 spelling of "is empty" /
      // "is not empty", which every objectstack filter face refuses. Rules
      // saved before the fix still carry it, so it keeps opening as the same
      // row — and the builder writes the accepted spelling (`$empty`, since
      // objectui#10813) the next time the criteria is edited. Reading alone
      // rewrites nothing.
      case '$in':
        return arraysEqual(val, [null, ''])
          ? { id, field, operator: 'is_empty', value: '' }
          : { id, field, operator: 'in', value: val };
      case '$nin':
        return arraysEqual(val, [null, ''])
          ? { id, field, operator: 'is_not_empty', value: '' }
          : { id, field, operator: 'not_in', value: val };
      default: return null;
    }
  }
  if (opKeys.length === 2 && '$gte' in v && '$lte' in v) {
    return { id, field, operator: 'between', value: [v.$gte, v.$lte] };
  }
  // "Is not empty" as `condToMongo` wrote it from objectui#10790 until
  // objectui#10813 moved the pair onto `$empty`: read-only, so a criteria saved
  // in between keeps opening as the same row (see {@link isEmptyEntryField}).
  if (opKeys.length === 2 && '$nin' in v && '$null' in v && arraysEqual(v.$nin, ['']) && v.$null === false) {
    return { id, field, operator: 'is_not_empty', value: '' };
  }
  return null;
}

/** Returns a BuilderGroup, or `null` when the criteria can't be represented. */
function mongoToFilterGroup(mongo: any): BuilderGroup | null {
  if (mongo == null) return { ...EMPTY_GROUP, conditions: [] };
  if (typeof mongo !== 'object' || Array.isArray(mongo)) return null;
  const entries = Object.entries(mongo);
  if (entries.length === 0) return { ...EMPTY_GROUP, conditions: [] };
  // A lone "is empty" row stored a lone `$or` from objectui#10790 until
  // objectui#10813; it is ONE row, not an OR group of its two halves. Read it
  // as the flat entry it is, below.
  if (entries.length === 1 && (mongo.$or || mongo.$and) && !kvToCondition(entries[0][0], entries[0][1], 0)) {
    const logic: 'and' | 'or' = mongo.$or ? 'or' : 'and';
    const arr = mongo.$or || mongo.$and;
    if (!Array.isArray(arr)) return null;
    const conditions: BuilderCondition[] = [];
    for (let i = 0; i < arr.length; i++) {
      const frag = arr[i];
      if (!frag || typeof frag !== 'object' || Object.keys(frag).length !== 1) return null;
      const field = Object.keys(frag)[0];
      // A `$` key reads only as the legacy "is empty" entry; `kvToCondition`
      // answers `null` for every other one.
      const c = kvToCondition(field, frag[field], i);
      if (!c) return null;
      conditions.push(c);
    }
    return { id: 'root', logic, conditions };
  }
  const conditions: BuilderCondition[] = [];
  let i = 0;
  for (const [field, v] of entries) {
    // Mixed logical + field → raw, except the legacy "is empty" `$or` entry,
    // which an AND group merged beside field keys (`kvToCondition` answers
    // `null` for every other `$` key).
    const c = kvToCondition(field, v, i++);
    if (!c) return null;
    conditions.push(c);
  }
  return { id: 'root', logic: 'and', conditions };
}

/**
 * Would this criteria select EVERY record of the object?
 *
 * Mirrors the server's `isMatchAllCriteria` (objectstack `plugin-sharing`,
 * objectstack-ai/objectstack#3896) closely enough to warn before the round-trip: blank, `{}`, `[]`, and
 * the vacuous combinators. Deliberately conservative in the same direction —
 * the cost of a false positive is one extra hint, the cost of a false negative
 * is a save that fails with a toast. The server stays authoritative.
 *
 * @internal exported for tests
 */
export function isMatchAllCriteria(parsed: any): boolean {
  if (parsed == null) return true;
  if (Array.isArray(parsed)) return parsed.every(isMatchAllCriteria);
  if (typeof parsed !== 'object') return true;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return true;
  for (const [key, value] of entries) {
    if (key === '$and') {
      if (!Array.isArray(value) || value.every(isMatchAllCriteria)) continue;
      return false;
    }
    if (key === '$or') {
      if (!Array.isArray(value) || value.length === 0 || value.some(isMatchAllCriteria)) continue;
      return false;
    }
    return false;
  }
  return true;
}

function stringifyValue(value: string | object | undefined | null): string {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function FilterConditionField({
  value,
  onChange,
  readonly,
  className,
  error,
  ...props
}: FieldWidgetComponentProps<string | object>) {
  const ctx = React.useContext(SchemaRendererContext);
  const { t } = useFieldTranslation();
  // Cast-free context read (objectui#7912); the local stays `any` for the
  // `FieldWidgetProps.dataSource?: unknown` channel it merges with.
  const dataSource: any = props.dataSource ?? ctx?.dataSource ?? null;
  const dependentValues: Record<string, any> = (props as any).dependentValues ?? {};
  const objectName = String(dependentValues.object_name ?? '');

  const [fields, setFields] = React.useState<FilterFieldDef[] | null>(null);

  React.useEffect(() => {
    setFields(null);
    if (!dataSource || !objectName || typeof dataSource.getObjectSchema !== 'function') return;
    let cancelled = false;
    (async () => {
      try {
        const schema = await dataSource.getObjectSchema(objectName);
        if (!cancelled) setFields(deriveFilterFields(schema));
      } catch {
        if (!cancelled) setFields([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataSource, objectName]);

  const rawValue = React.useMemo(() => stringifyValue(value), [value]);

  const parsed = React.useMemo(() => {
    if (!rawValue.trim()) return { mongo: {}, ok: true };
    try {
      return { mongo: JSON.parse(rawValue), ok: true };
    } catch {
      return { mongo: null, ok: false };
    }
  }, [rawValue]);

  const group = React.useMemo(
    () => (parsed.ok ? mongoToFilterGroup(parsed.mongo) : null),
    [parsed],
  );

  // Only flag a criteria that PARSES to match-all. Unparsable JSON has its own
  // message (`invalidJson`) and must not collect a second, contradictory one.
  const isEmptyCriteria = React.useMemo(
    () => parsed.ok && isMatchAllCriteria(parsed.mongo),
    [parsed],
  );

  // Raw JSON mode: forced when the stored value can't be represented in the
  // builder; otherwise opt-in via the toggle.
  const representable = parsed.ok && group !== null;
  const [rawMode, setRawMode] = React.useState<boolean>(!representable);
  React.useEffect(() => {
    if (!representable) setRawMode(true);
  }, [representable]);

  const typeOf = React.useMemo(() => {
    const map = new Map((fields ?? []).map((f) => [f.value, f.type]));
    return (f: string) => map.get(f);
  }, [fields]);

  /**
   * The builder's ROWS, held here — not projected from the stored criteria.
   *
   * objectui#8748. This widget is a controlled round-trip: it emits
   * `filterGroupToMongo(rows)` and reads the rows back out of the value it just
   * emitted. That was survivable only while every row round-tripped. Since the
   * same change makes `condToMongo` DROP a text row whose value box is still
   * empty, a projected row deletes itself: switching a row's operator to any of
   * `contains` / `icontains` / `not_contains` / `starts_with` /
   * `ends_with` emits no fragment, the criteria goes back to empty, and
   * `FilterBuilder` — which re-seeds its internal rows whenever the incoming
   * `value` differs from them — drops the row before a comparand can be typed.
   * Measured: those five operators were unreachable through this UI, except by
   * typing the value under `equals` first.
   *
   * So the rows are state and the stored criteria is what they EMIT. The drop
   * stays where it belongs — at emission — and an unfinished row stays on
   * screen, which is also what the `criteriaRequired` hint below is for.
   *
   * Re-seeded only by an OUTSIDE change: an incoming criteria that is no longer
   * what these rows emit (a different record, the raw-JSON editor, a form
   * reset). A parent that ignores what this widget emits is that same case by
   * construction — the stored value stays authoritative — which is the one
   * behaviour this keeps from the projection it replaces.
   */
  const [localGroup, setLocalGroup] = React.useState<BuilderGroup>(() => group ?? EMPTY_GROUP);

  const storedKey = parsed.ok ? criteriaKey(parsed.mongo) : null;
  const localKey = criteriaKey(filterGroupToMongo(localGroup, typeOf));

  React.useEffect(() => {
    // `group === null` is a criteria the builder cannot represent: raw-JSON
    // mode owns the value and there are no rows to seed.
    if (group === null || storedKey === null) return;
    if (storedKey !== localKey) setLocalGroup(group);
  }, [group, storedKey, localKey]);

  const handleBuilderChange = (g: BuilderGroup) => {
    setLocalGroup(g);
    const mongo = filterGroupToMongo(g, typeOf);
    onChange((mongo == null ? '' : JSON.stringify(mongo)) as any);
  };

  if (!objectName) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        {t('fields.filterCondition.selectObjectFirst')}
      </p>
    );
  }

  if (readonly) {
    if (!rawValue.trim()) {
      // Used to read "All records" — which was both wrong and the most
      // dangerous thing this widget could say (objectstack#3896). A rule with
      // no criteria has never usefully shared everything; it now shares
      // nothing and is refused on save, so name that instead.
      return (
        <span className={cn('text-sm text-destructive', className)}>
          {t('fields.filterCondition.noCriteria')}
        </span>
      );
    }
    return (
      <pre className={cn('overflow-x-auto rounded bg-muted/40 p-2 text-xs', className)}>
        {rawValue}
      </pre>
    );
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {rawMode ? (
        <>
          <textarea
            // DOM pass-through onto the raw-JSON editing surface
            // (objectui#3318). NOTE this widget stays on the #3318 ledger
            // regardless: its dependency-gated state (no `object_name` chosen
            // yet — the state a fresh form and the registry sweep render) is a
            // plain hint paragraph with no focusable control.
            {...toDomProps(props)}
            className="min-h-[96px] w-full rounded border bg-background px-2 py-1 font-mono text-xs"
            value={rawValue}
            placeholder='{ "type": "customer", "is_active": true }'
            onChange={(e) => onChange(e.target.value as any)}
            // The form's validation slot (#3222) OR this widget's own
            // unparsable-JSON state, which already renders its red message.
            aria-invalid={!!error || !parsed.ok}
          />
          {!parsed.ok && (
            <span className="text-xs text-destructive">{t('fields.filterCondition.invalidJson')}</span>
          )}
        </>
      ) : (
        <FilterBuilder
          fields={fields ?? []}
          value={localGroup as any}
          onChange={handleBuilderChange as any}
          extraOperators={FILTER_CONDITION_EXTRA_OPERATORS}
        />
      )}
      {/*
        The server refuses to save a criteria that would select every record
        (objectstack#3896), but that rejection only arrives as a toast after
        the admin hits Save. Say it here, while they are still looking at the
        empty builder — and never imply that leaving it empty means "share
        everything", which is what this widget used to do.
      */}
      {isEmptyCriteria && (
        <span className="text-xs text-destructive">
          {t('fields.filterCondition.criteriaRequired')}
        </span>
      )}
      <button
        type="button"
        className="self-start text-xs text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => setRawMode((m) => !m)}
        disabled={!representable && !rawMode}
        title={!representable ? t('fields.filterCondition.jsonOnly') : undefined}
      >
        {rawMode
          ? t('fields.filterCondition.useVisualBuilder')
          : t('fields.filterCondition.editAsJson')}
      </button>
    </div>
  );
}

export default FilterConditionField;
