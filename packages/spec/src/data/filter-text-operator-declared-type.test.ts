// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15661] Pins for the text-operator declared-type door's CONTRACT — the
 * sets, the verdict, the fixture and the derived case table. The door itself
 * (the engine seam) is the engine lane's; what this file keeps honest is that
 * the data the door consumes says exactly what the ruling says, in both
 * directions, and that no `FieldType` member can go unjudged in silence.
 */

import { describe, it, expect } from 'vitest';
import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  COMPUTED_VALUE_TYPES,
  FILE_REFERENCE_TYPES,
  INSTANT_TYPES,
  MULTI_OPTION_TYPES,
  NON_TEXT_STORED_VALUE_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
} from './field-value.zod';
import { FieldSchema, FieldType } from './field.zod';
import { ObjectSchema } from './object.zod';
import { parseFilterAST, StringOperatorSchema } from './filter.zod';
import {
  FORMULA_RETURN_TYPE_AS_FIELD_TYPE,
  TEXT_FILTER_OPERATORS,
  TEXT_OPERATOR_DOOR_CASES,
  TEXT_OPERATOR_DOOR_FIXTURE,
  TEXT_OPERATOR_DOOR_FIXTURE_FIELDS,
  TEXT_OPERATOR_DOOR_FIXTURE_OBJECT,
  TEXT_OPERATOR_DOOR_PASSING_TYPES,
  TEXT_OPERATOR_DOOR_REFUSED_TYPES,
  TEXT_OPERATOR_DOOR_TYPE_CLASSES,
  isTextFilterOperator,
  textOperatorDoorVerdict,
  type TextOperatorDoorCase,
  type TextOperatorDoorRefusalCase,
} from './filter-text-operator-declared-type';
import { StandardErrorCode } from '../api/errors.zod';

const sorted = (s: Iterable<string>) => [...s].sort();
const union = (...sets: ReadonlySet<string>[]) => new Set(sets.flatMap((s) => [...s]));

// ── H5: the operators are the ruling's list AND the schema's key set ────────

describe('[#15661] the judged operators', () => {
  it('are the seven the ruling names, verbatim', () => {
    expect([...TEXT_FILTER_OPERATORS]).toEqual([
      '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains', '$like', '$ilike',
    ]);
  });

  it('are exactly StringOperatorSchema\'s keys — a text operator declared later fails here, loudly', () => {
    // Equality, not subset: an operator declared and not judged is the door
    // silently letting a new spelling past; one judged and not declared is a
    // phantom row.
    expect(sorted(TEXT_FILTER_OPERATORS)).toEqual(sorted(Object.keys(StringOperatorSchema.shape)));
  });

  it('isTextFilterOperator answers the seven TRUE and the non-text vocabulary FALSE', () => {
    for (const op of TEXT_FILTER_OPERATORS) expect(isTextFilterOperator(op), op).toBe(true);
    for (const op of ['$eq', '$ne', '$in', '$gt', '$null', '$exists', '$regex', 'contains']) {
      expect(isTextFilterOperator(op), op).toBe(false);
    }
  });
});

// ── H1: the refused set is the union of the six exports; nothing minted ─────

describe('[#15661] the refused set', () => {
  it('equals the union of the six sets the ruling names — by set equality against the imports', () => {
    expect(sorted(TEXT_OPERATOR_DOOR_REFUSED_TYPES)).toEqual(sorted(union(
      NUMERIC_VALUE_TYPES,
      BOOLEAN_VALUE_TYPES,
      CALENDAR_DATE_TYPES,
      INSTANT_TYPES,
      CLOCK_TIME_TYPES,
      STRUCTURED_JSON_TYPES,
    )));
  });

  it('is disjoint from the passing set, and together with `formula` they are exactly FieldType', () => {
    for (const t of TEXT_OPERATOR_DOOR_REFUSED_TYPES) {
      expect(TEXT_OPERATOR_DOOR_PASSING_TYPES.has(t), `${t} is in both sets`).toBe(false);
    }
    expect(sorted(union(TEXT_OPERATOR_DOOR_REFUSED_TYPES, TEXT_OPERATOR_DOOR_PASSING_TYPES, new Set(['formula']))))
      .toEqual(sorted(FieldType.options));
  });

  it('the passing set is the string-valued classes: STRING ∪ {autonumber} ∪ option codes ∪ reference ids ∪ file references', () => {
    expect(sorted(TEXT_OPERATOR_DOOR_PASSING_TYPES)).toEqual(sorted(union(
      STRING_VALUE_TYPES,
      new Set(['autonumber']),
      SINGLE_OPTION_TYPES,
      MULTI_OPTION_TYPES,
      REFERENCE_VALUE_TYPES,
      FILE_REFERENCE_TYPES,
    )));
  });

  it('is WIDER than the SQL faces\' compile-time type-gate set, by exactly the temporal and JSON classes (H4)', () => {
    // NON_TEXT_STORED_VALUE_TYPES (#14079) = numeric + boolean, the set the
    // SQL compilers consult BENEATH the door. The door adds the classes whose
    // stored form is a dialect question — refused here by declaration.
    for (const t of NON_TEXT_STORED_VALUE_TYPES) expect(TEXT_OPERATOR_DOOR_REFUSED_TYPES.has(t), t).toBe(true);
    const beyond = [...TEXT_OPERATOR_DOOR_REFUSED_TYPES].filter((t) => !NON_TEXT_STORED_VALUE_TYPES.has(t));
    expect(sorted(beyond)).toEqual(sorted(union(
      CALENDAR_DATE_TYPES, INSTANT_TYPES, CLOCK_TIME_TYPES, STRUCTURED_JSON_TYPES,
    )));
  });
});

// ── H1: the census — every FieldType member exactly once across the rows ────

describe('[#15661] the class table is a census of FieldType', () => {
  it('every FieldType member appears in exactly one class row — none absent, none judged twice', () => {
    const seen = new Map<string, string[]>();
    for (const row of TEXT_OPERATOR_DOOR_TYPE_CLASSES) {
      for (const t of row.types) seen.set(t, [...(seen.get(t) ?? []), row.name]);
    }
    const absent = FieldType.options.filter((t) => !seen.has(t));
    const twice = [...seen].filter(([, rows]) => rows.length > 1);
    const ghosts = [...seen.keys()].filter((t) => !(FieldType.options as readonly string[]).includes(t));
    expect(absent, 'FieldType members with NO verdict row').toEqual([]);
    expect(twice, 'FieldType members judged by more than one row').toEqual([]);
    expect(ghosts, 'class-row members that are not FieldType').toEqual([]);
    expect(seen.size).toBe(FieldType.options.length);
  });

  it('the rows reference the existing sets by identity — nothing is re-listed', () => {
    const byName = new Map(TEXT_OPERATOR_DOOR_TYPE_CLASSES.map((r) => [r.name, r.types]));
    expect(byName.get('STRING_VALUE_TYPES')).toBe(STRING_VALUE_TYPES);
    expect(byName.get('SINGLE_OPTION_TYPES')).toBe(SINGLE_OPTION_TYPES);
    expect(byName.get('MULTI_OPTION_TYPES')).toBe(MULTI_OPTION_TYPES);
    expect(byName.get('REFERENCE_VALUE_TYPES')).toBe(REFERENCE_VALUE_TYPES);
    expect(byName.get('FILE_REFERENCE_TYPES')).toBe(FILE_REFERENCE_TYPES);
    expect(byName.get('NUMERIC_VALUE_TYPES')).toBe(NUMERIC_VALUE_TYPES);
    expect(byName.get('BOOLEAN_VALUE_TYPES')).toBe(BOOLEAN_VALUE_TYPES);
    expect(byName.get('CALENDAR_DATE_TYPES')).toBe(CALENDAR_DATE_TYPES);
    expect(byName.get('INSTANT_TYPES')).toBe(INSTANT_TYPES);
    expect(byName.get('CLOCK_TIME_TYPES')).toBe(CLOCK_TIME_TYPES);
    expect(byName.get('STRUCTURED_JSON_TYPES')).toBe(STRUCTURED_JSON_TYPES);
  });

  it('the refused rows are the six named classes and the passing rows are the string-valued classes', () => {
    const rowsWith = (v: string) => TEXT_OPERATOR_DOOR_TYPE_CLASSES.filter((r) => r.verdict === v).map((r) => r.name);
    expect(rowsWith('door-refusal')).toEqual([
      'NUMERIC_VALUE_TYPES', 'BOOLEAN_VALUE_TYPES', 'CALENDAR_DATE_TYPES',
      'INSTANT_TYPES', 'CLOCK_TIME_TYPES', 'STRUCTURED_JSON_TYPES',
    ]);
    expect(rowsWith('passes')).toEqual([
      'STRING_VALUE_TYPES', 'autonumber', 'SINGLE_OPTION_TYPES', 'MULTI_OPTION_TYPES',
      'REFERENCE_VALUE_TYPES', 'FILE_REFERENCE_TYPES',
    ]);
    expect(rowsWith('by-return-type')).toEqual(['formula']);
    expect(rowsWith('deferred')).toEqual([]);
  });

  it('H3: `summary` is refused because it is a NUMERIC_VALUE_TYPES member, not because it is computed', () => {
    expect(NUMERIC_VALUE_TYPES.has('summary')).toBe(true);
    expect(COMPUTED_VALUE_TYPES.has('summary')).toBe(true);
    expect(textOperatorDoorVerdict({ type: 'summary' })).toBe('door-refusal');
    // The other two computed types are judged by their own rows, not by the class.
    expect(textOperatorDoorVerdict({ type: 'autonumber' })).toBe('passes');
    expect(textOperatorDoorVerdict({ type: 'formula' })).toBe('deferred');
  });
});

// ── The verdict ──────────────────────────────────────────────────────────────

describe('[#15661] textOperatorDoorVerdict', () => {
  it('refuses every member of the refused set and passes every member of the passing set', () => {
    for (const t of TEXT_OPERATOR_DOOR_REFUSED_TYPES) expect(textOperatorDoorVerdict({ type: t }), t).toBe('door-refusal');
    for (const t of TEXT_OPERATOR_DOOR_PASSING_TYPES) expect(textOperatorDoorVerdict({ type: t }), t).toBe('passes');
  });

  it('H3: judges a formula as the FieldType its returnType names — text passes, number/boolean/date are refused, absent is deferred', () => {
    expect(textOperatorDoorVerdict({ type: 'formula', returnType: 'text' })).toBe('passes');
    expect(textOperatorDoorVerdict({ type: 'formula', returnType: 'number' })).toBe('door-refusal');
    expect(textOperatorDoorVerdict({ type: 'formula', returnType: 'boolean' })).toBe('door-refusal');
    expect(textOperatorDoorVerdict({ type: 'formula', returnType: 'date' })).toBe('door-refusal');
    expect(textOperatorDoorVerdict({ type: 'formula' })).toBe('deferred');
    expect(textOperatorDoorVerdict({ type: 'formula', returnType: undefined })).toBe('deferred');
    // A spelling the schema does not declare is unreadable too — never a silent pass.
    expect(textOperatorDoorVerdict({ type: 'formula', returnType: 'dyn' })).toBe('deferred');
  });

  it('H3: the return-type map is exactly FieldSchema.returnType\'s enum, and every value is a FieldType member', () => {
    // `.optional().describe()` — one ZodOptional around the enum.
    const declared = FieldSchema.shape.returnType.unwrap().options as readonly string[];
    expect(sorted(FORMULA_RETURN_TYPE_AS_FIELD_TYPE.keys())).toEqual(sorted(declared));
    for (const [rt, ft] of FORMULA_RETURN_TYPE_AS_FIELD_TYPE) {
      expect(rt).toBe(ft);
      expect(FieldType.options as readonly string[]).toContain(ft);
    }
  });
});

// ── The fixture ──────────────────────────────────────────────────────────────

describe('[#15661] the fixture', () => {
  it('carries one field per FieldType member (f_<type>), four typed formulas and one untyped', () => {
    const names = TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of FieldType.options) {
      if (t === 'formula') continue;
      expect(names, t).toContain(`f_${t}`);
    }
    const formulas = TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.filter((f) => f.type === 'formula');
    expect(sorted(formulas.map((f) => f.returnType ?? '(none)')))
      .toEqual(['(none)', 'boolean', 'date', 'number', 'text']);
    expect(TEXT_OPERATOR_DOOR_FIXTURE_FIELDS).toHaveLength(FieldType.options.length - 1 + 5);
  });

  it('every field is a legal FieldSchema input, and the object a legal ObjectSchema input', () => {
    for (const f of TEXT_OPERATOR_DOOR_FIXTURE_FIELDS) {
      const r = FieldSchema.safeParse(f);
      expect(r.success, `${f.name}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
    const obj = ObjectSchema.safeParse(TEXT_OPERATOR_DOOR_FIXTURE);
    expect(obj.success, obj.success ? '' : JSON.stringify(obj.error.issues)).toBe(true);
    expect(TEXT_OPERATOR_DOOR_FIXTURE.name).toBe(TEXT_OPERATOR_DOOR_FIXTURE_OBJECT);
    expect(Object.keys(TEXT_OPERATOR_DOOR_FIXTURE.fields)).toHaveLength(TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.length + 1);
  });
});

// ── The derived case table ───────────────────────────────────────────────────

const isRefusal = (c: TextOperatorDoorCase): c is TextOperatorDoorRefusalCase => c.verdict === 'door-refusal';
const fieldOf = (c: TextOperatorDoorCase) => TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.find((f) => f.name === c.field)!;

describe('[#15661] TEXT_OPERATOR_DOOR_CASES', () => {
  it('covers every fixture field × every operator, plus a dotted path into every structured-JSON field', () => {
    const jsonFields = TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.filter((f) => STRUCTURED_JSON_TYPES.has(f.type)).length;
    expect(TEXT_OPERATOR_DOOR_CASES).toHaveLength(
      (TEXT_OPERATOR_DOOR_FIXTURE_FIELDS.length + jsonFields) * TEXT_FILTER_OPERATORS.length,
    );
    for (const f of TEXT_OPERATOR_DOOR_FIXTURE_FIELDS) {
      for (const op of TEXT_FILTER_OPERATORS) {
        expect(TEXT_OPERATOR_DOOR_CASES.some((c) => c.key === f.name && c.operator === op), `${op} over ${f.name}`).toBe(true);
      }
    }
    for (const c of TEXT_OPERATOR_DOOR_CASES) expect(fieldOf(c), c.name).toBeDefined();
  });

  it('has unique case names — they are used as test names', () => {
    const names = TEXT_OPERATOR_DOOR_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every verdict agrees with textOperatorDoorVerdict over the field it names; dotted keys are deferred', () => {
    for (const c of TEXT_OPERATOR_DOOR_CASES) {
      const f = fieldOf(c);
      expect(c.declaredType, c.name).toBe(f.type);
      expect(c.returnType, c.name).toBe(f.returnType);
      const expected = c.key === c.field ? textOperatorDoorVerdict(f) : 'deferred';
      expect(c.verdict, c.name).toBe(expected);
    }
  });

  it('covers all three verdicts — a table with one answer would not need the discriminant', () => {
    const count = (v: string) => TEXT_OPERATOR_DOOR_CASES.filter((c) => c.verdict === v).length;
    expect(count('door-refusal')).toBe((TEXT_OPERATOR_DOOR_REFUSED_TYPES.size + 3) * TEXT_FILTER_OPERATORS.length);
    expect(count('passes')).toBe((TEXT_OPERATOR_DOOR_PASSING_TYPES.size + 1) * TEXT_FILTER_OPERATORS.length);
    expect(count('deferred')).toBe((1 + STRUCTURED_JSON_TYPES.size) * TEXT_FILTER_OPERATORS.length);
  });

  it('every refusal carries the ADR-0112 envelope — code AND status — and names the key, the declared type and the operator', () => {
    for (const c of TEXT_OPERATOR_DOOR_CASES.filter(isRefusal)) {
      expect(c.code, c.name).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(c.status, c.name).toBe(400);
      expect(c.mustMention, c.name).toContain(c.key);
      expect(c.mustMention, c.name).toContain(c.declaredType);
      expect(c.mustMention, c.name).toContain(c.operator);
      if (c.returnType) expect(c.mustMention, c.name).toContain(c.returnType);
    }
  });

  it('every filter is `{ [key]: { [operator]: string } }` and passes the SYNTAX door — a refusal can only be this door\'s', () => {
    for (const c of TEXT_OPERATOR_DOOR_CASES) {
      const filter = c.filter() as Record<string, Record<string, unknown>>;
      expect(Object.keys(filter), c.name).toEqual([c.key]);
      expect(Object.keys(filter[c.key]), c.name).toEqual([c.operator]);
      expect(typeof filter[c.key][c.operator], c.name).toBe('string');
      // The comparand-type door (`parseFilterAST`) accepts every case: a string
      // comparand in a string-operator slot. Whatever refuses these is the
      // field-aware door, never the syntax one.
      expect(() => parseFilterAST(c.filter()), c.name).not.toThrow();
    }
  });

  it('the factory returns a fresh object per call — no suite can edit what another judges', () => {
    const c = TEXT_OPERATOR_DOOR_CASES[0];
    expect(c.filter()).not.toBe(c.filter());
    expect(c.filter()).toEqual(c.filter());
  });
});
