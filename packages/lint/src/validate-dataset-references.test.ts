// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateDatasetReferences,
  DATASET_INCLUDE_UNKNOWN,
  DATASET_FIELD_UNKNOWN,
  DATASET_FIELD_NOT_INCLUDED,
  DATASET_FILTER_FIELD_UNKNOWN,
} from './validate-dataset-references.js';

/**
 * The object graph every case below resolves against. Deliberately a real
 * two-hop chain — `duly_task › duty (lookup) › duly_duty › owner (lookup) ›
 * sys_user` — because the ADR-0071 multi-hop path is where a resolver that
 * only ever looks at the base object passes everything it should catch.
 */
const objects = [
  {
    name: 'duly_task',
    fields: {
      period_key: { type: 'text', label: 'Period' },
      last_update_at: { type: 'datetime', label: 'Last Update' },
      amount: { type: 'currency', label: 'Amount' },
      status: { type: 'select', label: 'Status' },
      duty: { type: 'lookup', label: 'Duty', reference: 'duly_duty' },
    },
  },
  {
    name: 'duly_duty',
    fields: {
      frequency: { type: 'select', label: 'Frequency' },
      owner: { type: 'lookup', label: 'Owner', reference: 'duly_person' },
    },
  },
  {
    name: 'duly_person',
    fields: { region: { type: 'text', label: 'Region' } },
  },
];

/** One dataset over `duly_task`, with whatever the case under test declares. */
const stackWith = (dataset: Record<string, unknown>) => ({
  objects,
  datasets: [{ name: 'duly_health', label: 'Duty Health', object: 'duly_task', ...dataset }],
});

const rules = (stack: Record<string, unknown>) =>
  validateDatasetReferences(stack).map((f) => f.rule);

// ── The measured matrix (#14105) ─────────────────────────────────────────────
//
// Each row is one mutation the card measured on published 17.2.0, where
// `objectstack validate` exited 0 with "Validation passed". The clean spelling
// is asserted beside every one of them, because a rule that reports the typo
// AND the correct spelling has not narrowed the accept set, it has broken it.

describe('validateDatasetReferences — the six shapes that validated clean before', () => {
  it('refuses a dimension bound to a base field that does not exist', () => {
    const findings = validateDatasetReferences(
      stackWith({ dimensions: [{ name: 'period', field: 'period_kee' }], measures: [] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_FIELD_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('datasets[0].dimensions[0].field');
    expect(findings[0].where).toBe('dataset "duly_health" › dimension "period"');
    // The platform's message shape — the resolver knows the near miss.
    expect(findings[0].message).toContain('Did you mean "period_key"?');
  });

  it('accepts the same dimension spelled correctly', () => {
    expect(
      rules(stackWith({ dimensions: [{ name: 'period', field: 'period_key' }], measures: [] })),
    ).toEqual([]);
  });

  it('refuses a dimension bound to a JOINED field that does not exist', () => {
    const findings = validateDatasetReferences(
      stackWith({
        include: ['duty'],
        dimensions: [{ name: 'freq', field: 'duty.frequenci' }],
        measures: [],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_FIELD_UNKNOWN);
    // Resolved on the JOINED object, not the base one — the whole point of the
    // hop walk. A resolver that only knew `duly_task` would have reported this
    // path against the wrong object, or not at all.
    expect(findings[0].message).toContain('object "duly_duty"');
    expect(findings[0].message).toContain('Did you mean "frequency"?');
  });

  it('accepts a two-hop path when every hop and the leaf resolve', () => {
    expect(
      rules(
        stackWith({
          include: ['duty.owner'],
          dimensions: [{ name: 'region', field: 'duty.owner.region' }],
          measures: [],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses a measure bound to a field that does not exist', () => {
    const findings = validateDatasetReferences(
      stackWith({
        dimensions: [],
        measures: [{ name: 'freshness', aggregate: 'max', field: 'last_update_att' }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_FIELD_UNKNOWN);
    expect(findings[0].path).toBe('datasets[0].measures[0].field');
    expect(findings[0].where).toBe('dataset "duly_health" › measure "freshness"');
  });

  it('refuses a measure FILTER KEY that does not exist — the value half already gated', () => {
    const findings = validateDatasetReferences(
      stackWith({
        dimensions: [],
        measures: [
          {
            name: 'stale',
            aggregate: 'count',
            filter: { last_update_attt: { $lt: '{7_days_ago}' } },
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_FILTER_FIELD_UNKNOWN);
    // The exact position `filter-token-unknown` already reaches for the VALUE.
    expect(findings[0].path).toBe('datasets[0].measures[0].filter.last_update_attt');
    expect(findings[0].message).toContain('Did you mean "last_update_at"?');
  });

  it('accepts the same measure filter spelled correctly', () => {
    expect(
      rules(
        stackWith({
          dimensions: [],
          measures: [
            { name: 'stale', aggregate: 'count', filter: { last_update_at: { $lt: '{7_days_ago}' } } },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses an include[] entry naming a relationship that does not exist', () => {
    const findings = validateDatasetReferences(
      stackWith({ include: ['dutee'], dimensions: [], measures: [] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_INCLUDE_UNKNOWN);
    expect(findings[0].path).toBe('datasets[0].include[0]');
    expect(findings[0].message).toContain('Did you mean "duty"?');
  });

  it('leaves the base object to validate-object-references and reports nothing itself', () => {
    // Row 6 of the measured matrix. `object: 'duly_tsk'` is judged by the
    // object-name ladder (`object-reference-unknown`), and THIS rule must go
    // silent so one typo does not yield one finding per dimension, measure and
    // filter key.
    expect(
      validateDatasetReferences({
        objects,
        datasets: [
          {
            name: 'duly_health',
            object: 'duly_tsk',
            include: ['duty'],
            dimensions: [{ name: 'period', field: 'period_key' }],
            measures: [{ name: 'n', aggregate: 'count', field: 'amount' }],
          },
        ],
      }),
    ).toEqual([]);
  });
});

// ── The second real check the card names: declared joinability ───────────────

describe('validateDatasetReferences — ADR-0021 joins only DECLARED paths', () => {
  it('refuses a resolvable dotted path whose prefix is not in include', () => {
    const findings = validateDatasetReferences(
      stackWith({ dimensions: [{ name: 'freq', field: 'duty.frequency' }], measures: [] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_FIELD_NOT_INCLUDED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('"duty" is not declared');
    expect(findings[0].hint).toContain('Add "duty" to include');
  });

  it('accepts an intermediate hop implied by a longer declared path', () => {
    // ADR-0021: declaring `a.b` implicitly includes `a`. So `duty.frequency` is
    // joinable on the strength of `include: ['duty.owner']` alone.
    expect(
      rules(
        stackWith({
          include: ['duty.owner'],
          dimensions: [{ name: 'freq', field: 'duty.frequency' }],
          measures: [],
        }),
      ),
    ).toEqual([]);
  });

  it('never asks the include question of a BASE field', () => {
    expect(
      rules(stackWith({ dimensions: [{ name: 'amt', field: 'amount' }], measures: [] })),
    ).toEqual([]);
  });

  it('reports existence, not joinability, when the path also fails to resolve', () => {
    // Both defects are present (`nope` is neither declared in `include` nor a
    // real relationship). Exactly ONE finding, and it is the one carrying the
    // "did you mean" — a position that reports twice teaches the wrong fix.
    const findings = validateDatasetReferences(
      stackWith({ dimensions: [{ name: 'x', field: 'nope.frequency' }], measures: [] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_FIELD_UNKNOWN);
  });
});

// ── include[] that resolves but cannot be joined through ─────────────────────

describe('validateDatasetReferences — include[] must name a RELATIONSHIP', () => {
  it('refuses an include entry naming an ordinary field', () => {
    const findings = validateDatasetReferences(
      stackWith({ include: ['status'], dimensions: [], measures: [] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_INCLUDE_UNKNOWN);
    expect(findings[0].message).toContain('`select` field');
    expect(findings[0].message).toContain('not a relationship');
  });

  it('accepts an include entry naming a lookup', () => {
    expect(rules(stackWith({ include: ['duty'], dimensions: [], measures: [] }))).toEqual([]);
  });

  it('refuses a multi-hop include whose intermediate hop is not traversable', () => {
    const findings = validateDatasetReferences(
      stackWith({ include: ['status.owner'], dimensions: [], measures: [] }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(DATASET_INCLUDE_UNKNOWN);
    expect(findings[0].message).toContain('nothing to join through');
  });
});

// ── All three authored filter shapes ─────────────────────────────────────────
//
// #3574's own failure mode was a resolver that handled ONE filter shape. The
// key half is walked by the shared `walkFilterFieldKeys`, and these pin that a
// filter authored any of the three ways is judged.

describe('validateDatasetReferences — filter keys in every authored shape', () => {
  const withFilter = (filter: unknown) =>
    validateDatasetReferences(stackWith({ dimensions: [], measures: [], filter }));

  it('reads the Mongo condition object', () => {
    expect(withFilter({ nope: 'x' }).map((f) => f.rule)).toEqual([DATASET_FILTER_FIELD_UNKNOWN]);
    expect(withFilter({ status: 'open' })).toEqual([]);
  });

  it('descends $and / $or / $not arms', () => {
    const findings = withFilter({ $and: [{ status: 'open' }, { $not: { nope: 1 } }] });
    expect(findings.map((f) => f.rule)).toEqual([DATASET_FILTER_FIELD_UNKNOWN]);
    expect(findings[0].path).toBe('datasets[0].filter.$and[1].$not.nope');
  });

  it('reads the { field, operator, value } rule shape', () => {
    const findings = withFilter([{ field: 'nope', operator: 'equals', value: 1 }]);
    expect(findings.map((f) => f.rule)).toEqual([DATASET_FILTER_FIELD_UNKNOWN]);
    expect(findings[0].path).toBe('datasets[0].filter[0].field');
    expect(withFilter([{ field: 'status', operator: 'equals', value: 'open' }])).toEqual([]);
  });

  it('reads the [field, op, value] triple shape', () => {
    const findings = withFilter([['nope', '=', 1]]);
    expect(findings.map((f) => f.rule)).toEqual([DATASET_FILTER_FIELD_UNKNOWN]);
    expect(findings[0].path).toBe('datasets[0].filter[0][0]');
    expect(withFilter([['status', '=', 'open']])).toEqual([]);
  });

  it('composes a nested condition object into one relationship path', () => {
    // `{ duty: { frequency: … } }` is deep equality through a relationship, so
    // the field position is `duty.frequency` — NOT a bare `frequency`, which
    // would resolve against the wrong object and report a phantom miss.
    expect(
      validateDatasetReferences(
        stackWith({
          include: ['duty'],
          dimensions: [],
          measures: [],
          filter: { duty: { frequency: 'daily' } },
        }),
      ),
    ).toEqual([]);
    const findings = validateDatasetReferences(
      stackWith({
        include: ['duty'],
        dimensions: [],
        measures: [],
        filter: { duty: { frequenci: 'daily' } },
      }),
    );
    expect(findings.map((f) => f.rule)).toEqual([DATASET_FILTER_FIELD_UNKNOWN]);
    expect(findings[0].path).toBe('datasets[0].filter.duty.frequenci');
  });

  it('does not judge the operand shape of an unrecognised $ operator', () => {
    expect(withFilter({ $weird: { nope: 1 } })).toEqual([]);
  });
});

// ── The skips: never report what the graph cannot answer (ADR-0072 D1) ───────

describe('validateDatasetReferences — the three skips', () => {
  it('skips a dataset over an object this stack does not define', () => {
    // The live case: the platform ships five datasets over `sys_*` objects that
    // live in plugin-audit and the cloud runtime.
    expect(
      validateDatasetReferences({
        objects,
        datasets: [
          {
            name: 'sys_audit_log_metrics',
            object: 'sys_audit_log',
            dimensions: [{ name: 'action', field: 'action' }],
            measures: [{ name: 'event_count', aggregate: 'count' }],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('skips an object that declares no readable field map', () => {
    expect(
      validateDatasetReferences({
        objects: [{ name: 'ext_customer', datasource: 'remote' }],
        datasets: [
          {
            name: 'ext_metrics',
            object: 'ext_customer',
            dimensions: [{ name: 'region', field: 'region' }],
            measures: [],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('skips a registry-injected system column', () => {
    // The live case: `showcase_task_metrics` groups by `created_at`, a real
    // runtime column that appears in no authored `fields`.
    expect(
      rules(
        stackWith({
          dimensions: [{ name: 'created', field: 'created_at', dateGranularity: 'month' }],
          measures: [],
        }),
      ),
    ).toEqual([]);
  });

  it('skips a hop THROUGH an injected column, whose target is registry-owned', () => {
    // `owner_id` IS injected on this object (`ownership` omitted ⇒ both anchors)
    // and IS a lookup at the registry — but its type and target are invisible
    // here, so `owner_id.name` is unanswerable rather than a miss. Reporting it
    // would be the false positive skip 3 exists to avoid; assuming it resolves
    // would be the fail-open on the other side.
    expect(rules(stackWith({ dimensions: [{ name: 'o', field: 'owner_id.name' }], measures: [] }))).toEqual([]);
  });

  it('skips a relationship field that declares no reference target', () => {
    expect(
      validateDatasetReferences({
        objects: [
          { name: 'a', fields: { rel: { type: 'lookup', label: 'Rel' }, n: { type: 'text', label: 'N' } } },
        ],
        datasets: [
          { name: 'm', object: 'a', include: ['rel'], dimensions: [{ name: 'x', field: 'rel.anything' }], measures: [] },
        ],
      }),
    ).toEqual([]);
  });
});

// ── Positions that carry no reference at all ─────────────────────────────────

describe('validateDatasetReferences — shapes with nothing to resolve', () => {
  it('accepts a count(*) measure with no field', () => {
    expect(rules(stackWith({ dimensions: [], measures: [{ name: 'n', aggregate: 'count' }] }))).toEqual([]);
  });

  it('accepts a derived measure, whose refs are measure names the schema owns', () => {
    expect(
      rules(
        stackWith({
          dimensions: [],
          measures: [
            { name: 'a', aggregate: 'count' },
            { name: 'b', aggregate: 'count' },
            { name: 'r', derived: { op: 'ratio', of: ['a', 'b'] } },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('returns nothing for a stack with no datasets, and for an empty stack', () => {
    expect(validateDatasetReferences({ objects })).toEqual([]);
    expect(validateDatasetReferences({})).toEqual([]);
  });

  it('reads the name-keyed collection shape as well as the array shape', () => {
    const findings = validateDatasetReferences({
      objects: { duly_task: { fields: { amount: { type: 'currency', label: 'Amount' } } } },
      datasets: { duly_health: { object: 'duly_task', dimensions: [{ name: 'x', field: 'amoun' }], measures: [] } },
    });
    expect(findings.map((f) => f.rule)).toEqual([DATASET_FIELD_UNKNOWN]);
    expect(findings[0].where).toBe('dataset "duly_health" › dimension "x"');
  });

  it('carries the common finding shape on every finding', () => {
    const findings = validateDatasetReferences(
      stackWith({
        include: ['dutee'],
        dimensions: [{ name: 'd', field: 'nope' }],
        measures: [{ name: 'm', aggregate: 'sum', field: 'nope2', filter: { nope3: 1 } }],
      }),
    );
    expect(findings.length).toBe(4);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(typeof f.rule).toBe('string');
      expect(f.where.startsWith('dataset "duly_health"')).toBe(true);
      expect(f.path.startsWith('datasets[0]')).toBe(true);
      expect(f.message.length).toBeGreaterThan(0);
      expect(f.hint.length).toBeGreaterThan(0);
    }
  });
});

// ── The shipped corpus stays clean ───────────────────────────────────────────

describe('validateDatasetReferences — the shipped dataset shapes', () => {
  it('is silent on the app-crm opportunity dataset, verbatim', () => {
    expect(
      validateDatasetReferences({
        objects: [
          {
            name: 'crm_opportunity',
            fields: {
              stage: { type: 'select', label: 'Stage' },
              account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
              close_date: { type: 'date', label: 'Close Date' },
              amount: { type: 'currency', label: 'Amount' },
            },
          },
        ],
        datasets: [
          {
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
          },
        ],
      }),
    ).toEqual([]);
  });

  it('is silent on the showcase invoice dataset, whose measure filter is a real key', () => {
    expect(
      validateDatasetReferences({
        objects: [
          {
            name: 'showcase_invoice',
            fields: {
              status: { type: 'select', label: 'Status' },
              region: { type: 'text', label: 'Region' },
              issued_on: { type: 'date', label: 'Issued' },
              account: { type: 'lookup', label: 'Account', reference: 'showcase_account' },
              total: { type: 'currency', label: 'Total' },
            },
          },
        ],
        datasets: [
          {
            name: 'showcase_invoice_metrics',
            object: 'showcase_invoice',
            dimensions: [
              { name: 'status', field: 'status' },
              { name: 'region', field: 'region' },
              { name: 'issued_on', field: 'issued_on', dateGranularity: 'month' },
              { name: 'account', field: 'account' },
            ],
            measures: [
              { name: 'invoice_count', aggregate: 'count' },
              { name: 'subtotal_sum', aggregate: 'sum', field: 'total' },
              { name: 'paid_count', aggregate: 'count', filter: { status: 'paid' } },
              { name: 'paid_rate', derived: { op: 'ratio', of: ['paid_count', 'invoice_count'] } },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });
});
