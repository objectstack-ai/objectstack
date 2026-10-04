// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21333] Pins for the boolean-comparand declared-type door's CONTRACT — the
 * accepted spellings, the verdict, the refusal words, the fixture and the
 * derived case table. The door itself is `@objectstack/objectql`'s arm of the
 * engine's field-aware walk; this file keeps honest that the data it consumes
 * says what the module header argues, in both directions.
 */

import { describe, it, expect } from 'vitest';
import { BOOLEAN_VALUE_TYPES } from './field-value.zod';
import { FieldSchema, FieldType } from './field.zod';
import { ObjectSchema } from './object.zod';
import { parseFilterAST } from './filter.zod';
import {
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
  numberComparandFieldVerdict,
} from './filter-number-comparand-declared-type';
import {
  BOOLEAN_COMPARAND_DOOR_CASES,
  BOOLEAN_COMPARAND_DOOR_FIXTURE,
  BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS,
  BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT,
  BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES,
  BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS,
  BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS,
  BOOLEAN_COMPARAND_READING_CASES,
  BOOLEAN_COMPARAND_SPELLINGS,
  NON_BOOLEAN_STRING_FORMS,
  NON_BOOLEAN_VALUE_FORMS,
  booleanComparandDoorVerdict,
  booleanComparandFieldVerdict,
  booleanComparandRefusalMessage,
  readBooleanComparand,
  type BooleanComparandDoorCase,
  type BooleanComparandDoorNarrowsCase,
  type BooleanComparandDoorRefusalCase,
} from './filter-boolean-comparand-declared-type';
import { StandardErrorCode } from '../api/errors.zod';

const isRefusal = (c: BooleanComparandDoorCase): c is BooleanComparandDoorRefusalCase => c.verdict === 'door-refusal';
const isNarrows = (c: BooleanComparandDoorCase): c is BooleanComparandDoorNarrowsCase => c.verdict === 'narrows';

/** The comparand at a case's position inside a filter built for it. */
function comparandAt(c: BooleanComparandDoorCase, filter: Record<string, unknown>): unknown {
  const spec = filter[c.key];
  const tail = c.position.slice(c.key.length);
  if (tail === '') return spec;
  const m = /^\.(\$\w+)(?:\[(\d)\])?$/.exec(tail)!;
  const at = (spec as Record<string, unknown>)[m[1]];
  return m[2] === undefined ? at : (at as unknown[])[Number(m[2])];
}

// ── The accepted spellings ───────────────────────────────────────────────────

describe('[#21333] the accepted spellings', () => {
  it('are exactly the record validator\'s write-side set: true / false, 1 / 0, "1" / "0", "true" / "false"', () => {
    expect([...BOOLEAN_COMPARAND_SPELLINGS.entries()]).toEqual([
      [1, true], [0, false], ['1', true], ['0', false], ['true', true], ['false', false],
    ]);
    for (const b of [true, false]) expect(readBooleanComparand(b)).toEqual({ boolean: true, value: b });
  });

  it('every reading row answers what its row says', () => {
    for (const row of BOOLEAN_COMPARAND_READING_CASES) {
      const reading = readBooleanComparand(row.input);
      if (row.boolean === null) expect(reading, row.why).toBeNull();
      else if (row.boolean) expect(reading, row.why).toEqual({ boolean: true, value: row.value });
      else expect(reading, row.why).toEqual({ boolean: false, form: row.form });
    }
  });

  it('every refused form has at least one row, and no row names a form outside the vocabulary', () => {
    const forms = new Set(BOOLEAN_COMPARAND_READING_CASES.flatMap((r) => (r.boolean === false ? [r.form] : [])));
    expect([...forms].sort()).toEqual([...NON_BOOLEAN_STRING_FORMS].sort());
  });

  it('every accepted non-boolean spelling has a row', () => {
    for (const [spelling, value] of BOOLEAN_COMPARAND_SPELLINGS) {
      expect(BOOLEAN_COMPARAND_READING_CASES.some((r) => r.input === spelling && r.boolean === true && r.value === value), String(spelling))
        .toBe(true);
    }
  });

  it('folds no case and trims nothing — one spelling per value', () => {
    expect(readBooleanComparand('TRUE')).toEqual({ boolean: false, form: 'letter-case' });
    expect(readBooleanComparand(' false')).toEqual({ boolean: false, form: 'padded' });
    expect(readBooleanComparand(' YES ')).toEqual({ boolean: false, form: 'not-a-boolean' });
  });

  it('never reads a placeholder — no filter token resolves to a boolean', () => {
    for (const token of ['{current_user_id}', '{current_org_id}', '{record_id}', '{today}', '{not_a_token}']) {
      expect(readBooleanComparand(token), token).toEqual({ boolean: false, form: 'placeholder' });
    }
  });
});

// ── Which fields, which positions ────────────────────────────────────────────

describe('[#21333] the judged fields and positions', () => {
  it('are BOOLEAN_VALUE_TYPES itself, by identity — nothing re-listed', () => {
    expect(BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES).toBe(BOOLEAN_VALUE_TYPES);
    expect([...BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES].sort()).toEqual(['boolean', 'toggle']);
  });

  it('judges a formula by its returnType, and defers on an unreadable one', () => {
    expect(booleanComparandFieldVerdict({ type: 'formula', returnType: 'boolean' })).toBe('judged');
    expect(booleanComparandFieldVerdict({ type: 'formula', returnType: 'text' })).toBe('not-judged');
    expect(booleanComparandFieldVerdict({ type: 'formula' })).toBe('deferred');
    expect(booleanComparandFieldVerdict({ type: 'number' })).toBe('not-judged');
  });

  it('are the number door\'s positions BY IDENTITY — the engine judges both arms in one walk', () => {
    expect(BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS).toBe(NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS);
    expect(BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS).toBe(NUMBER_COMPARAND_DOOR_LIST_OPERATORS);
  });

  it('judges a field class disjoint from the number door\'s — at most one arm judges a key', () => {
    const metas = [
      ...FieldType.options.map((type) => ({ type })),
      ...['number', 'text', 'boolean', 'date'].map((returnType) => ({ type: 'formula', returnType })),
    ];
    for (const meta of metas) {
      const booleanJudges = booleanComparandFieldVerdict(meta) === 'judged';
      const numberJudges = numberComparandFieldVerdict(meta) === 'judged';
      expect(booleanJudges && numberJudges, JSON.stringify(meta)).toBe(false);
    }
    expect(metas.filter((m) => booleanComparandFieldVerdict(m) === 'judged')).toEqual([
      { type: 'boolean' }, { type: 'toggle' }, { type: 'formula', returnType: 'boolean' },
    ]);
  });
});

// ── The verdict ──────────────────────────────────────────────────────────────

describe('[#21333] booleanComparandDoorVerdict', () => {
  const field = { type: 'boolean' };

  it('refuses "yes" on a boolean field with the INVALID_FILTER / 400 envelope and its form', () => {
    expect(booleanComparandDoorVerdict(field, 'yes'))
      .toEqual({ verdict: 'door-refusal', form: 'not-a-boolean', code: 'INVALID_FILTER', status: 400 });
    expect(StandardErrorCode.enum.INVALID_FILTER).toBe('INVALID_FILTER');
  });

  it('narrows every accepted non-boolean spelling to its boolean, on boolean and toggle alike', () => {
    for (const type of ['boolean', 'toggle']) {
      for (const [spelling, value] of BOOLEAN_COMPARAND_SPELLINGS) {
        expect(booleanComparandDoorVerdict({ type }, spelling), `${type} ${String(spelling)}`).toEqual({ verdict: 'narrows', value });
      }
    }
  });

  it('passes a boolean, null, a reference and every value the comparand-type door refuses itself', () => {
    for (const comparand of [true, false, null, { $field: 'f_toggle' }, undefined, { a: 1 }, new Map(), Symbol('s')]) {
      expect(booleanComparandDoorVerdict(field, comparand), String(comparand)).toEqual({ verdict: 'passes' });
    }
  });

  it('[#21382] refuses a number other than 1 / 0, a Date and an array — each by what it is, with the 400 envelope', () => {
    const refusal = (form: string) => ({ verdict: 'door-refusal', form, code: 'INVALID_FILTER', status: 400 });
    for (const type of ['boolean', 'toggle']) {
      for (const n of [2, -1, 0.5, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER]) {
        expect(booleanComparandDoorVerdict({ type }, n), `${type} ${n}`).toEqual(refusal('number'));
      }
      for (const d of [new Date(0), new Date(Date.UTC(2026, 0, 1)), new Date(Number.NaN)]) {
        expect(booleanComparandDoorVerdict({ type }, d), `${type} ${String(d)}`).toEqual(refusal('date'));
      }
      for (const a of [[true], [], [1], ['true'], [[false]]]) {
        expect(booleanComparandDoorVerdict({ type }, a), `${type} ${JSON.stringify(a)}`).toEqual(refusal('array'));
      }
    }
    expect(booleanComparandDoorVerdict({ type: 'formula', returnType: 'boolean' }, 2)).toEqual(refusal('number'));
    // …while on a field that is not boolean none of them is this door's subject.
    for (const comparand of [2, new Date(0), [true]]) {
      expect(booleanComparandDoorVerdict({ type: 'text' }, comparand)).toEqual({ verdict: 'passes' });
      expect(booleanComparandDoorVerdict({ type: 'formula' }, comparand)).toEqual({ verdict: 'deferred' });
    }
  });

  it('[#21382] reads a bigint as the number it names — 1n / 0n narrow like 1 / 0, any other is refused as a number', () => {
    expect(readBooleanComparand(1n)).toEqual({ boolean: true, value: true });
    expect(readBooleanComparand(0n)).toEqual({ boolean: true, value: false });
    expect(readBooleanComparand(-0n)).toEqual({ boolean: true, value: false });
    expect(booleanComparandDoorVerdict(field, 1n)).toEqual({ verdict: 'narrows', value: true });
    expect(booleanComparandDoorVerdict(field, 0n)).toEqual({ verdict: 'narrows', value: false });
    for (const b of [2n, -1n, 2n ** 64n]) {
      expect(readBooleanComparand(b), String(b)).toBeNull();
      expect(booleanComparandDoorVerdict(field, b), String(b))
        .toEqual({ verdict: 'door-refusal', form: 'number', code: 'INVALID_FILTER', status: 400 });
    }
  });

  it('[#21382] the accepted set is unchanged — the widening adds refusals only', () => {
    // Every accepted spelling still narrows, a boolean still passes, null is still the null test.
    for (const [spelling, value] of BOOLEAN_COMPARAND_SPELLINGS) {
      expect(booleanComparandDoorVerdict(field, spelling)).toEqual({ verdict: 'narrows', value });
    }
    expect(booleanComparandDoorVerdict(field, true)).toEqual({ verdict: 'passes' });
    expect(booleanComparandDoorVerdict(field, null)).toEqual({ verdict: 'passes' });
    // The string rule is untouched: what it refused, it refuses in the same form.
    for (const row of BOOLEAN_COMPARAND_READING_CASES) {
      if (row.boolean !== false) continue;
      expect(booleanComparandDoorVerdict(field, row.input), row.input).toMatchObject({ verdict: 'door-refusal', form: row.form });
    }
  });

  it('passes any comparand on a field that is not boolean, and defers on an unreadable formula', () => {
    expect(booleanComparandDoorVerdict({ type: 'text' }, 'yes')).toEqual({ verdict: 'passes' });
    expect(booleanComparandDoorVerdict({ type: 'number' }, 'true')).toEqual({ verdict: 'passes' });
    expect(booleanComparandDoorVerdict({ type: 'formula' }, 'yes')).toEqual({ verdict: 'deferred' });
  });
});

// ── The words ────────────────────────────────────────────────────────────────

describe('[#21333] booleanComparandRefusalMessage', () => {
  const site = { field: 'active', declaredType: 'boolean', path: 'where.active.$ne', value: 'yes', form: 'not-a-boolean' as const };

  it('names the field, its declared type, the comparand, its position and the remedy — behind the caller prefix', () => {
    const message = booleanComparandRefusalMessage(site, "find('task')");
    expect(message.startsWith("find('task'): filter on 'active' compares a declared boolean field against \"yes\" at where.active.$ne"))
      .toBe(true);
    expect(message).toContain('which is not a boolean');
    expect(message).toContain('NOT applied');
    expect(message).toContain('Write true or false');
    expect(booleanComparandRefusalMessage(site).startsWith("filter on 'active'")).toBe(true);
  });

  it('names a formula\'s return type, and an aggregated column as one', () => {
    expect(booleanComparandRefusalMessage({ ...site, declaredType: 'formula', returnType: 'boolean' }))
      .toContain('a declared formula field returning boolean');
    const aggregated = booleanComparandRefusalMessage({ ...site, path: 'having.active', aggregated: true });
    expect(aggregated).toContain('compares a boolean aggregated column against');
    expect(aggregated).not.toContain('declared');
  });

  it('says something different for every form, string and non-string alike, and carries no tracker number', () => {
    const forms = [...NON_BOOLEAN_STRING_FORMS, ...NON_BOOLEAN_VALUE_FORMS];
    const messages = forms.map((form) => booleanComparandRefusalMessage({ ...site, form }));
    expect(new Set(messages).size).toBe(forms.length);
    for (const m of messages) expect(m).not.toMatch(/#\d/);
  });

  it('[#21382] renders a non-string comparand as what it is — a Date by name, a non-finite number by name, never as JSON null', () => {
    const at = (value: unknown, form: 'number' | 'date' | 'array') =>
      booleanComparandRefusalMessage({ ...site, path: 'where.active.$eq', value, form });
    expect(at(2, 'number')).toContain("against 2 at where.active.$eq, which is not a boolean: only the numbers 1 and 0 are read as a boolean");
    expect(at(Number.NaN, 'number')).toContain('against NaN at');
    expect(at(Number.NEGATIVE_INFINITY, 'number')).toContain('against -Infinity at');
    expect(at(2n, 'number')).toContain('against 2 at');
    expect(at(new Date(Date.UTC(2026, 0, 1)), 'date')).toContain('against Date(2026-01-01T00:00:00.000Z) at');
    expect(at(new Date(Number.NaN), 'date')).toContain('against Date(Invalid Date) at');
    expect(at(new Date(0), 'date')).toContain('compare a Date with a date or datetime field');
    expect(at([true], 'array')).toContain('against [true] at');
    expect(at([true], 'array')).toContain('use $in, each member a boolean');
    // No clause names a backend: the server error was a `where` fact, and the
    // engine evaluates the per-aggregation filter and having itself.
    for (const form of NON_BOOLEAN_VALUE_FORMS) expect(at(2, form)).not.toMatch(/postgres/i);
  });

  it('stays inside the 500-character client bound for every refusal in the case table, at the longest position', () => {
    for (const c of BOOLEAN_COMPARAND_DOOR_CASES.filter(isRefusal)) {
      const message = booleanComparandRefusalMessage({
        field: c.key, declaredType: c.declaredType, returnType: c.returnType,
        path: `aggregations[0].filter.${c.position}`, value: c.comparand, form: c.form,
      }, `aggregate('${BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT}')`);
      expect(message.length, c.name).toBeLessThanOrEqual(500);
    }
  });

  it('front-loads what a caller acts on: with 40-character names the head still ends inside the first 500 characters', () => {
    const name = 'f'.repeat(40);
    for (const form of [...NON_BOOLEAN_STRING_FORMS, ...NON_BOOLEAN_VALUE_FORMS]) {
      const message = booleanComparandRefusalMessage({
        field: name, declaredType: 'formula', returnType: 'boolean',
        path: `aggregations[12].filter.${name}.$between[1]`, value: 'x'.repeat(200), form,
      }, `aggregate('${'o'.repeat(40)}')`);
      const head = message.slice(0, message.indexOf(' The filter was NOT applied'));
      expect(head.length, form).toBeLessThanOrEqual(500);
      expect(message.slice(0, 500), form).toContain(head);
    }
  });
});

// ── The fixture and the case table ───────────────────────────────────────────

describe('[#21333] the fixture', () => {
  it('every field is a legal FieldSchema input, and the object a legal ObjectSchema input', () => {
    const names = BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
    for (const f of BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS) {
      const r = FieldSchema.safeParse(f);
      expect(r.success, `${f.name}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true);
    }
    const obj = ObjectSchema.safeParse(BOOLEAN_COMPARAND_DOOR_FIXTURE);
    expect(obj.success, obj.success ? '' : JSON.stringify(obj.error.issues)).toBe(true);
    expect(BOOLEAN_COMPARAND_DOOR_FIXTURE.name).toBe(BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT);
  });

  it('carries every judged type', () => {
    for (const type of BOOLEAN_COMPARAND_DOOR_JUDGED_TYPES) {
      expect(BOOLEAN_COMPARAND_DOOR_FIXTURE_FIELDS.some((f) => f.type === type), type).toBe(true);
    }
  });
});

describe('[#21333] BOOLEAN_COMPARAND_DOOR_CASES', () => {
  it('has unique case names — they are used as test names', () => {
    const names = BOOLEAN_COMPARAND_DOOR_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('covers all four verdicts', () => {
    expect([...new Set(BOOLEAN_COMPARAND_DOOR_CASES.map((c) => c.verdict))].sort())
      .toEqual(['deferred', 'door-refusal', 'narrows', 'passes']);
  });

  it('the census refuses "yes" and narrows "true" exactly on the boolean class and a formula returning boolean', () => {
    const census = BOOLEAN_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[census]'));
    const judged = ['f_boolean', 'f_toggle', 'f_formula_boolean'];
    for (const c of census) {
      if (judged.includes(c.key)) expect(c.verdict, c.name).toBe(c.comparand === 'yes' ? 'door-refusal' : 'narrows');
      else if (c.key === 'f_formula_untyped') expect(c.verdict, c.name).toBe('deferred');
      else expect(c.verdict, c.name).toBe('passes');
    }
  });

  it('the flag operators and a field reference pass — the door never judges them', () => {
    for (const c of BOOLEAN_COMPARAND_DOOR_CASES.filter((x) => x.name.startsWith('[unjudged]'))) {
      expect(c.verdict, c.name).toBe('passes');
    }
  });

  it('[#21382] the value group refuses every non-string form at every position the shape door leaves to it', () => {
    const value = BOOLEAN_COMPARAND_DOOR_CASES.filter((c) => c.name.startsWith('[value]'));
    const refused = value.filter(isRefusal);
    expect(new Set(refused.map((c) => c.form))).toEqual(new Set(NON_BOOLEAN_VALUE_FORMS));
    const positionsOf = (form: string) =>
      new Set(refused.filter((c) => c.key === 'f_boolean' && c.form === form).map((c) => c.position));
    const judged = ['f_boolean', ...BOOLEAN_COMPARAND_DOOR_SCALAR_OPERATORS.map((op) => `f_boolean.${op}`),
      ...BOOLEAN_COMPARAND_DOOR_LIST_OPERATORS.flatMap((op) => [`f_boolean.${op}[0]`, `f_boolean.${op}[1]`])];
    expect([...positionsOf('number')].sort()).toEqual([...judged].sort());
    expect([...positionsOf('date')].sort()).toEqual([...judged].sort());
    // The array rows skip every one-value slot, where the comparand-shape door
    // speaks first: the equality slots since #19757 / #19886, and [#21448] every
    // other scalar operator since. They sit at the list members alone.
    const listMember = (p: string) => /\[\d\]$/.test(p);
    expect([...positionsOf('array')].sort()).toEqual(judged.filter(listMember).sort());
    // Every judged field is refused a number; null and the non-boolean field's rows pass.
    expect(new Set(refused.filter((c) => c.comparand === -1).map((c) => c.key)))
      .toEqual(new Set(['f_boolean', 'f_toggle', 'f_formula_boolean']));
    for (const c of value.filter((x) => x.comparand === null || x.key === 'f_text')) expect(c.verdict, c.name).toBe('passes');
  });

  it('every refusal carries the ADR-0112 envelope, and the words name the key, the declared type, the comparand and its position', () => {
    for (const c of BOOLEAN_COMPARAND_DOOR_CASES.filter(isRefusal)) {
      expect(c.code, c.name).toBe(StandardErrorCode.enum.INVALID_FILTER);
      expect(c.status, c.name).toBe(400);
      const message = booleanComparandRefusalMessage({
        field: c.key, declaredType: c.declaredType, returnType: c.returnType,
        path: `where.${c.position}`, value: c.comparand, form: c.form,
      }, `find('${BOOLEAN_COMPARAND_DOOR_FIXTURE_OBJECT}')`);
      for (const s of c.mustMention) expect(message, c.name).toContain(s);
    }
  });

  it('a narrowed case\'s expected filter is its filter with the one comparand replaced by its boolean', () => {
    for (const c of BOOLEAN_COMPARAND_DOOR_CASES.filter(isNarrows)) {
      const expected = c.expectedFilter() as Record<string, unknown>;
      expect(comparandAt(c, expected), c.name).toBe(c.value);
      expect(comparandAt(c, c.filter() as Record<string, unknown>), c.name).toBe(c.comparand);
    }
  });

  it('every filter passes the SYNTAX door — a refusal can only be a field-aware door\'s', () => {
    for (const c of BOOLEAN_COMPARAND_DOOR_CASES) {
      expect(() => parseFilterAST(c.filter()), c.name).not.toThrow();
      if (isNarrows(c)) expect(() => parseFilterAST(c.expectedFilter()), c.name).not.toThrow();
    }
  });

  it('the factories return a fresh object per call — no suite can edit what another judges', () => {
    const c = BOOLEAN_COMPARAND_DOOR_CASES.find(isNarrows)!;
    expect(c.filter()).not.toBe(c.filter());
    expect(c.filter()).toEqual(c.filter());
    const reference = BOOLEAN_COMPARAND_DOOR_CASES.find((x) => typeof x.comparand === 'object' && x.comparand !== null)!;
    const first = comparandAt(reference, reference.filter() as Record<string, unknown>);
    expect(first).not.toBe(comparandAt(reference, reference.filter() as Record<string, unknown>));
    expect(first).toEqual(reference.comparand);
  });
});
