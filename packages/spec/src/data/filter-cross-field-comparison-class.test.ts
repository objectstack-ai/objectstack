// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20347] Pins for the cross-field comparison-class CONTRACT — the classes,
 * the class table and the two verdicts. What this file keeps honest is that
 * every `FieldType` member is classified exactly once, by reference to the
 * existing value-class sets, and that the pairwise verdict is the rule the
 * module header states. driver-sql answers the same on every pair because it
 * delegates to `crossFieldColumnVerdict`; the driver-internal aliases it keeps
 * above this table are pinned in driver-sql
 * (`sql-driver-20355-cross-field-class-driver-aliases.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  FILE_REFERENCE_TYPES,
  INSTANT_TYPES,
  MULTI_CAPABLE_TYPES,
  MULTI_OPTION_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
} from './field-value.zod';
import { FieldType } from './field.zod';
import {
  CROSS_FIELD_COMPARISON_CLASSES,
  CROSS_FIELD_COMPARISON_TYPE_CLASSES,
  CROSS_FIELD_NO_CLASS_REASONS,
  crossFieldColumnVerdict,
  crossFieldComparisonVerdict,
  type CrossFieldColumnVerdict,
} from './filter-cross-field-comparison-class';

const sorted = (s: Iterable<string>) => [...s].sort();
const union = (...sets: ReadonlySet<string>[]) => new Set(sets.flatMap((s) => [...s]));
const cls = (c: string): CrossFieldColumnVerdict => ({ kind: 'class', class: c } as CrossFieldColumnVerdict);
const none = (r: string): CrossFieldColumnVerdict => ({ kind: 'no-class', reason: r } as CrossFieldColumnVerdict);

describe('the class table — one classification, read by every judge', () => {
  it('classifies every FieldType member exactly once — rows pairwise disjoint, union exactly FieldType', () => {
    const seen = new Map<string, string>();
    for (const row of CROSS_FIELD_COMPARISON_TYPE_CLASSES) {
      for (const t of row.types) {
        expect(seen.get(t), `${t} is in both ${seen.get(t)} and ${row.name}`).toBeUndefined();
        seen.set(t, row.name);
      }
    }
    expect(sorted(seen.keys())).toEqual(sorted(FieldType.options));
  });

  it('spells each class by REFERENCE to the existing value-class sets — nothing re-listed', () => {
    const byName = new Map(CROSS_FIELD_COMPARISON_TYPE_CLASSES.map((row) => [row.name, row.types]));
    expect(byName.get('NUMERIC_VALUE_TYPES')).toBe(NUMERIC_VALUE_TYPES);
    expect(byName.get('STRING_VALUE_TYPES')).toBe(STRING_VALUE_TYPES);
    expect(byName.get('SINGLE_OPTION_TYPES')).toBe(SINGLE_OPTION_TYPES);
    expect(byName.get('REFERENCE_VALUE_TYPES')).toBe(REFERENCE_VALUE_TYPES);
    expect(byName.get('BOOLEAN_VALUE_TYPES')).toBe(BOOLEAN_VALUE_TYPES);
    expect(byName.get('CALENDAR_DATE_TYPES')).toBe(CALENDAR_DATE_TYPES);
    expect(byName.get('INSTANT_TYPES')).toBe(INSTANT_TYPES);
    expect(byName.get('CLOCK_TIME_TYPES')).toBe(CLOCK_TIME_TYPES);
    expect(byName.get('STRUCTURED_JSON_TYPES')).toBe(STRUCTURED_JSON_TYPES);
    expect(byName.get('MULTI_OPTION_TYPES')).toBe(MULTI_OPTION_TYPES);
    expect(byName.get('FILE_REFERENCE_TYPES')).toBe(FILE_REFERENCE_TYPES);
  });

  it('the six classes, by the value classes each one holds', () => {
    const typesOf = (c: string) => union(
      ...CROSS_FIELD_COMPARISON_TYPE_CLASSES
        .filter((row) => row.verdict.kind === 'class' && row.verdict.class === c)
        .map((row) => row.types),
    );
    expect(sorted(typesOf('numeric'))).toEqual(sorted(NUMERIC_VALUE_TYPES));
    expect(sorted(typesOf('text'))).toEqual(sorted(union(
      STRING_VALUE_TYPES, new Set(['autonumber']), SINGLE_OPTION_TYPES, REFERENCE_VALUE_TYPES,
    )));
    expect(sorted(typesOf('boolean'))).toEqual(sorted(BOOLEAN_VALUE_TYPES));
    expect(sorted(typesOf('date'))).toEqual(sorted(CALENDAR_DATE_TYPES));
    expect(sorted(typesOf('datetime'))).toEqual(sorted(INSTANT_TYPES));
    expect(sorted(typesOf('time'))).toEqual(sorted(CLOCK_TIME_TYPES));
  });

  it('the three families with no class: a list or an object, the file family, formula', () => {
    const typesOf = (r: string) => union(
      ...CROSS_FIELD_COMPARISON_TYPE_CLASSES
        .filter((row) => row.verdict.kind === 'no-class' && row.verdict.reason === r)
        .map((row) => row.types),
    );
    expect(sorted(typesOf('list-or-object'))).toEqual(sorted(union(STRUCTURED_JSON_TYPES, MULTI_OPTION_TYPES)));
    expect(sorted(typesOf('file'))).toEqual(sorted(FILE_REFERENCE_TYPES));
    expect(sorted(typesOf('formula'))).toEqual(['formula']);
  });

  it('declares no phantom class or reason: every one named is used by a row, and every row uses a named one', () => {
    const usedClasses = new Set<string>();
    const usedReasons = new Set<string>();
    for (const row of CROSS_FIELD_COMPARISON_TYPE_CLASSES) {
      if (row.verdict.kind === 'class') usedClasses.add(row.verdict.class);
      else usedReasons.add(row.verdict.reason);
    }
    expect(sorted(usedClasses)).toEqual(sorted(CROSS_FIELD_COMPARISON_CLASSES));
    expect(sorted(usedReasons)).toEqual(sorted(CROSS_FIELD_NO_CLASS_REASONS));
  });
});

describe('crossFieldColumnVerdict — one declared column', () => {
  it('answers each FieldType member its row\'s verdict when declared single-valued', () => {
    for (const row of CROSS_FIELD_COMPARISON_TYPE_CLASSES) {
      for (const type of row.types) {
        expect(crossFieldColumnVerdict({ type }), type).toEqual(row.verdict);
        expect(crossFieldColumnVerdict({ type, multiple: false }), `${type} multiple:false`).toEqual(row.verdict);
      }
    }
  });

  it('`multiple: true` on a multi-capable type holds a list — whatever its row says', () => {
    for (const type of MULTI_CAPABLE_TYPES) {
      expect(crossFieldColumnVerdict({ type, multiple: true }), type).toEqual(none('list-or-object'));
    }
  });

  it('`multiple: true` on any other type moves nothing — isMultiValueField\'s own reading', () => {
    for (const type of FieldType.options.filter((t) => !MULTI_CAPABLE_TYPES.has(t))) {
      expect(crossFieldColumnVerdict({ type, multiple: true }), type).toEqual(crossFieldColumnVerdict({ type }));
    }
  });

  it('formula has no class whatever its declared returnType — no stored column to reference', () => {
    expect(crossFieldColumnVerdict({ type: 'formula' })).toEqual(none('formula'));
  });

  it('a type outside FieldType is not judged: driver aliases, the absent-type default, garbage', () => {
    for (const type of ['integer', 'int', 'float', 'object', 'array', 'string', 'reference', '', 'Text']) {
      expect(crossFieldColumnVerdict({ type }), JSON.stringify(type)).toBeUndefined();
    }
  });
});

describe('crossFieldComparisonVerdict — the measured cells', () => {
  it('text vs number is cross-class, in both orders', () => {
    expect(crossFieldComparisonVerdict({ type: 'text' }, { type: 'number' }))
      .toEqual({ verdict: 'cross-class', left: 'text', right: 'numeric' });
    expect(crossFieldComparisonVerdict({ type: 'number' }, { type: 'text' }))
      .toEqual({ verdict: 'cross-class', left: 'numeric', right: 'text' });
  });

  it('text vs a single image has no class on the image side, in both orders', () => {
    expect(crossFieldComparisonVerdict({ type: 'text' }, { type: 'image' }))
      .toEqual({ verdict: 'no-class', left: cls('text'), right: none('file') });
    expect(crossFieldComparisonVerdict({ type: 'image' }, { type: 'text' }))
      .toEqual({ verdict: 'no-class', left: none('file'), right: cls('text') });
  });

  it('text vs a formula field has no class on the formula side', () => {
    expect(crossFieldComparisonVerdict({ type: 'text' }, { type: 'formula' }))
      .toEqual({ verdict: 'no-class', left: cls('text'), right: none('formula') });
  });

  it('two columns of one class are comparable — the control', () => {
    expect(crossFieldComparisonVerdict({ type: 'text' }, { type: 'text' })).toEqual({ verdict: 'comparable', class: 'text' });
    expect(crossFieldComparisonVerdict({ type: 'select' }, { type: 'lookup' })).toEqual({ verdict: 'comparable', class: 'text' });
    expect(crossFieldComparisonVerdict({ type: 'currency' }, { type: 'number' })).toEqual({ verdict: 'comparable', class: 'numeric' });
  });

  it('the three temporal classes do not mix, and a boolean is not a number', () => {
    expect(crossFieldComparisonVerdict({ type: 'date' }, { type: 'datetime' }).verdict).toBe('cross-class');
    expect(crossFieldComparisonVerdict({ type: 'datetime' }, { type: 'time' }).verdict).toBe('cross-class');
    expect(crossFieldComparisonVerdict({ type: 'boolean' }, { type: 'number' }).verdict).toBe('cross-class');
  });

  it('two file fields are not comparable either — the family has no class at all', () => {
    expect(crossFieldComparisonVerdict({ type: 'image' }, { type: 'image' }))
      .toEqual({ verdict: 'no-class', left: none('file'), right: none('file') });
  });

  it('an undeclared type on either side is unjudged', () => {
    expect(crossFieldComparisonVerdict({ type: 'integer' }, { type: 'number' })).toEqual({ verdict: 'unjudged' });
    expect(crossFieldComparisonVerdict({ type: 'formula' }, { type: 'string' })).toEqual({ verdict: 'unjudged' });
  });
});

describe('crossFieldComparisonVerdict — every pair of declared columns', () => {
  // Every FieldType member single-valued, plus every multi-capable member
  // flagged `multiple: true`.
  const columns = [
    ...FieldType.options.map((type) => ({ type })),
    ...[...MULTI_CAPABLE_TYPES].map((type) => ({ type, multiple: true })),
  ];
  const label = (c: { type: string; multiple?: boolean }) => (c.multiple ? `${c.type}[]` : c.type);

  it('is comparable exactly when both columns have a class and it is the same one', () => {
    for (const a of columns) {
      for (const b of columns) {
        const va = crossFieldColumnVerdict(a)!;
        const vb = crossFieldColumnVerdict(b)!;
        const same = va.kind === 'class' && vb.kind === 'class' && va.class === vb.class;
        expect(crossFieldComparisonVerdict(a, b).verdict === 'comparable', `${label(a)} vs ${label(b)}`).toBe(same);
      }
    }
  });

  it('is symmetric: swapping the sides never changes the verdict kind', () => {
    for (const a of columns) {
      for (const b of columns) {
        expect(crossFieldComparisonVerdict(a, b).verdict, `${label(a)} vs ${label(b)}`)
          .toBe(crossFieldComparisonVerdict(b, a).verdict);
      }
    }
  });
});
