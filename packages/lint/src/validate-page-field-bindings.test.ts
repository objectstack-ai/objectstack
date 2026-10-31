// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validatePageFieldBindings as validatePageFieldBindingsUnrecorded,
  checkFieldRefs,
  componentSectionGroupRefs,
  indexObjectFields,
  PAGE_FIELD_UNKNOWN,
  PAGE_FIELD_UNPROVISIONED,
  PAGE_SECTION_GROUP_UNKNOWN,
  PAGE_SECTION_COUNT_NOT_MULTI_VALUE,
  componentSectionCountRefs,
} from './validate-page-field-bindings.js';
import { indexUnprovisionedAnchors } from './system-fields.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Slice 19: every finding of the two ids whose `fix:` line this file
// shortened is recorded, and the hint block at the foot of the file holds each
// recorded `fix:` line to one line of at most 200 characters.
const firedHints: Array<{ rule: string; hint: string }> = [];
// [#22161] Slice 21: the same, for the two ids whose `fix:` line slice 21
// shortened; their block sits at the foot of the file too.
const firedSlice21: Array<{ rule: string; hint: string }> = [];
const validatePageFieldBindings: typeof validatePageFieldBindingsUnrecorded = (...args) => {
  const findings = validatePageFieldBindingsUnrecorded(...args);
  for (const f of findings) {
    if (f.rule === PAGE_FIELD_UNKNOWN || f.rule === PAGE_SECTION_COUNT_NOT_MULTI_VALUE) firedHints.push(f);
    if (f.rule === PAGE_FIELD_UNPROVISIONED || f.rule === PAGE_SECTION_GROUP_UNKNOWN) firedSlice21.push(f);
  }
  return findings;
};

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
          dataSource: { object: 'crm_account' },
          properties: { field: 'amount', aggregate: 'sum' },
        },
      ])],
    });
    // `amount` exists on crm_lead but NOT on crm_account, which this KPI binds.
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('crm_account');
  });
});

describe('validatePageFieldBindings — record:details real authored shape', () => {
  // Real pages author `sections: [{ label, fields }]` — the shape
  // `RecordDetailsProps` now declares too (#5611; it used to declare an ID
  // `string[]` that no page and no renderer ever used).
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

// ───────────────────────────────────────────────────────────────────────────
// #13855 — a section may REFERENCE a declared field group instead of
// enumerating its members. The key names something on a different schema, so
// the spec door takes any well-formed one and the existence question lands
// here, with the field-existence family it belongs to.
// ───────────────────────────────────────────────────────────────────────────

describe('validatePageFieldBindings — dangling `section.group` (#13855)', () => {
  /** `baseStack()` with declared field groups on `crm_lead`. */
  const groupedStack = () => {
    const stack = baseStack();
    (stack.objects[0] as Record<string, unknown>).fieldGroups = [
      { key: 'overview', label: 'Overview' },
      { key: 'money', label: 'Money' },
    ];
    return stack;
  };

  const detailsWith = (sections: unknown[]) =>
    [{ type: 'record:details', properties: { sections } }];

  it('is clean when the key names a declared group', () => {
    const findings = validatePageFieldBindings({
      ...groupedStack(),
      pages: [pageWith(detailsWith([{ group: 'overview' }, { group: 'money' }]))],
    });
    expect(findings).toEqual([]);
  });

  it('flags a key that names no declared group', () => {
    const findings = validatePageFieldBindings({
      ...groupedStack(),
      pages: [pageWith(detailsWith([{ group: 'overview' }, { group: 'contact_info' }]))],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(PAGE_SECTION_GROUP_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.sections[1].group');
    expect(findings[0].message).toContain('field group "contact_info"');
    expect(findings[0].message).toContain('silently does not render');
    // [#22161] Slice 21: one remedy line; the declared groups are no longer
    // echoed (no declared key is close to `contact_info`, so no "Did you mean").
    expect(findings[0].hint).toBe(
      "Fix the key, or declare 'contact_info' in crm_lead's `fieldGroups` and set `group: 'contact_info'` on its " +
        'member fields.',
    );
    expect(findings[0].hint).not.toContain('Declared groups');
  });

  it('reports the group miss alongside — not instead of — a field miss in a sibling section', () => {
    const findings = validatePageFieldBindings({
      ...groupedStack(),
      pages: [pageWith(detailsWith([
        { group: 'ghost_group' },
        { label: 'Money', fields: ['amount', 'nonexistent_field'] },
      ]))],
    });
    expect(findings.map(f => `${f.rule}@${f.path}`)).toEqual([
      `${PAGE_FIELD_UNKNOWN}@pages[0].regions[0].components[0].properties.sections[1].fields[1]`,
      `${PAGE_SECTION_GROUP_UNKNOWN}@pages[0].regions[0].components[0].properties.sections[0].group`,
    ]);
  });

  it('tells an author on an object with NO declared groups what to do instead', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith(detailsWith([{ group: 'overview' }]))],
    });
    expect(findings).toHaveLength(1);
    // [#22161] Slice 21: the one remedy line for an object with no groups yet —
    // declare one, or enumerate the section's `fields`.
    expect(findings[0].hint).toBe(
      "Declare `fieldGroups: [{ key: 'overview', label: '…' }]` on crm_lead and `group: 'overview'` on its member " +
        "fields, or enumerate the section's `fields`.",
    );
  });

  it('says nothing about an object this stack does not define', () => {
    const findings = validatePageFieldBindings({
      ...groupedStack(),
      pages: [{
        name: 'external_detail',
        object: 'from_another_package',
        regions: [{ name: 'main', components: detailsWith([{ group: 'nope' }]) }],
      }],
    });
    expect(findings).toEqual([]);
  });

  it('reads the group refs through the ONE descriptor table the field refs use', () => {
    // `componentSectionGroupRefs` walks `COMPONENT_FIELD_SPECS[…].nestedSections`
    // — the same list `componentFieldRefs` walks. A component that grows
    // sections is covered by both checks in one edit, rather than gaining the
    // field check and silently missing this one.
    expect(componentSectionGroupRefs('record:details', { sections: [{ group: 'a' }, { fields: ['x'] }] }, 'P'))
      .toEqual([{ key: 'a', path: 'P.sections[0].group' }]);
    // Unregistered component types stay skipped, silently, exactly as for fields.
    expect(componentSectionGroupRefs('record:line_items', { sections: [{ group: 'a' }] }, 'P')).toBeNull();
  });
});

describe('validatePageFieldBindings — the field a section heading counts (#23013)', () => {
  /** `baseStack()` plus multi-value fields on `crm_lead`. */
  const countStack = () => {
    const stack = baseStack();
    Object.assign((stack.objects[0] as { fields: Record<string, unknown> }).fields, {
      tags: { type: 'tags' },
      capabilities_not_on_plan: { type: 'multiselect', options: [{ label: 'SSO', value: 'sso' }] },
      watchers: { type: 'user', multiple: true },
      regions: { type: 'select', multiple: true, options: [{ label: 'EU', value: 'eu' }] },
    });
    return stack;
  };

  /** One counted section; `fields` lists the counted field like a real page does. */
  const countedPage = (field: string) => pageWith([{
    type: 'record:details',
    properties: {
      sections: [{ name: 'plan_gap', label: '{{ count }} items', fields: [field], count: { field } }],
    },
  }]);
  const COUNT_PATH = 'pages[0].regions[0].components[0].properties.sections[0].count.field';

  it('is clean on every multi-value shape: an option-list type, and a multi-capable type with `multiple: true`', () => {
    for (const field of ['tags', 'capabilities_not_on_plan', 'watchers', 'regions']) {
      expect(validatePageFieldBindings({ ...countStack(), pages: [countedPage(field)] }), field).toEqual([]);
    }
  });

  it('GATES on a counted field the object does not declare — reusing `page-field-unknown`', () => {
    const findings = validatePageFieldBindings({
      ...countStack(),
      pages: [pageWith([{
        type: 'record:details',
        properties: { sections: [{ label: '{{ count }} items', fields: ['tags'], count: { field: 'capabilitie' } }] },
      }])],
    });
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [PAGE_FIELD_UNKNOWN, 'error', COUNT_PATH],
    ]);
    expect(findings[0].message).toContain('"capabilitie"');
  });

  it('GATES on a counted field that holds one value, naming its type', () => {
    for (const [field, type] of [['status', 'select'], ['name', 'text'], ['account', 'lookup']] as const) {
      const findings = validatePageFieldBindings({ ...countStack(), pages: [countedPage(field)] });
      expect(findings.map((f) => [f.rule, f.severity, f.path]), field).toEqual([
        [PAGE_SECTION_COUNT_NOT_MULTI_VALUE, 'error', COUNT_PATH],
      ]);
      expect(findings[0].message, field).toContain(`\`${type}\``);
    }
  });

  it('judges a registry-injected column by its own definition: `created_at` is single-valued', () => {
    const findings = validatePageFieldBindings({
      ...countStack(),
      pages: [pageWith([{
        type: 'record:details',
        properties: { sections: [{ label: '{{ count }} items', fields: ['tags'], count: { field: 'created_at' } }] },
      }])],
    });
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [PAGE_SECTION_COUNT_NOT_MULTI_VALUE, 'error', COUNT_PATH],
    ]);
  });

  it('keeps the severity split: a section `fields[]` miss advises while the counted miss gates', () => {
    const findings = validatePageFieldBindings({
      ...countStack(),
      pages: [pageWith([{
        type: 'record:details',
        properties: { sections: [{ label: '{{ count }} items', fields: ['ghost'], count: { field: 'ghost' } }] },
      }])],
    });
    expect(findings.map((f) => [f.rule, f.severity, f.path])).toEqual([
      [PAGE_FIELD_UNKNOWN, 'warning', 'pages[0].regions[0].components[0].properties.sections[0].fields[0]'],
      [PAGE_FIELD_UNKNOWN, 'error', COUNT_PATH],
    ]);
  });

  it('says nothing about an object this stack does not define', () => {
    const findings = validatePageFieldBindings({
      ...countStack(),
      pages: [{ ...countedPage('anything'), object: 'other_pkg__thing' }],
    });
    expect(findings).toEqual([]);
  });

  it('survives off-spec input: a non-object `count`, a non-string `field`, a section that is not an object', () => {
    const refs = componentSectionCountRefs('record:details', {
      sections: ['overview', { count: 'tags' }, { count: { field: 7 } }, { count: { field: 'tags' } }],
    }, 'p');
    expect(refs).toEqual([{ name: 'tags', path: 'p.sections[3].count.field' }]);
  });

  it('reaches the gating reference-integrity suite every CLI command runs', () => {
    const findings = validateReferenceIntegrity({ ...countStack(), pages: [countedPage('status')] });
    expect(findings.filter((f) => f.rule === PAGE_SECTION_COUNT_NOT_MULTI_VALUE).map((f) => f.severity))
      .toEqual(['error']);
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

// [#23207] A related list carries two bindings and each batch of refs is judged
// against its own object: the node-level `dataSource` is the CHILD rows (else
// `properties.objectName`), and `relationshipValueField` names a field of the
// PARENT — the object the list inherits (here the page's `crm_lead`).
describe('validatePageFieldBindings — a related list splits its child and parent bindings', () => {
  const LIST = 'pages[0].regions[0].components[0].properties';
  const findingsOf = (component: Record<string, unknown>) =>
    validatePageFieldBindings({ ...baseStack(), pages: [pageWith([{ type: 'record:related_list', ...component }])] })
      .map((f) => [f.rule, f.severity, f.path, f.message]);

  it('a dataSource-bound list resolves relationshipValueField on the parent: no finding', () => {
    // `amount` is a crm_lead (page) field and not a crm_account (child) field.
    expect(findingsOf({
      dataSource: { object: 'crm_account' },
      properties: { relationshipField: 'region', relationshipValueField: 'amount', columns: ['name', 'region'] },
    })).toEqual([]);
  });

  it('a dataSource-bound list checks its child columns against dataSource.object', () => {
    expect(findingsOf({
      dataSource: { object: 'crm_account' },
      properties: { relationshipField: 'region', relationshipValueField: 'amount', columns: ['name', 'status'] },
    })).toEqual([[
      PAGE_FIELD_UNKNOWN,
      'warning',
      `${LIST}.columns[1]`,
      expect.stringContaining('field "status" is not a field on object "crm_account"'),
    ]]);
  });

  it('a dataSource-bound list checks sort, filter and relationshipField against the child too', () => {
    expect(findingsOf({
      dataSource: { object: 'crm_account' },
      properties: {
        relationshipField: 'ghost_fk',
        sort: [{ field: 'ghost_sort', order: 'asc' }],
        filter: [{ field: 'ghost_filter', operator: 'equals', value: 'x' }],
      },
    }).map(([, , path, message]) => [path, message])).toEqual([
      [`${LIST}.sort[0].field`, expect.stringContaining('"ghost_sort" is not a field on object "crm_account"')],
      [`${LIST}.filter[0].field`, expect.stringContaining('"ghost_filter" is not a field on object "crm_account"')],
      [`${LIST}.relationshipField`, expect.stringContaining('"ghost_fk" is not a field on object "crm_account"')],
    ]);
  });

  it('dataSource.object wins over properties.objectName for the child refs', () => {
    expect(findingsOf({
      dataSource: { object: 'crm_account' },
      // `status` is on crm_lead, so naming crm_lead here must not hide the miss.
      properties: { objectName: 'crm_lead', relationshipField: 'region', columns: ['status'] },
    }).map(([, , path, message]) => [path, message])).toEqual([
      [`${LIST}.columns[0]`, expect.stringContaining('"status" is not a field on object "crm_account"')],
    ]);
  });

  it('a parent-side ref that really is missing still reports, against the parent, on both spellings', () => {
    const expected = [[
      PAGE_FIELD_UNKNOWN,
      'warning',
      `${LIST}.relationshipValueField`,
      expect.stringContaining('field "ghost_key" is not a field on object "crm_lead"'),
    ]];
    expect(findingsOf({
      dataSource: { object: 'crm_account' },
      properties: { relationshipField: 'region', relationshipValueField: 'ghost_key' },
    })).toEqual(expected);
    expect(findingsOf({
      properties: { objectName: 'crm_account', relationshipField: 'region', relationshipValueField: 'ghost_key' },
    })).toEqual(expected);
  });

  it('control: the properties.objectName list keeps its single finding on the bad column', () => {
    expect(findingsOf({
      properties: { objectName: 'crm_account', relationshipField: 'region', relationshipValueField: 'amount', columns: ['status'] },
    })).toEqual([[
      PAGE_FIELD_UNKNOWN,
      'warning',
      `${LIST}.columns[0]`,
      expect.stringContaining('field "status" is not a field on object "crm_account"'),
    ]]);
  });

  // The parent binding `parentDataSource` (ruling B on objectui#12296): when the
  // list declares it, the parent ref resolves on ITS object, not the page's.
  it('a list with parentDataSource resolves relationshipValueField on that object: no finding', () => {
    // `ext_key` is on crm_par (the declared parent) only: not on crm_lead (the
    // page) and not on crm_account (the child rows).
    const stack = baseStack();
    const findings = validatePageFieldBindings({
      objects: [...stack.objects, { name: 'crm_par', fields: { ext_key: { type: 'text' } } }],
      pages: [pageWith([{
        type: 'record:related_list',
        dataSource: { object: 'crm_account' },
        properties: { relationshipField: 'region', relationshipValueField: 'ext_key', parentDataSource: { object: 'crm_par' } },
      }])],
    });
    expect(findings).toEqual([]);
  });

  it('a properties.objectName list with parentDataSource also resolves its parent ref on that object', () => {
    // The same reading without a node-level `dataSource`: `ext_key` is on crm_par only.
    const stack = baseStack();
    const findings = validatePageFieldBindings({
      objects: [...stack.objects, { name: 'crm_par', fields: { ext_key: { type: 'text' } } }],
      pages: [pageWith([{
        type: 'record:related_list',
        properties: { objectName: 'crm_account', relationshipField: 'region', relationshipValueField: 'ext_key', parentDataSource: { object: 'crm_par' } },
      }])],
    });
    expect(findings).toEqual([]);
  });

  it('a list with parentDataSource reports a parent ref its declared parent lacks, against that parent', () => {
    // `amount` is a crm_lead (page) field; the declared parent crm_account lacks
    // it, and the child rows (crm_account too) must not be what answers.
    expect(findingsOf({
      dataSource: { object: 'crm_account' },
      properties: { relationshipField: 'region', relationshipValueField: 'amount', parentDataSource: { object: 'crm_account' } },
    })).toEqual([[
      PAGE_FIELD_UNKNOWN,
      'warning',
      `${LIST}.relationshipValueField`,
      expect.stringContaining('field "amount" is not a field on object "crm_account"'),
    ]]);
  });

  it('a list nested in a dataSource-bound container resolves its parent ref on the container object', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([{
        type: 'flex',
        dataSource: { object: 'crm_account' },
        properties: {
          children: [{
            type: 'record:related_list',
            dataSource: { object: 'crm_lead' },
            // `region` is on crm_account (the container), not on crm_lead (the child).
            properties: { relationshipField: 'account', relationshipValueField: 'region', columns: ['ghost'] },
          }],
        },
      }])],
    });
    expect(findings.map((f) => [f.path, f.message])).toEqual([[
      `${LIST}.children[0].properties.columns[0]`,
      expect.stringContaining('"ghost" is not a field on object "crm_lead"'),
    ]]);
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
            details: {
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
      'pages[0].slots.details.properties.items[0].children[0].properties.fields[0]',
      'pages[0].slots.highlights.properties.fields[0]',
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

  // [#28020] An any-of group element names no field itself — its rules do, and
  // each is checked like a top-level rule. Read through `fieldRefsFrom` alone,
  // the group yielded nothing and every rule inside it went unchecked.
  it('checks the rules inside an any-of group of interfaceConfig.filterBy', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [
        {
          name: 'list_page',
          type: 'list',
          object: 'crm_lead',
          interfaceConfig: {
            source: 'crm_lead',
            filterBy: [
              { or: [
                { field: 'status', operator: 'equals', value: 'open' },
                { field: 'ghost_in_group', operator: 'equals', value: 'x' },
              ] },
              { field: 'amount', operator: 'greater_than', value: 1 },
            ],
          },
        },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual(['pages[0].interfaceConfig.filterBy[0].or[1].field']);
  });
});

describe('validatePageFieldBindings — false-positive floor', () => {
  // `record:line_items` has a `ComponentPropsMap` row since #21142, but this
  // rule's own descriptor table (`COMPONENT_FIELD_SPECS`) does not carry it, so
  // the rule skips it — which is what this pins. Its props are the props
  // gate's to judge.
  it('skips a component type its descriptor table does not carry', () => {
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

describe('validatePageFieldBindings — unprovisioned injected anchors (#8340)', () => {
  /**
   * The #8340 repro: a page binding over an ADR-0015 `external` object naming
   * `owner_id` — a registry-injected system column, so `page-field-unknown`
   * rightly stays silent, but nothing is stored behind it on a federated
   * object. `objectExtra` breaks each half of the derivation independently.
   */
  const externalStack = (objectExtra: Record<string, unknown> = {}) => ({
    objects: [
      {
        name: 'ext_customer',
        external: { remoteName: 'customers' },
        fields: { email: { type: 'text' }, tier: { type: 'select' } },
        ...objectExtra,
      },
    ],
  });
  const extPage = (components: unknown[]) => ({
    name: 'customer_detail',
    object: 'ext_customer',
    regions: [{ name: 'main', components }],
  });
  const only = (findings: ReturnType<typeof validatePageFieldBindings>) =>
    findings.filter((f) => f.rule === PAGE_FIELD_UNPROVISIONED);

  it('warns on a highlights binding over an unprovisioned anchor, and the existence rule stays silent', () => {
    const findings = validatePageFieldBindings({
      ...externalStack(),
      pages: [extPage([
        { type: 'record:highlights', properties: { fields: ['tier', 'owner_id'] } },
      ])],
    });
    expect(findings.filter((f) => f.rule === PAGE_FIELD_UNKNOWN)).toHaveLength(0);
    const warned = only(findings);
    expect(warned).toHaveLength(1);
    expect(warned[0].severity).toBe('warning');
    expect(warned[0].path).toBe('pages[0].regions[0].components[0].properties.fields[1]');
    expect(warned[0].message).toContain('owner_id');
    expect(warned[0].message).toContain('external object (ADR-0015)');
    expect(warned[0].message).toContain('renders it, blank, on every record');
    expect(warned[0].hint).toContain('columnMap');
  });

  it('is silent on the local twin — platform storage is real (mutation: drop `external`)', () => {
    const findings = validatePageFieldBindings({
      ...externalStack({ external: undefined }),
      pages: [extPage([
        { type: 'record:highlights', properties: { fields: ['owner_id'] } },
      ])],
    });
    expect(findings).toEqual([]);
  });

  it('is silent when the author DECLARES the column (#7859 — it maps a remote column they vouch for)', () => {
    const findings = validatePageFieldBindings({
      ...externalStack({ fields: { email: { type: 'text' }, owner_id: { type: 'text' } } }),
      pages: [extPage([
        { type: 'record:highlights', properties: { fields: ['owner_id'] } },
      ])],
    });
    expect(only(findings)).toHaveLength(0);
  });

  it('is silent on a declared field of the same external object', () => {
    const findings = validatePageFieldBindings({
      ...externalStack(),
      pages: [extPage([
        { type: 'record:highlights', properties: { fields: ['tier'] } },
      ])],
    });
    expect(findings).toEqual([]);
  });

  it('names the QUERY consequence when the ref reached a predicate, not a renderer', () => {
    // The `queried` consequence is reachable only through the shared core (the
    // react surface's own call); assert it there rather than inventing a page
    // shape that does not exist.
    const stack = externalStack();
    const findings = checkFieldRefs(
      [{ name: 'owner_id', path: 'p' }],
      'ext_customer',
      indexObjectFields(stack),
      'where',
      'queried',
      indexUnprovisionedAnchors(stack),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(PAGE_FIELD_UNPROVISIONED);
    // WARNING even in the gating position: unlike a missing column, the remote
    // schema is not visible to this pass (#8116's severity reasoning).
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('constant-false');
  });

  it('asks nothing when the caller passes no anchor index — the pre-#8340 behaviour', () => {
    const stack = externalStack();
    const findings = checkFieldRefs(
      [{ name: 'owner_id', path: 'p' }],
      'ext_customer',
      indexObjectFields(stack),
      'where',
      'queried',
    );
    expect(findings).toEqual([]);
  });
});

// [#22161] Slice 19: the `fix:` line of `page-field-unknown` and
// `page-section-count-not-multi-value`. One remedy line each; the object's
// field list is no longer echoed (the nearest declared field is named instead),
// and the reasoning is each id's `os explain` entry.
describe('[#22161] one-line fix — the page field ids whose `fix:` line this file shortened', () => {
  it('an unknown field names the nearest declared field, not the field list', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([{ type: 'record:highlights', properties: { fields: ['statsu'] } }])],
    });
    expect(findings.map((f) => f.hint)).toEqual(['Fix the field name, or add "statsu" to crm_lead. Did you mean "status"?']);
    expect(findings[0]!.hint).not.toContain('Object fields:');
  });

  it('a counted single-value field prints the one remedy line', () => {
    const findings = validatePageFieldBindings({
      ...baseStack(),
      pages: [pageWith([{
        type: 'record:details',
        properties: { sections: [{ name: 's', label: '{{ count }} items', fields: ['status'], count: { field: 'status' } }] },
      }])],
    });
    expect(findings.map((f) => f.hint)).toEqual([
      'Count a multi-value field (`multiselect`, `checkboxes`, `tags`, or one declared with `multiple: true`), or ' +
        'list this field in the section\'s `fields` to show its value.',
    ]);
  });

  it('every `fix:` line the cases above fired for those ids is one line of at most 200 characters', () => {
    expect([...new Set(firedHints.map((f) => f.rule))].sort()).toEqual([PAGE_FIELD_UNKNOWN, PAGE_SECTION_COUNT_NOT_MULTI_VALUE].sort());
    for (const f of firedHints) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
      expect(f.hint, f.rule).not.toContain('Object fields:');
      expect(f.hint, f.rule).not.toContain('References must match');
    }
  });

  const MOVED_FROM_HINT: Record<string, readonly string[]> = {
    [PAGE_FIELD_UNKNOWN]: ['exactly', 'nearest declared field', 'dotted relationship path'],
    [PAGE_SECTION_COUNT_NOT_MULTI_VALUE]: ['`select`, `lookup`, `user`, `file` or `image`', '`multiple: true`', '0 or 1'],
  };
  it.each(Object.keys(MOVED_FROM_HINT))('`os explain %s` carries what its `fix:` line no longer says', (rule) => {
    const text = explainRule(rule)!.paragraphs.join('\n');
    for (const fact of MOVED_FROM_HINT[rule]!) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
  });
});

// [#22161] Slice 21: the `fix:` line of `page-field-unprovisioned` and
// `page-section-group-unknown`. One remedy line each: the anchor id prints the
// shared one-line anchor fix, and the group id names the nearest declared group
// instead of echoing the object's whole group list. How to vouch for or opt out
// of an anchor, and how a section inherits a group's members, are each id's
// `os explain` entry.
describe('[#22161] one-line fix — the page ids whose `fix:` line slice 21 shortened', () => {
  it('a misspelt group key names the nearest declared group', () => {
    const stack = baseStack();
    (stack.objects[0] as Record<string, unknown>).fieldGroups = [
      { key: 'overview', label: 'Overview' },
      { key: 'money', label: 'Money' },
    ];
    const findings = validatePageFieldBindings({
      ...stack,
      pages: [pageWith([{ type: 'record:details', properties: { sections: [{ group: 'overveiw' }] } }])],
    });
    expect(findings.map((f) => f.hint)).toEqual([
      "Fix the key, or declare 'overveiw' in crm_lead's `fieldGroups` and set `group: 'overveiw'` on its member " +
        'fields. Did you mean "overview"?',
    ]);
  });

  it('an unprovisioned anchor prints the shared one-line anchor fix', () => {
    const findings = validatePageFieldBindings({
      objects: [{ name: 'ext_customer', external: { remoteName: 'customers' }, fields: { email: { type: 'text' } } }],
      pages: [{
        name: 'customer_detail',
        object: 'ext_customer',
        regions: [{ name: 'main', components: [{ type: 'record:highlights', properties: { fields: ['owner_id'] } }] }],
      }],
    });
    expect(findings.map((f) => [f.rule, f.hint])).toEqual([[
      PAGE_FIELD_UNPROVISIONED,
      "If the remote table carries 'owner_id', declare it in ext_customer's own fields (mapped through " +
        'columnMap); otherwise drop the reference or opt the object out of the injection',
    ]]);
  });

  it('every `fix:` line the cases in this file fired for those ids is one line of at most 200 characters', () => {
    expect([...new Set(firedSlice21.map((f) => f.rule))].sort()).toEqual(
      [PAGE_FIELD_UNPROVISIONED, PAGE_SECTION_GROUP_UNKNOWN].sort(),
    );
    for (const f of firedSlice21) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
      expect(f.hint, f.rule).not.toContain('Declared groups');
      expect(f.hint, f.rule).not.toContain('vouch for');
      expect(f.hint, f.rule).not.toContain('systemFields');
    }
  });

  const MOVED_FROM_HINT: Record<string, readonly string[]> = {
    [PAGE_FIELD_UNPROVISIONED]: ['columnMap', "`ownership: 'none'`", '`systemFields: { audit: false }`', 'vouch for'],
    [PAGE_SECTION_GROUP_UNKNOWN]: ['inherits its members', 'membership is declared on the FIELD', '`record:details`'],
  };
  it.each(Object.keys(MOVED_FROM_HINT))('`os explain %s` carries what its `fix:` line no longer says', (rule) => {
    const text = explainRule(rule)!.paragraphs.join('\n');
    for (const fact of MOVED_FROM_HINT[rule]!) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
  });
});
