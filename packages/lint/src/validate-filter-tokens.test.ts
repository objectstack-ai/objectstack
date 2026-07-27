// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validateFilterTokens, FILTER_TOKEN_UNKNOWN } from './validate-filter-tokens';

describe('validateFilterTokens', () => {
  it('returns nothing for an empty / absent stack', () => {
    expect(validateFilterTokens(undefined)).toEqual([]);
    expect(validateFilterTokens(null)).toEqual([]);
    expect(validateFilterTokens({})).toEqual([]);
  });

  // The exact shape from issue #3574: a metric widget whose owner clause never
  // resolved, so the widget rendered 0 and nobody noticed.
  it('catches {current_user} in a dashboard widget filter and names the widget', () => {
    const findings = validateFilterTokens({
      dashboards: [
        {
          name: 'service_dashboard',
          widgets: [
            {
              id: 'my_open_cases',
              type: 'metric',
              dataset: 'case_metrics',
              filter: { owner: '{current_user}', status: 'open' },
            },
          ],
        },
      ],
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(FILTER_TOKEN_UNKNOWN);
    expect(findings[0].where).toBe('dashboard "service_dashboard" · widget "my_open_cases"');
    expect(findings[0].path).toBe('dashboards[0].widgets[0].filter.owner');
    expect(findings[0].hint).toContain('{current_user_id}');
  });

  it('accepts the correct spelling alongside date macros', () => {
    expect(
      validateFilterTokens({
        dashboards: [
          {
            name: 'd',
            widgets: [
              {
                id: 'w',
                filter: {
                  owner_id: '{current_user_id}',
                  org: '{current_org_id}',
                  created_at: { $gte: '{week_start}' },
                  closed_at: { $lte: '${30_days_ago}' },
                  status: 'open',
                },
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  // Both platform filter shapes must be walked. A resolver that handled only
  // the array shape is what caused #3574 in the first place.
  it('walks the array/triple list-view shape as well as the object shape', () => {
    const findings = validateFilterTokens({
      objects: [
        {
          name: 'crm_lead',
          listViews: {
            my_leads: {
              filter: [{ field: 'owner', operator: 'equals', value: '{current_user}' }],
            },
            my_other: { filter: [['owner', '=', '{user_id}']] },
          },
        },
      ],
    });

    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.path).sort()).toEqual([
      'objects[0].listViews.my_leads.filter[0].value',
      'objects[0].listViews.my_other.filter[0][2]',
    ]);
    for (const f of findings) expect(f.hint).toContain('{current_user_id}');
  });

  it('reaches nested $and / $or branches', () => {
    const findings = validateFilterTokens({
      dashboards: [
        {
          name: 'd',
          widgets: [
            {
              id: 'w',
              filter: {
                $and: [{ status: 'open' }, { $or: [{ owner: '{me}' }, { owner: '{current_user_id}' }] }],
              },
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('dashboards[0].widgets[0].filter.$and[1].$or[0].owner');
  });

  it('covers reports, datasets and SDUI page components', () => {
    const findings = validateFilterTokens({
      reports: [{ name: 'r', runtimeFilter: { owner: '{current_user}' } }],
      datasets: [{ name: 'ds', filter: { org: '{org_id}' } }],
      pages: [
        {
          name: 'p',
          regions: [
            {
              components: [
                { type: 'object-grid', properties: { filters: [['owner_id', '=', '{current_user}']] } },
              ],
            },
          ],
        },
      ],
    });
    expect(findings.map((f) => f.where).sort()).toEqual([
      'dataset "ds"',
      'page "p"',
      'report "r"',
    ]);
  });

  // Navigation resolves an extra vocabulary (AppContextSelector ids). Filters
  // do not, so the rule must not wander into `params` / `recordId`.
  it('ignores nav params and recordId, which resolve context-selector ids', () => {
    expect(
      validateFilterTokens({
        apps: [
          {
            name: 'app',
            navigation: [
              { id: 'n1', type: 'object', recordId: '{current_user_id}' },
              { id: 'n2', type: 'component', params: { package: '{active_package}' } },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('flags an unresolvable token in a nav item filters map', () => {
    const findings = validateFilterTokens({
      apps: [
        {
          name: 'app',
          navigation: [{ id: 'n', type: 'object', filters: { owner_id: '{current_user}' } }],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('apps[0].navigation[0].filters.owner_id');
  });

  it('leaves ordinary values and partial braces alone', () => {
    expect(
      validateFilterTokens({
        dashboards: [
          {
            name: 'd',
            widgets: [
              {
                id: 'w',
                title: '{not_a_filter}',
                filter: { name: 'Acme {Corp}', count: 3, active: true, tags: ['a', 'b'] },
              },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it('survives a cyclic metadata graph', () => {
    const dash: Record<string, unknown> = { name: 'd', widgets: [] };
    dash.self = dash;
    expect(() => validateFilterTokens({ dashboards: [dash] })).not.toThrow();
  });
});
