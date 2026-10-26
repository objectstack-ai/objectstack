/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9196 — `ObjectView` was a THIRD, drifted reader of the `filter[...]`
 * URL family, and its drift was NOT "the operator was ignored".
 *
 * The reader it carried had a GREEDY field capture, so an operator-suffixed key
 * did not fail to match — it matched with the suffix swallowed INTO THE FIELD
 * NAME. On `/apps/:app/:object`, `?filter[amount][gte]=100` emitted a condition
 * against a field literally named `amount][gte`, which no object declares: a
 * silently WRONG query, not an ignored parameter and not a refusal.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * The ruling on the card takes ONE of the two candidate repairs:
 *
 *   NOT taken — teaching this route the operator arm. That would ADD range
 *      operators to a route that has never had them, widening the accepted set
 *      of an addressable public surface. It is a behaviour addition, and it
 *      belongs to the maintainer.
 *   Taken — the route drops the operator suffix it cannot execute, which is the
 *      posture the `/data` surface already DECLARES in as many words: "An
 *      unknown operator suffix is ignored (never silently downgraded to
 *      equality)."
 *
 * The route now reads through `drillUrlFilters`, the one module that owns this
 * family, so there is no longer a private reader here to drift. Both arms share
 * ONE key grammar, which is what makes the swallowing structurally impossible
 * rather than merely fixed at one call site.
 *
 * ## SUITE DIRECTION — stated before running
 *
 *   RED on the unmodified base tree: every assertion in "the card's three rows"
 *   that reads the object route, both assertions in "IGNORED is not DOWNGRADED",
 *   the whole bracket battery, and both source-scan pins. On the base tree the
 *   object-route reader does not exist as an importable function at all, so the
 *   red arrives as a resolution failure; the behavioural before/after on the
 *   real base-tree bytes is recorded in the PR body, measured by lifting the
 *   live regex literal out of `ObjectView.tsx` rather than copying it.
 *
 *   GREEN on the base tree, by design: nothing here. The `/data` column rows are
 *   green on both sides EXCEPT the bracketed-field row, and they are labelled
 *   below as non-discriminating for that reason — they are recorded because they
 *   are the evidence that the operator arm did not move, not because they pin
 *   this change.
 *
 * ## Every control here can fire
 *
 * - The LIT CONTROL is the plain, unsuffixed `filter[field]=value` row. It must
 *   read the same on BOTH readers and must be UNCHANGED by this repair — it is
 *   the only evidence that ordinary equality was not broken while the suffix was
 *   being dropped. It fires if the repair over-reaches.
 * - The `/data` column is pinned on the SAME inputs in the SAME run. Its `gte`
 *   row staying `['amount', '>=', '100']` is what proves the operator arm was
 *   not moved onto the object route: it still executes there and ONLY there.
 * - The source scan carries a positive control (`ANCHOR`), so a read of the
 *   wrong or an empty file fails loudly instead of reporting a clean sweep.
 * - The bracket battery carries a non-vacuity control, so a battery that
 *   silently stopped emitting anything cannot pass by inspecting nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUrlFilterTriples, parseUrlEqualityFilterTriples } from './drillUrlFilters';

/** The ADR-0055 `/data` surface reader (`ObjectDataPage`). */
const dataSurface = (qs: string) => parseUrlFilterTriples(new URLSearchParams(qs));
/** The plain object route reader (`ObjectView`), after objectui#9196. */
const objectRoute = (qs: string) => parseUrlEqualityFilterTriples(new URLSearchParams(qs));

describe("objectui#9196 — the card's three rows, both readers, one run", () => {
  it('row 1 — an unknown operator suffix is dropped by BOTH readers', () => {
    expect(dataSurface('filter[owners][contains]=u1')).toEqual([]);
    expect(objectRoute('filter[owners][contains]=u1')).toEqual([]);
  });

  it('row 2 — LIT CONTROL: plain equality is unchanged, and identical on both', () => {
    expect(dataSurface('filter[owners]=u1')).toEqual([['owners', '=', 'u1']]);
    expect(objectRoute('filter[owners]=u1')).toEqual([['owners', '=', 'u1']]);
  });

  it('row 3 — a range suffix executes on /data ONLY, and is dropped on the object route', () => {
    // The `/data` half is the proof that the operator arm was NOT added here:
    // it is exactly where it already was, and nowhere new.
    expect(dataSurface('filter[amount][gte]=100')).toEqual([['amount', '>=', '100']]);
    expect(objectRoute('filter[amount][gte]=100')).toEqual([]);
  });

  it('row 3, the defect itself — no condition is emitted against `amount][gte`', () => {
    const fields = objectRoute('filter[amount][gte]=100').map(([field]) => field);
    expect(fields).not.toContain('amount][gte');
  });
});

describe('objectui#9196 — IGNORED is not DOWNGRADED TO EQUALITY', () => {
  it('drops the whole key rather than filtering `amount = 100`', () => {
    const triples = objectRoute('filter[amount][gte]=100');
    expect(triples).toEqual([]);
    // Stated the other way round too, because "ignored" and "downgraded" are
    // two different outcomes and only one of them is correct: a route that
    // cannot execute `>= 100` must not quietly answer the narrower `= 100`
    // question. `toEqual([])` alone would also pass for a reader that refused
    // the whole URL, so the field-level assertion names which one we mean.
    expect(triples).not.toContainEqual(['amount', '=', '100']);
    expect(triples.map(([field]) => field)).not.toContain('amount');
  });

  it('drops each bound of a two-bound range, not just one of them', () => {
    expect(
      objectRoute('filter[close_date][gte]=2026-04-01&filter[close_date][lt]=2026-07-01'),
    ).toEqual([]);
  });

  it('keeps the OTHER conditions in the same URL — only the suffixed key is dropped', () => {
    expect(objectRoute('filter[amount][gte]=100&filter[status]=open')).toEqual([
      ['status', '=', 'open'],
    ]);
  });
});

describe('objectui#9196 — no emitted field name ever carries a bracket', () => {
  // The simplest success criterion on the card: a condition on a field name
  // containing a bracket is a condition no object can answer.
  const inputs = [
    'filter[amount][gte]=100',
    'filter[owners][contains]=u1',
    'filter[a][b][c]=1',
    'filter[x][GTE]=1',
    'filter[weird[x]=1',
    'filter[owners]=u1',
    'filter[account.region]=NA',
  ];

  it.each(inputs)('object route, %s', (qs) => {
    for (const [field] of objectRoute(qs)) {
      expect(field).not.toMatch(/[[\]]/);
    }
  });

  it.each(inputs)('/data surface, %s', (qs) => {
    for (const [field] of dataSurface(qs)) {
      expect(field).not.toMatch(/[[\]]/);
    }
  });

  it('the battery is not vacuous — it does emit conditions for the plain rows', () => {
    // Instrument check: if every input above produced nothing, the loops would
    // pass without ever inspecting a field name.
    expect(inputs.flatMap((qs) => objectRoute(qs))).toEqual([
      ['owners', '=', 'u1'],
      ['account.region', '=', 'NA'],
    ]);
    expect(inputs.flatMap((qs) => dataSurface(qs))).toEqual([
      ['amount', '>=', '100'],
      ['owners', '=', 'u1'],
      ['account.region', '=', 'NA'],
    ]);
  });
});

describe('objectui#9196 — the equality arm this route DOES implement', () => {
  it('keeps a relationship path intact', () => {
    expect(objectRoute('filter[account.region]=NA')).toEqual([['account.region', '=', 'NA']]);
  });

  it('skips an empty value', () => {
    expect(objectRoute('filter[status]=')).toEqual([]);
  });

  it('ignores params outside the family', () => {
    expect(objectRoute('recordId=abc&uf_status=open')).toEqual([]);
  });

  it('reads every plain key in a multi-condition URL', () => {
    expect(objectRoute('filter[stage]=won&filter[region]=emea')).toEqual([
      ['stage', '=', 'won'],
      ['region', '=', 'emea'],
    ]);
  });
});

describe('objectui#9196 — `ObjectView` no longer keeps a private reader of this family', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const SOURCE = readFileSync(path.join(here, 'ObjectView.tsx'), 'utf8');
  /** Positive control: a wrong or empty read fails here, not silently below. */
  const ANCHOR = 'const urlFilters';

  it('read the file it means to scan (control)', () => {
    expect(SOURCE).toContain(ANCHOR);
  });

  it('parses the family through the shared module instead of its own regex', () => {
    expect(SOURCE).toContain('parseUrlEqualityFilterTriples');
    expect(SOURCE).toContain("from './drillUrlFilters.js'");
  });

  it('declares no `filter[` regex literal of its own', () => {
    // A regex literal is the only place the escaped bracket occurs after
    // `filter`. The surviving plain-string use (`key.startsWith('filter[')`,
    // which builds the memo key) has no backslash, so it is not matched here —
    // the scan is about a fourth PARSER appearing, not about the substring.
    expect(SOURCE).not.toMatch(/filter\\\[/);
  });
});
