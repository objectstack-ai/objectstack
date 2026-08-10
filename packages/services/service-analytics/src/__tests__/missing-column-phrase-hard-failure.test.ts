// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6035] Postgres's missing-COLUMN wording stays a hard failure, because a
 * mistyped column name is a query bug and not an absent table.
 *
 * ## What was wrong
 *
 * `isMissingSourceError`'s own docblock promises the degradation path is
 * "Deliberately scoped to MISSING SOURCE (table/object/relation) — not
 * column/syntax errors, which stay hard failures so real query bugs still
 * surface". One driver wording broke that promise by construction:
 *
 *   `column "label" of relation "acct" does not exist`       (SQLSTATE 42703)
 *
 * carries `relation "acct" does not exist` inside it VERBATIM. #5717 anchored
 * the postgres limb to postgres's real missing-table wording, and this string
 * matched anyway — it had to, because it literally contains that wording. No
 * tightening of "does this say a relation is missing" can exclude it; only
 * asking the more specific question FIRST can, which is why the fix is an
 * ORDERING (subtract the column phrase, then classify) and not a better regex.
 *
 * Both consequences were wrong, and which one fired depended only on whether
 * the named relation happened to be the dataset's own object:
 *
 *   - a JOINED table's name  → a loud but FALSE cross-datasource topology
 *     error, blaming the datasource layout for a typo;
 *   - the dataset's OWN name → the widget degrades to an empty grid, one
 *     `warn`, and the mistyped column is never mentioned to anyone.
 *
 * Both are pinned below, because "which half fires" is an accident of the
 * fixture and a fix that only closed one would look green from either side.
 *
 * ## Why this was dormant, stated as a limit rather than a boast
 *
 * Analytics is a READ face, and postgres does not use this wording on reads: a
 * SELECT naming an unknown column says `column "bogus" does not exist`, with no
 * `relation` in it (row 06 of the corpus below — a miss before and after).
 * `column … of relation …` is INSERT/UPDATE/ALTER phrasing. So this repairs a
 * predicate that disagreed with its own documentation, and does NOT repair a
 * production incident. The value is that the disagreement cannot outlive the
 * assumption that keeps it harmless — the day any write-shaped statement, any
 * driver re-wording, or any newly wrapped `cause` puts that phrase in front of
 * this catch, it is classified correctly instead of silently.
 *
 * ## The corpus, and why it is asserted through the public API
 *
 * PR #6045 (#5717) measured 13 real in-repo wordings and moved exactly one
 * verdict. This file re-pins all 13 — but as `queryDataset` OUTCOMES rather
 * than as booleans out of a private predicate, so what is guarded is the
 * behaviour a caller can actually observe (empty grid / topology refusal /
 * propagated verbatim), and so the pair `isMissingSourceError` +
 * `missingSourceRelation` is exercised JOINTLY. Each wording is thrown BARE, on
 * purpose: several of these producers carry an ADR-0112 envelope in real life
 * and would propagate via #5717's defence B no matter what the sniffer said,
 * which would make them vacuous as pins of the sniffer (#5046's lesson — a case
 * that passes because nothing is produced). Stripping the envelope is the same
 * isolation `dataset-degradation-envelope.test.ts` uses for its defence-C case.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Ordinary direction (red), and deliberately NARROW: this change subtracts one
 * phrase, so restoring the deleted guard must turn red exactly the cases about
 * that phrase and nothing else. Predicted, with the guard removed from both
 * functions:
 *
 *   - `column … of relation "sys_team" …` (a joined name)  → RED, becomes the
 *     false topology refusal;
 *   - `column … of relation "opportunity" …` (own object)  → RED, becomes an
 *     empty grid;
 *   - the 13-row corpus table                              → RED on row 05 ONLY;
 *   - the other 12 rows, and every case in
 *     `dataset-degradation-envelope.test.ts`               → GREEN throughout.
 *
 * MEASURED, both guards disabled: **3 red / 15 green** in this file — the three
 * predicted cases and no others, row 05 the only corpus row to move, and
 * `dataset-degradation-envelope.test.ts` green at 11/11 in both states, which is
 * what makes "narrowing, not a behaviour change" a measurement rather than a
 * claim. (The green count is corrected from the 12 first written here — 18
 * cases, not 15; the RED SET was predicted exactly and is the part that carries
 * the argument, so the miscount is fixed in place rather than quietly.)
 *
 * The two reverted failures are worth quoting, because they are the defect
 * itself rather than a red mark: the joined-name case came back as
 * `[Analytics] dataset "sales" cannot be executed as one statement: table
 * "sys_team" is not on the default datasource …` — a datasource-topology story
 * told about a typo — and the own-object case failed as `expected undefined to
 * be an instance of Error`, i.e. nothing was thrown at all and the widget got
 * its empty grid.
 */

import { describe, it, expect, vi } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { matchMissingColumnOfRelation } from '@objectstack/types';
import { AnalyticsService } from '../analytics-service.js';

const EMPTY = { rows: [], fields: [], totals: [] };

const dataset = DatasetSchema.parse({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  include: ['account'],
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
});

const SELECTION = { dimensions: ['region'], measures: ['revenue'] };
const CTX = { tenantId: 'org_A' } as ExecutionContext;

function logger() {
  return { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() } as any;
}

/** A service whose execution throws `thrown` — the only way into the catch under test. */
function serviceThatThrows(thrown: unknown, log = logger()) {
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => { throw thrown; },
    isRegisteredObject: () => true,
    logger: log,
  });
}

/**
 * The three outcomes `queryDataset`'s catch can produce, named so a corpus row
 * reads as a behaviour rather than as an internal boolean.
 */
type Outcome = 'empty' | 'topology' | 'propagated';

async function outcomeOf(wording: string, log = logger()): Promise<Outcome> {
  try {
    const result = await serviceThatThrows(new Error(wording), log).queryDataset(dataset, SELECTION, CTX);
    expect(result).toEqual(EMPTY);
    return 'empty';
  } catch (e) {
    const message = String((e as Error)?.message);
    // The #5033 cross-datasource refusal is this layer's OWN wording; anything
    // else reaching the caller is the driver's error, untouched.
    return /cannot be executed as one statement/.test(message) ? 'topology' : 'propagated';
  }
}

// ── the corpus PR #6045 measured, transcribed from its real producers ─────────

/** Postgres's missing-COLUMN wording, matching `rest.test.ts`'s pinned case. */
const MISSING_COLUMN_JOINED = 'column "label" of relation "sys_team" does not exist';

const CORPUS: Array<[row: string, wording: string, outcome: Outcome]> = [
  ['01 sqlite/libsql bare', 'no such table: opportunity', 'empty'],
  ['02 sqlite via knex (sql-prefixed)', 'SELECT COUNT(*) FROM "opportunity" - no such table: opportunity', 'empty'],
  ['03 postgres missing table', 'select "region" from "opportunity" - relation "opportunity" does not exist', 'empty'],
  ['04 postgres schema-qualified', 'relation "public.crm_account" does not exist', 'topology'],
  // The one verdict this change moves. Before: `topology` — a false
  // cross-datasource refusal for a mistyped column.
  ['05 postgres MISSING COLUMN (write path)', MISSING_COLUMN_JOINED, 'propagated'],
  ['06 postgres missing column (read path)', 'column "bogus_dim" does not exist', 'propagated'],
  ['07 mysql', "Table 'app.opportunity' doesn't exist", 'empty'],
  [
    '08 objectql datasource',
    "[ObjectQL] Datasource 'warehouse' configured for object 'crm_account' is not registered.",
    'topology',
  ],
  ['09 rest unknown object', "Object 'ghost' is not registered", 'topology'],
  [
    '10 analytics CUBE_NOT_FOUND (#3867)',
    "Cube 'ghost' not found: no cube is registered under that name, and it is not a " +
      'registered object either (a cube can only be auto-inferred from a registered object). ' +
      "Define a Cube in your stack, or check the object name.",
    'empty',
  ],
  [
    '11 dataset-compiler relationship refusal',
    '[dataset-compiler] dataset "sales" includes relationship "bogus" which does not exist on object "opportunity".',
    'propagated',
  ],
  [
    '12 read-scope nested/relation value',
    '[read-scope-sql] "owner" has a nested/relation value which is not supported in a read scope (fail-closed).',
    'propagated',
  ],
  [
    '13 analytics measure gate (#4437)',
    "Measure 'ghost_sum' on cube 'opportunity' aggregates field 'ghost', which object " +
      "'opportunity' does not have. Valid measures: (none).",
    'propagated',
  ],
];

// ─────────────────────────────────────────────────────────────────────────────

describe('[#6035] postgres’s missing-COLUMN wording is a hard failure, not a missing source', () => {
  it('the wording is the one this repo already pins on the REST face', () => {
    // Guards the fixture against drifting away from the phrase the precedent
    // handles: `rest-server.ts`'s `mapDataError` extracts this same string to
    // answer `400 INVALID_FIELD` instead of a `404`, pinned in `rest.test.ts`.
    // If these two stop being the same sentence, the two faces have started
    // disagreeing about what postgres says — which is what this fix removed.
    //
    // [#6615] Asked through the SHARED parser rather than a fourth open-coded
    // copy of the regex. The copy this replaces was itself the drift this test
    // set out to prevent: it could be edited without `mapDataError` moving, so
    // "the two faces agree" was pinned against a private restatement of one of
    // them. Now the fixture is checked against the one definition both read,
    // and the column name it yields is asserted too — `mapDataError` puts
    // exactly that string in the `field` of its `400 INVALID_FIELD`.
    expect(matchMissingColumnOfRelation(MISSING_COLUMN_JOINED)).toBe('label');
    // …and it does contain a well-formed missing-TABLE wording, which is the
    // whole reason a subtraction is needed rather than a tighter anchor.
    expect(MISSING_COLUMN_JOINED).toMatch(/relation\s+["'`]?[A-Za-z0-9_$.]+["'`]?\s+does not exist/i);
  });

  it('naming a JOINED table: propagates verbatim instead of a false topology refusal', async () => {
    const log = logger();
    let caught: Error | undefined;
    try {
      await serviceThatThrows(new Error(MISSING_COLUMN_JOINED), log).queryDataset(dataset, SELECTION, CTX);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught, 'a mistyped column was swallowed by the degradation path').toBeInstanceOf(Error);
    // The driver's own sentence, unedited — the caller can read the column name.
    expect(String(caught?.message)).toBe(MISSING_COLUMN_JOINED);
    // Specifically NOT the #5033 cross-datasource story, which blames the
    // datasource layout for what is a spelling mistake.
    expect(String(caught?.message)).not.toMatch(/cannot be executed as one statement/);
    expect(String(caught?.message)).not.toMatch(/A dataset JOIN cannot cross datasources/);
    // Bare in ⇒ bare out; this layer must not invent an envelope for it.
    expect((caught as { code?: unknown })?.code).toBeUndefined();
    expect((caught as { status?: unknown })?.status).toBeUndefined();
  });

  it('naming the dataset’s OWN object: propagates instead of degrading to an empty grid', async () => {
    // The other half of the same defect, and the quieter one: here the named
    // relation IS `opportunity`, so the old code took the degradation branch —
    // `{rows: []}` plus one warn, with the mistyped column mentioned to nobody.
    const own = 'column "reginn" of relation "opportunity" does not exist';
    const log = logger();
    let caught: Error | undefined;
    try {
      await serviceThatThrows(new Error(own), log).queryDataset(dataset, SELECTION, CTX);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught, 'a mistyped column became a confident empty chart').toBeInstanceOf(Error);
    expect(String(caught?.message)).toBe(own);
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('returning an empty result'));
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('is unavailable'));
  });

  it('an unquoted look-alike is left alone — the subtraction does not widen past postgres', async () => {
    // Direction-of-error guard. Postgres always quotes both names here, so the
    // subtraction requires quotes; a sentence that merely talks ABOUT a relation
    // must keep whatever verdict it had rather than newly becoming a hard
    // failure, since over-matching would regress #5033's deliberate leniency.
    expect(await outcomeOf('relation "opportunity" does not exist')).toBe('empty');
  });
});

describe('[#6035] the other 12 in-repo wordings keep the verdict #5717 measured', () => {
  it.each(CORPUS)('%s → %s', async (_row, wording, expected) => {
    expect(await outcomeOf(wording)).toBe(expected);
  });

  it('exactly one corpus row is a hard failure for the column reason', () => {
    // Counts the shape rather than restating the table: the corpus must keep
    // containing the moved row and its read-path neighbour, so a future edit
    // that quietly drops row 05 cannot leave this file passing.
    const columnRows = CORPUS.filter(([, wording]) => /column\s+["'`]/i.test(wording));
    expect(columnRows.map(([row]) => row)).toEqual([
      '05 postgres MISSING COLUMN (write path)',
      '06 postgres missing column (read path)',
    ]);
    expect(columnRows.every(([, , outcome]) => outcome === 'propagated')).toBe(true);
  });
});
