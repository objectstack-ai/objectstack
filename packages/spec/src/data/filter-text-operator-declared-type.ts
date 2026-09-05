// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15661] The text-operator **declared-type door** — which fields a text
 * operator (`$contains` family) may be aimed at, judged by the field's
 * DECLARED type at the engine's field-aware seam, BEFORE any driver runs.
 *
 * ## The ruling this encodes (maintainer, 2026-09-05, recorded on #15661)
 *
 * > **C-deny, now**: a text operator (`$contains` / `$notContains` /
 * > `$startsWith` / `$endsWith` / `$icontains` / `$like` / `$ilike`) over a
 * > field whose DECLARED type can never store a string —
 * > `NUMERIC_VALUE_TYPES` ∪ `BOOLEAN_VALUE_TYPES` ∪ `CALENDAR_DATE_TYPES` ∪
 * > `INSTANT_TYPES` ∪ `CLOCK_TIME_TYPES` ∪ `STRUCTURED_JSON_TYPES`, all
 * > existing sets in `field-value.zod.ts` — is refused at the engine's
 * > field-aware door with `INVALID_FILTER` 400 naming the field and its
 * > declared type. No new vocabulary is minted. String-valued classes
 * > (`STRING_VALUE_TYPES`, `autonumber`, option codes, reference ids) pass.
 * > `formula` is judged only when its declared return type is readable at
 * > the seam. #14079's option-A row stays beneath the door for every
 * > evaluator no door fronts.
 *
 * Not taken: C-allow (refuse everything outside the string classes — it
 * would break the substring filters over `select` codes, lookup ids and
 * `tags` that work today) and D (no door — the mistaken query keeps
 * answering `[]` with no signal, the "silent wrong answer" the text table's
 * own header names).
 *
 * ## One axis: the DECLARED type of the field an UNDOTTED key names
 *
 * The verdict is a function of exactly two things — the field's declared
 * `type` (and, for `formula`, its declared `returnType`) and whether the
 * operator is one of {@link TEXT_FILTER_OPERATORS}. Nothing else moves it:
 *
 * - **Refused** ({@link TEXT_OPERATOR_DOOR_REFUSED_TYPES}): the six classes
 *   the ruling names, spelled by REFERENCE to their exports — a member added
 *   to `NUMERIC_VALUE_TYPES` later is refused without a change here. That
 *   includes `summary`, which is a member of `NUMERIC_VALUE_TYPES` (its
 *   computed nature is `COMPUTED_VALUE_TYPES`' axis, not this door's).
 * - **Passes** ({@link TEXT_OPERATOR_DOOR_PASSING_TYPES}): every class whose
 *   stored value can be a string — `STRING_VALUE_TYPES`, `autonumber`, the
 *   option-code classes (single AND multi: the ruling protects `tags`), the
 *   record-id classes, and the file classes (an opaque id / url string today,
 *   a `sys_file` id string after ADR-0104 D3 — never "never a string", so
 *   outside the refused criterion; not ruled by name, derived from the
 *   ruling's criterion and recorded as such on the class row). The door lets
 *   these through UNCHANGED; what a text operator then answers over an ARRAY
 *   value (multi-option, `multiple: true`) is the evaluators' own question
 *   beneath the door, not this table's.
 * - **Deferred** — no verdict, the filter proceeds unchanged: a `formula`
 *   whose `returnType` is absent (unreadable at the seam), and a DOTTED key
 *   (`address.city`), which is `filter-dotted-head`'s subject — its
 *   structured-JSON heads are deliberately unjudged there (live on two of
 *   three backends, #8371), and this door reading the head's declared type
 *   would re-close that carve-out. The leaf's type is declared nowhere the
 *   seam can read, so there is nothing to judge.
 *
 * `formula` with a readable `returnType` is judged AS THE FIELD TYPE ITS
 * RETURN TYPE NAMES: every value of `FieldSchema.returnType` (`number` /
 * `text` / `boolean` / `date`) is itself a `FieldType` member, so `text`
 * passes and the other three are refused through the same sets — no second
 * vocabulary ({@link FORMULA_RETURN_TYPE_AS_FIELD_TYPE}).
 *
 * `multiple: true` does not change a verdict: the class is the ruling's axis.
 *
 * ## Beneath the door: #14079's row stays (the two are one contract)
 *
 * The door refuses at the ENGINE seam by DECLARED type, six classes wide.
 * Beneath it, every evaluator no door fronts — a direct driver call,
 * `formula`'s write-side `check`, `having`, RLS — keeps answering
 * `FILTER_TEXT_CASES`' stored-value row (a stored value that is not a string
 * never satisfies a positive text operator and always satisfies
 * `$notContains`). The SQL faces' compile-time type-gate set,
 * `NON_TEXT_STORED_VALUE_TYPES` (numeric + boolean), is NARROWER than this
 * door's set on purpose: temporal and structured-JSON columns are refused
 * here, by declaration, but beneath the door they answer by their stored
 * representation, which is a dialect question (ADR-0053) the contract does
 * not decide. Neither `filter-text-conformance.ts` nor `field-value.zod.ts`
 * changes for this door.
 *
 * ## Where the door lives, and what this module is
 *
 * The comparand-type door (`filter-comparand-type.ts`) is a SYNTAX door: it
 * runs inside `parseFilterAST`, with no field map. This door is FIELD-AWARE —
 * it needs the object's real field map — so it cannot live there; it lives at
 * the engine's field-aware seam (`@objectstack/objectql`, beside the
 * `INVALID_FIELD` unknown-field door, before any driver dispatch — its own
 * card, the engine lane). THIS MODULE IS THE CONTRACT ONLY: the sets, the
 * pure verdict, a fixture object and the derived case table. It writes no
 * door, and `packages/spec` carries no runtime logic (Prime Directive #2).
 *
 * ## How the engine suite consumes {@link TEXT_OPERATOR_DOOR_CASES}
 *
 * Register {@link TEXT_OPERATOR_DOOR_FIXTURE} against a recording driver,
 * then for every case run `find(TEXT_OPERATOR_DOOR_FIXTURE.name, { where:
 * c.filter() })`:
 *
 * - `door-refusal`: the call rejects with `code` AND `status` (the ADR-0112
 *   envelope — `toThrow()` alone is not a pin), the message contains every
 *   {@link TextOperatorDoorRefusalCase.mustMention} substring, and NO driver
 *   read ran.
 * - `passes` / `deferred`: the driver read ran and received the filter
 *   UNCHANGED — the door records no verdict and rewrites nothing.
 *
 * Every case passes the SYNTAX door (`parseFilterAST` accepts each filter —
 * pinned in this module's test), so a refusal can only be this door's.
 *
 * ## Deliberately NOT a driver case-set
 *
 * `scripts/check-driver-conformance.mjs` enrols every `*_CASES` export of a
 * `*-conformance.ts` file into the driver census. This table is not one:
 * drivers sit BENEATH this door and must keep answering `FILTER_TEXT_CASES`'
 * row, so a driver "covering" it would assert the opposite of the ruling.
 * Its consumer is the engine door alone, which is why the file is named for
 * the door it declares (like `filter-comparand-type.ts` and
 * `filter-dotted-head.ts`) rather than as a conformance table.
 *
 * @see FILTER_TEXT_CASES — the row beneath the door (#14079).
 * @see NON_TEXT_STORED_VALUE_TYPES — the SQL faces' narrower compile-time set.
 * @see FILTER_COMPARAND_TYPE_CASES — the syntax door this one is shaped after.
 * @see classifyDottedFilterHead — the dotted-key verdict this door defers to.
 * @see https://github.com/objectstack-ai/objectstack/issues/15661 (the ruling)
 * @see https://github.com/objectstack-ai/objectstack/issues/14079 (the row beneath)
 */

import type { FilterCondition } from './filter.zod';
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
} from './field-value.zod';

/* ────────────────────────────────────────────────────────────────────────────
 * The operators the door judges
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The text operators the door judges — the ruling's list, which is exactly
 * the key set of `StringOperatorSchema` (pinned: a text operator declared
 * later fails the pin loudly instead of slipping past the door).
 */
export const TEXT_FILTER_OPERATORS = [
  '$contains',
  '$notContains',
  '$startsWith',
  '$endsWith',
  '$icontains',
  '$like',
  '$ilike',
] as const;

export type TextFilterOperator = (typeof TEXT_FILTER_OPERATORS)[number];

/** Is `op` one of {@link TEXT_FILTER_OPERATORS}? */
export function isTextFilterOperator(op: string): op is TextFilterOperator {
  return (TEXT_FILTER_OPERATORS as readonly string[]).includes(op);
}

/* ────────────────────────────────────────────────────────────────────────────
 * The verdict, by declared type
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Field types whose DECLARED type can never store a string — the union of the
 * six existing classes the ruling names, by reference. A text operator over
 * one of these is refused at the door.
 */
export const TEXT_OPERATOR_DOOR_REFUSED_TYPES: ReadonlySet<string> = new Set([
  ...NUMERIC_VALUE_TYPES,
  ...BOOLEAN_VALUE_TYPES,
  ...CALENDAR_DATE_TYPES,
  ...INSTANT_TYPES,
  ...CLOCK_TIME_TYPES,
  ...STRUCTURED_JSON_TYPES,
]);

/**
 * Field types the door lets through: every class whose stored value can be a
 * string. `autonumber` is spelled by name because the ruling names it by name
 * (its stored value is the formatted string; `RUNTIME_OWNED_FIELD_TYPES` is a
 * different axis and only coincidentally the same singleton).
 */
export const TEXT_OPERATOR_DOOR_PASSING_TYPES: ReadonlySet<string> = new Set([
  ...STRING_VALUE_TYPES,
  'autonumber',
  ...SINGLE_OPTION_TYPES,
  ...MULTI_OPTION_TYPES,
  ...REFERENCE_VALUE_TYPES,
  ...FILE_REFERENCE_TYPES,
]);

/**
 * A `formula`'s declared `returnType`, read as the `FieldType` whose class
 * judges it. Every value of `FieldSchema.returnType` IS a `FieldType` member,
 * so the map is the identity over that enum — spelled out so an enum value
 * added later is a loud pin failure rather than a silent `passes`.
 */
export const FORMULA_RETURN_TYPE_AS_FIELD_TYPE: ReadonlyMap<string, string> = new Map([
  ['number', 'number'],
  ['text', 'text'],
  ['boolean', 'boolean'],
  ['date', 'date'],
]);

/**
 * The door's three answers.
 *
 * - `door-refusal` — refused before any driver runs (`INVALID_FILTER` / 400).
 * - `passes` — a string-valued declared type; the filter proceeds unchanged.
 * - `deferred` — the door records NO verdict and the filter proceeds
 *   unchanged: the declared type is not readable at the seam (a `formula`
 *   without `returnType`), or the key is not this door's subject (a dotted
 *   path — `filter-dotted-head`'s).
 */
export type TextOperatorDoorVerdict = 'door-refusal' | 'passes' | 'deferred';

/** The slice of a field definition the door reads. */
export interface TextOperatorDoorFieldMeta {
  type: string;
  /** `formula` only — the declared return type, when authoring could prove one. */
  returnType?: string | undefined;
}

/**
 * The door's verdict for a text operator aimed at an UNDOTTED key naming
 * `field`. Pure: two inputs, one of three answers, no I/O.
 *
 * A dotted key never reaches this function on the door's side — the door
 * judges only keys that name a declared field directly (see the module note).
 */
export function textOperatorDoorVerdict(field: TextOperatorDoorFieldMeta): TextOperatorDoorVerdict {
  if (field.type === 'formula') {
    const asFieldType = typeof field.returnType === 'string'
      ? FORMULA_RETURN_TYPE_AS_FIELD_TYPE.get(field.returnType)
      : undefined;
    // Unreadable (absent, or a spelling the schema does not declare) ⇒ not judged.
    if (asFieldType === undefined) return 'deferred';
    return textOperatorDoorVerdict({ type: asFieldType });
  }
  if (TEXT_OPERATOR_DOOR_REFUSED_TYPES.has(field.type)) return 'door-refusal';
  return 'passes';
}

/* ────────────────────────────────────────────────────────────────────────────
 * The class table — every FieldType member, exactly once
 * ──────────────────────────────────────────────────────────────────────────── */

/** One row of {@link TEXT_OPERATOR_DOOR_TYPE_CLASSES}. */
export interface TextOperatorDoorTypeClass {
  /** The class, named after the `field-value.zod.ts` set it references. */
  readonly name: string;
  /** Its members — the existing export, never a re-listing. */
  readonly types: ReadonlySet<string>;
  /** The door's verdict for every member, or `by-return-type` for `formula`. */
  readonly verdict: TextOperatorDoorVerdict | 'by-return-type';
  /** Why — surfaced in failure output and in the verdict matrix. */
  readonly note: string;
}

/**
 * The verdict matrix, one row per value class. Its test pins that the rows'
 * members are pairwise disjoint and that their union is EXACTLY `FieldType`:
 * no member may be silently absent, and none may be judged twice.
 */
export const TEXT_OPERATOR_DOOR_TYPE_CLASSES: readonly TextOperatorDoorTypeClass[] = [
  {
    name: 'STRING_VALUE_TYPES',
    types: STRING_VALUE_TYPES,
    verdict: 'passes',
    note: 'The stored value is a string — the operators\' natural subject. `password` / `secret` are strings too; whether a secret may be filtered by substring is a security-posture question outside this door.',
  },
  {
    name: 'autonumber',
    types: new Set(['autonumber']),
    verdict: 'passes',
    note: 'Named by the ruling: the stored value is the formatted string.',
  },
  {
    name: 'SINGLE_OPTION_TYPES',
    types: SINGLE_OPTION_TYPES,
    verdict: 'passes',
    note: 'The stored value is one option CODE, a string — a substring filter over it is legal today (C-allow was refused for breaking it).',
  },
  {
    name: 'MULTI_OPTION_TYPES',
    types: MULTI_OPTION_TYPES,
    verdict: 'passes',
    note: 'An array of option codes — the ruling protects `tags` by name. Element-wise semantics over the array are the evaluators\' question beneath the door.',
  },
  {
    name: 'REFERENCE_VALUE_TYPES',
    types: REFERENCE_VALUE_TYPES,
    verdict: 'passes',
    note: 'The stored value is a record-id string.',
  },
  {
    name: 'FILE_REFERENCE_TYPES',
    types: FILE_REFERENCE_TYPES,
    verdict: 'passes',
    note: 'DERIVED, not ruled by name: the stored form is an opaque id / url string or a legacy inline object today, and a `sys_file` id string after ADR-0104 D3 — never "never a string", so outside the refused criterion. Re-judge only if D3 lands a non-string stored form.',
  },
  {
    name: 'NUMERIC_VALUE_TYPES',
    types: NUMERIC_VALUE_TYPES,
    verdict: 'door-refusal',
    note: 'A number is never a string on any backend. `summary` is a member of this set (verified at the set, not the name) — its computed nature is `COMPUTED_VALUE_TYPES`\' axis, not this door\'s.',
  },
  {
    name: 'BOOLEAN_VALUE_TYPES',
    types: BOOLEAN_VALUE_TYPES,
    verdict: 'door-refusal',
    note: 'A boolean is never a string on any backend (driver read-coercion repairs SQL 0/1 before the caller sees it).',
  },
  {
    name: 'CALENDAR_DATE_TYPES',
    types: CALENDAR_DATE_TYPES,
    verdict: 'door-refusal',
    note: 'Declared as a calendar day, not text. Its STORED form is a dialect question (ADR-0053) that the row beneath the door leaves to each face — the door refuses by declaration.',
  },
  {
    name: 'INSTANT_TYPES',
    types: INSTANT_TYPES,
    verdict: 'door-refusal',
    note: 'Declared as a UTC instant, not text — the same declaration-vs-storage split as the calendar class.',
  },
  {
    name: 'CLOCK_TIME_TYPES',
    types: CLOCK_TIME_TYPES,
    verdict: 'door-refusal',
    note: 'Declared as a wall-clock time, not text — the same split.',
  },
  {
    name: 'STRUCTURED_JSON_TYPES',
    types: STRUCTURED_JSON_TYPES,
    verdict: 'door-refusal',
    note: 'The stored value is an object; a substring over it is meaningless. A DOTTED path into one (`address.city`) is NOT this door\'s subject — it stays unjudged, per `filter-dotted-head`.',
  },
  {
    name: 'formula',
    types: new Set(['formula']),
    verdict: 'by-return-type',
    note: 'Judged as the FieldType its declared `returnType` names (`text` passes; `number` / `boolean` / `date` are refused through the same sets); `returnType` absent ⇒ deferred, the declared type is not readable at the seam.',
  },
];

/* ────────────────────────────────────────────────────────────────────────────
 * The fixture and the derived case table
 * ──────────────────────────────────────────────────────────────────────────── */

/** A field of {@link TEXT_OPERATOR_DOOR_FIXTURE} — a legal `FieldSchema` input. */
export interface TextOperatorDoorFixtureField {
  readonly name: string;
  readonly type: string;
  /** Reference types point back at the fixture object itself. */
  readonly reference?: string;
  /** `formula` — a CEL expression, present so the field is a legal declaration. */
  readonly expression?: string;
  /** `formula` — the declared return type under test, or absent for the deferred row. */
  readonly returnType?: 'number' | 'text' | 'boolean' | 'date';
  /** `summary` — a roll-up declaration, present so the field is a legal declaration. */
  readonly summaryOperations?: { readonly object: string; readonly field: string; readonly function: 'count' };
}

/** The fixture object's name. */
export const TEXT_OPERATOR_DOOR_FIXTURE_OBJECT = 'text_door_probe';

const fixtureFieldFor = (type: string): TextOperatorDoorFixtureField => {
  const name = `f_${type}`;
  if (REFERENCE_VALUE_TYPES.has(type) && type !== 'user') return { name, type, reference: TEXT_OPERATOR_DOOR_FIXTURE_OBJECT };
  if (type === 'summary') {
    return { name, type, summaryOperations: { object: TEXT_OPERATOR_DOOR_FIXTURE_OBJECT, field: 'id', function: 'count' } };
  }
  return { name, type };
};

/** Every member of every class row, in class-table order — each FieldType member once. */
const CLASSIFIED_FIELD_TYPES: readonly string[] = TEXT_OPERATOR_DOOR_TYPE_CLASSES
  .flatMap((row) => [...row.types]);

/**
 * The fixture: one field per `FieldType` member (`f_<type>`), plus one
 * `formula` field per declared return type and one with none. Reference
 * types point at the fixture itself; `summary` counts the fixture's own rows;
 * `formula` carries a trivial expression — each field is a legal
 * `FieldSchema` input (pinned), so a suite may register the object through
 * any door, Zod-validating or not.
 */
export const TEXT_OPERATOR_DOOR_FIXTURE_FIELDS: readonly TextOperatorDoorFixtureField[] = [
  ...CLASSIFIED_FIELD_TYPES
    .filter((type) => type !== 'formula')
    .map(fixtureFieldFor),
  ...[...FORMULA_RETURN_TYPE_AS_FIELD_TYPE.keys()].map((returnType) => ({
    name: `f_formula_${returnType}`,
    type: 'formula',
    expression: '1',
    returnType: returnType as 'number' | 'text' | 'boolean' | 'date',
  })),
  { name: 'f_formula_untyped', type: 'formula', expression: '1' },
];

/**
 * The fixture object, in the `{ name, fields }` shape `registerObject`
 * takes — a legal `ObjectSchema` input (pinned). `id` is the row-identity
 * text column the engine's own fixtures declare.
 */
export const TEXT_OPERATOR_DOOR_FIXTURE = {
  name: TEXT_OPERATOR_DOOR_FIXTURE_OBJECT,
  label: 'Text-operator door probe',
  fields: Object.fromEntries([
    ['id', { name: 'id', type: 'text' }],
    ...TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.map((f) => [f.name, f] as const),
  ]) as Readonly<Record<string, TextOperatorDoorFixtureField>>,
} as const;

interface TextOperatorDoorCaseBase {
  /** Stable identifier, usable as a test name. */
  readonly name: string;
  /** The filter key under test — the fixture field, or a dotted path headed by it. */
  readonly key: string;
  /** The fixture field the key names (or heads). */
  readonly field: string;
  /** The field's declared type — a `FieldType` member. */
  readonly declaredType: string;
  /** `formula` only — the declared return type, when present. */
  readonly returnType?: string;
  readonly operator: TextFilterOperator;
  /**
   * Builds the filter under test — a factory, like the comparand table's, so
   * no suite can edit an object another suite judges.
   */
  readonly filter: () => FilterCondition;
  /** Why the case is here — surfaced in failure output. */
  readonly note?: string;
}

/** A case the DOOR must refuse — before any driver runs. */
export interface TextOperatorDoorRefusalCase extends TextOperatorDoorCaseBase {
  readonly verdict: 'door-refusal';
  /** The ADR-0112 code the refusal must carry … */
  readonly code: 'INVALID_FILTER';
  /** … beside this status. */
  readonly status: 400;
  /** Substrings the refusal message must contain: the key, the declared type (and return type), the operator. */
  readonly mustMention: readonly string[];
}

/** A case the door must let through UNCHANGED — a string-valued declared type. */
export interface TextOperatorDoorPassesCase extends TextOperatorDoorCaseBase {
  readonly verdict: 'passes';
}

/** A case the door records NO verdict for — the filter proceeds unchanged. */
export interface TextOperatorDoorDeferredCase extends TextOperatorDoorCaseBase {
  readonly verdict: 'deferred';
}

export type TextOperatorDoorCase =
  | TextOperatorDoorRefusalCase
  | TextOperatorDoorPassesCase
  | TextOperatorDoorDeferredCase;

/** The comparand each case carries — `$like` / `$ilike` take a pattern, the rest a substring. */
const comparandFor = (operator: TextFilterOperator): string =>
  operator === '$like' || operator === '$ilike' ? '%5%' : '5';

function caseFor(
  field: TextOperatorDoorFixtureField,
  operator: TextFilterOperator,
  key: string = field.name,
): TextOperatorDoorCase {
  const dotted = key !== field.name;
  const verdict: TextOperatorDoorVerdict = dotted ? 'deferred' : textOperatorDoorVerdict(field);
  const declared = field.returnType ? `${field.type} returning ${field.returnType}` : field.type;
  const filter = (): FilterCondition => ({ [key]: { [operator]: comparandFor(operator) } });
  const base = {
    name: `${operator} over ${key} (${declared}) — ${verdict}`,
    key,
    field: field.name,
    declaredType: field.type,
    ...(field.returnType ? { returnType: field.returnType } : {}),
    operator,
    filter,
  };
  switch (verdict) {
    case 'door-refusal':
      return {
        ...base,
        verdict,
        code: 'INVALID_FILTER',
        status: 400,
        mustMention: [key, field.type, ...(field.returnType ? [field.returnType] : []), operator],
      };
    case 'passes':
      return { ...base, verdict };
    case 'deferred':
      return {
        ...base,
        verdict,
        note: dotted
          ? 'A dotted path into a structured-JSON field is filter-dotted-head\'s subject (deliberately unjudged there, #8371); this door must not re-close that carve-out by reading the head\'s declared type.'
          : 'The declared return type is not readable at the seam — the ruling judges formula only when it is.',
      };
  }
}

/**
 * The cases: every fixture field × every text operator, plus a dotted path
 * into every structured-JSON field × every text operator. Derived, so the
 * table follows the sets and the vocabulary rather than a hand-kept list.
 */
export const TEXT_OPERATOR_DOOR_CASES: readonly TextOperatorDoorCase[] = [
  ...TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.flatMap((field) =>
    TEXT_FILTER_OPERATORS.map((operator) => caseFor(field, operator))),
  ...TEXT_OPERATOR_DOOR_FIXTURE_FIELDS
    .filter((field) => STRUCTURED_JSON_TYPES.has(field.type))
    .flatMap((field) =>
      TEXT_FILTER_OPERATORS.map((operator) => caseFor(field, operator, `${field.name}.leaf`))),
];
