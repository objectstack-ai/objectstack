// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { validatePageFieldBindings, PAGE_FIELD_UNKNOWN } from './validate-page-field-bindings.js';

const baseStack = () => ({
  objects: [
    {
      name: 'crm_lead',
      fields: {
        name: { type: 'text' },
        status: { type: 'select' },
        account: { type: 'lookup', reference: 'crm_account' },
        amount: { type: 'currency' },
      },
    },
    {
      name: 'crm_account',
      fields: { name: { type: 'text' }, region: { type: 'text' } },
    },
  ],
});

/** A `kind: 'full'` record page with one region holding `components`. */
const pageWith = (components: unknown[], extra: Record<string, unknown> = {}) => ({
  name: 'lead_detail',
  object: 'crm_lead',
  regions: [{ name: 'main', components }],
  ...extra,
});

describe('validatePageFieldBindings — highlights / KPI cards', () => {
  // The HotCRM instance: a highlights strip naming a field the object lacks.
  it('warns on an unknown highlights field', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        { type: 'record:highlights', properties: { fields: ['status', 'total_revenue'] } },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(PAGE_FIELD_UNKNOWN);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.fields[1]');
    expect(findings[0].message).toContain('total_revenue');
    expect(findings[0].message).toContain('crm_lead');
  });

  it('accepts the object form of a highlights field', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        { type: 'record:highlights', properties: { fields: [{ name: 'status', label: 'Status' }] } },
      ])],
    });
    expect(findings).toEqual([]);
  });

  it('flags the object form when the name is unknown', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        { type: 'record:highlights', properties: { fields: [{ name: 'ghost' }] } },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.fields[0].name');
  });

  it('warns on an unknown element:number aggregate field, against its own object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'element:number',
          properties: { object: 'crm_account', field: 'amount', aggregate: 'sum' },
        },
      ])],
    });
    // `amount` exists on crm_lead but NOT on crm_account, which this KPI binds.
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_account');
  });
});

describe('validatePageFieldBindings — record:details real authored shape', () => {
  // Real pages author `sections: [{ label, fields }]`, which RecordDetailsProps
  // does not describe (it survives because `properties` is unvalidated).
  it('walks sections[].fields[]', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:details',
          properties: {
            sections: [
              { label: 'Overview', fields: ['name', 'status'] },
              { label: 'Money', fields: ['amount', 'nonexistent_field'] },
            ],
          },
        },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.sections[1].fields[1]',
    );
  });

  it('walks hideFields', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        { type: 'record:details', properties: { hideFields: ['status', 'ghost'] } },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.hideFields[1]');
  });
});

describe('validatePageFieldBindings — related lists bind the related object', () => {
  it('checks columns against objectName, not the page object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:related_list',
          properties: {
            objectName: 'crm_account',
            relationshipField: 'region',
            // `status` is a crm_lead field; the related object is crm_account.
            columns: ['name', 'status'],
          },
        },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_account');
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.columns[1]');
  });

  it('checks the add-picker against its own object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:related_list',
          properties: {
            objectName: 'crm_account',
            add: { picker: { object: 'crm_lead', valueField: 'name', labelField: 'ghost' } },
          },
        },
      ])],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.add.picker.labelField',
    );
  });
});

describe('validatePageFieldBindings — binding precedence and traversal', () => {
  it('dataSource.object overrides the page object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:highlights',
          dataSource: { object: 'crm_account' },
          properties: { fields: ['region', 'status'] },
        },
      ])],
    });
    // `region` is on crm_account (ok); `status` is not.
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_account');
  });

  it('walks slots and nested tab children', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [
        {
          name: 'p',
          object: 'crm_lead',
          kind: 'slotted',
          slots: {
            highlights: { type: 'record:highlights', properties: { fields: ['ghost_a'] } },
            tabs: {
              type: 'page:tabs',
              properties: {
                items: [
                  {
                    label: 'Detail',
                    children: [
                      { type: 'record:details', properties: { fields: ['ghost_b'] } },
                    ],
                  },
                ],
              },
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.path).sort()).toEqual([
      'pages[0].slots.highlights.properties.fields[0]',
      'pages[0].slots.tabs.properties.items[0].children[0].properties.fields[0]',
    ]);
  });

  it('checks interfaceConfig against `source`', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [
        {
          name: 'list_page',
          type: 'list',
          object: 'crm_lead',
          interfaceConfig: {
            source: 'crm_lead',
            columns: ['name', { field: 'ghost_col' }],
            sort: [{ field: 'amount', order: 'desc' }],
            filterBy: [{ field: 'ghost_filter', operator: 'equals', value: 'x' }],
            userFilters: { element: 'dropdown', fields: [{ field: 'status' }] },
          },
        },
      ],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'pages[0].interfaceConfig.columns[1].field',
      'pages[0].interfaceConfig.filterBy[0].field',
    ]);
  });
});

describe('validatePageFieldBindings — false-positive floor', () => {
  it('skips an unregistered component type', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:line_items',
          properties: { childObject: 'crm_account', amountField: 'whatever', columns: [{ field: 'nope' }] },
        },
      ])],
    });
    expect(findings).toEqual([]);
  });

  it('skips a component bound to a cross-package object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:highlights',
          dataSource: { object: 'sys_user' },
          properties: { fields: ['anything_at_all'] },
        },
      ])],
    });
    expect(findings).toEqual([]);
  });

  it('skips relationship dot-paths and system fields', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        {
          type: 'record:details',
          properties: { fields: ['account.name', 'created_at', 'id', 'owner_id'] },
        },
      ])],
    });
    expect(findings).toEqual([]);
  });

  it('skips a source-authored page', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([{ type: 'record:highlights', properties: { fields: ['ghost'] } }], {
        kind: 'react',
        source: 'export default () => null;',
      })],
    });
    expect(findings).toEqual([]);
  });

  it('is silent on a clean page and tolerates empty input', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([
        { type: 'record:highlights', properties: { fields: ['name', 'status'] } },
        { type: 'record:path', properties: { statusField: 'status' } },
      ])],
    });
    expect(findings).toEqual([]);
    expect(validatePageFieldBindings({})).toEqual([]);
    expect(validatePageFieldBindings(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('does not check a component with no resolvable object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [
        {
          name: 'app_page',
          type: 'app',
          regions: [{ name: 'main', components: [
            { type: 'record:highlights', properties: { fields: ['ghost'] } },
          ] }],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validatePageFieldBindings — legacy bare-string sort (#4340)', () => {
  /**
   * `ListViewSchema.sort` still accepts `"created_at desc"`. Reading the whole
   * string as a field name reported `"amount desc"` as unknown — a finding
   * whose "field" the author never wrote, and one no fix could satisfy. The
   * shared `sortFieldRefs` reads its head instead, the way the renderer does.
   */
  it('judges the head segment, not the whole "field desc" string', () => {
    const listPage = (sort: unknown) => ({
      ...baseStack(),
      pages: [
        {
          name: 'list_page',
          type: 'list',
          object: 'crm_lead',
          interfaceConfig: { source: 'crm_lead', columns: ['name'], sort },
        },
      ],
    });
    expect(validatePageFieldBindings(listPage('amount desc'))).toEqual([]);
    const bad = validatePageFieldBindings(listPage('ghost_col desc'));
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain('"ghost_col"');
    expect(bad[0].message).not.toContain('ghost_col desc');
  });
});
