// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #19143 — the DATASET write door, which before this file dispatched NOTHING.
 *
 * ## The state this closes
 *
 * `DEFAULT_METADATA_TYPE_REGISTRY` declares `dataset` with
 * `allowRuntimeCreate: true` — Studio, REST `/meta` and an MCP/AI author may
 * all mint one at runtime. Measured on `origin/main` before this card: no rule
 * declared `dataset` in `runtimeTypes` (zero, against a lit control that
 * returned every other declared type) and `TYPE_TO_STACK_KEY` carried no
 * `dataset` row. The two absences were CONSISTENT rather than contradictory —
 * the gate filters by `runtimeTypes` before it consults the table — so nothing
 * was mis-wired and CI was green, correctly. What they summed to is that a
 * dataset write built no per-write snapshot and dispatched no rule at all,
 * while the rules that judge a dataset sat one wall away naming their own
 * failure mode as a surface that «renders successfully with empty or wrong
 * numbers».
 *
 * ADR-0049's 「声明即强制」 admits two resolutions, and which one applies is a
 * question of measurement, not preference: honour the declaration, or retire
 * it. Author-time rules for `dataset` DO exist — `validateDatasetReferences`
 * (#14105) and `validateDatasetMeasureAggregates` (#16354), plus
 * `validateObjectReferences`' `datasets[].object` rung — so the declaration is
 * honoured and this file is what proves the door reaches them.
 *
 * ## Why the controls are permanent
 *
 * The `seed: 'data'` note in `runtime-gate.ts` records the failure this file
 * exists to refuse: the wiring guard asks only that a declared type HAS a
 * mapping, never that the mapping names a key some rule READS. A `dataset` row
 * pointing at a collection nothing reads would keep every gate green and report
 * `rulesRun` while running on nothing. So every rule crossed here has a case
 * below that fires it THROUGH the real door, and the differential's fences have
 * their own.
 */
import { describe, expect, it } from 'vitest';

import { REFERENCE_INTEGRITY_RULES } from './reference-integrity-suite.js';
import {
  runRuntimeAuthoringRules,
  runtimeAuthoringRulesFor,
  runtimeGatedTypes,
  stackKeyForType,
} from './runtime-gate.js';

/**
 * The resolution universe every case below is judged against — one real object
 * whose field types are what the aggregate table is asked about.
 */
const OBJECTS = [
  {
    name: 'acme_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: {
      status: { type: 'select', label: 'Status' },
      region: { type: 'text', label: 'Region' },
      issued_on: { type: 'date', label: 'Issued' },
      total: { type: 'currency', label: 'Total' },
      account: { type: 'lookup', label: 'Account', reference: 'acme_account' },
    },
  },
  {
    name: 'acme_account',
    label: 'Account',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
  },
];

/** A dataset that every crossed rule passes — the shape the shipped corpus has. */
const cleanDataset = (over: Record<string, unknown> = {}) => ({
  name: 'acme_invoice_metrics',
  label: 'Invoice Metrics',
  object: 'acme_invoice',
  dimensions: [
    { name: 'status', field: 'status' },
    { name: 'region', field: 'region' },
    { name: 'issued_on', field: 'issued_on', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'invoice_count', aggregate: 'count' },
    { name: 'total_amount', aggregate: 'sum', field: 'total' },
  ],
  ...over,
});

/**
 * A stored sibling, clean under every crossed rule, so the differential's
 * baseline contributes nothing and every asserted finding is unambiguously this
 * write's own.
 */
const STORED_SIBLING = {
  name: 'acme_account_metrics',
  object: 'acme_account',
  dimensions: [{ name: 'name', field: 'name' }],
  measures: [{ name: 'account_count', aggregate: 'count' }],
};

const gateDataset = (
  item: unknown,
  context: object = { objects: OBJECTS, datasets: [STORED_SIBLING] },
) => runRuntimeAuthoringRules({ type: 'dataset', item, context });

/** The one error the write ADDED, asserted with its full 422 envelope keys. */
const expectRefusal = (item: unknown, rule: string) => {
  const result = gateDataset(item);
  const ids = result.errors.map((f) => f.rule);
  const f = result.errors.find((e) => e.rule === rule);
  expect(f, `expected [${rule}] among added errors, got: ${JSON.stringify(ids)}`).toBeDefined();
  // The 422 envelope's four keys (#4463 D3): the caller turns `errors` into
  // `err.issues` verbatim, so a finding without them is a refusal an author
  // cannot act on.
  expect(f!.severity).toBe('error');
  expect((f!.path ?? '').length).toBeGreaterThan(0);
  expect((f!.where ?? '').length).toBeGreaterThan(0);
  expect((f!.message ?? '').length).toBeGreaterThan(10);
  return result;
};

describe('the dataset write door is wired at all (#19143)', () => {
  it('declares, maps, and dispatches — the three legs the card measured as absent', () => {
    // Leg 2a's zero, inverted: some rule now declares the type.
    expect(runtimeGatedTypes()).toContain('dataset');
    // Leg 2b's missing row. ⛔ Without it the gate finds the rules, builds no
    // snapshot and returns clean — wired, enforcing nothing.
    expect(stackKeyForType('dataset')).toBe('datasets');
    // Exact, in registry order. "Clean" and "nothing ran" must stay
    // distinguishable, and a rule silently joining or leaving this door is
    // precisely the drift this pin exists to catch.
    expect(runtimeAuthoringRulesFor('dataset').map((r) => r.name)).toEqual([
      'validateDatasetMeasureAggregates',
      'validateReferenceIntegrity',
    ]);
  });

  it('the suite dispatches exactly the two members that judge a dataset', () => {
    // The suite's own finer axis (#9313). The entry arriving says nothing about
    // WHICH members judge the snapshot, and a member resolving against a
    // collection the snapshot does not carry would report every reference into
    // it as dead rather than going quiet.
    const members = REFERENCE_INTEGRITY_RULES.filter((r) =>
      (r.runtimeTypes ?? ['flow']).includes('dataset'),
    ).map((r) => r.name);

    expect(members).toEqual(['validateObjectReferences', 'validateDatasetReferences']);
  });

  it('⛔ the mapping is not wired onto nothing — the rules READ `datasets`', () => {
    // The `seed: 'data'` lesson made mechanical. A mapping onto a key no rule
    // reads keeps every gate green and reports `rulesRun` while running on
    // nothing, so the proof has to be a REFUSAL produced from the mapped
    // collection, not the presence of a row. This case is the minimal one: the
    // written item reaches a rule at all.
    const clean = gateDataset(cleanDataset());
    expect(clean.rulesRun).toEqual([
      'validateDatasetMeasureAggregates',
      'validateReferenceIntegrity',
    ]);
    expect(clean.errors).toEqual([]);

    const refused = gateDataset(
      cleanDataset({ dimensions: [{ name: 'region', field: 'no_such_column_xyz' }] }),
    );
    expect(
      refused.errors.map((f) => f.rule),
      'the same door, the same snapshot, one changed field — a mapping onto a ' +
        'collection nothing reads cannot produce this',
    ).toContain('dataset-field-unknown');
  });
});

describe('the door refuses each crossed rule s own defect (#19143)', () => {
  it('⭐ LIT — a dimension bound to a column that does not exist', () => {
    const result = expectRefusal(
      cleanDataset({ dimensions: [{ name: 'region', field: 'no_such_column_xyz' }] }),
      'dataset-field-unknown',
    );
    const f = result.errors.find((e) => e.rule === 'dataset-field-unknown')!;
    expect(f.message).toMatch(/no_such_column_xyz/);
  });

  it('⭐ LIT — a measure bound to a column that does not exist', () => {
    expectRefusal(
      cleanDataset({
        measures: [{ name: 'total_amount', aggregate: 'sum', field: 'no_such_column_xyz' }],
      }),
      'dataset-field-unknown',
    );
  });

  it('⭐ LIT — a measure filter KEY that does not exist', () => {
    expectRefusal(
      cleanDataset({
        measures: [
          {
            name: 'total_amount',
            aggregate: 'sum',
            field: 'total',
            filter: { no_such_column_xyz: 'paid' },
          },
        ],
      }),
      'dataset-filter-field-unknown',
    );
  });

  it('⭐ LIT — an `include[]` entry that names no relationship', () => {
    expectRefusal(
      cleanDataset({ include: ['no_such_relationship_xyz'] }),
      'dataset-include-unknown',
    );
  });

  it('⭐ LIT — an aggregate the field type cannot carry (#16354)', () => {
    // `sum` over a `text` column. The compile leg refuses this pair with
    // `400 DATASET_INVALID` when a query is built; this is the same fix made
    // while the author still has the document open — and it is the rule whose
    // own registry entry named this card as what held it off the door.
    const result = expectRefusal(
      cleanDataset({
        measures: [{ name: 'region_total', aggregate: 'sum', field: 'region' }],
      }),
      'measure-aggregate-field-type-refused',
    );
    expect(result.rulesRun).toContain('validateDatasetMeasureAggregates');
  });

  it('⭐ LIT — a base object that resolves to nothing (the split-off rung)', () => {
    // `validateObjectReferences` owns this one rather than
    // `validateDatasetReferences`, because the reference is an object NAME and
    // needs the curated platform ladder. Crossing one member without the other
    // is the #7220 split this pin refuses: an author refused for a dangling
    // dimension and waved through for a dangling base object cannot predict
    // the door.
    expectRefusal(
      cleanDataset({ object: 'no_such_object_xyz', dimensions: [], measures: [] }),
      'object-reference-unknown',
    );
  });
});

describe('the door s fences hold on a dataset write (#4463 D4)', () => {
  it('does not charge this write for a STORED dataset s pre-existing defect', () => {
    // The differential's whole purpose. A tenant's stored dataset may already
    // violate a rule that did not exist when it was written, and the read path
    // must keep serving it — gating on the absolute finding set would make an
    // unrelated legacy row block every future save.
    const brokenStored = {
      name: 'acme_legacy_metrics',
      object: 'acme_invoice',
      dimensions: [{ name: 'region', field: 'long_gone_column' }],
      measures: [{ name: 'c', aggregate: 'count' }],
    };

    const result = runRuntimeAuthoringRules({
      type: 'dataset',
      item: cleanDataset(),
      context: { objects: OBJECTS, datasets: [brokenStored] },
    });

    expect(
      result.errors,
      "a stored dataset's pre-existing condition must cancel in the differential — " +
        'surfacing it here would refuse a clean publish for somebody else\'s row',
    ).toEqual([]);
    // Non-vacuous: the same broken row IS refused when it is the write.
    expect(
      gateDataset(brokenStored).errors.map((f) => f.rule),
    ).toContain('dataset-field-unknown');
  });

  it('an UPDATE replaces its stored self rather than appearing beside it', () => {
    // Replace-not-erase (`buildRuntimeWriteSnapshots`). Without it an update
    // reads as a second dataset of the same name, and every finding the stored
    // copy carries would be charged to the write that fixed it.
    const stored = {
      name: 'acme_invoice_metrics',
      object: 'acme_invoice',
      dimensions: [{ name: 'region', field: 'long_gone_column' }],
      measures: [{ name: 'c', aggregate: 'count' }],
    };

    const fixed = runRuntimeAuthoringRules({
      type: 'dataset',
      item: cleanDataset(),
      context: { objects: OBJECTS, datasets: [stored] },
    });

    expect(
      fixed.errors,
      'republishing a dataset under its own name with the defect REMOVED must be clean',
    ).toEqual([]);
  });

  it('[#10064] a finding leaving the gate keys the collection entry by NAME', () => {
    // The wire shape. `datasets[3]` is an offset into this gate's private
    // snapshot — an in-memory array the caller has never seen and cannot
    // enumerate. Mapping the `dataset` type is exactly what pulled `datasets`
    // into the derived name-keyed set, so this assertion is the visible half of
    // that derivation (`runtime-gate.derived-name-keys.test.ts` holds the
    // other).
    const result = gateDataset(
      cleanDataset({ dimensions: [{ name: 'region', field: 'no_such_column_xyz' }] }),
    );
    const f = result.errors.find((e) => e.rule === 'dataset-field-unknown')!;

    expect(f.path).toBe('datasets.acme_invoice_metrics.dimensions[0].field');
    // Nested positions stay positional on purpose: within one named item they
    // index the author's own document, which the receiver holds.
    expect(f.path).not.toMatch(/^datasets\[\d+\]/);
  });

  it('DARK — the rules that read `datasets` only as CONTEXT do not run here', () => {
    // `validateWidgetBindings` / `validateChartBindings` resolve a
    // PRESENTATION's binding against the dataset universe. On a dataset write
    // there is no board and no chart, so crossing them would be coverage that
    // reads as coverage and judges nothing. They keep their own doors.
    const names = runtimeAuthoringRulesFor('dataset').map((r) => r.name);
    expect(names).not.toContain('validateWidgetBindings');
    expect(names).not.toContain('validateChartBindings');
  });

  it('DARK — mapping `dataset` did not widen any OTHER type s roster', () => {
    // The card is one metadata type. A `dashboard` write reaching the dataset
    // existence rules would be the differential re-judging a stored dataset,
    // which #4463 D4 cancels — wired, and enforcing nothing.
    for (const type of runtimeGatedTypes().filter((t) => t !== 'dataset')) {
      expect(
        runtimeAuthoringRulesFor(type).map((r) => r.name),
        `'${type}' writes must not reach the dataset-only rule`,
      ).not.toContain('validateDatasetMeasureAggregates');
    }
  });
});

describe('the shipped dataset corpus stays publishable (#19143)', () => {
  // The false-positive measurement made permanent. A refusal widening whose
  // population was never measured is how a door stops being usable; these are
  // the shipped declarations, lifted verbatim from the example apps, pushed
  // through the real door with their own objects as context.
  it('examples/app-crm `opportunity_metrics` publishes clean', () => {
    const objects = [
      {
        name: 'crm_opportunity',
        sharingModel: 'private',
        fields: {
          stage: { type: 'select', label: 'Stage' },
          account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
          close_date: { type: 'date', label: 'Close Date' },
          amount: { type: 'currency', label: 'Amount' },
        },
      },
    ];
    const item = {
      name: 'opportunity_metrics',
      object: 'crm_opportunity',
      dimensions: [
        { name: 'stage', field: 'stage', type: 'string' },
        { name: 'account', field: 'account', type: 'lookup' },
        { name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'month' },
      ],
      measures: [
        { name: 'opp_count', aggregate: 'count' },
        { name: 'total_amount', aggregate: 'sum', field: 'amount' },
        { name: 'avg_amount', aggregate: 'avg', field: 'amount' },
      ],
    };

    const result = runRuntimeAuthoringRules({ type: 'dataset', item, context: { objects } });
    expect(result.errors).toEqual([]);
    expect(result.advisories).toEqual([]);
    // ⭐ The zero is a fact about the corpus AND about the door: the same call
    // with one field path broken is refused, so the clean reading is not a
    // harness that looked at nothing.
    expect(
      runRuntimeAuthoringRules({
        type: 'dataset',
        item: { ...item, dimensions: [{ name: 'stage', field: 'no_such_column_xyz' }] },
        context: { objects },
      }).errors.map((f) => f.rule),
    ).toContain('dataset-field-unknown');
  });
});
