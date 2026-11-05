// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { REPORT_FILTER_FIELD_UNKNOWN, validateReportRuntimeFilters } from './validate-report-runtime-filter.js';
import { WIDGET_FILTER_FIELD_UNKNOWN, validateWidgetBindings } from './validate-widget-bindings.js';

/**
 * [#29900] The card's shape: an object `orch_item` (`name`, `status`, `hours`),
 * a dataset over it with a dimension named apart from its field, a related
 * object reached through a declared `include`, and one report.
 */
function stack(reportOverrides: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return {
    objects: [
      {
        name: 'orch_item',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'status', type: 'text' },
          { name: 'hours', type: 'number' },
          { name: 'owner', type: 'lookup', reference: 'orch_user' },
        ],
      },
      { name: 'orch_user', fields: [{ name: 'region', type: 'text' }] },
    ],
    datasets: [{
      name: 'orch_ds2',
      object: 'orch_item',
      include: ['owner'],
      dimensions: [{ name: 'state', field: 'status' }],
      measures: [{ name: 'hours_sum', aggregate: 'sum', field: 'hours' }],
    }],
    reports: [{
      name: 'orch_r5',
      label: 'Bad',
      type: 'summary',
      dataset: 'orch_ds2',
      values: ['hours_sum'],
      rows: ['state'],
      ...reportOverrides,
    }],
    ...extra,
  };
}

const run = (s: Record<string, unknown>) => validateReportRuntimeFilters(s);

describe('report-filter-field-unknown (#29900)', () => {
  it('errors on the card\'s repro, at the key\'s path, with the twin\'s verdict', () => {
    const findings = run(stack({ runtimeFilter: { no_such_field: 'x' } }));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(REPORT_FILTER_FIELD_UNKNOWN);
    expect(f.severity).toBe('error');
    expect(f.path).toBe('reports[0].runtimeFilter.no_such_field');
    expect(f.where).toBe('report "orch_r5"');
    expect(f.message).toContain('no_such_field');
    expect(f.message).toContain('orch_item');
  });

  it('carries the verdict\'s "Did you mean"', () => {
    const [f] = run(stack({ runtimeFilter: { statsu: 'open' } }));
    expect(f.message).toContain('Did you mean "status"?');
  });

  it('is silent on a real field key', () => {
    expect(run(stack({ runtimeFilter: { status: 'open' } }))).toEqual([]);
  });

  it('accepts a bare key naming a dimension of the dataset', () => {
    expect(run(stack({ runtimeFilter: { state: 'open' } }))).toEqual([]);
  });

  it('accepts a registry-injected system column and walks `$` combinators', () => {
    expect(run(stack({
      runtimeFilter: { $or: [{ created_at: { $gte: '{today}' } }, { $not: { hours: { $gt: 3 } } }] },
    }))).toEqual([]);
    const findings = run(stack({ runtimeFilter: { $and: [{ status: 'open' }, { $not: { bogus: 1 } }] } }));
    expect(findings.map((f) => f.path)).toEqual(['reports[0].runtimeFilter.$and[1].$not.bogus']);
  });

  it('resolves a dotted relationship path, and reports a dangling leaf on the joined object', () => {
    expect(run(stack({ runtimeFilter: { 'owner.region': 'emea' } }))).toEqual([]);
    const findings = run(stack({ runtimeFilter: { 'owner.regionn': 'emea' } }));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('orch_user');
  });

  it('judges a joined report: each block\'s own filter, and the container filter per block', () => {
    const s = stack({
      type: 'joined',
      dataset: undefined,
      rows: undefined,
      values: undefined,
      runtimeFilter: { nope: 1 },
      blocks: [
        { name: 'b1', type: 'summary', dataset: 'orch_ds2', values: ['hours_sum'], runtimeFilter: { also_nope: 1 } },
        { name: 'b2', type: 'tabular', dataset: 'orch_ds2', runtimeFilter: { status: 'open' } },
      ],
    });
    expect(run(s).map((f) => [f.where, f.path])).toEqual([
      ['report "orch_r5" · block "b1"', 'reports[0].runtimeFilter.nope'],
      ['report "orch_r5" · block "b1"', 'reports[0].blocks[0].runtimeFilter.also_nope'],
      ['report "orch_r5" · block "b2"', 'reports[0].runtimeFilter.nope'],
    ]);
  });

  it('takes the skips: an unknown dataset, an object the stack does not define, no field map', () => {
    expect(run(stack({ dataset: 'no_such_ds', runtimeFilter: { nope: 1 } }))).toEqual([]);
    const missing = stack({ runtimeFilter: { nope: 1 } });
    missing.objects = missing.objects.filter((o) => o.name !== 'orch_item');
    expect(run(missing)).toEqual([]);
    const fieldless = stack({ runtimeFilter: { nope: 1 } });
    delete (fieldless.objects[0] as { fields?: unknown }).fields;
    expect(run(fieldless)).toEqual([]);
  });

  it('does not report the not-included clause (the widget twin\'s second id is not this rule\'s)', () => {
    const s = stack({ runtimeFilter: { 'owner.region': 'emea' } });
    (s.datasets[0] as { include?: unknown }).include = [];
    expect(run(s)).toEqual([]);
  });

  it('refuses a bare key naming a measure, with its own message (#30006)', () => {
    const findings = run(stack({ runtimeFilter: { hours_sum: { $gt: 10 } } }));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.rule).toBe(REPORT_FILTER_FIELD_UNKNOWN);
    expect(f.path).toBe('reports[0].runtimeFilter.hours_sum');
    expect(f.message).toContain('names a measure of dataset "orch_ds2"');
    expect(f.hint).toContain('key the filter by the field "hours"');
  });

  it('accepts what the dashboard twin accepts on the same dataset, and refuses what it refuses', () => {
    // [#30006] One accept set: the dimension key and the measure key are in the
    // list, and the two rules answer them alike.
    const keys = [
      'status', 'created_at', 'owner.region', 'state',
      'no_such_field', 'owner.regionn', 'hours.total', 'hours_sum',
    ];
    for (const key of keys) {
      const s = stack({ runtimeFilter: { [key]: 1 } }, {
        dashboards: [{ name: 'd', widgets: [{ id: 'w', type: 'metric', dataset: 'orch_ds2', values: ['hours_sum'], filter: { [key]: 1 } }] }],
      });
      const twin = validateWidgetBindings(s).filter((f) => f.rule === WIDGET_FILTER_FIELD_UNKNOWN).length;
      expect(run(s).length, key).toBe(twin);
    }
  });
});

describe('#29900 — the rule gates `validate` and `build`', () => {
  for (const command of ['validate', 'build'] as const) {
    it(`an unknown key fails \`${command}\`; a field key and a dimension key pass`, () => {
      const bad = splitBySeverity(runAuthoringRules(command, { normalized: stack({ runtimeFilter: { no_such_field: 'x' } }) }));
      expect(bad.errors.map((f) => f.rule)).toContain(REPORT_FILTER_FIELD_UNKNOWN);
      const good = splitBySeverity(runAuthoringRules(command, { normalized: stack({ runtimeFilter: { status: 'open', state: 'open' } }) }));
      expect(good.errors.filter((f) => f.rule === REPORT_FILTER_FIELD_UNKNOWN)).toEqual([]);
    });
  }
});
