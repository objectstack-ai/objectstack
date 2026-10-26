/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `convertFiltersToAST` refuses the two `$icontains` comparand shapes the
 * published table declares REFUSED (objectui#9001).
 *
 * ## The defect
 *
 * `@objectstack/spec`'s `FILTER_TEXT_CASES` carries two REJECTION rows for
 * `$icontains` — an empty comparand and a non-string one — each with
 * `code: 'INVALID_FILTER'` and `mustMention: ['$icontains']`. `ValueDataSource`
 * has answered both since objectui#8748 (`refuseTextComparand`).
 * `convertFiltersToAST` answered neither: measured on `origin/main` `152f0a700`
 * (objectui#8996 and objectui#9019 both landed), both faces in one process,
 *
 * ```
 * $icontains ''   LOWER=["name","icontains",""]   MATCH=[] REFUSED(1)
 * $icontains 42   LOWER=["name","icontains",42]   MATCH=[] REFUSED(1)
 * ```
 *
 * — one authored filter refused by the in-memory matcher and lowered onto the
 * wire by the ObjectStack path. The acceptance-set split objectui#8568 and
 * objectui#8976 each closed on the operator-KEY axis, here on the COMPARAND
 * axis.
 *
 * ## What is asserted, and why in this shape
 *
 * The weak version of this file would be `expect(() => convertFiltersToAST({
 * name: { $icontains: '' } })).toThrow()` — satisfied by any throw, including a
 * bare `Error` from a converter that had simply broken, and blind to the half of
 * the contract that is the message. Four stronger claims are made instead.
 *
 *   1. **The contract's own rows are DRIVEN, not transcribed.** The rejection
 *      rows are read off the installed `FILTER_TEXT_CASES` at run time and each
 *      is pushed through `convertFiltersToAST`; the row supplies the filter, the
 *      `code` and the `mustMention` list. A transcribed contract drifts from the
 *      contract, and this file would then pin the drift.
 *   2. **The port is a MIRROR of `ValueDataSource`, checked by driving both.**
 *      Triage's ruling was *port, do not re-design*, and `mustMention` is what
 *      makes that load-bearing rather than stylistic: a differently-worded
 *      refusal is a different failure to honour the same contract. So the
 *      matcher's refusal text is captured live, its envelope stripped, and the
 *      converter's message must CONTAIN it verbatim. Neither face can drift
 *      without this reddening.
 *   3. **`ValueDataSource` still answers what objectui#8748 made it answer.**
 *      This card makes a SECOND path agree with the first; it does not edit the
 *      first. Pinned here so "the two agree" cannot be satisfied by having
 *      quietly moved the reference implementation.
 *   4. **The refusal is not "refuse everything".** A valid `$icontains` must
 *      still lower byte for byte, the sibling positive operators must be
 *      untouched, and the TRUE-identity tail must answer exactly what it
 *      answered before — a guard written as `!operatorValue`, or one that
 *      `continue`d instead of throwing, passes the rejection cases above and
 *      fails these.
 *
 * ⚠️ Deliberately NOT claimed: that the refusal reaches a real backend. What is
 * provable in this tree is the lowering and the two faces' agreement.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FILTER_TEXT_CASES } from '@objectstack/spec/data';
import { convertFiltersToAST, convertOperatorToAST, FilterOperatorError } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

/**
 * The `FILTER_TEXT_CASES` rejection rows that are about the `$icontains`
 * COMPARAND, read off the installed spec rather than transcribed.
 *
 * Narrowed by the OPERATOR KEYS of the row's own filter, not by its
 * `mustMention` list: the `$regex` rows also mention `$icontains` (they
 * prescribe it as the repair), and driving those through this converter would
 * assert something true for a different reason — the `$regex` arm, which
 * objectui#8976 already pinned.
 */
type RejectionRow = {
  name: string;
  filter: Record<string, any>;
  code: string;
  mustMention: readonly string[];
  comparand: unknown;
};

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
    rows.push({
      name: row.name,
      filter,
      code: row.code,
      mustMention: row.mustMention ?? [],
      comparand: operatorMap.$icontains,
    });
  }
  return rows;
}

const REJECTION_ROWS = icontainsComparandRejectionRows();

const ROWS = [
  { id: 'a', name: 'ACME Corporation' },
  { id: 'b', name: 'acme holdings' },
  { id: 'c', name: 'Globex' },
];

/** The envelope `refuseFilterNode` wraps every `ValueDataSource` refusal in. */
const MATCHER_PREFIX = '[ObjectUI] ValueDataSource: ';
const MATCHER_SUFFIX = '. Rows are excluded rather than passed through.';

async function selectionAndRefusals(
  filter: unknown,
): Promise<{ ids: string[]; refusals: string[] }> {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find('rows', { $filter: filter as any });
  const refusals = warn.mock.calls.map((call) => String(call[0]));
  warn.mockRestore();
  return { ids: result.data.map((r) => r.id as string), refusals };
}

/**
 * The REASON `ValueDataSource` refused, with its face-specific envelope removed
 * — the half of the message that is the contract's, and so the half this
 * converter has to repeat.
 *
 * Throws rather than returning `undefined` when the envelope no longer matches:
 * a silently-unparsed refusal would make the mirror assertion below compare the
 * converter's message against an empty string, which every message contains.
 */
function matcherReason(refusal: string | undefined): string {
  if (
    refusal === undefined
    || !refusal.startsWith(MATCHER_PREFIX)
    || !refusal.endsWith(MATCHER_SUFFIX)
  ) {
    throw new Error(
      `ValueDataSource's refusal envelope changed (objectui#9001 reads it to compare the two `
      + `faces' wording). Re-point this reader at the new envelope; do NOT delete the check — `
      + `the wording agreement IS what FILTER_TEXT_CASES' mustMention makes load-bearing. `
      + `Got: ${String(refusal)}`,
    );
  }
  return refusal.slice(MATCHER_PREFIX.length, refusal.length - MATCHER_SUFFIX.length);
}

/**
 * `JSON.stringify` for a diagnostic that must survive the values this file
 * deliberately feeds it.
 *
 * Measured during this card's ablation: with the guard removed, the BigInt case
 * below reddened — correctly — but through `JSON.stringify`'s own "Do not know
 * how to serialize a BigInt", so the failure text named the HARNESS instead of
 * the defect. A red that misdirects the next reader is a red that costs a
 * debugging session, so the diagnostic is made total.
 */
function show(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function refusalFrom(filter: Record<string, any>): FilterOperatorError {
  try {
    const lowered = convertFiltersToAST(filter);
    throw new Error(
      `convertFiltersToAST(${show(filter)}) did NOT refuse — it lowered `
      + `${show(lowered)} onto the wire. That is objectui#9001.`,
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

describe('objectui#9001 — controls', () => {
  it('read BOTH $icontains comparand rejection rows off the installed spec', () => {
    // Guards the vacuous pass: a reader that matched nothing would make the
    // `it.each` below iterate zero rows and report success.
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
    expect(
      REJECTION_ROWS.every((row) => row.mustMention.includes('$icontains')),
      'and every row must require the refusal to NAME the operator',
    ).toBe(true);
  });

  it('$icontains still lowers to `icontains`, the key the guard is written on', () => {
    // The guard is keyed on the LOWERED operator. If this identity ever moved,
    // the guard would stop firing while every rejection case still read as a
    // throw from somewhere else — so it is pinned rather than assumed.
    expect(convertOperatorToAST('$icontains')).toBe('icontains');
  });

  it('the matcher and the converter both really run on this fixture', async () => {
    // The live control for the whole file: green before this card and after it.
    // A red here is about the harness, not about the comparand door.
    expect(convertFiltersToAST({ name: { $icontains: 'acme' } })).toEqual([
      'name',
      'icontains',
      'acme',
    ]);
    const { ids, refusals } = await selectionAndRefusals({ name: { $icontains: 'acme' } });
    expect(ids, 'the working operator must select the case-insensitive set').toEqual(['a', 'b']);
    expect(refusals, 'and must not print a refusal').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1. The contract's rejection rows, driven through the converter
// ---------------------------------------------------------------------------

describe('objectui#9001 — every FILTER_TEXT_CASES $icontains comparand rejection is honoured', () => {
  it.each(REJECTION_ROWS.map((row) => [row.name, row] as const))(
    '%s',
    (_name, row) => {
      const error = refusalFrom(row.filter);
      // The envelope, not merely "it threw": `classifyLoadError` reads these,
      // and a bare `Error` classifies as a NETWORK fault — the one thing a
      // malformed filter definitely is not.
      expect(error.code, 'the row declares the ADR-0112 code the refusal must carry').toBe(row.code);
      expect(error.httpStatus, 'and its 400-class status').toBe(400);
      for (const token of row.mustMention) {
        expect(
          error.message,
          `FILTER_TEXT_CASES requires this refusal to mention ${token}`,
        ).toContain(token);
      }
      expect(
        error.message,
        'and the FIELD, so an author can find the condition in their filter',
      ).toContain('name');
    },
  );

  it('the refusal happens BEFORE the node exists, so nothing lowers', () => {
    // The distinction the card is about: a node that reaches the wire and is
    // refused two layers later teaches the author nothing, and on the
    // `$expand` route is not refused at all.
    for (const row of REJECTION_ROWS) {
      expect(() => convertFiltersToAST(row.filter)).toThrow(FilterOperatorError);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. A PORT, not a second design — the two faces' wording is pinned together
// ---------------------------------------------------------------------------

describe('objectui#9001 — the converter repeats ValueDataSource\'s refusal verbatim', () => {
  it.each(REJECTION_ROWS.map((row) => [row.name, row] as const))(
    '%s — same words, each face\'s own envelope',
    async (_name, row) => {
      const { refusals } = await selectionAndRefusals(row.filter);
      expect(
        refusals,
        'objectui#8748 refuses this shape in the matcher; if it does not, the reference '
          + 'implementation moved and this port must be re-derived rather than re-pinned',
      ).toHaveLength(1);
      const reason = matcherReason(refusals[0]);
      expect(reason.length, 'a non-empty reason, or `toContain` below is vacuous').toBeGreaterThan(40);
      expect(
        refusalFrom(row.filter).message,
        'triage ruled PORT, do not re-design: FILTER_TEXT_CASES\' mustMention makes the wording '
          + 'part of the contract, so a converter message that no longer contains the matcher\'s '
          + 'reason is a DIFFERENT failure to honour the same row',
      ).toContain(reason);
    },
  );

  it('the two envelopes differ, which is the half that does NOT transfer', async () => {
    // `ValueDataSource` excludes-and-logs because it is deciding about one ROW;
    // this converter is the PRODUCER deciding whether to send a query at all
    // and has no row to exclude, so it throws the `INVALID_FILTER` / 400
    // envelope this file already carries for `$regex`, `$not` and three other
    // comparand shapes. Pinned so "port the message" is not misread as "port
    // the delivery".
    const { refusals } = await selectionAndRefusals({ name: { $icontains: '' } });
    expect(refusals[0]).toContain('Rows are excluded rather than passed through');
    expect(refusalFrom({ name: { $icontains: '' } }).message).not.toContain(
      'Rows are excluded rather than passed through',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. The reference implementation is UNCHANGED — this card edits the second path
// ---------------------------------------------------------------------------

describe('objectui#9001 — ValueDataSource still answers what objectui#8748 made it answer', () => {
  it('the `$` dialect excludes every row and names `$icontains` once', async () => {
    const { ids, refusals } = await selectionAndRefusals({ name: { $icontains: '' } });
    expect(ids, 'the pre-8748 answer was every row — a predicate constraining nothing').toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('$icontains');
  });

  it('the AST dialect answers the same way and names `icontains`', async () => {
    const { ids, refusals } = await selectionAndRefusals(['name', 'icontains', '']);
    expect(ids).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('icontains');
  });

  it('a non-string comparand is refused there too, and still is', async () => {
    const { ids, refusals } = await selectionAndRefusals({ name: { $icontains: 42 } });
    expect(ids).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('not a string');
  });
});

// ---------------------------------------------------------------------------
// 4. Not "refuse everything" — the controls that stop the cheap pass
// ---------------------------------------------------------------------------

describe('objectui#9001 — what the guard must NOT touch', () => {
  it('a valid $icontains lowers exactly as it did before this card', () => {
    // Byte for byte, alone and beside a sibling condition — the second form
    // exercises the multi-condition `and` builder the guard sits inside.
    expect(convertFiltersToAST({ name: { $icontains: 'acme' } })).toEqual([
      'name',
      'icontains',
      'acme',
    ]);
    expect(convertFiltersToAST({ name: { $icontains: 'acme' }, status: 'open' })).toEqual([
      'and',
      ['name', 'icontains', 'acme'],
      ['status', '=', 'open'],
    ]);
  });

  it('the sibling positive operators are deliberately NOT widened by analogy', () => {
    // `FILTER_TEXT_CASES` declares the comparand refusals for `$icontains` and
    // for no other operator, so these keep the answer they have always given.
    // The asymmetry is a scope boundary, not an oversight: moving it is the
    // published table's decision — the same line `refuseTextComparand`'s own
    // docblock draws one data source over.
    expect(convertFiltersToAST({ name: { $contains: '' } })).toEqual(['name', 'contains', '']);
    expect(convertFiltersToAST({ name: { $startsWith: '' } })).toEqual(['name', 'startswith', '']);
    expect(convertFiltersToAST({ name: { $endsWith: '' } })).toEqual(['name', 'endswith', '']);
  });

  it('the TRUE-identity tail counts exactly the keys it counted before', () => {
    // objectui#8770 folds a filter whose EVERY key is a TRUE-identity group,
    // by comparing a COUNT with `Object.keys(filter).length` — and
    // objectui#9030 is open on that comparison counting keys the loop skips.
    // A new refusal must not perturb it. It cannot: the guard THROWS, so it
    // adds no `continue` and skips no key, and the tail is unreachable from
    // it. Pinned rather than argued.
    //
    // ⚠️ UPDATED TWICE. objectui#9020 gave the all-skipped tail its own count
    // and its own `undefined` — a SECOND guard beside this one. objectui#9030
    // then narrowed THIS guard's denominator to the keys the loop actually
    // PROCESSED, so a mixed filter folds too. Neither touched what this control
    // measures: a refusal that THROWS adds no `continue`, skips no key, and so
    // moves neither the numerator nor the denominator. The empty-operator-map
    // case below is the one no fold claims, and it is what keeps this control
    // able to see a perturbation at all — ⚠️ UPDATED: since objectui#9164 it is
    // refused rather than handed back as the object, and a fold that swallowed
    // it would answer `undefined` instead of throwing.
    expect(convertFiltersToAST({ $and: [] })).toBeUndefined();
    expect(convertFiltersToAST({ $or: [{}] })).toBeUndefined();
    expect(convertFiltersToAST({ $and: [], a: null })).toBeUndefined();
    expect(() => convertFiltersToAST({ $and: [], a: {} })).toThrow(FilterOperatorError);
    expect(convertFiltersToAST({})).toEqual({});
    expect(convertFiltersToAST({ a: null })).toBeUndefined();
    expect(convertFiltersToAST({ $and: [], name: { $icontains: 'x' } })).toEqual([
      'name',
      'icontains',
      'x',
    ]);
  });

  it('a BigInt comparand is refused WITH the envelope, not replaced by a TypeError', () => {
    // `JSON.stringify` throws on a BigInt. Building the message inside the
    // `throw` expression means an unguarded stringify would escape in the
    // refusal's PLACE, and `classifyLoadError` reads a bare `TypeError` as a
    // network fault — "check your connection" for a filter already judged.
    const error = refusalFrom({ name: { $icontains: 10n } });
    expect(error.code).toBe('INVALID_FILTER');
    expect(error.message).toContain('bigint');
    expect(error.message).toContain('$icontains');
  });
});
