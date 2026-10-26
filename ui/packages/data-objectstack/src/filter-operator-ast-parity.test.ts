/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Adapter operator table → filter-AST parity (#2901, objectstack#3948, #3641).
 *
 * `FILTER_OPERATOR_ALIASES` is the last translation a filter passes through
 * before it goes on the wire, and `toAstFilterOperator` ends in `?? op` —
 * an unmapped operator is emitted verbatim. The server then rejects the shape
 * at `isFilterAST()`, passes the array through unconverted, and driver-sql
 * skips it entirely: **no WHERE clause, no error, every row returned.**
 *
 * (`toAstFilterOperator` was spelled `normalizeFilterOperator` until
 * objectui#7265 renamed it: `@objectstack/spec/ui` exports a DIFFERENT function
 * under that name, one that folds to the canonical VIEW vocabulary rather than
 * to the AST symbols this table produces. The rename is pinned in
 * `scripts/__tests__/spec-symbol-ledger-data-objectstack-7265.test.ts`.)
 *
 * So a missing row in this table is not a validation failure, it is an
 * unfiltered query. `before`/`after` — canonical members of the spec's
 * `VIEW_FILTER_OPERATORS` — were missing, which is exactly how a stored
 * "close_date before X" view came back unfiltered.
 *
 * That failure description is historical, and one part of it has moved (measured
 * for #3641, not assumed): on the published `@objectstack/driver-sql@17.0.0-rc.5`
 * the array form is lowered by `parseFilterAST()` at the engine and protocol
 * doors, and an array reaching the driver anyway is refused with a 400
 * (`unsupportedFilterError`, objectstack#5158) rather than skipped. What the
 * protocol door does with an array the AST gate REJECTS is not measurable from
 * this repo, so whether a missing row costs an unfiltered read or a hard 400
 * today is deliberately left open. Both are a broken query.
 *
 * ## What the coverage guarantee rests on (#3641)
 *
 * The coverage sweep below used to mirror production's `?? op` tail: resolve the
 * operator through the table, fall back to the raw view spelling, then ask
 * whether the result was a member of `VALID_AST_OPERATORS`. That reads as a
 * coverage assertion and is not one. `VALID_AST_OPERATORS` is derived upstream
 * from `AST_OPERATOR_MAP`, it grew until it spelled the canonical view operators
 * verbatim — `before` and `after` included — and from that moment the fallback
 * arm was always AST-valid. Emptying this entire table left the sweep green, so
 * the one thing it existed to catch, a missing row, had become invisible to it.
 *
 * The sweep therefore asserts the row EXISTS, with no fallback: the header above
 * says a missing row is an unfiltered query rather than a validation failure, so
 * a missing row is what is asserted, directly. What the rows resolve TO is a
 * separate question, kept as its own assertion below — and the pair that
 * actually regressed is pinned by spelling, not by membership.
 */
import { describe, it, expect } from 'vitest';
import { VALID_AST_OPERATORS } from '@objectstack/spec/data';
import { VIEW_FILTER_OPERATORS, normalizeFilterOperator } from '@objectstack/spec/ui';
import { FILTER_OPERATOR_ALIASES } from './index';

/**
 * View operators this adapter is not the bridge for — the value-shape ones the
 * view layer resolves to a null comparison before an operator is ever emitted.
 *
 * Every token here must still be a member of `VIEW_FILTER_OPERATORS` — the
 * ratchet below enforces it. Subtracting a name the spec has retired excuses
 * nothing and must be deleted rather than left as a dead subtraction (#3628).
 */
const NOT_THIS_ADAPTERS_JOB = new Set(['is_empty', 'is_not_empty']);

describe('FILTER_OPERATOR_ALIASES lands inside the spec AST vocabulary', () => {
  it('reads both vocabularies from the spec', () => {
    expect(VIEW_FILTER_OPERATORS.length).toBeGreaterThan(0);
    expect(VALID_AST_OPERATORS.size).toBeGreaterThan(0);
  });

  // The exclusion ratchet (#3628). The coverage sweep further down subtracts a
  // hand-written set from a spec-derived vocabulary, and that subtraction only
  // excuses something while the spec still lists the subtracted tokens. Once
  // upstream retires or renames one, the sweep stays green (it is still total
  // over what remains) but the row becomes dead weight, and its comment goes on
  // telling the next reader that the view layer resolves this one to a null
  // comparison — about an operator no author can declare any more. That is the
  // shape that rotted 37 of 82 deny-list entries in #3601 with nothing to report
  // it: a hand-written list beside a spec-derived vocabulary and no assertion
  // that its members still exist in that vocabulary.
  //
  // Collected rather than asserted per entry on purpose (same call as PR #3623):
  // vocabulary retirements land as whole families, and failing on the first entry
  // would hide the rest.
  it('every NOT_THIS_ADAPTERS_JOB token is still in the spec view vocabulary', () => {
    const vocabulary = new Set<string>(VIEW_FILTER_OPERATORS);
    const retired = [...NOT_THIS_ADAPTERS_JOB].filter((op) => !vocabulary.has(op));
    expect(
      retired,
      `VIEW_FILTER_OPERATORS no longer lists these NOT_THIS_ADAPTERS_JOB tokens: `
        + `${retired.join(', ')}. The spec has retired them, so subtracting them from `
        + 'the coverage sweep below excuses nothing — delete each from the set (with '
        + 'the comment claiming the view layer resolves it) rather than leaving a dead '
        + 'subtraction',
    ).toEqual([]);
  });

  it('every alias target is an operator the AST gate accepts', () => {
    const bad = Object.entries(FILTER_OPERATOR_ALIASES)
      .filter(([, target]) => !VALID_AST_OPERATORS.has(String(target).toLowerCase()))
      .map(([alias, target]) => `${alias} → ${target}`);
    expect(
      bad,
      'these aliases translate to operators VALID_AST_OPERATORS rejects, so the '
        + 'server drops the filter silently instead of erroring',
    ).toEqual([]);
  });

  it('has a mapping row for every canonical view operator the spec defines', () => {
    // Resolution mirrors `toAstFilterOperator` — lowercased spelling first,
    // then the operator as written — but stops short of its `?? op` tail. That
    // tail is production behaviour and must stay there; reproducing it HERE is
    // what cancelled this assertion (#3641), because the value it falls back to
    // is the raw view spelling and the AST vocabulary now accepts all of those.
    const hasRow = (op: string) =>
      Object.prototype.hasOwnProperty.call(FILTER_OPERATOR_ALIASES, op.toLowerCase())
      || Object.prototype.hasOwnProperty.call(FILTER_OPERATOR_ALIASES, op);

    const missing = VIEW_FILTER_OPERATORS
      .filter((op) => !NOT_THIS_ADAPTERS_JOB.has(op))
      .filter((op) => !hasRow(op));
    expect(
      missing,
      'FILTER_OPERATOR_ALIASES has no row for these. An author can declare them on a '
        + 'ViewFilterRule and the spec validates them, so they reach the wire as the raw '
        + 'view spelling. Do not settle for "the AST gate happens to accept that" — the '
        + 'gate accepting a spelling is not the driver compiling it into a WHERE clause, '
        + 'and an unmapped operator is how this adapter shipped an unfiltered query',
    ).toEqual([]);
  });

  it('maps the date comparisons that regressed', () => {
    expect(FILTER_OPERATOR_ALIASES.before).toBe('<');
    expect(FILTER_OPERATOR_ALIASES.after).toBe('>');
  });
});

/**
 * This table is NOT the spec's `normalizeFilterOperator` (objectui#7265).
 *
 * The local fold over this table was called `normalizeFilterOperator` until that
 * card renamed it `toAstFilterOperator`, because `@objectstack/spec/ui` exports a
 * function of that name and most of this monorepo imports it. The two take the
 * same input and land in different vocabularies, which is the whole reason the
 * route was RENAME and not BIND — so the difference is measured here, against the
 * resolved pin, rather than asserted in a comment. The spec-side half of the same
 * measurement (its fold, its `?? op` tail, its lenient non-string arm) is in
 * `scripts/__tests__/spec-symbol-ledger-data-objectstack-7265.test.ts`.
 */
describe('this table is a different vocabulary from the spec fold that shares its old name', () => {
  /** Resolution as `toAstFilterOperator` does it, minus its `?? op` tail. */
  const row = (op: string) => FILTER_OPERATOR_ALIASES[op.toLowerCase()] ?? FILTER_OPERATOR_ALIASES[op];

  it('answers an AST symbol where the spec answers a canonical view word', () => {
    const viewVocabulary = new Set<string>(VIEW_FILTER_OPERATORS);

    // Both spellings of one operator: the spec folds them together onto a view
    // word, this table translates them together onto a wire symbol.
    for (const spelling of ['eq', 'equals']) {
      expect(String(normalizeFilterOperator(spelling))).toBe('equals');
      expect(row(spelling)).toBe('=');
    }
    // …and the two answers are in different vocabularies, not two spellings of
    // one. Read off the spec's own list rather than restated.
    expect(viewVocabulary.has('equals')).toBe(true);
    expect(viewVocabulary.has('=')).toBe(false);
  });

  it('…and it is most of the vocabulary, not one operator — enumerated, never counted', () => {
    // Every canonical view operator this adapter is the bridge for, plus the
    // legacy spellings this table carries rows for. The set is DERIVED so it
    // cannot go stale, and the assertion is a floor on which members diverge
    // rather than a number, per AGENTS.md #9.
    const corpus = [
      ...VIEW_FILTER_OPERATORS.filter((op) => !NOT_THIS_ADAPTERS_JOB.has(op)),
      ...Object.keys(FILTER_OPERATOR_ALIASES),
    ];
    const agree: string[] = [];
    const diverge: string[] = [];
    for (const op of new Set(corpus)) {
      (String(normalizeFilterOperator(op)) === String(row(op)) ? agree : diverge).push(op);
    }

    // The divergence is the finding…
    expect(diverge).toContain('eq');
    expect(diverge).toContain('greater_than');
    expect(diverge).toContain('before');
    expect(diverge.length).toBeGreaterThan(agree.length);

    // …and the agreement is the lit control that keeps it from being vacuous: a
    // comparison where NOTHING matched would mean the probe is broken, not that
    // the functions differ. `contains` is an identity row on both sides.
    expect(agree).toContain('contains');
    expect(String(normalizeFilterOperator('contains'))).toBe('contains');
    expect(row('contains')).toBe('contains');
  });
});
