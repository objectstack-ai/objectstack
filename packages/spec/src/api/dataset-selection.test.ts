// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#17551, ruled] `DatasetSelectionSchema` — the ONE declaration of the wire
 * shape `POST /api/v1/analytics/dataset/query` posts under `selection`.
 *
 * ## What was wrong
 *
 * `DatasetSelection` was a TypeScript **interface** (`contracts/analytics-service.ts`)
 * with no Zod schema anywhere in the repo. PR #17548 doored the route, but only
 * over the SEVEN members the selection shares with `AnalyticsQuery`; the four
 * dataset-only ones — `runtimeFilter`, `dateGranularity`, `compareTo`,
 * `totals` — were 「declared in TypeScript, published in the api-surface, and
 * enforced by nothing on the wire」. #17550 is the measured consequence:
 * `compareTo: { kind: 'nonsense' }` came back as a previous-period comparison
 * under an ordinary **200**, a number a dashboard renders and a person reads as
 * fact.
 *
 * ## What is pinned, and why BOTH directions are here
 *
 * Every refusal owes two cases. ⛔ A schema that refuses everything passes the
 * first kind and is still wrong — so each member below has a malformed value
 * that must now be refused WITH ITS REMEDY, and a legal value that must still
 * pass. §5 drives the whole eleven-member shape as one specimen.
 *
 * §1 pins the 「transcription, not a new contract」 claim the ruling turns on,
 * and pins it STRUCTURALLY: the seven shared members are asserted to be
 * `AnalyticsQuerySchema`'s own declarations BY IDENTITY, so there is no second
 * copy that could drift.
 */

import { describe, it, expect } from 'vitest';

import { AnalyticsQuerySchema } from '../data/analytics.zod';
import {
  DatasetCompareToSchema,
  DatasetSelectionSchema,
  DatasetTotalsSchema,
  datasetCompareKindRefusalMessage,
} from './analytics.zod';

/** A legal, ordinary dashboard-widget selection — all eleven members. */
const FULLY_LOADED = {
  dimensions: ['region'],
  measures: ['revenue'],
  runtimeFilter: { region: 'NA' },
  timeDimensions: [{ dimension: 'close_date', granularity: 'month', dateRange: 'last_30_days' }],
  dateGranularity: 'month',
  order: { revenue: 'desc' },
  limit: 10,
  offset: 0,
  compareTo: { kind: 'previousPeriod', dimension: 'close_date' },
  totals: { groupings: [['region'], []] },
  timezone: 'Asia/Shanghai',
} as const;

/** Every issue message a failed parse raised, joined — what an author reads. */
function refusalText(input: unknown): string {
  const parsed = DatasetSelectionSchema.safeParse(input);
  expect(parsed.success, `expected a refusal, got a pass: ${JSON.stringify(input)}`).toBe(false);
  return parsed.success ? '' : parsed.error.issues.map((i) => i.message).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — the transcription claim, pinned structurally
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The seven members `DatasetSelection` shares with `AnalyticsQuery` — the list
 * the REST door used to carry as a hand-written array, which was a standing
 * CLAIM that two declarations agreed. Taking the declarations themselves makes
 * the claim structural; this block is what keeps it that way.
 */
const SHARED_WITH_ANALYTICS_QUERY = [
  'dimensions',
  'measures',
  'timeDimensions',
  'order',
  'limit',
  'offset',
  'timezone',
] as const;

const DATASET_ONLY = ['runtimeFilter', 'dateGranularity', 'compareTo', 'totals'] as const;

describe('#17551 §1 — a transcription of published text, not a new contract', () => {
  it('the seven shared members ARE `AnalyticsQuery`’s declarations, by identity', () => {
    const selection = DatasetSelectionSchema.shape as Record<string, unknown>;
    const query = AnalyticsQuerySchema.shape as Record<string, unknown>;
    for (const member of SHARED_WITH_ANALYTICS_QUERY) {
      expect(query[member], `${member} must be declared on AnalyticsQuery`).toBeDefined();
      // ⭐ Identity, not equality: a retyped copy would pass a structural
      // comparison and drift the day either side moved.
      expect(selection[member], `${member} must BE the AnalyticsQuery declaration`)
        .toBe(query[member]);
    }
  });

  it('the four dataset-only members are declared here and on no sibling', () => {
    const selection = DatasetSelectionSchema.shape as Record<string, unknown>;
    const query = Object.keys(AnalyticsQuerySchema.shape as Record<string, unknown>);
    for (const member of DATASET_ONLY) {
      expect(selection[member], `${member} must be declared on the selection`).toBeDefined();
      expect(query, `${member} must NOT be an AnalyticsQuery member`).not.toContain(member);
    }
  });

  it('eleven members, no more — the interface published exactly these', () => {
    expect(Object.keys(DatasetSelectionSchema.shape as Record<string, unknown>).sort()).toEqual(
      [...SHARED_WITH_ANALYTICS_QUERY, ...DATASET_ONLY].sort(),
    );
  });

  it('`runtimeFilter` is NOT taken off `where` — same shape, different key', () => {
    const selection = DatasetSelectionSchema.shape as Record<string, unknown>;
    const query = AnalyticsQuerySchema.shape as Record<string, unknown>;
    expect(selection.runtimeFilter).not.toBe(query.where);
    // …and the alias table is what tells an author so, rather than a 400 they
    // have to guess at.
    expect(refusalText({ measures: ['revenue'], where: { region: 'NA' } }))
      .toContain('`where` → `runtimeFilter`');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 — ⭐ #17550's case: an unrecognised `compareTo.kind`
// ─────────────────────────────────────────────────────────────────────────────

describe('#17550 §2 — `compareTo: { kind: … }` outside the closed pair is refused, with a remedy', () => {
  it('the card’s own specimen is refused', () => {
    const text = refusalText({ measures: ['revenue'], compareTo: { kind: 'nonsense' } });
    // ① what arrived — so the caller can find it in the body they sent.
    expect(text).toContain('"nonsense"');
    // ② the whole legal set, both members, spelled as an author would write them.
    expect(text).toContain("'previousPeriod'");
    expect(text).toContain("'previousYear'");
    // ③ the fix, and that it is THIS key's value that is wrong.
    expect(text).toContain('compareTo.kind');
    expect(text).toContain('drop compareTo');
    // ④ ⭐ the prescription is the North Star clause this card cites: the
    // refusal is loud AND it says what used to happen instead.
    expect(text).toContain('200');
  });

  it('every spelling an unparsed body can carry is refused, not just a plausible one', () => {
    for (const kind of ['previousQuarter', 'previous_period', 7, null]) {
      const text = refusalText({ measures: ['revenue'], compareTo: { kind } });
      expect(text, `kind=${JSON.stringify(kind)}`).toContain('compareTo.kind');
    }
  });

  it('CONTROL — both declared kinds still pass, with and without `dimension`', () => {
    for (const kind of ['previousPeriod', 'previousYear'] as const) {
      expect(DatasetSelectionSchema.safeParse({ measures: ['revenue'], compareTo: { kind } }).success)
        .toBe(true);
      expect(DatasetSelectionSchema.safeParse({
        measures: ['revenue'],
        compareTo: { kind, dimension: 'close_date' },
      }).success).toBe(true);
    }
  });

  it('the retired `{ offset }` arm and the bare-string form each carry their rewrite', () => {
    const offset = refusalText({ measures: ['revenue'], compareTo: { kind: 'previousPeriod', offset: '7d' } });
    expect(offset).toContain('`offset`');
    expect(offset).toContain("kind: 'previousYear'");

    const bare = refusalText({ measures: ['revenue'], compareTo: 'previousPeriod' });
    expect(bare).toContain("compareTo: { kind: 'previousPeriod' }");
  });

  it('ONE condition, ONE wording — the two origins differ only in where it was refused', () => {
    const schema = datasetCompareKindRefusalMessage('previousQuarter', 'schema');
    const runtime = datasetCompareKindRefusalMessage('previousQuarter', 'runtime');
    // The verdict sentence is byte-identical on both sides of the door…
    const verdict = 'compareTo.kind "previousQuarter" is not a comparison window this platform implements.';
    expect(schema.startsWith(verdict)).toBe(true);
    expect(runtime.startsWith(verdict)).toBe(true);
    // …and only the clause that says WHERE differs — the one clause no input
    // can supply, which is why it is a required parameter with no default.
    expect(schema).toContain('Refused at the schema');
    expect(runtime).toContain('Refused past the schema door');
    expect(schema).not.toEqual(runtime);
    // The schema really raises it — not a sentence only the builder knows.
    expect(refusalText({ measures: ['revenue'], compareTo: { kind: 'previousQuarter' } }))
      .toContain(verdict);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 — the other three undoored members, both directions each
// ─────────────────────────────────────────────────────────────────────────────

describe('#17551 §3 — `runtimeFilter` / `dateGranularity` / `totals`', () => {
  it('`dateGranularity` outside the closed vocabulary is refused; every member of it passes', () => {
    expect(refusalText({ measures: ['revenue'], dateGranularity: 'fortnight' }))
      .toMatch(/fortnight|Invalid option/);
    for (const g of ['day', 'week', 'month', 'quarter', 'year']) {
      expect(
        DatasetSelectionSchema.safeParse({ measures: ['revenue'], dateGranularity: g }).success,
        `dateGranularity: ${g} must still pass`,
      ).toBe(true);
    }
  });

  it('`runtimeFilter` must be a FilterCondition; a real one passes', () => {
    expect(DatasetSelectionSchema.safeParse({ measures: ['revenue'], runtimeFilter: 'region = NA' }).success)
      .toBe(false);
    for (const f of [{ region: 'NA' }, { region: { $ne: 'EU' } }, { $and: [{ region: 'NA' }] }]) {
      expect(
        DatasetSelectionSchema.safeParse({ measures: ['revenue'], runtimeFilter: f }).success,
        `runtimeFilter ${JSON.stringify(f)} must still pass`,
      ).toBe(true);
    }
  });

  it('`totals` is `{ groupings: string[][] }`; the grand total and a matrix both pass', () => {
    // The response spells the same idea `dimensions` — the cross-direction
    // near-miss the guidance entry exists for.
    expect(refusalText({ measures: ['revenue'], totals: { dimensions: ['region'] } }))
      .toContain('totals: { groupings:');
    // A flat list where a list OF LISTS is declared.
    expect(DatasetSelectionSchema.safeParse({ measures: ['revenue'], totals: { groupings: ['region'] } }).success)
      .toBe(false);
    for (const t of [{ groupings: [[]] }, { groupings: [['region'], ['stage'], []] }]) {
      expect(
        DatasetSelectionSchema.safeParse({ measures: ['revenue'], totals: t }).success,
        `totals ${JSON.stringify(t)} must still pass`,
      ).toBe(true);
    }
  });

  it('the two nested directives are closed too — an unknown key is named, not dropped', () => {
    expect(DatasetCompareToSchema.safeParse({ kind: 'previousPeriod', dimensoin: 'x' }).success).toBe(false);
    expect(DatasetTotalsSchema.safeParse({ groupings: [[]], grandTotal: true }).success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 — an unknown key is named, echoed and pointed somewhere
// ─────────────────────────────────────────────────────────────────────────────

describe('#17551 §4 — the selection is `.strict()`, like every other analytics door', () => {
  it('names the surface, echoes the key, and carries the history', () => {
    const text = refusalText({ measures: ['revenue'], totaIs: { groupings: [[]] } });
    expect(text).toContain('Unrecognized key(s) on this dataset selection');
    expect(text).toContain('`totaIs`');
    expect(text).toContain('enforced by nothing on the wire');
  });

  it('a member of the REQUEST BODY written one level too deep gets its wrong-layer pointer', () => {
    const text = refusalText({ measures: ['revenue'], datasetName: 'sales' });
    expect(text).toContain('one level up');
    expect(text).toContain('`{ dataset | datasetName, selection }`');
  });

  it('`cube` — the sibling body’s required member — is answered, not merely rejected', () => {
    const text = refusalText({ measures: ['revenue'], cube: 'opportunity' });
    expect(text).toContain('a dataset selection names no cube');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 — ⭐ the negative side: the whole shape still passes, unchanged
// ─────────────────────────────────────────────────────────────────────────────

describe('#17551 §5 — a valid selection still passes, and the parse adds nothing', () => {
  it('the fully-loaded eleven-member selection parses', () => {
    const parsed = DatasetSelectionSchema.safeParse(FULLY_LOADED);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('⭐ the parse output equals the input — no default, no transform', () => {
    // The route forwards the CALLER's object, never the parse output, and that
    // is only safe while this holds. A `.default()` added to any member later
    // turns this red instead of silently overriding the engine's own
    // resolution chain (the `timezone` rule #1982/#2018 records).
    expect(DatasetSelectionSchema.parse(FULLY_LOADED)).toEqual(FULLY_LOADED);
  });

  it('the minimal selection — `measures` alone — passes', () => {
    expect(DatasetSelectionSchema.safeParse({ measures: ['revenue'] }).success).toBe(true);
  });

  it('every in-repo selection specimen still passes', () => {
    // The same leniency sweep #17058 ran at the door, re-run against the WHOLE
    // schema: if any in-repo caller had been relying on the four undoored
    // members going unparsed, this is where it shows.
    const specimens: Array<Record<string, unknown>> = [
      { measures: ['account_count'], dimensions: ['bogus_dim'] },
      { measures: ['account_count'], runtimeFilter: { bogus_col: 'x' } },
      { dimensions: ['stage'], measures: ['revenue'], order: { profit: 'desc' } },
      { dimensions: ['stage'], measures: ['revenue'], totals: { groupings: [['region']] } },
      {
        dimensions: ['stage'],
        measures: ['revenue'],
        timeDimensions: [{ dimension: 'close_date', granularity: 'month' }],
        compareTo: { kind: 'previousPeriod' },
      },
      { measures: ['amount_sum'] },
      { measures: ['cnt'], timeDimensions: [{ dimension: 'issued', granularity: 'month' }] },
      // The five objectui call sites, as they build their selection today
      // (DatasetWidget, DatasetReportRenderer, DashboardFilterBar,
      // ObjectChart, DatasetPreview — measured at objectui @98178b2).
      { dimensions: ['region'], measures: ['revenue'], runtimeFilter: { region: 'NA' }, dateGranularity: 'month', order: { revenue: 'desc' }, limit: 20 },
      { dimensions: ['region'], measures: ['revenue'], totals: { groupings: [['region'], []] }, order: { revenue: 'asc' } },
      { dimensions: ['industry'], measures: ['option_count'], runtimeFilter: { is_active: true }, order: { industry: 'asc' }, limit: 1000 },
      { dimensions: [], measures: [] },
    ];
    for (const selection of specimens) {
      const parsed = DatasetSelectionSchema.safeParse(selection);
      expect(
        parsed.success,
        `specimen must still pass: ${JSON.stringify(selection)} — ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`,
      ).toBe(true);
    }
  });
});
