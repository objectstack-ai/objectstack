// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validatePresetComparands, FILTER_PRESET_COMPARAND } from './validate-preset-comparands';

describe('validatePresetComparands (#8793 — the ruled C half of #8690)', () => {
  it('returns nothing for an empty / absent stack', () => {
    expect(validatePresetComparands(undefined)).toEqual([]);
    expect(validatePresetComparands(null)).toEqual([]);
    expect(validatePresetComparands({})).toEqual([]);
  });

  // The exact measured defect shape from #8690: $gte "last_30_days" → 200 / 0.
  it('catches a bare preset under $gte in a dashboard widget filter, naming widget, path and fix', () => {
    const findings = validatePresetComparands({
      dashboards: [{
        name: 'sales',
        widgets: [{
          id: 'won_deals', type: 'metric', dataset: 'deals', values: ['total'],
          filter: { closed_at: { $gte: 'last_30_days' } },
        }],
      }],
    });
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(FILTER_PRESET_COMPARAND);
    expect(f.where).toBe('dashboard "sales" · widget "won_deals"');
    expect(f.path).toBe('dashboards[0].widgets[0].filter.closed_at.$gte');
    expect(f.message).toContain('last_30_days');
    expect(f.message).toContain('{30_days_ago}'); // the spelling that works
    expect(f.hint).toContain('{date-macro}');
  });

  it('judges all three authored filter shapes', () => {
    const findings = validatePresetComparands({
      views: [{
        name: 'recent',
        // Shape 2: view filter rules — ordering spelling, alias fold included.
        filter: [
          { field: 'created_at', operator: 'after', value: 'last_7_days' },
          { field: 'created_at', operator: 'gte', value: 'last_30_days' },
          { field: 'created_at', operator: 'between', value: ['last_90_days', '2026-01-01'] },
        ],
      }],
      pages: [{
        name: 'board',
        // Shape 3: triples — infix and alias spellings.
        components: [
          { type: 'list', filter: ['created_at', '>=', 'last_90_days'] },
          { type: 'list', filter: ['and', ['created_at', 'after', 'this_week'], ['status', '=', 'open']] },
        ],
      }],
      flows: [{
        name: 'sweep',
        // Shape 1: Mongo-style, on a flow CRUD node.
        nodes: [{ id: 'find', config: { filter: { updated_at: { $lt: 'last_month' } } } }],
      }],
    });
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual([
      'flows[0].nodes[0].config.filter.updated_at.$lt',
      'pages[0].components[0].filter[2]',
      'pages[0].components[1].filter[1][2]',
      'views[0].filter[0].value',
      'views[0].filter[1].value',
      'views[0].filter[2].value[0]',
    ].sort());
    for (const f of findings) expect(f.severity).toBe('error');
  });

  it('stays quiet on every legitimate spelling — the discriminating controls', () => {
    expect(validatePresetComparands({
      dashboards: [{
        name: 'ok',
        widgets: [{
          id: 'w', type: 'metric', dataset: 'd', values: ['v'],
          // The platform's own correct spellings in the SAME positions.
          filter: {
            closed_at: { $gte: '{30_days_ago}' },
            opened_at: { $between: ['{week_start}', '{week_end}'] },
            signed_at: { $lt: '2026-01-15' },
          },
        }],
      }],
      views: [{
        name: 'v',
        filter: [
          { field: 'closed_at', operator: 'after', value: '{30_days_ago}' },
          { field: 'closed_at', operator: 'after', value: '2026-01-15' },
          // Equality against a picklist value that collides with a preset
          // name is an author's own vocabulary — not this rule's business.
          { field: 'period', operator: 'equals', value: 'this_quarter' },
          { field: 'period', operator: 'in', value: ['last_30_days'] },
        ],
      }],
      pages: [{
        name: 'p',
        components: [
          { type: 'list', filter: ['closed_at', '>=', '{30_days_ago}'] },
          // Equality triple — not judged.
          { type: 'list', filter: ['period', '=', 'last_30_days'] },
        ],
      }],
      flows: [{
        name: 'f',
        nodes: [{
          id: 'n',
          config: {
            filter: {
              // Equality / membership — not judged (engine door owns the
              // temporal-field case, field type in hand).
              period: 'this_quarter',
              window: { $in: ['last_7_days'] },
              // Undeclared string — the field-typed engine door owns it.
              updated_at: { $gte: 'not-a-date-at-all' },
              // The empty-string cell stays its own card, by ruling.
              created_at: { $gte: '' },
            },
          },
        }],
      }],
    })).toEqual([]);
  });

  it('walks $and / $or / $not and nested relations in the Mongo shape', () => {
    const findings = validatePresetComparands({
      objects: [{
        name: 'deal',
        listViews: [{
          name: 'recent',
          filter: {
            $and: [{ $or: [{ closed_at: { $gte: 'last_7_days' } }] }],
            $not: { account: { created_at: { $lt: 'this_year' } } },
          },
        }],
      }],
    });
    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual([
      'objects[0].listViews[0].filter.$and[0].$or[0].closed_at.$gte',
      'objects[0].listViews[0].filter.$not.account.created_at.$lt',
    ].sort());
  });

  it('does not double-report a value the token rule already owns', () => {
    // `{last_30_days}` is a WRAPPED unknown token — validate-filter-tokens'
    // verdict (FILTER_TOKEN_UNKNOWN), not this rule's: a preset name carries
    // no braces, so the two vocabularies cannot collide on one value.
    expect(validatePresetComparands({
      dashboards: [{
        name: 'd',
        widgets: [{ id: 'w', type: 'metric', dataset: 'x', values: ['v'], filter: { closed_at: { $gte: '{last_30_days}' } } }],
      }],
    })).toEqual([]);
  });
});
