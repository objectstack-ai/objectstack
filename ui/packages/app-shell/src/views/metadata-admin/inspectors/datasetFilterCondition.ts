// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Bridge between the visual {@link FilterBuilder} (a flat `FilterGroup` of
 * `{field, operator, value}` rows, whose operator ids are the protocol's own
 * `VIEW_FILTER_OPERATORS` spellings since objectui#9306) and the spec
 * `FilterCondition` (Mongo-style `{ field: { $op: value } }`, conjoined with
 * `$and`) stored on `dataset.filter` / `measure.filter`.
 *
 * Scope (deliberate): the visual editor supports the common case — a flat AND
 * of simple `field op value` conditions. Anything it can't faithfully round-trip
 * (nested groups, `$or`, multi-operator objects, unmapped operators, and a row
 * the builder cannot hold — see {@link builderHolds}) is reported as NOT
 * representable so the caller can fall back to the source editor instead of
 * silently corrupting the author's filter.
 *
 * The value-less operators are the exception to "field op value": the builder
 * draws no input for them, so the row is complete without one. Both pairs the
 * builder offers — `$empty` (is empty) and `$null` (is null) — are bridged
 * here, in {@link VALUELESS_TO_MONGO}.
 *
 * An operator that is NOT bridged is dropped, and dropping is where the danger
 * used to be: see {@link isClearedGroup} for why an unmapped operator is now
 * inert rather than destructive (objectui#9372).
 *
 * Whether a row is FINISHED is not this file's rule: it is the builder's own
 * `isFilterValueComplete`, the one arity-aware answer every write path asks
 * (objectui#5025). That is what lets the `between` arm map at all — a pair is
 * emitted only with both bounds present (objectui#10062).
 *
 * The write half is deliberately NOT injective — the spec carries one token for
 * "strictly greater", which both `greater_than` and `after` have to use — so the
 * read half cannot be a plain inverse table. {@link readBackOperator} settles
 * the ambiguous tokens against the field's own operator bucket (objectui#9382).
 */

import { isFilterValueComplete, operatorsForFieldType } from '@object-ui/components';

/**
 * FilterBuilder operator → FilterCondition Mongo operator.
 *
 * Keyed on the builder's ids, which are the protocol's canonical operator ids
 * since objectui#9306 (they were camelCase before). Every row reaching this
 * bridge carries one: the builder folds a stored deprecated camelCase id onto
 * its canonical twin at its own read boundary, and {@link conditionToGroup}
 * reads a stored `$`-token straight onto the canonical id. A camelCase key here
 * would therefore match nothing — and an unmatched operator is DROPPED (see the
 * `continue` in {@link groupToCondition}), so this table is pinned id for id,
 * with the stored predicate each one writes, by
 * `filter-builder-protocol-ids-census-9306.test.ts`.
 */
const OP_TO_MONGO: Record<string, string> = {
  equals: '$eq', not_equals: '$ne',
  greater_than: '$gt', greater_than_or_equal: '$gte', less_than: '$lt', less_than_or_equal: '$lte',
  after: '$gt', before: '$lt',
  contains: '$contains', in: '$in', not_in: '$nin',
  // objectui#9372. The builder offers these three only on its TEXT bucket,
  // which is the side the spec's declared-type door passes them on
  // (`TEXT_OPERATOR_DOOR_CASES`: `passes` over `text`, `door-refusal` over
  // `number` / `date` / `boolean`), and every filter backend answers them
  // against the same canonical table (`FILTER_TEXT_CASES`). So mapping them is
  // a bridge to a predicate the platform already agrees on, not a new claim.
  not_contains: '$notContains', starts_with: '$startsWith', ends_with: '$endsWith',
  // objectui#9306. The case-insensitive contains stopped being opt-in when the
  // dropdown took the protocol's id for it (see `OPT_IN_OPERATORS` in
  // `@object-ui/components`), so this inspector offers it on the text bucket
  // like any other text operator. It is bridged on exactly the ground the three
  // above are: `$icontains` is a `FILTER_OPERATORS` member, and both
  // `TEXT_OPERATOR_DOOR_CASES` and `FILTER_TEXT_CASES` carry it. It is the same
  // token `FilterConditionField` has always written for this row.
  icontains: '$icontains',
  // objectui#10062 (ruling batch #146 item 5, letter A). A PAIR operator,
  // offered on the builder's date bucket, stored as the spec's own
  // `{ $between: [lo, hi] }`. It was held back only because the builder can
  // hand this bridge a half-typed pair (`['2026-01-01', '']`) and nothing here
  // told that apart from a finished one. The rule that does exists —
  // `isFilterValueComplete` — and {@link groupToCondition} now asks it, so a
  // pair missing either bound is dropped as incomplete and never emitted.
  between: '$between',
};
/**
 * The DEFAULT read-back for each token — the answer when the field's declared
 * type is unknown, and the answer for every token only one operator writes.
 *
 * ⚠️ It cannot be the whole read half, because the write half is not injective:
 * see {@link MONGO_PREIMAGE} and {@link readBackOperator}.
 */
const MONGO_TO_OP: Record<string, string> = {
  $eq: 'equals', $ne: 'not_equals',
  $gt: 'greater_than', $gte: 'greater_than_or_equal', $lt: 'less_than', $lte: 'less_than_or_equal',
  $contains: 'contains', $in: 'in', $nin: 'not_in',
  $notContains: 'not_contains', $startsWith: 'starts_with', $endsWith: 'ends_with',
  $icontains: 'icontains',
  $between: 'between',
};

/**
 * Stored token → EVERY builder operator that writes it.
 *
 * Derived from {@link OP_TO_MONGO} rather than hand-listed, for the reason
 * `liveRows` states about its own two readers: a second copy of this relation
 * is exactly how the two halves drift apart.
 *
 * Measured over the whole domain the dropdown can build (objectui#9382): four
 * tokens have two operators writing them — `$empty` (`$exists` until
 * objectui#10813), `$null`, `$gt`, `$lt`. The first two are disambiguated by
 * their PAYLOAD, in the `$empty` / `$null` arms of {@link conditionToGroup},
 * because the stored value is the boolean that picks the operator. `$gt` / `$lt` carry the author's comparand instead,
 * so no bit of the stored condition tells `after` from `greater_than` — which
 * is why the field's declared type has to.
 */
const MONGO_PREIMAGE: Record<string, readonly string[]> = (() => {
  const out: Record<string, string[]> = {};
  for (const [op, token] of Object.entries(OP_TO_MONGO)) (out[token] ||= []).push(op);
  return out;
})();

/** A field as the inspector already describes it to the builder. */
export interface BuilderFieldDef { value: string; label?: string; type?: string }

/**
 * Which builder operator a stored token reads back as, on a field of this type.
 *
 * ## Why the type has to be consulted (objectui#9382)
 *
 * `after` and `greater_than` both write `$gt`, and the spec's filter vocabulary
 * has exactly one token for "strictly greater" — there is no `$after` for the
 * write half to have used. So the collapse is not a defect in what gets stored:
 * the stored filter is correct and filters correctly. What was lost is only the
 * LABEL, and the label is a function of the field's type, because that is what
 * decides which bucket the dropdown draws.
 *
 * Reading it back with a fixed table therefore handed the date buckets an
 * operator they do not offer. Measured on the pre-fix tree, over every
 * (field type, operator) pair the dropdown can build: 6 pairs broke — `before`
 * and `after` on each of `date`, `datetime` and `time` — and every other pair
 * round-tripped exactly. Driven in the real component, the consequence was a
 * BLANK operator trigger, and `reconcileOperatorForField` then settled that row
 * on `equals` as soon as the author touched its field picker, committing a
 * different filter than the one they had stored.
 *
 * ## The rule
 *
 * Among the operators that write this token, pick the one THIS field's bucket
 * offers. The bucket table is asked rather than copied, so the answer cannot
 * disagree with what the dropdown actually lists; `operatorsForFieldType` is
 * called with no opt-in extras because that is how the inspector mounts the
 * builder.
 *
 * ⛔ Deliberately not a widening. When the type is unknown, or when the bucket
 * offers neither candidate or both, this falls back to {@link MONGO_TO_OP} —
 * the unchanged default — rather than inventing an answer. Nothing new is
 * ACCEPTED here and no stored filter is rewritten; only the operator id the
 * panel is seeded with changes, and it changes to one the panel can draw.
 * Whether the fallback can then be drawn is not this function's question:
 * {@link builderHolds} asks it of every row, this one included.
 */
function readBackOperator(mop: string, fieldType: string | undefined): string | undefined {
  const candidates = MONGO_PREIMAGE[mop];
  if (fieldType && candidates && candidates.length > 1) {
    const offered = new Set(operatorsForFieldType(fieldType).map((o) => o.value));
    const settled = candidates.filter((c) => offered.has(c));
    if (settled.length === 1) return settled[0];
  }
  return MONGO_TO_OP[mop];
}

/**
 * Value-less builder operators, and the predicate each one lowers to.
 *
 * A row carrying one of these is COMPLETE without a value — the builder draws
 * no input for it — so they are matched ahead of the value-completeness check
 * in {@link groupToCondition}, not after it.
 *
 * `is_null` / `is_not_null` are not a spelling of `is_empty` / `is_not_empty`. The
 * dropdown offers both pairs as their own rows and the spec's filter vocabulary
 * carries both `$null` and `$empty`, so they stay distinct in both directions;
 * collapsing them would draw two labels for one wire predicate and rewrite the
 * author's choice when the filter is read back.
 *
 * objectui#10813: the empty pair writes the spec's ONE 「is empty」 operator,
 * `$empty` (ruling B on objectstack#20311; in `FILTER_OPERATORS` and the
 * lowering of the view operators `is_empty` / `is_not_empty` since
 * objectstack#20446). What counts as empty is the column's DECLARED row of the
 * spec's per-type table — `''` on a text-like column, `[]` on a multi-value
 * one, null alone on every other type — expanded by each evaluator
 * (`expandEmptyOperator`), so ⛔ no copy of that table lives here. It wrote
 * `$exists` before — the spec's has-a-value test (`!= null`), which never
 * counts `''` or `[]` — so one operator name, offered in three builders,
 * matched three record sets. A stored `$exists` is no longer read back as this pair —
 * see the note in {@link conditionToGroup}.
 *
 * objectui#9363: the null pair was missing here, so an `Is null` row — an
 * ordinary entry in this inspector's menu, drawn as a finished row — fell
 * through to the unmapped-operator `continue` below and was dropped. Dropping
 * the last surviving row makes this function return `undefined`, and the
 * inspector commits that as `{ filter: undefined }`, the same patch shape used
 * to CLEAR the filter. So picking the entry erased the author's stored filter,
 * with no error and the condition still on screen.
 */
const VALUELESS_TO_MONGO: Record<string, Record<string, boolean>> = {
  is_empty: { $empty: true }, is_not_empty: { $empty: false },
  is_null: { $null: true }, is_not_null: { $null: false },
};

export interface BuilderCondition { id?: string; field: string; operator: string; value?: unknown }
export interface BuilderGroup { id?: string; logic: 'and' | 'or'; conditions: BuilderCondition[] }

/**
 * The ObjectQL filter AST, owned by `@objectstack/spec/data`.
 *
 * This was `Record<string, any>` — a local declaration under the spec's own
 * name that carried none of its structure (objectstack#4115). Re-exporting the
 * real recursive type restores `$and` / `$or` / `$not` and the per-field
 * operator shape, so the bridge below is checked against what actually gets
 * stored on `dataset.filter` / `measure.filter`.
 *
 * NOTE for the sibling batches: unlike `@object-ui/types` and
 * `@object-ui/components`, app-shell's `FilterCondition` was NOT the
 * FilterBuilder row — that concept lives here under its own name,
 * `BuilderCondition` (above), and needed no rename. Do not fold this one into
 * the `FilterBuilderCondition` rename.
 */
export type { FilterCondition } from '@objectstack/spec/data';

import type { FilterCondition } from '@objectstack/spec/data';

/**
 * The rows this bridge will even look at. A row with no field picked is not
 * yet a row — the builder seeds one the moment "Add condition" is clicked —
 * so it is neither serialized nor counted as something the author typed.
 *
 * One definition, two readers: {@link groupToCondition} filters by it and
 * {@link isClearedGroup} counts it. Two copies of this predicate is exactly
 * how "the group is empty" and "the group serialized to nothing" could drift
 * apart again.
 */
function liveRows(group: BuilderGroup | undefined): BuilderCondition[] {
  return (group?.conditions ?? []).filter((c) => c && c.field);
}

/**
 * Is an `undefined` answer from {@link groupToCondition} the author CLEARING
 * the filter (objectui#9372)?
 *
 * ## The conflation this exists to end
 *
 * `undefined` out of {@link groupToCondition} meant two different things —
 * *"the author cleared the filter"* and *"nothing survived serialization"* —
 * and the only caller treated both as clear. Since the inspector commits on
 * every change, and the host applies patches as `{ ...draft, ...patch }`, that
 * commit SETS `filter` to `undefined`: the same patch shape
 * `objectChangePatch` uses deliberately to erase it. So a serialization that
 * produced nothing destroyed the author's stored filter.
 *
 * Reachable two ways, and both are the same defect:
 *
 *  - switching the only row to an operator this bridge does not map
 *    (objectui#9363 closed `isNull` / `isNotNull`, objectui#9372 the three
 *    text operators, objectui#10062 `between` — none this inspector offers is
 *    left, so the route now needs an operator it does not offer);
 *  - leaving the only row UNFINISHED, which needs no unmapped operator at all
 *    — a blanked value, or a `between` pair with one bound typed: the
 *    incomplete-row `continue` drops it and the last part goes with it.
 *
 * ## What the caller does with the answer
 *
 * `false` means "rows are still on screen": the caller must patch NOTHING and
 * leave the stored value alone. `true` — no rows at all, i.e. Clear all, or
 * the last row removed — is the author's own gesture and still commits
 * `undefined`.
 *
 * ⛔ Deliberately not "emit something for the unmapped operator". A filter
 * emitted in a spelling that means something else is worse than a dropped one,
 * which is the whole reason the unmapped arm exists; this makes the drop inert,
 * it does not stop it dropping.
 */
export function isClearedGroup(group: BuilderGroup | undefined): boolean {
  return liveRows(group).length === 0;
}

/** Serialize the visual group → a spec FilterCondition (flat `$and`). */
export function groupToCondition(group: BuilderGroup | undefined): FilterCondition | undefined {
  const conds = liveRows(group);
  const parts: FilterCondition[] = [];
  for (const c of conds) {
    const valueless = VALUELESS_TO_MONGO[c.operator];
    if (valueless) { parts.push({ [c.field]: { ...valueless } }); continue; }
    const mop = OP_TO_MONGO[c.operator];
    // Still dropped rather than emitted in a spelling that means something
    // else — that decision is the reason this arm exists and it is unchanged.
    //
    // What changed (objectui#9372) is the COST of the drop. It used to erase
    // the author's stored filter whenever no other row survived; now
    // {@link isClearedGroup} lets the caller tell that apart from a real clear,
    // so an unmapped operator is inert. Every operator this inspector offers
    // is mapped since objectui#10062 took `between` (the partition is pinned
    // in `datasetFilterCondition.nullOperators-9363`), so this arm now answers
    // only for an operator the builder would have to be GRANTED — an opt-in
    // this caller does not pass.
    if (!mop) continue;
    // Skip incomplete rows — emitting `{field:{$op:''}}` would be a
    // silently-wrong filter (matches only empty), not "no filter", and a
    // `between` pair with a blank bound is a range with a missing end, which
    // no reading turns into the range the author meant.
    //
    // ⛔ Not a local predicate. `isFilterValueComplete` is the builder's own
    // arity-aware answer (objectui#5025): for a scalar or list it is the exact
    // test this line used to spell inline, and for a `pair` it requires BOTH
    // bounds present, reading `0` and `false` as real bounds rather than
    // blanks. A second copy here is how the two came to disagree before.
    const v = c.value;
    if (!isFilterValueComplete(c.operator, v as Parameters<typeof isFilterValueComplete>[1])) continue;
    parts.push({ [c.field]: { [mop]: v } });
  }
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { $and: parts };
}

/**
 * Can the builder HOLD this read-back row: draw it as stored, and write it
 * back when the author edits any other row in its group (objectui#10257)?
 *
 * The inspector commits on every change, so every row {@link conditionToGroup}
 * opens goes back through {@link groupToCondition} as soon as the author
 * touches a SIBLING. A row this answers `false` for is one that commit would
 * rewrite or drop, so the whole filter goes to the Source tab instead. Two
 * questions, both asked of every row, whatever its token:
 *
 *  1. WOULD THE WRITE HALF KEEP IT? Asked of {@link groupToCondition} itself,
 *     not of a copy of its rules, so the two halves cannot give one shape
 *     different answers. This is what refuses an incomplete stored value — a
 *     `{ $eq: '' }`, a `{ $in: [] }`, a half `$between` — which the write half
 *     drops as an unfinished row. Read back as a row, it vanished the moment a
 *     sibling was edited; for `$in: []` that widened the dataset from no rows
 *     to every row.
 *
 *     ⛔ Not fixed on the write side instead. `equals ''` is also the row the
 *     builder SEEDS when "Add condition" is clicked, so a write half that kept
 *     `{ $eq: '' }` would emit a filter for every unfinished row — the
 *     silently-wrong filter its incomplete-row drop exists to prevent. The
 *     write half carries a shape only where a finished row means exactly that
 *     predicate (objectui#9363, objectui#9372); a shape it cannot carry stays
 *     out of the builder.
 *
 *  2. DOES THE COLUMN'S BUCKET OFFER ITS OPERATOR? Read back as an operator the
 *     dropdown does not list — `$in` on a date or number column, `$gt` on a
 *     text one, `$empty` on a boolean one — the panel draws a BLANK operator
 *     trigger (objectui#4768 / #7561), and one touch of the row's field picker
 *     reconciles it to `equals` and reshapes the value, committing a different
 *     filter than the one stored (the objectui#9382 defect). The bucket is
 *     asked exactly as the builder asks it for each row:
 *     `operatorsForFieldType` of the listed column's type, no opt-ins. A column
 *     listed without a type, or not listed at all, gets the builder's default
 *     text bucket for both — the bucket the panel WOULD draw, not an unknown
 *     one. Only a read with NO field list skips this: no caller that draws a
 *     panel reads that way, and it is the pure spec-shape read the field-less
 *     round-trip pins rely on.
 *
 * objectui#10062 asked both questions for the pair arity only, as a guard on
 * the `$between` it had just mapped; this is that guard for every token.
 */
function builderHolds(row: BuilderCondition, fields: ReadonlyArray<BuilderFieldDef> | undefined): boolean {
  if (groupToCondition({ logic: 'and', conditions: [row] }) === undefined) return false;
  if (!fields) return true;
  const fieldType = fields.find((f) => f.value === row.field)?.type;
  return operatorsForFieldType(fieldType).some((o) => o.value === row.operator);
}

/**
 * Parse a stored FilterCondition → the visual group. `representable: false` when
 * the condition uses shapes the flat builder can't faithfully edit (nested
 * `$and`/`$or`, multi-op objects, unmapped operators, and any row
 * {@link builderHolds} refuses) — callers should then show the source editor
 * instead.
 *
 * `fields` is the same list the caller hands the builder, and it is what lets
 * an ambiguous token read back as the operator that field's dropdown actually
 * offers — see {@link readBackOperator}. It is optional so the pure
 * spec-shape assertions keep working without one; omitting it restores the
 * fixed-table read, which is right for every token only one operator writes
 * and wrong only for the pairs {@link MONGO_PREIMAGE} names.
 */
export function conditionToGroup(
  cond: FilterCondition | undefined | null,
  fields?: ReadonlyArray<BuilderFieldDef>,
): { group: BuilderGroup; representable: boolean } {
  const empty: BuilderGroup = { id: 'g', logic: 'and', conditions: [] };
  if (cond == null) return { group: empty, representable: true };
  if (typeof cond !== 'object' || Array.isArray(cond)) return { group: empty, representable: false };
  if ('$or' in cond) return { group: empty, representable: false };

  const list: FilterCondition[] = Array.isArray((cond as any).$and) ? (cond as any).$and : [cond];
  const conditions: BuilderCondition[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { group: empty, representable: false };
    if ('$and' in c || '$or' in c) return { group: empty, representable: false };
    const keys = Object.keys(c);
    if (keys.length !== 1) return { group: empty, representable: false };
    const field = keys[0];
    const v = (c as any)[field];
    let row: BuilderCondition;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const opKeys = Object.keys(v);
      if (opKeys.length !== 1) return { group: empty, representable: false };
      const mop = opKeys[0];
      if (mop === '$empty') {
        // The inverse of the write half, as for `$null` below — but only a
        // BOOLEAN flag: the spec declares `$empty: z.boolean()` and every
        // evaluator refuses any other, so a non-boolean one goes to the Source
        // tab rather than opening as a row the next commit would make runnable.
        //
        // ⛔ A stored `$exists` no longer reads back as `is_empty` /
        // `is_not_empty` (objectui#10813). It is what this pair WROTE before,
        // but it is the has-a-value test (`!= null`) and `$empty` is not: read
        // back as the pair, a sibling edit would rewrite it to `$empty` and
        // move `''` / `[]` across the line — a stored filter changed by an
        // edit to a DIFFERENT row, which the invariant pinned for
        // {@link builderHolds} (objectui#10257) forbids.
        // This inspector offers no `exists` row either, so `$exists` falls to
        // the unmapped-token arm below and the filter opens in the Source tab,
        // stored bytes untouched.
        if (typeof v.$empty !== 'boolean') return { group: empty, representable: false };
        row = { id: `c${i}`, field, operator: v.$empty ? 'is_empty' : 'is_not_empty', value: '' };
      } else if (mop === '$null') {
        // The inverse of the write half: `$null: false` is "is not null", so
        // the boolean picks the operator rather than becoming the row's value.
        // Without this arm a filter this bridge now WRITES would read back as
        // non-representable, sending the author to the Source tab for a row the
        // builder can draw.
        row = { id: `c${i}`, field, operator: v.$null ? 'is_null' : 'is_not_null', value: '' };
      } else {
        const op = readBackOperator(mop, fields?.find((f) => f.value === field)?.type);
        if (!op) return { group: empty, representable: false };
        row = { id: `c${i}`, field, operator: op, value: v[mop] };
      }
    } else {
      row = { id: `c${i}`, field, operator: 'equals', value: v }; // implicit equality
    }
    // Every arm, every token: a row the builder cannot hold sends the whole
    // filter to the Source tab rather than opening where the next commit of
    // ANY row would rewrite or drop it (objectui#10257).
    if (!builderHolds(row, fields)) return { group: empty, representable: false };
    conditions.push(row);
  }
  return { group: { id: 'g', logic: 'and', conditions }, representable: true };
}
