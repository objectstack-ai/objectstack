// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] `validateExpression` refuses `==` / `!=` between a LIST-valued
 * field and a non-null scalar literal (`list-equality`).
 *
 * CEL compares the whole list with the scalar, so `record.labels == 'frontend'`
 * is `false` for `['frontend', 'qa']` and for `null` alike: the condition
 * answers one constant on every row. A field is a list subject when its
 * `fieldTypes` type is inherently multi (`multiselect` / `checkboxes` /
 * `tags`) or `ExprSchemaHint.multiValueFields` names it (a `select` /
 * `lookup` / `user` declared `multiple: true`).
 *
 * The first describe proves the premise on the evaluator itself, so the
 * refusal below is about a real constant and not a guess.
 */

import { describe, it, expect } from 'vitest';

import { celEngine } from './cel-engine';
import { compileCelToFilter } from './cel-to-filter';
import { matchesFilterCondition } from './matches-filter';
import { validateExpression, type ExprSchemaHint } from './validate';

const MULTI_TYPES = ['multiselect', 'checkboxes', 'tags'] as const;
const CAPABLE_TYPES = ['select', 'lookup', 'user'] as const;

/** A record-scoped hint over one field `f` of `type`, optionally declared multi-valued. */
function hintFor(type: string, multi = false, scope: 'record' | 'flattened' = 'record'): ExprSchemaHint {
  return {
    objectName: 'probe',
    fields: ['f', 'name', 'g'],
    fieldTypes: { f: type, name: 'text' },
    ...(multi ? { multiValueFields: ['f'] } : {}),
    scope,
    // A flattened site is judged only where the run is proven to bind a row
    // of the typed object; the unproven case is pinned on its own below.
    ...(scope === 'flattened' ? { faultOutcome: 'run-fails' as const } : {}),
  };
}

/** Every operand order and member spelling of `<root>.f <op> 'a'`. */
function comparisons(root: string, op: '==' | '!='): readonly string[] {
  return [
    `${root}.f ${op} 'a'`,
    `'a' ${op} ${root}.f`,
    `${root}['f'] ${op} 'a'`,
    `'a' ${op} ${root}["f"]`,
    `${root}.f ${op} 3`,
    `${root}.f ${op} true`,
    `${root}.name == 'x' && ${root}.f ${op} 'a'`,
  ];
}

function refusalsOf(source: string, hint: ExprSchemaHint, role: 'predicate' | 'value' = 'predicate') {
  return validateExpression(role, source, hint).errors;
}

describe('the premise — on the evaluator, a list compared with a scalar is a constant', () => {
  const run = (source: string, labels: unknown) =>
    celEngine.evaluate({ dialect: 'cel', source }, { record: { labels } });
  it.each([[['frontend', 'qa']], [['qa']], [[]], [null]])('labels = %j', (labels) => {
    expect(run("record.labels == 'frontend'", labels)).toEqual({ ok: true, value: false });
    expect(run("record.labels != 'frontend'", labels)).toEqual({ ok: true, value: true });
  });
  it('CONTROL — a membership test answers per row', () => {
    const src = "record.labels != null && 'frontend' in record.labels";
    expect(run(src, ['frontend', 'qa'])).toEqual({ ok: true, value: true });
    expect(run(src, ['qa'])).toEqual({ ok: true, value: false });
    expect(run(src, null)).toEqual({ ok: true, value: false });
  });
});

describe('list-equality — refused on an inherently multi-value type', () => {
  for (const type of MULTI_TYPES) {
    for (const root of ['record', 'previous']) {
      for (const op of ['==', '!='] as const) {
        for (const source of comparisons(root, op)) {
          it(`${type}: refuses ${source}`, () => {
            const errors = refusalsOf(source, hintFor(type));
            expect(errors.map((e) => e.code)).toEqual(['list-equality']);
            const [e] = errors;
            expect(e.code === 'list-equality' && e.params.reference).toBe(`${root}.f`);
            expect(e.code === 'list-equality' && e.params.operator).toBe(op);
            expect(e.code === 'list-equality' && e.params.answer).toBe(op === '==' ? 'false' : 'true');
            expect(e.message).toContain(`\`${root}.f\``);
            expect(e.message).toContain(' in ');
            expect(e.message).toContain(op === '==' ? `in ${root}.f)\`` : `!(`);
          });
        }
      }
    }
  }

  it('the optional spellings (`.?f`, `[?\'f\']`) do not compile against a scalar: invalid-cel alone, no second refusal', () => {
    for (const source of ["record.?f == 'a'", "previous[?'f'] != 'a'"]) {
      expect(refusalsOf(source, hintFor('tags')).map((e) => e.code)).toEqual(['invalid-cel']);
    }
  });

  it('refuses in a flattened (flow) condition and in a formula value too', () => {
    expect(refusalsOf("record.f == 'a'", hintFor('tags', false, 'flattened')).map((e) => e.code)).toEqual(['list-equality']);
    expect(refusalsOf("record.f == 'a'", hintFor('tags'), 'value').map((e) => e.code)).toEqual(['list-equality']);
  });

  it('refuses each comparison once, in the order written', () => {
    const errors = refusalsOf("record.f == 'a' || previous.f != 'b'", hintFor('multiselect'));
    expect(errors.map((e) => e.code === 'list-equality' && [e.params.reference, e.params.operator])).toEqual([
      ['record.f', '=='],
      ['previous.f', '!='],
    ]);
  });
});

describe('list-equality — select / lookup / user follow multiValueFields', () => {
  for (const type of CAPABLE_TYPES) {
    for (const op of ['==', '!='] as const) {
      it(`${type} declared multiple: refuses record.f ${op} 'a'`, () => {
        const errors = refusalsOf(`record.f ${op} 'a'`, hintFor(type, true));
        expect(errors.map((e) => e.code)).toEqual(['list-equality']);
        expect(errors[0].message).toContain('`record.f`');
        expect(errors[0].message).toMatch(/\bin record\.f/);
      });
      it(`${type} not declared multiple: accepts record.f ${op} 'a' (absent key, as before)`, () => {
        expect(validateExpression('predicate', `record.f ${op} 'a'`, hintFor(type)).ok).toBe(true);
      });
    }
  }

  it('multiValueFields alone (no fieldTypes) is enough', () => {
    const r = validateExpression('predicate', "record.f == 'a'", { fields: ['f'], scope: 'record', multiValueFields: ['f'] });
    expect(r.errors.map((e) => e.code)).toEqual(['list-equality']);
  });
});

describe('list-equality — accepted shapes', () => {
  const accepted = [
    'record.f == null',
    'record.f != null',
    'null == record.f',
    'null != previous.f',
    "'a' in record.f",
    "record.f != null && 'a' in record.f",
    "record.f == null || !('a' in record.f)",
    "record.f == ['a', 'b']",
    'record.f == previous.f',
    'size(record.f) == 2',
    "record.f[0] == 'a'",
    'record.f == record.g',
  ];
  for (const source of accepted) {
    it(`accepts ${source}`, () => {
      const r = validateExpression('predicate', source, hintFor('multiselect'));
      expect(r.errors.map((e) => e.code)).toEqual([]);
    });
  }

  it('CONTROL — a scalar field compared with a scalar is accepted', () => {
    for (const type of ['text', 'select', 'lookup', 'user', 'number']) {
      for (const op of ['==', '!=']) {
        expect(validateExpression('predicate', `record.f ${op} 'a'`, hintFor(type)).ok).toBe(true);
      }
    }
    expect(validateExpression('predicate', "record.name == 'a'", hintFor('multiselect')).ok).toBe(true);
  });

  it('CONTROL — no hint, no verdict', () => {
    expect(validateExpression('predicate', "record.f == 'a'").ok).toBe(true);
    expect(validateExpression('predicate', "record.f == 'a'", { scope: 'record' }).ok).toBe(true);
  });
});

describe('list-equality — a bare name at a flattened (flow) site is the trigger record field', () => {
  const listEquality = (source: string, hint: ExprSchemaHint) =>
    refusalsOf(source, hint).filter((e) => e.code === 'list-equality');

  for (const [type, multi] of [['tags', false], ['multiselect', false], ['user', true], ['select', true]] as const) {
    for (const source of ["f == 'a'", "'a' != f", 'f == 3', "name == 'x' && f != 'a'"]) {
      it(`${type}${multi ? ' (multiple)' : ''}: refuses \`${source}\`, naming the bare field and the \`in\` rewrite`, () => {
        const errors = listEquality(source, hintFor(type, multi, 'flattened'));
        expect(errors).toHaveLength(1);
        expect(errors[0].params).toMatchObject({ reference: 'f' });
        expect(errors[0].message).toContain('`f` holds a list');
        expect(errors[0].message).toMatch(/ in f\b/);
      });
    }
  }

  // The premise for a bare name is measured on the flow engine's own
  // `evaluateCondition`, which flattens the record into the run's scope:
  // `service-automation`'s `list-equality-advisory-36167.test.ts`.

  it('CONTROL — a bare name at a record-scoped site is no field: no list-equality', () => {
    expect(listEquality("f == 'a'", hintFor('tags'))).toEqual([]);
  });

  it('CONTROL — a bare name a flow variable holds is not the field: no list-equality; record.f still is', () => {
    const hint = { ...hintFor('tags', false, 'flattened'), flowVariables: ['f'] };
    expect(listEquality("f == 'a'", hint)).toEqual([]);
    expect(listEquality("record.f == 'a'", hint).map((e) => e.params.reference)).toEqual(['record.f']);
  });

  it('CONTROL — where nodes can bind names no reader sees, a bare name gets no verdict; record.f still does', () => {
    const hint = { ...hintFor('tags', false, 'flattened'), bareNamesUnproven: true };
    expect(listEquality("f == 'a'", hint)).toEqual([]);
    expect(listEquality("record.f == 'a'", hint).map((e) => e.params.reference)).toEqual(['record.f']);
  });

  for (const source of ['f == null', 'null != f', "'a' in f", "f != null && 'a' in f", "f == ['a']", "name == 'a'"]) {
    it(`CONTROL — accepts \`${source}\``, () => {
      expect(listEquality(source, hintFor('tags', false, 'flattened'))).toEqual([]);
    });
  }

  it('CONTROL — a select / user not declared multiple is not judged bare either', () => {
    for (const type of ['select', 'user']) expect(listEquality("f == 'a'", hintFor(type, false, 'flattened'))).toEqual([]);
  });
});

describe('list-equality — a name a comprehension macro binds is an item of the list, not the field', () => {
  /** `labels` / `items` are list fields by type, `owners` by `multiple`. */
  const hint = (scope: 'record' | 'flattened'): ExprSchemaHint => ({
    objectName: 'probe',
    fields: ['items', 'labels', 'owners'],
    fieldTypes: { items: 'tags', labels: 'multiselect', owners: 'user' },
    multiValueFields: ['owners'],
    scope,
    ...(scope === 'flattened' ? { faultOutcome: 'run-fails' as const } : {}),
  });
  const refusedReferences = (source: string, scope: 'record' | 'flattened') =>
    refusalsOf(source, hint(scope)).filter((e) => e.code === 'list-equality').map((e) => e.params.reference);

  it('the premise: the bound name holds one item, so the comparison answers per row', () => {
    const run = (items: unknown) =>
      celEngine.evaluate({ dialect: 'cel', source: "record.items.exists(labels, labels == 'a')" }, { record: { items } });
    expect(run(['a', 'b'])).toEqual({ ok: true, value: true });
    expect(run(['b'])).toEqual({ ok: true, value: false });
  });

  for (const source of [
    "record.items.exists(labels, labels == 'a')",
    "record.items.all(owners, owners != 'a')",
    "record.items.exists_one(labels, 'a' == labels)",
    "record.items.filter(owners, owners == 'a').size() > 0",
    "record.items.map(labels, labels == 'a').size() > 0",
    "record.items.exists(x, record.items.exists(labels, labels == x))",
  ]) {
    it(`flattened: accepts \`${source}\``, () => {
      expect(refusedReferences(source, 'flattened')).toEqual([]);
    });
  }

  it('flattened: the same name read outside the macro is still the field, and refused', () => {
    expect(refusedReferences("record.items.exists(labels, labels == 'a') && labels == 'b'", 'flattened')).toEqual(['labels']);
    expect(refusedReferences("labels != 'b' || record.items.all(labels, labels != 'a')", 'flattened')).toEqual(['labels']);
  });

  it('flattened: a body reading a name the macro does not bind still judges it', () => {
    expect(refusedReferences("record.items.exists(x, labels == 'a')", 'flattened')).toEqual(['labels']);
  });

  it('a record. read inside a macro body is still the field, at either scope', () => {
    for (const scope of ['record', 'flattened'] as const) {
      expect(refusedReferences("record.items.exists(labels, record.labels == 'a')", scope)).toEqual(['record.labels']);
    }
  });

  it('record scope: a bound name named like a field is accepted (bare names are no field there)', () => {
    expect(refusedReferences("record.items.exists(labels, labels == 'a')", 'record')).toEqual([]);
  });
});

describe('list-equality — the prescribed rewrite tests membership where it is read', () => {
  /** The one `list-equality` refusal of `source` under `hint`, and its prescribed rewrite. */
  const rewriteOf = (source: string, hint: ExprSchemaHint): string => {
    const errors = refusalsOf(source, hint).filter((e) => e.code === 'list-equality');
    expect(errors).toHaveLength(1);
    const [e] = errors;
    if (e.code !== 'list-equality') throw new Error('unreachable');
    expect(e.message).toContain(`write \`${e.params.rewrite}\``);
    return e.params.rewrite;
  };
  /** Rows a list field can hold, and whether `'a'` is a member. */
  const ROWS: readonly (readonly [string, Record<string, unknown>, boolean])[] = [
    ['[a, b]', { f: ['a', 'b'], name: 'x' }, true],
    ['[b]', { f: ['b'], name: 'x' }, false],
    ['[]', { f: [], name: 'x' }, false],
    ['null', { f: null, name: 'x' }, false],
    ['absent', { name: 'x' }, false],
  ];
  const evaluate = (source: string, vars: Record<string, unknown>) =>
    celEngine.evaluate({ dialect: 'cel', source }, vars);

  describe('a `record.` / `previous.` read evaluated as CEL', () => {
    it('pins the text: has()-guarded and parenthesised whole', () => {
      expect(rewriteOf("record.f == 'a'", hintFor('tags'))).toBe(
        '(has(record.f) && record.f != null && "a" in record.f)',
      );
      expect(rewriteOf("record.f != 'a'", hintFor('tags'))).toBe(
        '(!has(record.f) || record.f == null || !("a" in record.f))',
      );
    });
    for (const op of ['==', '!='] as const) {
      for (const [label, row, member] of ROWS) {
        it(`\`${op}\` on row ${label}: answers ${op === '==' ? member : !member}, and stands inside \`&&\` / \`||\``, () => {
          const rewrite = rewriteOf(`record.f ${op} 'a'`, hintFor('tags'));
          const want = op === '==' ? member : !member;
          expect(evaluate(rewrite, { record: row })).toEqual({ ok: true, value: want });
          // Parenthesised whole: a conjunct before it does not split it.
          expect(evaluate(`record.name == 'x' && ${rewrite}`, { record: row })).toEqual({ ok: true, value: want });
          expect(evaluate(`record.name == 'y' && ${rewrite}`, { record: row })).toEqual({ ok: true, value: false });
          expect(evaluate(`false || ${rewrite}`, { record: row })).toEqual({ ok: true, value: want });
        });
      }
    }
    it('on `previous`, which is null on a create, answers without faulting', () => {
      expect(evaluate(rewriteOf("previous.f == 'a'", hintFor('tags')), { previous: null })).toEqual({ ok: true, value: false });
      expect(evaluate(rewriteOf("previous.f != 'a'", hintFor('tags')), { previous: null })).toEqual({ ok: true, value: true });
    });
    it('the rewrite itself is accepted at the site', () => {
      for (const op of ['==', '!='] as const) {
        const rewrite = rewriteOf(`record.f ${op} 'a'`, hintFor('tags'));
        expect(validateExpression('predicate', rewrite, hintFor('tags')).ok).toBe(true);
      }
    });
  });

  describe('a bare name at a flattened site proven to bind the typed row', () => {
    const flat = hintFor('tags', false, 'flattened');
    it('pins the text: null-guarded and parenthesised whole', () => {
      expect(rewriteOf("f == 'a'", flat)).toBe('(f != null && "a" in f)');
      expect(rewriteOf("f != 'a'", flat)).toBe('(f == null || !("a" in f))');
    });
    // The run binds every declared field (null when empty), so no row lacks `f`.
    for (const op of ['==', '!='] as const) {
      for (const [label, row, member] of ROWS.filter(([label]) => label !== 'absent')) {
        it(`\`${op}\` on row ${label}: answers ${op === '==' ? member : !member}, inside \`&&\` too`, () => {
          const rewrite = rewriteOf(`f ${op} 'a'`, flat);
          const want = op === '==' ? member : !member;
          // `extra` binds the row's fields as top-level names, as a flow run does.
          expect(evaluate(rewrite, { extra: row })).toEqual({ ok: true, value: want });
          expect(evaluate(`name == 'x' && ${rewrite}`, { extra: row })).toEqual({ ok: true, value: want });
          expect(evaluate(`name == 'y' && ${rewrite}`, { extra: row })).toEqual({ ok: true, value: false });
        });
      }
    }
    it('the rewrite itself is accepted at the site', () => {
      for (const op of ['==', '!='] as const) {
        expect(validateExpression('predicate', rewriteOf(`f ${op} 'a'`, flat), flat).ok).toBe(true);
      }
    });
  });

  describe('a source compiled to a query filter (`filterCompiled`: a sharing rule condition)', () => {
    const filtered: ExprSchemaHint = { ...hintFor('tags'), filterCompiled: true };
    const FIELDS = { f: { type: 'tags' }, name: { type: 'text' } } as const;
    /** Lower `source` as the sharing-rule path does, then match it against `row`. */
    const matches = (source: string, row: Record<string, unknown>): boolean => {
      const lowered = compileCelToFilter(source);
      if (!lowered.ok) throw new Error(`not lowered: ${lowered.reason} — ${lowered.detail}`);
      return matchesFilterCondition(row, lowered.filter, { fields: FIELDS });
    };
    it('pins the text: `contains`, null-guarded, parenthesised whole', () => {
      expect(rewriteOf("record.f == 'a'", filtered)).toBe('(record.f != null && record.f.contains("a"))');
      expect(rewriteOf("record.f != 'a'", filtered)).toBe('(record.f == null || !record.f.contains("a"))');
    });
    it('a number literal is passed as its text (`$contains` compares text)', () => {
      expect(rewriteOf('record.f == 3', filtered)).toBe('(record.f != null && record.f.contains("3"))');
    });
    it('the CEL `in` spelling does not lower: the reason the site gets its own', () => {
      const lowered = compileCelToFilter('record.f != null && "a" in record.f');
      expect(lowered.ok).toBe(false);
    });
    for (const op of ['==', '!='] as const) {
      for (const [label, row, member] of ROWS) {
        it(`\`${op}\` on row ${label}: the lowered filter matches ${op === '==' ? member : !member}, inside \`&&\` too`, () => {
          const rewrite = rewriteOf(`record.f ${op} 'a'`, filtered);
          const want = op === '==' ? member : !member;
          expect(matches(rewrite, row)).toBe(want);
          expect(matches(`record.name == 'x' && ${rewrite}`, row)).toBe(want);
          expect(matches(`record.name == 'y' && ${rewrite}`, row)).toBe(false);
        });
      }
    }
    it('the rewrite itself is accepted at the site', () => {
      for (const op of ['==', '!='] as const) {
        expect(validateExpression('predicate', rewriteOf(`record.f ${op} 'a'`, filtered), filtered).ok).toBe(true);
      }
    });
    it('CONTROL — without `filterCompiled` the same comparison gets the CEL spelling', () => {
      expect(rewriteOf("record.f == 'a'", hintFor('tags'))).toContain(' in record.f');
    });
  });
});

describe('list-equality — a flattened site with no proven row binding gets no verdict', () => {
  // An API, scheduled or trigger-less flow runs on what its entrance handed
  // it: `record` / the bare names are not proven to be the typed object's
  // fields, so `labels == 'frontend'` can be correct code there.
  const unproven: ExprSchemaHint = { ...hintFor('tags', false, 'flattened') };
  delete (unproven as { faultOutcome?: unknown }).faultOutcome;
  for (const source of ["f == 'a'", "record.f == 'a'", "'a' != f", "previous.f != 'a'"]) {
    it(`accepts \`${source}\` (no list-equality)`, () => {
      expect(refusalsOf(source, unproven).filter((e) => e.code === 'list-equality')).toEqual([]);
    });
  }
  it(`a faultOutcome other than 'run-fails' is no proof either`, () => {
    for (const faultOutcome of ['fail-closed', 'fail-open'] as const) {
      expect(refusalsOf("f == 'a'", { ...unproven, faultOutcome }).filter((e) => e.code === 'list-equality')).toEqual([]);
    }
  });
  it('CONTROL — the same sources at a proven site are refused', () => {
    for (const source of ["f == 'a'", "record.f == 'a'"]) {
      expect(refusalsOf(source, hintFor('tags', false, 'flattened')).map((e) => e.code)).toContain('list-equality');
    }
  });
});
