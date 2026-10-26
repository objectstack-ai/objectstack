/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `viewFilterRuleToNode` refuses the two `icontains` comparand shapes the
 * published table declares REFUSED, and all three faces now read ONE
 * implementation of that refusal (objectui#9048).
 *
 * ## The defect
 *
 * `@objectstack/spec`'s `FILTER_TEXT_CASES` carries two REJECTION rows for the
 * case-insensitive contains operator — an empty comparand and a non-string one
 * — each with `code: 'INVALID_FILTER'`. `ValueDataSource` has answered both
 * since objectui#8748 and `convertFiltersToAST` since objectui#9001. The STORED
 * VIEW rule vocabulary answered neither: measured on `origin/main` `6df26f025`
 * with `@objectstack/spec` 17.4.0,
 *
 * ```
 * toFilterNode([{ field:'name', operator:'icontains', value:'' }]) => [["name","icontains",""]]
 * toFilterNode([{ field:'name', operator:'icontains', value:42 }]) => [["name","icontains",42]]
 * convertFiltersToAST({ name: { $icontains: '' } })                => THROWS INVALID_FILTER / 400
 * ```
 *
 * — one contract, refused when the author writes it in the `$` dialect and
 * lowered onto the wire when the same author SAVES it as a view rule.
 *
 * ## What is asserted, and why in this shape
 *
 * The weak version of this file would be `expect(() => …).toThrow()`, satisfied
 * by any throw including a bare `Error` from a converter that had simply
 * broken. Four stronger claims are made instead, three of them inherited from
 * `filter-text-comparand-9001.test.ts` because this card is the same contract
 * one dialect over.
 *
 *   1. **The contract's own rows are DRIVEN, not transcribed.** The rejection
 *      rows are read off the installed `FILTER_TEXT_CASES` at run time; each
 *      row's comparand is re-seated as a view rule and pushed through
 *      `toFilterNode`. A transcribed contract drifts from the contract.
 *   2. **ONE refusal, three envelopes — checked by driving all three.** Triage
 *      ruled "make the dialects share the one that works", so the matcher's
 *      refusal text is captured live and BOTH producer faces must contain it
 *      verbatim. A fourth copy pasted in later cannot satisfy this without
 *      being byte-identical, and a drift in any one face reddens here.
 *   3. **The two already-shipped faces are UNCHANGED.** This card consolidates
 *      them; it must not move them. Pinned so "all three agree" cannot be
 *      satisfied by having quietly edited the reference implementation.
 *   4. **The refusal is not "refuse everything".** A valid comparand must still
 *      lower byte for byte, the sibling positive operators must be untouched,
 *      objectui#8557's ARRAY arm must still answer the ARRAY message for this
 *      operator, and a rule with NO comparand must still lower to its 2-tuple.
 *
 * ⚠️ Deliberately NOT claimed: that the refusal reaches a real backend. What is
 * provable in this tree is the lowering and the three faces' agreement.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FILTER_TEXT_CASES } from '@objectstack/spec/data';
import * as corePublicEntry from '../../index.js';
import { toFilterNode, convertFiltersToAST, FilterOperatorError } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

/**
 * The `FILTER_TEXT_CASES` rejection rows that are about the case-insensitive
 * contains COMPARAND, read off the installed spec rather than transcribed.
 *
 * Narrowed by the OPERATOR KEYS of the row's own filter, not by its
 * `mustMention` list: the `$regex` rows also mention `$icontains` (they
 * prescribe it as the repair), and re-seating those as view rules would assert
 * something true for a different reason.
 */
type RejectionRow = { name: string; code: string; comparand: unknown };

function icontainsComparandRejectionRows(): RejectionRow[] {
  const rows: RejectionRow[] = [];
  for (const row of FILTER_TEXT_CASES as readonly any[]) {
    if (row.expectRejection !== true) continue;
    const filter = row.filter as Record<string, any>;
    const fields = Object.keys(filter);
    if (fields.length !== 1) continue;
    const operatorMap = filter[fields[0]];
    if (!operatorMap || typeof operatorMap !== 'object' || Array.isArray(operatorMap)) continue;
    const operators = Object.keys(operatorMap);
    if (operators.length !== 1 || operators[0] !== '$icontains') continue;
    rows.push({ name: row.name, code: row.code, comparand: operatorMap.$icontains });
  }
  return rows;
}

const REJECTION_ROWS = icontainsComparandRejectionRows();

/** The view-rule spelling of the operator — no `$`, a `VIEW_FILTER_OPERATORS` member. */
const VIEW_SPELLING = 'icontains';

const ROWS = [
  { id: 'a', name: 'ACME Corporation' },
  { id: 'b', name: 'acme holdings' },
  { id: 'c', name: 'Globex' },
];

/** The envelope `refuseFilterNode` wraps every `ValueDataSource` refusal in. */
const MATCHER_PREFIX = '[ObjectUI] ValueDataSource: ';
const MATCHER_SUFFIX = '. Rows are excluded rather than passed through.';

function viewRule(value: unknown, operator: string = VIEW_SPELLING) {
  return value === undefined
    ? { field: 'name', operator }
    : { field: 'name', operator, value };
}

async function matcherRefusals(filter: unknown): Promise<string[]> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ds = new ValueDataSource({ items: ROWS });
  await ds.find('rows', { $filter: filter as any });
  const refusals = warn.mock.calls.map((call) => String(call[0]));
  warn.mockRestore();
  return refusals;
}

/**
 * The REASON `ValueDataSource` refused, with its face-specific envelope removed
 * — the half of the message the CONTRACT owns, and so the half every producer
 * has to repeat.
 *
 * Throws rather than returning `undefined` when the envelope no longer matches:
 * a silently-unparsed refusal would make the mirror assertions below compare
 * against an empty string, which every message contains.
 */
function matcherReason(refusal: string | undefined): string {
  if (
    refusal === undefined
    || !refusal.startsWith(MATCHER_PREFIX)
    || !refusal.endsWith(MATCHER_SUFFIX)
  ) {
    throw new Error(
      `ValueDataSource's refusal envelope changed (objectui#9048 reads it to compare the three `
      + `faces' wording). Re-point this reader at the new envelope; do NOT delete the check — `
      + `the wording agreement IS what makes "one refusal, three envelopes" checkable. `
      + `Got: ${String(refusal)}`,
    );
  }
  return refusal.slice(MATCHER_PREFIX.length, refusal.length - MATCHER_SUFFIX.length);
}

/** `JSON.stringify` made total, so a diagnostic survives the values fed to it. */
function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function viewRefusalFor(value: unknown): FilterOperatorError {
  const rule = viewRule(value);
  try {
    const lowered = toFilterNode([rule]);
    throw new Error(
      `toFilterNode([${show(rule)}]) did NOT refuse — it lowered ${show(lowered)} onto the `
      + `wire. That is objectui#9048.`,
    );
  } catch (error) {
    if (error instanceof FilterOperatorError) return error;
    throw error;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 0. Controls — the populations were really read, and can really fail
// ---------------------------------------------------------------------------

describe('objectui#9048 — controls', () => {
  it('read BOTH icontains comparand rejection rows off the installed spec', () => {
    // Guards the vacuous pass: a reader that matched nothing would make the
    // `it.each` blocks below iterate zero rows and report success.
    expect(
      REJECTION_ROWS.length,
      'FILTER_TEXT_CASES no longer carries the $icontains comparand rejection rows this card '
        + 'exists to honour — the premise changed and this file must be re-read, not re-pointed',
    ).toBeGreaterThanOrEqual(2);
    expect(
      REJECTION_ROWS.some((row) => row.comparand === ''),
      'the EMPTY-comparand row must be among them',
    ).toBe(true);
    expect(
      REJECTION_ROWS.some((row) => typeof row.comparand !== 'string'),
      'the NON-STRING comparand row must be among them',
    ).toBe(true);
    expect(
      REJECTION_ROWS.every((row) => row.code === 'INVALID_FILTER'),
      'every row must declare the ADR-0112 code this converter carries',
    ).toBe(true);
  });

  it('LIVE CONTROL: a valid comparand still lowers, on the very path this card edits', () => {
    // Green before this card and after it. A red here is about the harness or
    // about a guard that refuses too much, never about the comparand door.
    expect(toFilterNode([viewRule('acme')])).toEqual([['name', VIEW_SPELLING, 'acme']]);
  });

  it('LIVE CONTROL: the matcher really runs on this fixture and stays quiet for a valid filter',
    async () => {
      const refusals = await matcherRefusals([['name', VIEW_SPELLING, 'acme']]);
      expect(refusals, 'a working operator must not print a refusal').toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 1. The contract's rejection rows, re-seated as STORED VIEW rules
// ---------------------------------------------------------------------------

describe('objectui#9048 — every FILTER_TEXT_CASES icontains comparand rejection is honoured '
  + 'on the view-rule path', () => {
  it.each(REJECTION_ROWS.map((row) => [row.name, row] as const))(
    '%s',
    (_name, row) => {
      const error = viewRefusalFor(row.comparand);
      // The envelope, not merely "it threw": `classifyLoadError` reads these,
      // and a bare `Error` classifies as a NETWORK fault — the one thing a
      // malformed filter definitely is not.
      expect(error.code, 'the row declares the ADR-0112 code the refusal must carry').toBe(row.code);
      expect(error.httpStatus, 'and its 400-class status').toBe(400);
      expect(
        error.message,
        'the refusal must name the operator SPELLING THAT ARRIVED — a view rule has no `$`, '
          + 'and prescribing one sends the author looking for a key their metadata cannot hold',
      ).toContain(`'${VIEW_SPELLING}'`);
      expect(
        error.message,
        'and it must still name the $-dialect spelling FILTER_TEXT_CASES uses, so an author '
          + 'reading the published table can recognise their own condition in it',
      ).toContain('$icontains');
      expect(
        error.message,
        'and the FIELD, so an author can find the condition in their saved view',
      ).toContain('name');
    },
  );

  it('the refusal happens BEFORE the node exists, so nothing lowers', () => {
    // The distinction the card is about: a node that reaches the wire is
    // answered two layers later by a 400 the author cannot attribute to their
    // view — or, on an in-memory data source, by an empty list and no error.
    for (const row of REJECTION_ROWS) {
      expect(() => toFilterNode([viewRule(row.comparand)])).toThrow(FilterOperatorError);
    }
  });

  it('a mixed source refuses the rule without the surrounding AST nodes deciding the answer', () => {
    // `ObjectView` concatenates a saved view's rules with `?filter[…]` URL
    // triples into ONE array, so the refused rule really does arrive beside
    // already-lowered nodes.
    expect(() => toFilterNode([
      ['stage', '=', 'won'],
      viewRule(''),
    ])).toThrow(FilterOperatorError);
  });
});

// ---------------------------------------------------------------------------
// 2. ONE refusal, three envelopes — the consolidation, checked by driving it
// ---------------------------------------------------------------------------

describe('objectui#9048 — all three faces repeat the same refusal', () => {
  it.each(REJECTION_ROWS.map((row) => [row.name, row] as const))(
    '%s — same words in the matcher, the $ converter and the view rule',
    async (_name, row) => {
      // The matcher's AST arm, driven with the SAME operator spelling the view
      // rule carries, so the reason strings are comparable without allowances.
      const refusals = await matcherRefusals([['name', VIEW_SPELLING, row.comparand]]);
      expect(
        refusals,
        'objectui#8748 refuses this shape in the matcher; if it does not, the reference '
          + 'implementation moved and this consolidation must be re-derived rather than re-pinned',
      ).toHaveLength(1);
      const reason = matcherReason(refusals[0]);
      expect(reason.length, 'a non-empty reason, or `toContain` below is vacuous').toBeGreaterThan(40);

      expect(
        viewRefusalFor(row.comparand).message,
        'triage ruled "make the dialects share the one that works": a view refusal that no '
          + 'longer contains the matcher\'s reason is a SECOND implementation, which is the one '
          + 'thing this card exists to prevent',
      ).toContain(reason);
    },
  );

  it('the $ dialect keeps repeating it too — the consolidation did not move objectui#9001',
    async () => {
      for (const row of REJECTION_ROWS) {
        const refusals = await matcherRefusals({ name: { $icontains: row.comparand } });
        const reason = matcherReason(refusals[0]);
        let converterMessage = '';
        try {
          convertFiltersToAST({ name: { $icontains: row.comparand } });
        } catch (error) {
          converterMessage = (error as Error).message;
        }
        expect(converterMessage, 'the $ dialect must still refuse').not.toBe('');
        expect(converterMessage).toContain(reason);
      }
    });

  it('each face keeps its OWN envelope — the half that does NOT transfer', async () => {
    // `ValueDataSource` excludes-and-logs because it is deciding about one ROW;
    // both converter faces are PRODUCERS deciding whether to send a query at
    // all and have no row to exclude, so they throw. Pinned so "share the
    // refusal" is not misread as "share the delivery".
    const refusals = await matcherRefusals([['name', VIEW_SPELLING, '']]);
    expect(refusals[0]).toContain('Rows are excluded rather than passed through');
    expect(viewRefusalFor('').message).not.toContain(
      'Rows are excluded rather than passed through',
    );
    // …and the two throwing faces are still distinguishable from each other:
    // the view face says which vocabulary the author is writing in.
    expect(viewRefusalFor('').message).toContain('STORED VIEW rule');
  });
});

// ---------------------------------------------------------------------------
// 3. The boundaries this card must not move
// ---------------------------------------------------------------------------

describe('objectui#9048 — what must NOT change', () => {
  it('a valid comparand lowers byte for byte, on every shape that reaches this function', () => {
    expect(toFilterNode([viewRule('acme')])).toEqual([['name', VIEW_SPELLING, 'acme']]);
    expect(toFilterNode([viewRule('a')])).toEqual([['name', VIEW_SPELLING, 'a']]);
    // A comparand that merely LOOKS empty is a real one and must survive.
    expect(toFilterNode([viewRule(' ')])).toEqual([['name', VIEW_SPELLING, ' ']]);
    expect(toFilterNode([viewRule('0')])).toEqual([['name', VIEW_SPELLING, '0']]);
  });

  it('the sibling positive operators are untouched — only the declared row is answered', () => {
    // `$contains` / `$startsWith` / `$endsWith` have no rejection row in
    // FILTER_TEXT_CASES, so widening by analogy would be this file inventing a
    // contract the published table did not declare.
    for (const operator of ['contains', 'starts_with', 'ends_with', 'not_contains', 'equals']) {
      expect(
        toFilterNode([viewRule('', operator)]),
        `${operator} has no FILTER_TEXT_CASES rejection row and must keep lowering`,
      ).toEqual([['name', operator, '']]);
      expect(toFilterNode([viewRule(42, operator)])).toEqual([['name', operator, 42]]);
    }
  });

  it("objectui#8557's ARRAY arm still answers FIRST for an array on this operator", () => {
    // Ordering is load-bearing. An array comparand is not a "not a string"
    // problem — it is a membership-spelling problem, and #8557's message
    // prescribes `in` / `not_in` / `between`. A comparand door placed ahead of
    // it would answer a true sentence with the wrong repair.
    let message = '';
    try {
      toFilterNode([viewRule(['a'])]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message, 'an array on a single-value operator must still be refused').not.toBe('');
    expect(message, "the ARRAY arm's message, not the comparand arm's").toContain('carries an ARRAY');
    expect(message).toContain('objectui#8557');
  });

  it('a rule with NO comparand still lowers to its 2-tuple', () => {
    // `isRefusedTextComparand(undefined)` is TRUE, so this is the carve-out the
    // guard spells out rather than a happy accident. The view vocabulary HAS an
    // "absent" the `$` dialect does not, the valueless operators depend on it,
    // and `FILTER_TEXT_CASES` declares two rows — not three.
    expect(toFilterNode([viewRule(undefined)])).toEqual([['name', VIEW_SPELLING]]);
    expect(toFilterNode([{ field: 'name', operator: 'is_null' }])).toEqual([['name', 'is_null']]);
  });

  it('an operator the spec does not know is still passed through VERBATIM', () => {
    // A misspelling must reach `isFilterAST` and be named by the server, not be
    // coerced into a valid operator or answered with the wrong diagnosis. The
    // `$`-prefixed spelling is not a member of this vocabulary either.
    expect(toFilterNode([viewRule('', 'icontainz')])).toEqual([['name', 'icontainz', '']]);
    expect(toFilterNode([viewRule('', '$icontains')])).toEqual([['name', '$icontains', '']]);
  });
});

// ---------------------------------------------------------------------------
// 4. The consolidation stayed INSIDE the package
// ---------------------------------------------------------------------------

describe('objectui#9048 — the shared refusal is internal to @object-ui/core', () => {
  it('is not re-exported from the package entry', () => {
    // objectui#9048 fixed the two `@object-ui/core` producers by giving them ONE
    // refusal to read. The third producer — `objectFilterEntryToAST` in
    // `@object-ui/data-objectstack` — is in a SECOND published package, and
    // `@object-ui/core`'s `exports` map has exactly one entry (`"."`), so it can
    // only import what `src/index.ts` re-exports. Reaching the shared refusal
    // from there is therefore a PUBLISHED-SURFACE addition, which this card
    // deliberately did not make.
    //
    // ⚠️ This pin is not a ban. It is the place the decision gets recorded: if
    // you are landing the cross-package half, change this assertion in the same
    // commit and say so in the PR, so the addition is a decision rather than a
    // side effect of an `export *` somewhere.
    for (const name of ['isRefusedTextComparand', 'textComparandRefusalReason', 'describeComparand']) {
      expect(
        Object.prototype.hasOwnProperty.call(corePublicEntry, name),
        `${name} reached @object-ui/core's published entry. objectui#9048 kept the shared `
          + 'refusal internal on purpose; adding it is a published-surface change and a '
          + "maintainer's call",
      ).toBe(false);
    }
  });

  it('…while both in-package faces do read it', async () => {
    // The other half of the same claim: internal does not mean unused. Both
    // producers and the matcher answer the same shape, which is only true
    // because they share one implementation.
    expect(() => toFilterNode([viewRule('')])).toThrow(FilterOperatorError);
    expect(() => convertFiltersToAST({ name: { $icontains: '' } })).toThrow(FilterOperatorError);
    expect(await matcherRefusals([['name', VIEW_SPELLING, '']])).toHaveLength(1);
  });
});
