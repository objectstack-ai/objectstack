// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FilterArray` is DECLARED, and it is declared INPUT-ONLY. (#5158, ruling C)
 *
 * Before this file, `FilterArray` was a name with no definition: three READMEs,
 * `llms.txt`, four skills, the query-adapter docs and this package's own
 * react-blocks prop table all taught authors to write it, and the protocol
 * never declared it anywhere. An AI author following the contract it was handed
 * had nothing to check its work against.
 *
 * The maintainer's ruling (2026-08-04 15:22Z on #5158) was **C — one lowering
 * sink**: declare the shape as input-only sugar, keep the wire/storage contract
 * exactly as it is, and lower every arrival through `parseFilterAST`. Option A
 * (widen `where` to accept the array dialect, so every driver and transport
 * maintains two compilers forever) was rejected. So this file pins BOTH halves,
 * and the negative half is the load-bearing one:
 *
 * 1. the declaration exists and matches the shapes the measured producers emit;
 * 2. a query's `where` does **not** accept it — a future "helpful" widening of
 *    the protocol face turns this red and lands the reader back on #5158.
 *
 * It also pins the two deliberate strictnesses that separate this authoring
 * gate from the runtime detector `isFilterAST`, so that list cannot grow by
 * accident.
 */

import { describe, it, expect } from 'vitest';
import {
  FilterArraySchema,
  FILTER_ARRAY_LOGIC_KEYWORDS,
  VALID_AST_OPERATORS,
  isFilterAST,
  parseFilterAST,
  FilterConditionSchema,
  type FilterArray,
  type FilterArrayOperator,
} from './filter.zod';
import { QuerySchema } from './query.zod';

/** The shapes the measured producers actually emit (see the file header). */
const PRODUCED: ReadonlyArray<{ label: string; value: FilterArray }> = [
  // `FilterBuilder.equals()` / a `<ListView filters={…}>` prop.
  { label: 'comparison', value: ['status', '=', 'active'] },
  // `FilterBuilder.isNull()` — direction is in the operator name, so no value.
  { label: 'comparison, two-element null predicate', value: ['deleted_at', 'is_null'] },
  // `FilterBuilder.build()` with more than one condition.
  { label: 'group', value: ['and', ['stage', '=', 'won'], ['amount', '>', 1000]] },
  { label: 'group, or', value: ['or', ['stage', '=', 'won'], ['stage', '=', 'lost']] },
  // `FilterBuilder.between()` nests a group inside a group.
  { label: 'nested group', value: ['and', ['or', ['a', '=', 1], ['b', '=', 2]], ['c', '=', 3]] },
  // `examples/app-showcase/src/ui/pages/my-work.page.ts:52`.
  { label: 'bare list, implicit AND', value: [['owner_id', '=', '{current_user_id}']] },
  { label: 'bare list, two conditions', value: [['a', '=', 1], ['b', '>', 2]] },
  // Set / range / string operators carry non-scalar values.
  { label: 'in', value: ['role', 'in', ['admin', 'editor']] },
  { label: 'between', value: ['age', 'between', [18, 65]] },
];

describe('FilterArray is declared', () => {
  it('accepts every shape the measured producers emit', () => {
    for (const { label, value } of PRODUCED) {
      const result = FilterArraySchema.safeParse(value);
      expect(
        result.success,
        `${label}: ${JSON.stringify(value)} — ${result.success ? '' : JSON.stringify(result.error.issues)}`,
      ).toBe(true);
    }
  });

  it('every produced shape lowers to a FilterCondition through the declared sink', () => {
    // The declaration's whole semantic claim: what this schema accepts,
    // `parseFilterAST` turns into something `where` DOES accept. If these ever
    // disagree the declaration is lying about where the shape goes.
    for (const { label, value } of PRODUCED) {
      const lowered = parseFilterAST(value);
      expect(lowered, label).toBeDefined();
      expect(FilterConditionSchema.safeParse(lowered).success, label).toBe(true);
    }
  });

  it('rejects the non-filter arrays that used to be misread as filters', () => {
    // The shapes `isFilterAST` was written to refuse (#4121) — a naive
    // `Array.isArray` read them as filters and the driver had to cope.
    for (const value of [[1, 2, 3], ['and'], ['or'], [], 'not an array', { status: 'active' }, null]) {
      expect(FilterArraySchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
    }
  });

  it('accepts every operator in the vocabulary, in the position it is read from', () => {
    for (const op of VALID_AST_OPERATORS) {
      const result = FilterArraySchema.safeParse(['some_field', op, 'v']);
      expect(result.success, `operator '${op}'`).toBe(true);
    }
  });

  it('rejects an operator outside the vocabulary', () => {
    // The silent failure this closes: `convertComparison` lowers an unknown
    // spelling to `$equalss` and hands it to a driver that has never heard of
    // it. Authoring-time rejection names the vocabulary instead.
    const result = FilterArraySchema.safeParse(['status', 'equalss', 'won']);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.success ? [] : result.error.issues)).toContain('equalss');
  });

  it('folds operator case the same way every door folds it', () => {
    // Load-bearing, not cosmetic: already-stored view metadata carries camelCase
    // spellings (`VIEW_FILTER_OPERATOR_ALIASES`, `ui/view.zod.ts`), and every
    // door lowercases before lookup. A case-sensitive gate here would reject
    // filters the wire accepts today.
    for (const op of ['IN', 'startsWith', 'notEquals', 'Is_Null']) {
      expect(FilterArraySchema.safeParse(['some_field', op, 'v']).success, op).toBe(
        isFilterAST(['some_field', op, 'v']),
      );
    }
  });

  it('reserves the logic keywords for the group reading', () => {
    for (const kw of FILTER_ARRAY_LOGIC_KEYWORDS) {
      // As a field name: refused, because that reading is taken (and
      // `isFilterAST` refuses it too — it commits to the group reading and then
      // fails to find children).
      expect(FilterArraySchema.safeParse([kw, '=', true]).success, kw).toBe(false);
      expect(isFilterAST([kw, '=', true]), kw).toBe(false);
      // As a group opener: accepted.
      expect(FilterArraySchema.safeParse([kw, ['a', '=', 1]]).success, kw).toBe(true);
    }
  });
});

describe('FilterArray is INPUT-ONLY — it is not part of the wire contract', () => {
  /**
   * THE NEGATIVE PIN (#5158 ruling C, step 1).
   *
   * If this goes red, someone widened the protocol face to accept the array
   * dialect — that is rejected option A, and it puts two filter compilers back
   * into every driver and transport. Read #5158 before changing this file.
   */
  it('a query `where` does NOT accept the array dialect', () => {
    for (const { label, value } of PRODUCED) {
      const result = QuerySchema.safeParse({ object: 'showcase_project', where: value });
      expect(result.success, `where accepted a FilterArray (${label}) — see #5158`).toBe(false);
    }
  });

  it('`FilterCondition` itself does not accept the array dialect', () => {
    // One layer down from `where`, so the exclusion cannot be re-introduced by
    // widening the condition type instead of the query.
    for (const { label, value } of PRODUCED) {
      expect(FilterConditionSchema.safeParse(value).success, label).toBe(false);
    }
  });

  it('the lowered form IS what `where` accepts', () => {
    // The other direction of the same claim: the sugar is not refused because
    // the filter is bad, it is refused because it has not been lowered yet.
    for (const { label, value } of PRODUCED) {
      const result = QuerySchema.safeParse({
        object: 'showcase_project',
        where: parseFilterAST(value),
      });
      expect(result.success, `${label}: ${JSON.stringify(result.success ? '' : result.error.issues)}`).toBe(true);
    }
  });
});

describe('the authoring gate is stricter than the runtime detector, in exactly two places', () => {
  /**
   * `isFilterAST` tolerates these by accident; no measured producer emits them;
   * each is unambiguously an author error. Enumerated here so the divergence
   * list is a fact on the record rather than something a future reader has to
   * re-derive by diffing two functions.
   */
  const DELIBERATELY_STRICTER: ReadonlyArray<{ label: string; value: unknown }> = [
    { label: 'trailing elements past the value position', value: ['a', '=', 1, 2] },
    { label: 'empty field name', value: ['', '=', 1] },
  ];

  it('rejects what `isFilterAST` accepts, only on this list', () => {
    for (const { label, value } of DELIBERATELY_STRICTER) {
      expect(isFilterAST(value), `${label} — runtime detector`).toBe(true);
      expect(FilterArraySchema.safeParse(value).success, `${label} — authoring gate`).toBe(false);
    }
  });

  it('agrees with `isFilterAST` on everything else', () => {
    const agree: unknown[] = [
      ...PRODUCED.map((p) => p.value),
      [1, 2, 3],
      ['and'],
      [],
      'not an array',
      { status: 'active' },
      ['status', 'equalss', 'won'],
      ['and', '=', true],
      ['some_field', 'startsWith', 'A'],
    ];
    for (const value of agree) {
      expect(FilterArraySchema.safeParse(value).success, JSON.stringify(value) ?? String(value)).toBe(
        isFilterAST(value),
      );
    }
  });
});

/**
 * ⚠️ **These assertions do not run in CI, and saying so is the point.**
 *
 * `packages/spec/tsconfig.json` excludes `**` + `/*.test.ts` under the measured
 * `TEST_DEBT` entry in `scripts/check-type-check-coverage.mjs` (272 test files,
 * 902 errors), so `pnpm --filter @objectstack/spec typecheck` never reads this
 * file and every `@ts-expect-error` below is INERT — it looks like a pinned
 * contract and pins nothing. That is true of all 17 `@ts-expect-error`
 * directives across spec's test layer, not just these two; filed as #5305.
 *
 * They are kept because they are correct and become live the day spec
 * graduates off `TEST_DEBT`. Verified by hand on this branch, with the
 * exclusion lifted:
 *
 * ```
 * # tsconfig extending spec's, "include": [this file], "exclude": []
 * npx tsc -p tsconfig.typetest.tmp.json   # => exit 0, both directives live
 * ```
 *
 * and reverse-verified by widening `FilterArrayOperator` back to `string`
 * (restoring the `Record< string, string >` annotation on `AST_OPERATOR_MAP`),
 * which reports exactly one new error — `TS2578: Unused '@ts-expect-error'
 * directive` on the misspelled-operator line, the narrowing this declaration
 * adds. Do not read a green `pnpm test` as evidence for anything in this block.
 */
describe('FilterArray type-level declaration (NOT type-checked in CI — see above)', () => {
  it('narrows the operator position to the canonical vocabulary', () => {
    const canonical: FilterArrayOperator = 'starts_with';
    const comparison: FilterArray = ['name', canonical, 'A'];
    const group: FilterArray = ['and', ['a', '=', 1], ['b', '>', 2]];
    const list: FilterArray = [['a', '=', 1], ['b', '>', 2]];
    // @ts-expect-error — 'equalss' is not in the operator vocabulary.
    const misspelled: FilterArray = ['status', 'equalss', 'won'];
    // @ts-expect-error — a group needs at least one condition.
    const empty: FilterArray = ['and'];

    expect([comparison, group, list, misspelled, empty]).toHaveLength(5);
  });
});
