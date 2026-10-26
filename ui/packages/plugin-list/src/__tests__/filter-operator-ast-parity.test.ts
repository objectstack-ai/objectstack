/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * View operator → filter-AST operator parity (#2901, objectstack#3948, #3641).
 *
 * The spec ships two operator vocabularies that must agree at this boundary:
 *
 *   - `VIEW_FILTER_OPERATORS` (`ui/view.zod.ts`) — what an author may declare on
 *     a `ViewFilterRule`, and what `ViewFilterRuleSchema` validates against.
 *   - `VALID_AST_OPERATORS` (`data/filter.zod.ts`) — what gates `isFilterAST()`
 *     on the server, deciding whether a filter is parsed into a query at all.
 *
 * `mapOperator` is what bridges them, and a gap in it is invisible —
 * `isFilterAST()` returns false, the protocol passes the array through
 * unconverted, and driver-sql then skips it entirely. **No WHERE clause, no
 * error, every row returned.** That is how `before`/`after` shipped broken: they
 * are canonical view operators, and the bridge had no entry for them.
 *
 * One measured update to that failure description, recorded rather than assumed
 * (#3641). On the published `@objectstack/driver-sql@17.0.0-rc.5` the driver no
 * longer compiles the array form at all: `parseFilterAST()` lowers arrays at the
 * engine and protocol doors, and an array that reaches the driver anyway is
 * refused with a 400 (`unsupportedFilterError`, objectstack#5158) rather than
 * skipped. What the protocol door does with an array the AST gate REJECTS is not
 * measurable from this repo, so whether a gap in the bridge costs an unfiltered
 * read or a hard 400 today is left open here on purpose. Both are a broken
 * query, and neither is a reason for the bridge to have a gap.
 *
 * ## Why this file pins OUTPUTS rather than membership (#3641)
 *
 * Every assertion here used to rest on one question: is `mapOperator`'s output a
 * member of `VALID_AST_OPERATORS`? That pivot is not stable, because the AST set
 * is not a fixed complement of the view set. Upstream derives it from
 * `AST_OPERATOR_MAP` (`new Set(Object.keys(...))`), and it grew until it spelled
 * the canonical view operators verbatim — `before` and `after` among them, the
 * exact pair whose missing bridge entries caused the leak this file was written
 * for. From that moment an identity `mapOperator` satisfied every assertion in
 * the file, and nothing went red to say so. The header meanwhile went on quoting
 * a count of how many view operators the AST set was missing, which by then was
 * measured at zero.
 *
 * So the spine is now `EXPECTED_AST_TARGET` below: one row per canonical view
 * operator, naming the exact spelling `mapOperator` must emit. Deleting a branch
 * from the bridge fails here whatever either vocabulary happens to contain, and
 * the totality ratchet fails the moment the pinned rows and the spec vocabulary
 * stop lining up — in either direction, so both a spec addition (the growth that
 * cancelled this file) and a spec retirement (#3628 / #3601, the mirror image)
 * land as a red test rather than as quiet slack.
 *
 * No count of the overlap between the two vocabularies is stated anywhere in
 * this file, deliberately: a hand-written number beside a vocabulary that moves
 * is what rotted here last time, and nothing below depends on one.
 *
 * The membership and `isFilterAST()` sweeps are kept as a secondary check. They
 * are still the reason a wrong target matters — they are just no longer what
 * gives this file its teeth.
 */
import { describe, it, expect } from 'vitest';
import { VALID_AST_OPERATORS, isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { VIEW_FILTER_OPERATORS, VIEW_FILTER_OPERATOR_ALIASES } from '@objectstack/spec/ui';
import { mapOperator, normalizeFilterCondition } from '../ListView';

/**
 * The exact spelling `mapOperator` must emit for each canonical view operator.
 *
 * Read off `mapOperator`'s switch in `../ListView` — NOT captured from its
 * output. A capture would fossilise whatever the bridge does today, bug
 * included; each row names the arm that produces it so a reviewer can check the
 * table against the source rather than against the code it is meant to police.
 *
 * `mapOperator` folds its input with `.toLowerCase().replace(/[_\s]/g, '')`
 * before switching, so the arm names below are the folded spellings.
 */
const EXPECTED_AST_TARGET: Record<string, string> = {
  equals: '=', //                 case 'equals'
  not_equals: '!=', //            case 'notequals'
  contains: 'contains', //        case 'contains'
  icontains: 'icontains', //      case 'icontains'
  not_contains: 'notcontains', // case 'notcontains'
  starts_with: 'startswith', //   case 'startswith'
  ends_with: 'endswith', //       case 'endswith'
  greater_than: '>', //           case 'greaterthan'
  less_than: '<', //              case 'lessthan'
  greater_than_or_equal: '>=', // case 'greaterthanorequal'
  less_than_or_equal: '<=', //    case 'lessthanorequal'
  in: 'in', //                    case 'in'
  not_in: 'nin', //               case 'notin' — `nin`, never the spaced `not in`
  is_null: 'isnull', //           case 'isnull'
  is_not_null: 'isnotnull', //    case 'isnotnull'
  before: '<', //                 case 'before'  ─┬ the pair that regressed
  after: '>', //                  case 'after'   ─┘
  between: 'between', //          case 'between'
  // objectui#10813. These two were the only rows with no arm of their own —
  // pinned as identity, because `convertFilterGroupToAST` resolved the pair
  // to `[field, '=' | '!=', null]` before `mapOperator` was consulted. That
  // null test is not what the spec's `is_empty` means since `$empty` (ruling B
  // on objectstack#20311, lowered from the pair by objectstack#20446), so the
  // pair now takes the value-less path like `is_null`, through real arms.
  is_empty: 'isempty', //         case 'isempty'
  is_not_empty: 'isnotempty', //  case 'isnotempty'
};

describe('mapOperator bridges the spec view vocabulary onto the AST vocabulary', () => {
  it('reads both vocabularies from the spec', () => {
    // Guards every assertion below against silently passing on an empty list.
    expect(VIEW_FILTER_OPERATORS.length).toBeGreaterThan(0);
    expect(VALID_AST_OPERATORS.size).toBeGreaterThan(0);
  });

  // The totality ratchet for the pin table (#3641). Both directions matter and
  // they fail for different reasons:
  //
  //   - an unpinned view operator means the spec grew and the bridge was never
  //     asked what it emits for the newcomer. That is the silent case: the AST
  //     set is derived upstream and tends to grow in step, so the newcomer is
  //     very likely AST-valid under an identity mapping and every membership
  //     assertion in this file would stay green while the bridge does nothing.
  //   - a pinned row the spec no longer lists means the pin outlived its
  //     operator and now only tests the bridge's dead code.
  it('pins exactly the spec view vocabulary, no more and no less', () => {
    const pinned = new Set(Object.keys(EXPECTED_AST_TARGET));
    const vocabulary = new Set<string>(VIEW_FILTER_OPERATORS);

    const unpinned = [...vocabulary].filter((op) => !pinned.has(op));
    expect(
      unpinned,
      `VIEW_FILTER_OPERATORS has grown: ${unpinned.join(', ')} have no row in `
        + 'EXPECTED_AST_TARGET. Read mapOperator and add the spelling it must emit for '
        + 'each — do not capture whatever it returns today, and do not rely on the AST '
        + 'set happening to accept the raw view spelling: that is precisely how this '
        + 'file stopped discriminating in #3641',
    ).toEqual([]);

    const stale = [...pinned].filter((op) => !vocabulary.has(op));
    expect(
      stale,
      `EXPECTED_AST_TARGET pins operators the spec no longer defines: ${stale.join(', ')}. `
        + 'Delete each row rather than leaving it to test dead bridge branches',
    ).toEqual([]);
  });

  // The spine (#3641). Vocabulary growth cannot cancel this: it compares against
  // a literal, not against a set that moves.
  it.each(Object.entries(EXPECTED_AST_TARGET))(
    'mapOperator(%s) emits exactly %s',
    (viewOp, expected) => {
      expect(
        mapOperator(viewOp),
        `mapOperator('${viewOp}') must emit '${expected}'. If the bridge changed on `
          + 'purpose, update the row in EXPECTED_AST_TARGET and say why; if it did not, '
          + 'a branch has gone missing and this filter reaches the wire in a spelling '
          + 'the server may accept syntactically while meaning something else',
      ).toBe(expected);
    },
  );

  it('the empty pair reaches the wire as the spec\'s `$empty`, not as a null test (objectui#10813)', () => {
    // The meaning, asked of the spec's own lowering rather than assumed: the
    // node the live grid emits for each row of the pair lowers to `$empty`,
    // which every evaluator expands by the column's declared type. The null
    // pair is the control — a different operator, still lowered to `$null`.
    expect(parseFilterAST(['f', mapOperator('is_empty'), null] as never)).toEqual({ f: { $empty: true } });
    expect(parseFilterAST(['f', mapOperator('is_not_empty'), null] as never)).toEqual({ f: { $empty: false } });
    expect(parseFilterAST(['f', mapOperator('isEmpty'), null] as never)).toEqual({ f: { $empty: true } });
    expect(parseFilterAST(['f', mapOperator('is_null'), null] as never)).toEqual({ f: { $null: true } });
  });

  // Every canonical view operator. A `HANDLED_BEFORE_MAPPING` set subtracted
  // `is_empty` / `is_not_empty` here until objectui#10813, while
  // `convertFilterGroupToAST` resolved the pair before mapOperator was asked;
  // with no operator left in it, the set and its exclusion ratchet (#3628) were
  // deleted rather than kept as a subtraction of nothing.
  const bridged = [...VIEW_FILTER_OPERATORS];

  // Secondary (#3641): this is why a wrong target matters, not what detects one.
  // On its own it does not discriminate — the AST vocabulary already spells the
  // view operators verbatim, so an identity mapOperator passes it. Kept because
  // it names the consequence, and because it still catches a pinned target that
  // is misspelt in EXPECTED_AST_TARGET and in mapOperator alike.
  it.each(bridged)('%s maps to an AST-valid operator', (viewOp) => {
    const mapped = mapOperator(viewOp);
    expect(
      VALID_AST_OPERATORS.has(String(mapped).toLowerCase()),
      `mapOperator('${viewOp}') → '${mapped}', which VALID_AST_OPERATORS rejects. `
        + 'isFilterAST() will return false and the filter will be silently dropped '
        + 'server-side — an unfiltered result set, not an error.',
    ).toBe(true);
  });

  // Secondary, same standing as the sweep above: it exercises the whole emitted
  // triple rather than the operator alone, which is the shape that actually
  // reaches the server.
  it.each(bridged)('a single %s condition survives the isFilterAST gate', (viewOp) => {
    // The reachable shape: one condition, AND logic, emitted as a bare triple.
    // This is exactly what silently full-scanned before the fix.
    const value = viewOp === 'in' || viewOp === 'not_in' ? ['a', 'b'] : 'x';
    const triple = normalizeFilterCondition(['some_field', mapOperator(viewOp), value]);
    expect(
      isFilterAST(triple),
      `a '${viewOp}' filter produced ${JSON.stringify(triple)}, which isFilterAST() rejects`,
    ).toBe(true);
  });

  it('also bridges every legacy alias the spec still folds, onto the same target', () => {
    // Stored view metadata carries these: saveMeta persists the authored body
    // verbatim, so the spec's z.preprocess normalization never reaches the row.
    //
    // Pinned against EXPECTED_AST_TARGET rather than against AST membership
    // (#3641), for the same reason as the spine and with no second hand-written
    // table: an alias the spec folds to a canonical operator must reach the wire
    // as whatever that canonical operator reaches the wire as. Under the old
    // membership form an identity mapOperator passed this too, since the AST
    // vocabulary spells most of these aliases verbatim as well.
    const mismatched = Object.keys(VIEW_FILTER_OPERATOR_ALIASES)
      .map((alias) => {
        const canonical = VIEW_FILTER_OPERATOR_ALIASES[alias];
        return { alias, canonical, expected: EXPECTED_AST_TARGET[canonical], actual: mapOperator(alias) };
      })
      .filter(({ expected, actual }) => actual !== expected)
      .map(({ alias, canonical, expected, actual }) =>
        `${alias} (spec folds it to ${canonical}): expected '${expected}', got '${actual}'`);
    expect(
      mismatched,
      'these legacy spellings exist in stored view metadata and mapOperator does not '
        + 'resolve them the way it resolves the canonical operator the spec folds them to',
    ).toEqual([]);
  });

  it('emits `nin`, never the spaced `not in`, which no spec vocabulary defines', () => {
    for (const spelling of ['notIn', 'not_in', 'nin']) {
      expect(mapOperator(spelling)).toBe('nin');
    }
  });

  it('still expands a not-in array into an AND of inequalities', () => {
    // Regression: the expansion keyed on the old spaced spelling.
    expect(normalizeFilterCondition(['stage', 'nin', ['won', 'lost']]))
      .toEqual(['and', ['stage', '!=', 'won'], ['stage', '!=', 'lost']]);
    // …and keeps accepting the spellings an external caller may pass, since
    // normalizeFilterCondition is part of plugin-list's public surface.
    expect(normalizeFilterCondition(['stage', 'not in', ['won', 'lost']]))
      .toEqual(['and', ['stage', '!=', 'won'], ['stage', '!=', 'lost']]);
  });
});
