// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validatePresetComparands, FILTER_PRESET_COMPARAND } from './validate-preset-comparands.js';

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

  it('[#8704] reaches a field-level relatedListFilter under objects', () => {
    // `relatedListFilter` is the one FILTER_KEYS member not spelled `filter`:
    // it rides flat on the field beside its relatedList* family. Listing it in
    // the shared walk is what lands this rule (and tokens/empty-combinators)
    // on the new position — this pin holds that coverage.
    const findings = validatePresetComparands({
      objects: [{
        name: 'account',
        fields: {
          task: {
            type: 'lookup',
            reference: 'account',
            relatedListFilter: { created_at: { $gte: 'last_30_days' } },
          },
        },
      }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].fields.task.relatedListFilter.created_at.$gte');
    expect(findings[0].message).toContain('last_30_days');
  });

  it('[#8704] POSITIVE CONTROL: a clean relatedListFilter reports nothing', () => {
    expect(validatePresetComparands({
      objects: [{
        name: 'account',
        fields: {
          task: {
            type: 'lookup',
            reference: 'account',
            relatedListFilter: { status: { $ne: 'deleted' }, created_at: { $gte: '{30_days_ago}' } },
          },
        },
      }],
    })).toEqual([]);
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

describe('validatePresetComparands — arm 2, the FIELD-TYPED equality / membership refusal (#16106)', () => {
  /**
   * The card's own shape: `crm_opportunity` declares `close_date` as a `date`
   * column (plus a `datetime` sibling, a `time` sibling, a select column whose
   * option value collides with a preset name, a text column, and a lookup hop
   * to an object with its own date column).
   */
  const crmObjects = [
    {
      name: 'crm_opportunity',
      fields: {
        close_date: { type: 'date' },
        closed_at: { type: 'datetime' },
        opens_at: { type: 'time' },
        stage: { type: 'select', options: [{ label: 'This Quarter', value: 'this_quarter' }] },
        period: { type: 'text' },
        account: { type: 'lookup', reference: 'crm_account' },
      },
    },
    { name: 'crm_account', fields: { created_on: { type: 'date' }, name: { type: 'text' } } },
    { name: 'crm_note', fields: { opportunity: { type: 'lookup', reference: 'crm_opportunity' }, noted_on: { type: 'date' } } },
  ];
  const crmDatasets = [{ name: 'deals', object: 'crm_opportunity', measures: [] }];

  const board = (widgets: unknown[]) => ({
    objects: crmObjects,
    datasets: crmDatasets,
    dashboards: [{ name: 'sales', widgets }],
  });
  const widget = (id: string, filter: unknown, over: Record<string, unknown> = {}) => ({
    id, type: 'metric', dataset: 'deals', values: ['total'], filter, ...over,
  });

  it("refuses the card's three residue rows — bare, $eq, $in — on a declared date field, naming path and window", () => {
    const findings = validatePresetComparands(board([
      widget('bare', { close_date: 'last_30_days' }),
      widget('eq', { close_date: { $eq: 'last_30_days' } }),
      widget('in', { close_date: { $in: ['last_30_days'] } }),
    ]));
    expect(findings.map((f) => f.path).sort()).toEqual([
      'dashboards[0].widgets[0].filter.close_date',
      'dashboards[0].widgets[1].filter.close_date.$eq',
      'dashboards[0].widgets[2].filter.close_date.$in[0]',
    ]);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(f.rule).toBe(FILTER_PRESET_COMPARAND);
      expect(f.where).toMatch(/^dashboard "sales" · widget "/);
      expect(f.message).toContain('"last_30_days" is a dashboard date-range PRESET name');
      expect(f.message).toContain('{30_days_ago}'); // the spelling that works
      expect(f.hint).toContain('{date-macro}');
    }
    // The implicit-equality position is reported under the operator it lowers to.
    expect(findings[0].message).toContain('As a bare "$eq" comparand');
    expect(findings[2].message).toContain('As a bare "$in" comparand');
  });

  it('judges $ne / $nin, every member of a list, and a declared datetime field the same way', () => {
    const findings = validatePresetComparands(board([
      widget('w', {
        close_date: { $ne: 'yesterday' },
        closed_at: { $nin: ['last_week', '2026-01-01', 'this_year'] },
      }),
    ]));
    expect(findings.map((f) => f.path).sort()).toEqual([
      'dashboards[0].widgets[0].filter.close_date.$ne',
      'dashboards[0].widgets[0].filter.closed_at.$nin[0]',
      'dashboards[0].widgets[0].filter.closed_at.$nin[2]',
    ]);
  });

  it('judges the view-rule and triple spellings, alias folds included', () => {
    const findings = validatePresetComparands({
      objects: crmObjects,
      views: [{
        name: 'recent',
        data: { provider: 'object', object: 'crm_opportunity' },
        filter: [
          { field: 'close_date', operator: 'equals', value: 'last_30_days' },
          { field: 'close_date', operator: 'eq', value: 'this_month' },          // alias → equals
          { field: 'closed_at', operator: 'in', value: ['last_7_days', '2026-01-01'] },
          { field: 'close_date', operator: 'notIn', value: ['last_week'] },      // alias → not_in
          { field: 'close_date', operator: 'ne', value: 'today' },               // alias → not_equals
        ],
      }],
      pages: [{
        name: 'board',
        components: [
          { type: 'list', dataSource: { object: 'crm_opportunity' }, filter: ['close_date', '=', 'last_30_days'] },
          { type: 'list', dataSource: { object: 'crm_opportunity' }, filter: ['and', ['closed_at', 'in', ['this_year']], ['close_date', '!=', 'yesterday']] },
          { type: 'list', dataSource: { object: 'crm_opportunity' }, filter: ['close_date', 'nin', ['last_quarter']] },
          { type: 'list', dataSource: { object: 'crm_opportunity' }, filter: ['close_date', 'equals', 'this_week'] }, // alias → =
        ],
      }],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'pages[0].components[0].filter[2]',
      'pages[0].components[1].filter[1][2][0]',
      'pages[0].components[1].filter[2][2]',
      'pages[0].components[2].filter[2][0]',
      'pages[0].components[3].filter[2]',
      'views[0].filter[0].value',
      'views[0].filter[1].value',
      'views[0].filter[2].value[0]',
      'views[0].filter[3].value[0]',
      'views[0].filter[4].value',
    ].sort());
    // The view rule reports the canonical operator, the triple the authored one.
    expect(findings.find((f) => f.path === 'views[0].filter[1].value')!.message).toContain('"equals"');
    expect(findings.find((f) => f.path === 'pages[0].components[3].filter[2]')!.message).toContain('"equals"');
  });

  it('binds every carrier to the object its conditions address, nearest declaration first', () => {
    const findings = validatePresetComparands({
      objects: [
        ...crmObjects.slice(1),
        {
          name: 'crm_opportunity',
          fields: {
            ...crmObjects[0].fields,
            // A summary field's `filter` runs over the CHILD object (its own `object`).
            note_count: { type: 'summary', summary: { object: 'crm_note', function: 'count', filter: { noted_on: 'last_month' } } },
            // A `relatedListFilter` runs over the rows of the object that owns the field.
            account: { type: 'lookup', reference: 'crm_account', relatedListFilter: { close_date: { $in: ['this_quarter'] } } },
          },
          // An object's own list views: the object itself.
          listViews: [{ name: 'closing', filter: { close_date: 'this_week' } }],
        },
      ],
      datasets: crmDatasets,
      reports: [{
        name: 'pipeline', dataset: 'deals',
        runtimeFilter: { close_date: { $eq: 'last_quarter' } },
        blocks: [{ type: 'table', dataset: 'deals', runtimeFilter: { closed_at: 'last_year' } }],
      }],
      flows: [{
        name: 'sweep',
        nodes: [{ id: 'find', type: 'find_records', config: { objectName: 'crm_opportunity', filter: { close_date: { $ne: 'today' } } } }],
      }],
      pages: [{
        name: 'detail', object: 'crm_account',
        components: [
          // `record:related_list`: `properties.objectName` is the related object.
          { type: 'record:related_list', properties: { objectName: 'crm_opportunity', filter: { close_date: 'last_7_days' } } },
          // No component binding: the page's own `object`.
          { type: 'list', filter: { created_on: 'last_90_days' } },
        ],
      }],
      dashboards: [{
        name: 'ops',
        globalFilters: [{ name: 'acct', field: 'account', type: 'select', optionsFrom: { object: 'crm_account', valueField: 'id', labelField: 'name', filter: { created_on: 'this_year' } } }],
        widgets: [
          // A relationship hop: nested condition AND dotted spelling, both resolved on `crm_account`.
          widget('hop', { account: { created_on: 'last_month' }, 'account.created_on': { $in: ['this_month'] } }),
        ],
      }],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'dashboards[0].globalFilters[0].optionsFrom.filter.created_on',
      'dashboards[0].widgets[0].filter.account.created_on',
      'dashboards[0].widgets[0].filter.account.created_on.$in[0]',
      'flows[0].nodes[0].config.filter.close_date.$ne',
      'objects[2].fields.account.relatedListFilter.close_date.$in[0]',
      'objects[2].fields.note_count.summary.filter.noted_on',
      'objects[2].listViews[0].filter.close_date',
      'pages[0].components[0].properties.filter.close_date',
      'pages[0].components[1].filter.created_on',
      'reports[0].blocks[0].runtimeFilter.closed_at',
      'reports[0].runtimeFilter.close_date.$eq',
    ].sort());
  });

  it('binds name-keyed (map-form) objects and datasets exactly as array-form ones', () => {
    const findings = validatePresetComparands({
      objects: { crm_opportunity: { fields: { close_date: { type: 'date' } } } },
      datasets: { deals: { object: 'crm_opportunity', measures: [] } },
      dashboards: [{ name: 'sales', widgets: [widget('w', { close_date: 'last_30_days' })] }],
    });
    expect(findings.map((f) => f.path)).toEqual(['dashboards[0].widgets[0].filter.close_date']);
  });

  it('stays quiet on every legitimate or unjudgeable position — the discriminating controls', () => {
    expect(validatePresetComparands({
      objects: [
        ...crmObjects,
        { name: 'crm_empty' }, // declares no field map
      ],
      datasets: [
        ...crmDatasets,
        { name: 'ghost_ds', object: 'no_such_object', measures: [] },
      ],
      dashboards: [{
        name: 'ok',
        widgets: [
          widget('picklist', {
            // Equality / membership against a select or text column whose
            // value collides with a preset name is the author's own vocabulary.
            stage: 'this_quarter',
            period: { $in: ['last_30_days'] },
            // A `time` column: the ruling names date / datetime only.
            opens_at: 'today',
            // A registry-injected column: its type is invisible to the graph.
            created_at: 'last_30_days',
            // A field the object does not declare: another rule's finding.
            close_dat: 'last_30_days',
            // The platform's own correct spellings in the judged positions.
            close_date: { $in: ['{30_days_ago}', '2026-01-15'] },
            closed_at: { $eq: '2026-01-15T00:00:00.000Z' },
          }),
          // Bindings that cannot resolve: an unknown dataset, a dataset on an
          // unknown object, an object with no field map.
          widget('ghost', { close_date: 'last_30_days' }, { dataset: 'no_such_dataset' }),
          widget('ghost2', { close_date: 'last_30_days' }, { dataset: 'ghost_ds' }),
        ],
      }],
      views: [
        // A non-`object` provider names no fields on any object graph.
        { name: 'api', data: { provider: 'api', object: 'crm_opportunity' }, filter: [{ field: 'close_date', operator: 'equals', value: 'last_30_days' }] },
        // No binding at all.
        { name: 'unbound', filter: [{ field: 'close_date', operator: 'in', value: ['last_30_days'] }] },
      ],
      flows: [{
        name: 'templated',
        // A templated target object is resolved at run time — skipped, not guessed.
        nodes: [{ id: 'n', config: { objectName: '{vars.target}', filter: { close_date: 'last_30_days' } } }],
      }],
      apps: [{ name: 'crm', filter: { close_date: 'last_30_days' } }],
      pages: [{ name: 'p', components: [{ type: 'list', filter: ['close_date', '=', 'last_30_days'] }] }],
    })).toEqual([]);
  });

  // [#16106 review finding B1] A form field's `publicPicker.filter` is a static
  // pre-filter the public-lookup route runs on the REFERENCED object
  // (`picker.object`, else the field's `reference`). Binding it to the view's
  // own object produced a FALSE refusal — the one failure direction this arm
  // may never have — whenever the parent and the referenced object share a
  // field name with differing types.
  const pickerObjects = [
    {
      name: 'crm_opportunity',
      fields: {
        close_date: { type: 'date' },
        account: { type: 'lookup', reference: 'crm_account' },
        contact: { type: 'lookup', reference: 'crm_contact' },
        owner_note: { type: 'text' },
      },
    },
    // Same field NAME as the parent, a select column whose option value collides with a preset.
    { name: 'crm_account', fields: { close_date: { type: 'select', options: [{ label: 'This Quarter', value: 'this_quarter' }] } } },
    // Same field name, genuinely a date.
    { name: 'crm_contact', fields: { close_date: { type: 'date' } } },
  ];
  const pickerForm = (fields: unknown[]) => ({
    objects: pickerObjects,
    views: [{
      name: 'lead_form', type: 'form',
      data: { provider: 'object', object: 'crm_opportunity' },
      sections: [{ fields }],
    }],
  });
  const pickerRule = { field: 'close_date', operator: 'equals', value: 'this_quarter' };

  it('[B1] stays QUIET on a publicPicker filter over a referenced select column that shares its name with a parent date column', () => {
    // The measured false refusal: parent `close_date` is a date, the picker queries `crm_account`.
    expect(validatePresetComparands(pickerForm([
      { field: 'account', publicPicker: { filter: [pickerRule] } },
    ]))).toEqual([]);
    // The `object` override names the referenced object outright.
    expect(validatePresetComparands(pickerForm([
      { field: 'account', publicPicker: { object: 'crm_account', filter: [pickerRule] } },
    ]))).toEqual([]);
    // Unresolvable pickers stay UNJUDGED, never the parent: a field the form
    // object does not declare, and a field that is not a relationship (no
    // `reference` to follow — on the parent it would have read as a date).
    expect(validatePresetComparands(pickerForm([
      { field: 'no_such_field', publicPicker: { filter: [pickerRule] } },
      { field: 'close_date', publicPicker: { filter: [pickerRule] } },
      { field: 'owner_note', publicPicker: { filter: [pickerRule] } },
    ]))).toEqual([]);
  });

  it('[B1] POSITIVE CONTROL: the same picker filter is still refused when the REFERENCED object declares the field as a date', () => {
    // Resolved through the field's `reference`.
    expect(validatePresetComparands(pickerForm([
      { field: 'contact', publicPicker: { filter: [pickerRule] } },
    ])).map((f) => f.path)).toEqual(['views[0].sections[0].fields[0].publicPicker.filter[0].value']);
    // Resolved through the `object` override (pointing a select-typed parent lookup at the date object).
    expect(validatePresetComparands(pickerForm([
      { field: 'account', publicPicker: { object: 'crm_contact', filter: [pickerRule] } },
    ])).map((f) => f.path)).toEqual(['views[0].sections[0].fields[0].publicPicker.filter[0].value']);
  });

  it('keeps arm 1 field-agnostic: an ordering preset still fires with NO objects in the stack, and on a text column', () => {
    const findings = validatePresetComparands({
      objects: crmObjects,
      datasets: crmDatasets,
      dashboards: [{ name: 'd', widgets: [widget('w', { period: { $gte: 'last_30_days' }, close_date: 'last_30_days' })] }],
      views: [{ name: 'v', filter: [{ field: 'anything', operator: 'after', value: 'last_7_days' }] }],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'dashboards[0].widgets[0].filter.close_date',
      'dashboards[0].widgets[0].filter.period.$gte',
      'views[0].filter[0].value',
    ]);
  });
});
