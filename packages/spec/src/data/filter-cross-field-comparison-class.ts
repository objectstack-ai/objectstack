// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20347] The cross-field **comparison class** — which two DECLARED columns a
 * field-to-field comparison may put on its two sides:
 * `{ a: { $eq: { $field: 'b' } } }`, and the same shape under `$ne` / `$gt` /
 * `$gte` / `$lt` / `$lte` (the lowering of `record.a == record.b`, `!=`, `>`,
 * `>=`, `<`, `<=` in an RLS predicate or a sharing-rule condition).
 *
 * ## Why one classification, exported once
 *
 * Three judges ask this question of one comparison:
 *
 * - **driver-sql**, when it compiles a read — the #5222 validation boundary
 *   refuses a comparison between two columns of different classes, or against
 *   a column with no class, with `INVALID_FILTER` / 400;
 * - **the in-process write check** (`matches-filter`), when an RLS `check` is
 *   evaluated against a post-image;
 * - **the authoring door** — `@objectstack/lint`'s RLS and sharing-rule
 *   enforceability rules, which hold the declared field map and can say so
 *   before anything runs.
 *
 * Until this module the rule lived in driver-sql alone, as a module-private
 * function (`crossFieldComparisonClass`), so the authoring door had nothing to
 * read and the write check had no rule. Measured on one RLS policy,
 * `record.status != record.amount` (text vs number) or
 * `record.status != record.photo` (text vs image): `os validate` said valid,
 * the `find` its `using` scopes answered `INVALID_FILTER` / 400 on driver-sql,
 * and an `insert` its `check` judges was admitted and stored — one policy,
 * three answers. This module is the one definition every judge reads.
 *
 * ## The rule, lifted case for case from driver-sql
 *
 * A column has a comparison CLASS when its stored value is one scalar of a
 * shape SQL and the in-memory evaluator read the same way. Six classes, each
 * spelled by REFERENCE to the existing `field-value.zod.ts` value classes, so a
 * member added to one of those sets later is classified without a change here:
 *
 * | class      | declared types                                                                   |
 * |:-----------|:---------------------------------------------------------------------------------|
 * | `numeric`  | `NUMERIC_VALUE_TYPES`                                                            |
 * | `text`     | `STRING_VALUE_TYPES`, `autonumber`, `SINGLE_OPTION_TYPES`, `REFERENCE_VALUE_TYPES` |
 * | `boolean`  | `BOOLEAN_VALUE_TYPES`                                                            |
 * | `date`     | `CALENDAR_DATE_TYPES`                                                            |
 * | `datetime` | `INSTANT_TYPES`                                                                  |
 * | `time`     | `CLOCK_TIME_TYPES`                                                               |
 *
 * Three families have NO class, and no comparison against them is compiled:
 *
 * - **`list-or-object`** — `STRUCTURED_JSON_TYPES`, `MULTI_OPTION_TYPES`, and
 *   any multi-capable type flagged `multiple: true` (`isMultiValueField`):
 *   element-wise semantics SQL comparison operators do not have.
 * - **`file`** — `FILE_REFERENCE_TYPES`, refused BY NAME and independent of
 *   the deployment. During the ADR-0104 dual-encoding window one media column
 *   can hold a bare id and another the JSON-quoted form of the same id, so no
 *   comparison against the family is provably one answer on every path.
 * - **`formula`** — virtual: there is no stored column to reference. This
 *   holds whatever the formula's `returnType` — unlike the text-operator door
 *   (`filter-text-operator-declared-type.ts`), which judges a formula by its
 *   return type, a column-to-column comparison needs a COLUMN on both sides.
 *
 * A comparison is **comparable** only when both columns have a class and it is
 * the same class. The rule is symmetric and deliberately covers pairings that
 * happen to agree on one backend: across classes SQLite orders by storage class
 * (every TEXT above every INTEGER) while JS relational operators coerce, so
 * `{ stage: { $gt: { $field: 'amount' } } }` returned four rows on SQLite and
 * none in memory when driver-sql measured it; a `boolean` column holds `0/1`
 * where a record holds `true/false`; and the three temporal classes store three
 * different text shapes. Refusing a pairing that would have agreed costs an
 * author a message; admitting one that diverges costs a permission rule its
 * meaning.
 *
 * `crossFieldComparisonClass` in `@objectstack/driver-sql` delegates to
 * {@link crossFieldColumnVerdict} for every declared field type, so the two
 * cannot disagree on a single pair; the driver-internal aliases it keeps above
 * this table are pinned by `sql-driver-20355-cross-field-class-driver-aliases.test.ts`.
 *
 * ## Declared types only
 *
 * The table is over `FieldType` members, exactly once each (pinned). A type
 * outside `FieldType` — a driver-internal alias (`integer` / `int` / `float`
 * are numeric columns, `object` / `array` JSON columns, `string` is driver-sql's
 * default for an absent type), an introspected column — is not a declaration
 * this table judges: {@link crossFieldColumnVerdict} answers `undefined` and
 * {@link crossFieldComparisonVerdict} `unjudged`. A driver layers its own
 * aliases above this table, as `field-value.zod.ts`'s header says every
 * driver-internal alias does.
 *
 * ## What this module is
 *
 * The contract only — the classes, the class table, and two pure verdict
 * functions. It writes no door and carries no runtime logic (Prime Directive
 * #2). The authoring door reads it in `@objectstack/lint`
 * (`validate-rls-predicate-enforceability.ts`, `validate-sharing-rule-enforceability.ts`);
 * the engine lane rewires driver-sql and the write check onto it.
 *
 * @see FILE_REFERENCE_TYPES / STRUCTURED_JSON_TYPES / isMultiValueField — the no-class families.
 * @see TEXT_OPERATOR_DOOR_TYPE_CLASSES — the neighbouring declared-type table this one is shaped after.
 */

import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  FILE_REFERENCE_TYPES,
  INSTANT_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
  isMultiValueField,
} from './field-value.zod';

/* ────────────────────────────────────────────────────────────────────────────
 * The classes, and the families with none
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The six comparison classes. Two columns are comparable only within one of
 * them. The names are driver-sql's, so a refusal it logs ("stored as numeric")
 * and a verdict read here name a class the same way.
 */
export const CROSS_FIELD_COMPARISON_CLASSES = [
  'numeric',
  'text',
  'boolean',
  'date',
  'datetime',
  'time',
] as const;

export type CrossFieldComparisonClass = (typeof CROSS_FIELD_COMPARISON_CLASSES)[number];

/**
 * Why a declared column has NO comparison class — the three families no
 * column-to-column comparison is compiled against.
 *
 * - `list-or-object` — the value is a list or an object (a structured JSON
 *   type, an inherently-multi option type, or `multiple: true`).
 * - `file` — a media / attachment type, refused by name (see the module header).
 * - `formula` — virtual: no stored column.
 */
export const CROSS_FIELD_NO_CLASS_REASONS = ['list-or-object', 'file', 'formula'] as const;

export type CrossFieldNoClassReason = (typeof CROSS_FIELD_NO_CLASS_REASONS)[number];

/** One declared column's standing in a field-to-field comparison. */
export type CrossFieldColumnVerdict =
  | { readonly kind: 'class'; readonly class: CrossFieldComparisonClass }
  | { readonly kind: 'no-class'; readonly reason: CrossFieldNoClassReason };

/** The slice of a field definition the classification reads. */
export interface CrossFieldComparisonFieldMeta {
  /** The declared `type` — a `FieldType` member, or the verdict is `undefined`. */
  type: string;
  /**
   * The declared `multiple` flag. Only `true` moves a verdict, and only on a
   * multi-capable type (`isMultiValueField`'s own reading).
   */
  multiple?: boolean | undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The class table — every FieldType member, exactly once
 * ──────────────────────────────────────────────────────────────────────────── */

/** One row of {@link CROSS_FIELD_COMPARISON_TYPE_CLASSES}. */
export interface CrossFieldComparisonTypeClass {
  /** The row, named after the `field-value.zod.ts` set it references. */
  readonly name: string;
  /** Its members — the existing export, never a re-listing. */
  readonly types: ReadonlySet<string>;
  /** Every member's verdict when it is declared single-valued. */
  readonly verdict: CrossFieldColumnVerdict;
  /** Why — surfaced in failure output. */
  readonly note: string;
}

const classOf = (cls: CrossFieldComparisonClass): CrossFieldColumnVerdict => ({ kind: 'class', class: cls });
const noClass = (reason: CrossFieldNoClassReason): CrossFieldColumnVerdict => ({ kind: 'no-class', reason });

/**
 * The classification, one row per value class. Its test pins that the rows'
 * members are pairwise disjoint and that their union is EXACTLY `FieldType`:
 * no member may be silently absent, and none may be classified twice.
 *
 * A row states the verdict for a member declared single-valued; `multiple:
 * true` on a multi-capable member (`select` / `radio` / `lookup` / `user` /
 * `file` / `image`) moves it to `list-or-object` — see
 * {@link crossFieldColumnVerdict}.
 */
export const CROSS_FIELD_COMPARISON_TYPE_CLASSES: readonly CrossFieldComparisonTypeClass[] = [
  {
    name: 'NUMERIC_VALUE_TYPES',
    types: NUMERIC_VALUE_TYPES,
    verdict: classOf('numeric'),
    note: 'A finite number, stored in a numeric column on every SQL dialect. `summary` is a member (verified at the set, not the name).',
  },
  {
    name: 'STRING_VALUE_TYPES',
    types: STRING_VALUE_TYPES,
    verdict: classOf('text'),
    note: 'A plain string, stored as text.',
  },
  {
    name: 'autonumber',
    types: new Set(['autonumber']),
    verdict: classOf('text'),
    note: 'The stored value is the formatted number, a string.',
  },
  {
    name: 'SINGLE_OPTION_TYPES',
    types: SINGLE_OPTION_TYPES,
    verdict: classOf('text'),
    note: 'One option code, a string. `multiple: true` on `select` / `radio` makes it a list.',
  },
  {
    name: 'REFERENCE_VALUE_TYPES',
    types: REFERENCE_VALUE_TYPES,
    verdict: classOf('text'),
    note: 'A record id, a string. `multiple: true` on `lookup` / `user` makes it a list.',
  },
  {
    name: 'BOOLEAN_VALUE_TYPES',
    types: BOOLEAN_VALUE_TYPES,
    verdict: classOf('boolean'),
    note: 'A boolean — `0/1` in a SQL column, `true/false` on a record, so it is its own class.',
  },
  {
    name: 'CALENDAR_DATE_TYPES',
    types: CALENDAR_DATE_TYPES,
    verdict: classOf('date'),
    note: 'A calendar day (`YYYY-MM-DD`) — not an instant, so not comparable with a `datetime`.',
  },
  {
    name: 'INSTANT_TYPES',
    types: INSTANT_TYPES,
    verdict: classOf('datetime'),
    note: 'A UTC instant (canonical ISO text on SQLite) — its own class.',
  },
  {
    name: 'CLOCK_TIME_TYPES',
    types: CLOCK_TIME_TYPES,
    verdict: classOf('time'),
    note: 'A wall-clock time of day (`HH:MM:SS`) — its own class.',
  },
  {
    name: 'STRUCTURED_JSON_TYPES',
    types: STRUCTURED_JSON_TYPES,
    verdict: noClass('list-or-object'),
    note: 'A structured JSON payload in a JSON column — not one comparable value.',
  },
  {
    name: 'MULTI_OPTION_TYPES',
    types: MULTI_OPTION_TYPES,
    verdict: noClass('list-or-object'),
    note: 'An array of option codes in a JSON column — not one comparable value.',
  },
  {
    name: 'FILE_REFERENCE_TYPES',
    types: FILE_REFERENCE_TYPES,
    verdict: noClass('file'),
    note: 'Refused by name, whatever the deployment stores: during the ADR-0104 dual-encoding window one media column can hold a bare id and another the JSON-quoted form of the same id.',
  },
  {
    name: 'formula',
    types: new Set(['formula']),
    verdict: noClass('formula'),
    note: 'Virtual — no stored column to reference, whatever the declared `returnType`.',
  },
];

/** `type` → its row's verdict, built once from the table above. */
const VERDICT_OF_TYPE: ReadonlyMap<string, CrossFieldColumnVerdict> = new Map(
  CROSS_FIELD_COMPARISON_TYPE_CLASSES.flatMap((row) => [...row.types].map((type) => [type, row.verdict] as const)),
);

const LIST_OR_OBJECT: CrossFieldColumnVerdict = noClass('list-or-object');

/* ────────────────────────────────────────────────────────────────────────────
 * The verdicts
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One declared column's comparison class, or the reason it has none.
 * `undefined` for a `type` outside `FieldType` — not a declaration this table
 * judges (see the module header). Pure: one input, no I/O.
 */
export function crossFieldColumnVerdict(field: CrossFieldComparisonFieldMeta): CrossFieldColumnVerdict | undefined {
  const row = VERDICT_OF_TYPE.get(field.type);
  if (row === undefined) return undefined;
  // The same question driver-sql asks first, through the same predicate: a
  // multi-capable type flagged `multiple: true` holds a list, whatever its row.
  if (isMultiValueField({ type: field.type, multiple: field.multiple === true })) return LIST_OR_OBJECT;
  return row;
}

/**
 * The verdict on one field-to-field comparison between two declared columns.
 *
 * - `comparable` — both columns have a class, and it is the same one.
 * - `cross-class` — both have a class, and they differ (text vs number).
 * - `no-class` — at least one column has no class (a list or an object, a
 *   file field, a formula); both columns' verdicts are carried so a caller can
 *   name the one at fault.
 * - `unjudged` — a declared type is outside `FieldType`; no verdict.
 *
 * Symmetric in its answer: swapping the two sides never changes the verdict
 * kind (pinned over every pair).
 */
export type CrossFieldComparisonVerdict =
  | { readonly verdict: 'comparable'; readonly class: CrossFieldComparisonClass }
  | {
      readonly verdict: 'cross-class';
      readonly left: CrossFieldComparisonClass;
      readonly right: CrossFieldComparisonClass;
    }
  | { readonly verdict: 'no-class'; readonly left: CrossFieldColumnVerdict; readonly right: CrossFieldColumnVerdict }
  | { readonly verdict: 'unjudged' };

/**
 * May `left` and `right` be compared column to column? Pure: two declared
 * columns in, one of four answers out, no I/O. Only `comparable` is a
 * comparison the platform defines; every other judged answer is one driver-sql
 * refuses to compile.
 */
export function crossFieldComparisonVerdict(
  left: CrossFieldComparisonFieldMeta,
  right: CrossFieldComparisonFieldMeta,
): CrossFieldComparisonVerdict {
  const l = crossFieldColumnVerdict(left);
  const r = crossFieldColumnVerdict(right);
  if (l === undefined || r === undefined) return { verdict: 'unjudged' };
  if (l.kind === 'no-class' || r.kind === 'no-class') return { verdict: 'no-class', left: l, right: r };
  if (l.class !== r.class) return { verdict: 'cross-class', left: l.class, right: r.class };
  return { verdict: 'comparable', class: l.class };
}
