// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { PageSchema } from '@objectstack/spec/ui';

import { walkAuthoredFilters } from './filter-walk';
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

  // [#19791] A list page's `interfaceConfig.filterBy` and a lookup field's
  // `lookupFilters` reach the engine's `where` verbatim, where the same two
  // placeholder vocabularies resolve.
  it('reaches a page filterBy and a lookup field lookupFilters', () => {
    const findings = validateFilterTokens({
      objects: [{
        name: 'invoice',
        fields: {
          account: {
            type: 'lookup',
            reference: 'account',
            lookupFilters: [
              { field: 'owner', operator: 'eq', value: '{current_user}' },
              { field: 'owner', operator: 'ne', value: '{current_user_id}' },
            ],
          },
        },
      }],
      pages: [{
        name: 'deals',
        type: 'list',
        interfaceConfig: {
          source: 'deal',
          filterBy: [
            { field: 'owner', operator: 'equals', value: '{user_id}' },
            { field: 'created_at', operator: 'greater_than', value: '{30_days_ago}' },
          ],
        },
      }],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'objects[0].fields.account.lookupFilters[0].value',
      'pages[0].interfaceConfig.filterBy[0].value',
    ]);
    for (const f of findings) expect(f.rule).toBe(FILTER_TOKEN_UNKNOWN);
  });

  it('survives a cyclic metadata graph', () => {
    const dash: Record<string, unknown> = { name: 'd', widgets: [] };
    dash.self = dash;
    expect(() => validateFilterTokens({ dashboards: [dash] })).not.toThrow();
  });
});

/**
 * `{record_id}` — the record-context token. It resolves only where a record is
 * in context, which on the surfaces this rule walks means a component on a
 * `type: 'record'` page. Everywhere else it is refused by name, with the reason
 * ("no record in context on this surface"), not the unknown-token message.
 */
describe('validateFilterTokens — {record_id}', () => {
  const NO_RECORD = 'no record in context on this surface';

  function recordPage(type: string | undefined, filter: unknown): Record<string, unknown> {
    return {
      name: 'person_page',
      label: 'Person',
      ...(type === undefined ? {} : { type }),
      object: 'person',
      regions: [
        {
          name: 'main',
          components: [
            { type: 'element:number', properties: { object: 'task', aggregate: 'count', filter } },
          ],
        },
      ],
    };
  }

  function expectRefusal(
    findings: ReturnType<typeof validateFilterTokens>,
    path: string,
    where: string,
  ): void {
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.rule).toBe(FILTER_TOKEN_UNKNOWN);
    expect(f.path).toBe(path);
    expect(f.where).toBe(where);
    expect(f.message).toContain('{record_id}');
    expect(f.message).toContain(NO_RECORD);
    // The reason, not the unknown-token wording.
    expect(f.message).not.toContain('is not a resolvable placeholder');
  }

  it('accepts it on a component of a record page, in every filter shape', () => {
    expect(validateFilterTokens({ pages: [recordPage('record', { assignee: '{record_id}', status: 'open' })] })).toEqual([]);
    expect(validateFilterTokens({ pages: [recordPage('record', [['assignee', '=', '${record_id}']])] })).toEqual([]);
    expect(
      validateFilterTokens({
        pages: [recordPage('record', [{ field: 'assignee', operator: 'equals', value: '{record_id}' }])],
      }),
    ).toEqual([]);
  });

  it('accepts it beside the session tokens and date macros on the same record page', () => {
    expect(
      validateFilterTokens({
        pages: [recordPage('record', {
          $and: [{ assignee: '{record_id}' }, { owner: '{current_user_id}' }, { due: { $lt: '{today}' } }],
        })],
      }),
    ).toEqual([]);
  });

  it('accepts it in a slot of a slotted record page', () => {
    expect(
      validateFilterTokens({
        pages: [{
          name: 'p', label: 'P', type: 'record', kind: 'slotted', object: 'person',
          slots: { main: { type: 'record:related_list', properties: { filter: { assignee: '{record_id}' } } } },
        }],
      }),
    ).toEqual([]);
  });

  it('an untyped page is judged as the schema default, a record page', () => {
    // The rule runs on the parsed stack, where `PageSchema` has filled `type`.
    // This holds the rule's reading of an absent `type` equal to that default.
    const parsed = PageSchema.parse({ name: 'person_page', label: 'Person' });
    expect(parsed.type).toBe('record');
    expect(validateFilterTokens({ pages: [recordPage(undefined, { assignee: '{record_id}' })] })).toEqual([]);
  });

  it.each(['home', 'app', 'utility', 'list'])('refuses it on a %s page', (type) => {
    expectRefusal(
      validateFilterTokens({ pages: [recordPage(type, { assignee: '{record_id}' })] }),
      'pages[0].regions[0].components[0].properties.filter.assignee',
      'page "person_page"',
    );
  });

  it('refuses it in a list page base filter (interfaceConfig.filterBy)', () => {
    expectRefusal(
      validateFilterTokens({
        pages: [{
          name: 'tasks', type: 'list',
          interfaceConfig: { source: 'task', filterBy: [{ field: 'assignee', operator: 'equals', value: '{record_id}' }] },
        }],
      }),
      'pages[0].interfaceConfig.filterBy[0].value',
      'page "tasks"',
    );
  });

  it('refuses it on a list view (top-level view)', () => {
    expectRefusal(
      validateFilterTokens({ views: [{ name: 'my_tasks', filter: [{ field: 'assignee', operator: 'equals', value: '{record_id}' }] }] }),
      'views[0].filter[0].value',
      'view "my_tasks"',
    );
  });

  it("refuses it on an object's list view", () => {
    expectRefusal(
      validateFilterTokens({
        objects: [{ name: 'task', listViews: { mine: { filter: [['assignee', '=', '{record_id}']] } } }],
      }),
      'objects[0].listViews.mine.filter[0][2]',
      'object "task"',
    );
  });

  it('refuses it on a dashboard widget', () => {
    expectRefusal(
      validateFilterTokens({
        dashboards: [{ name: 'ops', widgets: [{ id: 'open_tasks', type: 'metric', filter: { assignee: '{record_id}' } }] }],
      }),
      'dashboards[0].widgets[0].filter.assignee',
      'dashboard "ops" · widget "open_tasks"',
    );
  });

  it('refuses it on a report', () => {
    expectRefusal(
      validateFilterTokens({ reports: [{ name: 'r', runtimeFilter: { assignee: '{record_id}' } }] }),
      'reports[0].runtimeFilter.assignee',
      'report "r"',
    );
  });

  it('refuses it on a dataset', () => {
    expectRefusal(
      validateFilterTokens({ datasets: [{ name: 'ds', filter: { assignee: '{record_id}' } }] }),
      'datasets[0].filter.assignee',
      'dataset "ds"',
    );
  });

  it('refuses it in an app nav item filter', () => {
    expectRefusal(
      validateFilterTokens({
        apps: [{ name: 'app', navigation: [{ id: 'n', type: 'object', filters: { assignee: '{record_id}' } }] }],
      }),
      'apps[0].navigation[0].filters.assignee',
      'app "app"',
    );
  });

  it('judges each page by its own type — record page accepted, list page refused, same stack', () => {
    const findings = validateFilterTokens({
      pages: [
        recordPage('record', { assignee: '{record_id}' }),
        { ...recordPage('home', { assignee: '{record_id}' }), name: 'home_page' },
      ],
    });
    expect(findings.map((f) => f.where)).toEqual(['page "home_page"']);
  });

  it('near miss {recordId} is still unknown on a record page, with {record_id} suggested', () => {
    const findings = validateFilterTokens({ pages: [recordPage('record', { assignee: '{recordId}' })] });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FILTER_TOKEN_UNKNOWN);
    expect(findings[0].hint).toContain('"{record_id}"');
  });

  it('lit control — the session tokens stay valid on the surfaces that refuse {record_id}', () => {
    expect(
      validateFilterTokens({
        views: [{ name: 'v', filter: [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }] }],
        dashboards: [{ name: 'd', widgets: [{ id: 'w', filter: { org: '{current_org_id}' } }] }],
        pages: [recordPage('home', { owner: '{current_user_id}' })],
      }),
    ).toEqual([]);
  });

  it('the page loop names paths and locations exactly as the shared walk does', () => {
    // The `pages` collection is walked page by page so each page's `type` is
    // in hand; a page's finding must still read as the shared walk reads it,
    // including a map-shaped collection and an unnamed page.
    const stacks = [
      { pages: [recordPage('record', { a: '{nope}' }), { regions: [{ components: [{ properties: { filter: { b: '{nope}' } } }] }] }] },
      { pages: { first: recordPage('home', { a: '{nope}' }), second: recordPage('list', { b: '{nope}' }) } },
    ];
    for (const stack of stacks) {
      const walked: string[] = [];
      walkAuthoredFilters(stack, [{ key: 'pages', kind: 'page' }], ({ value, path, where }) => {
        for (const [k] of Object.entries(value as Record<string, unknown>)) walked.push(`${where} @ ${path}.${k}`);
      });
      const found = validateFilterTokens(stack).map((f) => `${f.where} @ ${f.path}`);
      expect(walked.length).toBeGreaterThan(0);
      expect(found).toEqual(walked);
    }
  });
});
