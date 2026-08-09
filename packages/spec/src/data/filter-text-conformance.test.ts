// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `FILTER_TEXT_CASES` landed as a standard no backend answered yet (#5701, the
 * contract half of the #4706 ruling). That premise was true when this file was
 * written and has since been falsified: the SQL-family drivers import and
 * execute the whole table — that import is what
 * `scripts/check-driver-conformance.mjs` counts as coverage, and its ledger's
 * DEBT rows are the open remainder (re-verified 2026-08, #6993). What has NOT
 * expired is this file's reason to exist: in the window where nothing executed
 * the table, a miscounted `expected` list would have sat quietly wrong until a
 * driver author trusted it — and between driver runs, the same oracle is still
 * what keeps the table honest.
 *
 * So this file executes it, against a reference evaluator written from the
 * declared semantics: ASCII-only case folding, literal comparands. If the table
 * and the declaration disagree, one of them is wrong TODAY rather than in six
 * months.
 *
 * The second job is proving the table is not VACUOUS. Two cases exist solely to
 * pin the ASCII-only boundary (#4706 Q1 = A), and a fixture that cannot tell an
 * ASCII fold from a Unicode fold would pass them by accident. `the ASCII-only
 * cases discriminate` runs both folds and requires them to DISAGREE exactly
 * there — the reverse verification, made permanent, in the direction that
 * matters: a Unicode-folding backend must FAIL those two rows.
 */

import { describe, it, expect } from 'vitest';
import {
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  type FilterTextCase,
  type FilterTextRowsCase,
} from './filter-text-conformance';

// ── A reference evaluator, from the declared semantics ───────────────────────

/** Fold `A-Z` and nothing else — the domain #4706 Q1 pinned. */
const asciiFold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
/** The fold the contract deliberately does NOT promise — for the discrimination test. */
const unicodeFold = (s: string) => s.toLowerCase();

/** Evaluate one field constraint against one value, with the given fold. */
function evaluate(value: string, ops: Record<string, unknown>, fold: (s: string) => string): boolean {
  return Object.entries(ops).every(([op, comparand]) => {
    const c = String(comparand);
    switch (op) {
      // Case-insensitive containment folds BOTH sides.
      case '$icontains': return fold(value).includes(fold(c));
      // The rest compare literally — no fold, no wildcards, no regex.
      case '$contains': return value.includes(c);
      case '$notContains': return !value.includes(c);
      case '$startsWith': return value.startsWith(c);
      case '$endsWith': return value.endsWith(c);
      default: throw new Error(`reference evaluator has no arm for ${op}`);
    }
  });
}

/** Ids the reference evaluator returns for a rows-case, ascending. */
function referenceIds(c: FilterTextRowsCase, fold: (s: string) => string): string[] {
  const ops = (c.filter as Record<string, Record<string, unknown>>).name;
  return FILTER_TEXT_ROWS.filter((r) => evaluate(r.name, ops, fold)).map((r) => r.id);
}

const isRowsCase = (c: FilterTextCase): c is FilterTextRowsCase => c.expectRejection !== true;
const rowsCases = FILTER_TEXT_CASES.filter(isRowsCase);
const rejectionCases = FILTER_TEXT_CASES.filter((c) => !isRowsCase(c));

// ── The table agrees with the declaration ────────────────────────────────────

describe('FILTER_TEXT_CASES against the declared semantics', () => {
  for (const c of rowsCases) {
    it(`reference evaluator reproduces: ${c.name}`, () => {
      expect(referenceIds(c, asciiFold)).toEqual([...c.expected]);
    });
  }

  it('the ASCII-only cases discriminate — a Unicode fold FAILS exactly them', () => {
    // The whole point of Q1 = A. If this ever reports zero disagreements, the
    // fixture stopped being able to tell the two folds apart and the boundary
    // is no longer pinned by anything.
    const disagree = rowsCases
      .filter((c) => referenceIds(c, unicodeFold).join() !== referenceIds(c, asciiFold).join())
      .map((c) => c.name);

    expect(disagree.sort()).toEqual([
      'ASCII-only: a lower-case non-ASCII comparand does NOT match its upper-case row',
      'ASCII-only: an upper-case non-ASCII comparand does NOT match its lower-case row',
    ]);

    // And name the wrong answer, so the failure explains itself: a Unicode
    // folder returns BOTH café rows for a query that must return one.
    const caseLower = rowsCases.find((c) => c.name.startsWith('ASCII-only: a lower-case'))!;
    expect(referenceIds(caseLower, unicodeFold)).toEqual(['3', '4']);
    expect(referenceIds(caseLower, asciiFold)).toEqual(['4']);
  });

  it('the case-SENSITIVITY cases discriminate — a folding $contains FAILS them', () => {
    // The Q2 = A pin, proved non-vacuous the same way: today three of five
    // backends fold `$contains`, so the rows that must exclude their
    // case-variant twin have to actually exclude it.
    const contains = rowsCases.find((c) => c.name.startsWith('$contains is case-SENSITIVE — a lower-case'))!;
    expect(contains.expected).toEqual(['2']);
    const folding = FILTER_TEXT_ROWS.filter((r) => asciiFold(r.name).includes(asciiFold('acme'))).map((r) => r.id);
    expect(folding, 'a case-folding $contains returns both — that is the answer #4706 Q2 rejected').toEqual(['1', '2']);
  });
});

// ── The table is internally well-formed ──────────────────────────────────────

describe('FILTER_TEXT_CASES shape', () => {
  it('has unique case names — they are used as test names', () => {
    const names = FILTER_TEXT_CASES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has unique row ids', () => {
    const ids = FILTER_TEXT_ROWS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never expects an id the fixture does not contain', () => {
    const ids = new Set(FILTER_TEXT_ROWS.map((r) => r.id));
    for (const c of rowsCases) {
      for (const id of c.expected) {
        expect(ids.has(id), `${c.name} expects row ${id}, which is not in FILTER_TEXT_ROWS`).toBe(true);
      }
    }
  });

  it('lists expected ids ascending, without duplicates', () => {
    for (const c of rowsCases) {
      const asked = [...c.expected];
      expect([...new Set(asked)].sort(), c.name).toEqual(asked);
    }
  });

  it('covers both verdicts — a table with no rejection case would not need the discriminant', () => {
    expect(rowsCases.length).toBeGreaterThan(0);
    expect(rejectionCases.length).toBeGreaterThan(0);
  });
});

describe('the rejection cases carry a prescription, not just a refusal', () => {
  for (const c of rejectionCases) {
    it(c.name, () => {
      if (isRowsCase(c)) throw new Error('unreachable — filtered above');
      // ADR-0112 envelope, so a suite cannot accept a bare 500-shaped throw.
      expect(c.code).toBe('INVALID_FILTER');
      expect(c.mustMention.length).toBeGreaterThan(0);
      // Every refused spelling must be named, so the author can find it in their filter…
      const refused = Object.keys((c.filter as Record<string, Record<string, unknown>>).name);
      for (const op of refused) {
        expect(c.mustMention, `${c.name} refuses ${op} without requiring the message to name it`).toContain(op);
      }
      // …and the retired ones must name the replacement, or the error is a dead end.
      if (refused.some((op) => op === '$regex' || op === '$options')) {
        expect(c.mustMention).toContain('$icontains');
      }
    });
  }
});
