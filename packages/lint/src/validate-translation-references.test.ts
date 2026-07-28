// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateTranslationReferences,
  TRANSLATION_TARGET_UNKNOWN,
  TRANSLATION_OPTION_KEY_UNKNOWN,
} from './validate-translation-references.js';

/** A stack shaped like the HotCRM lead surface: fields, options, a view, an action. */
const leadStack = (translations: unknown[]) => ({
  objects: [
    {
      name: 'crm_lead',
      label: 'Lead',
      fields: {
        name: { type: 'text', label: 'Name' },
        status: {
          type: 'select',
          label: 'Status',
          options: [
            { value: 'planning', label: 'Planning' },
            { value: 'working', label: 'Working' },
          ],
        },
        source: {
          type: 'select',
          label: 'Source',
          options: [
            { value: 'direct_mail', label: 'Direct Mail' },
            { value: 'web', label: 'Web' },
          ],
        },
      },
      fieldGroups: [{ key: 'basics', label: 'Basics' }],
      actions: [{ name: 'convert_lead', label: 'Convert', params: [{ name: 'owner', type: 'lookup' }] }],
    },
  ],
  views: [{ name: 'open_leads', objectName: 'crm_lead', label: 'Open Leads' }],
  translations,
});

describe('validateTranslationReferences — orphan keys', () => {
  it('flags a bundle keyed to a field the object does not declare', () => {
    // The HotCRM instance: `assigned_to`, `budget`, `image_url` outlived the
    // fields they were written for.
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: { label: '线索', fields: { assigned_to: { label: '负责人' } } },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(TRANSLATION_TARGET_UNKNOWN);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.crm_lead.fields.assigned_to');
    expect(findings[0].hint).toContain('Declared fields: name, source, status.');
  });

  it('accepts every key that resolves — fields, options, views, actions, sections', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: {
                label: '线索',
                fields: {
                  name: { label: '名称' },
                  status: { label: '状态', options: { planning: '计划中', working: '进行中' } },
                },
                _views: { open_leads: { label: '未关闭线索' } },
                _actions: { convert_lead: { label: '转换', params: { owner: { label: '负责人' } } } },
                _sections: { basics: { label: '基础信息' } },
              },
            },
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('does not flag implicit audit/system fields', () => {
    const findings = validateTranslationReferences(
      leadStack([
        { en: { objects: { crm_lead: { label: 'Lead', fields: { created_at: { label: 'Created' } } } } } },
      ]),
    );
    expect(findings).toEqual([]);
  });

  it('flags an unresolved view / action / section by name', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          en: {
            objects: {
              crm_lead: {
                label: 'Lead',
                _views: { all_leads: { label: 'All Leads' } },
                _actions: { mass_update: { label: 'Mass Update' } },
                _sections: { deal_info: { label: 'Deal Information' } },
              },
            },
          },
        },
      ]),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0].en.objects.crm_lead._views.all_leads',
      'translations[0].en.objects.crm_lead._sections.deal_info',
      'translations[0].en.objects.crm_lead._actions.mass_update',
    ]);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('flags an action parameter the action does not declare', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          en: {
            objects: {
              crm_lead: {
                label: 'Lead',
                _actions: { convert_lead: { label: 'Convert', params: { assignee: { label: 'Assignee' } } } },
              },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._actions.convert_lead.params.assignee');
    expect(findings[0].hint).toContain('Declared params: owner.');
  });
});

describe('validateTranslationReferences — option keys', () => {
  it('flags an option key that is a near-miss of the stored value', () => {
    // The HotCRM instance: `direct-mail` for the value `direct_mail`.
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: {
                label: '线索',
                fields: { source: { label: '来源', options: { 'direct-mail': '直邮' } } },
              },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(TRANSLATION_OPTION_KEY_UNKNOWN);
    expect(findings[0].path).toBe(
      'translations[0]["zh-CN"].objects.crm_lead.fields.source.options.direct-mail',
    );
    expect(findings[0].message).toContain('Did you mean "direct_mail"?');
    expect(findings[0].hint).toContain('Declared values: direct_mail, web.');
  });

  it('flags an option key that is a value from a different vocabulary', () => {
    // The other HotCRM instance: `planned` where the field's value is `planning`.
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: { label: '线索', fields: { status: { label: '状态', options: { planned: '计划中' } } } },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(TRANSLATION_OPTION_KEY_UNKNOWN);
    expect(findings[0].hint).toContain('Declared values: planning, working.');
  });

  it('names the value when the key is the display label', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: { label: '线索', fields: { source: { label: '来源', options: { 'Direct Mail': '直邮' } } } },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('keyed by the DISPLAY LABEL');
    expect(findings[0].hint).toBe('Rename the key to "direct_mail".');
  });

  it('flags an option map on a field that declares no options', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          en: {
            objects: {
              crm_lead: { label: 'Lead', fields: { name: { label: 'Name', options: { a: 'A' } } } },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(TRANSLATION_OPTION_KEY_UNKNOWN);
    expect(findings[0].message).toContain('declares no `options` at all');
  });

  it('accepts the legacy option shapes the extractor also tolerates', () => {
    const stack = {
      objects: [
        {
          name: 'crm_lead',
          fields: {
            record_map: { type: 'select', options: { open: 'Open', closed: 'Closed' } },
            bare_values: { type: 'select', options: ['open', 'closed'] },
          },
        },
      ],
      translations: [
        {
          en: {
            objects: {
              crm_lead: {
                label: 'Lead',
                fields: {
                  record_map: { options: { open: 'Open' } },
                  bare_values: { options: { closed: 'Closed' } },
                },
              },
            },
          },
        },
      ],
    };
    expect(validateTranslationReferences(stack)).toEqual([]);
  });
});

describe('validateTranslationReferences — cross-package objects (§4 ladder)', () => {
  const bundleFor = (objectName: string) => [
    {
      'zh-CN': {
        objects: {
          [objectName]: { label: '用户', fields: { some_field_we_cannot_see: { label: '字段' } } },
        },
      },
    },
  ];

  it('skips a registered platform object wholly — its fields are not visible from here', () => {
    expect(
      validateTranslationReferences({ objects: [], translations: bundleFor('sys_user') }),
    ).toEqual([]);
  });

  it('warns on a platform-prefixed name no package registers', () => {
    const findings = validateTranslationReferences({
      objects: [],
      translations: bundleFor('sys_approval_process'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('platform namespace');
    // The object key is reported once; its subtree is not half-checked.
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.sys_approval_process');
  });

  it('warns once on an unprefixed unknown object, without walking its subtree', () => {
    const findings = validateTranslationReferences({
      objects: [{ name: 'todo_task', fields: { title: { type: 'text' } } }],
      translations: bundleFor('task'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.task');
    expect(findings[0].message).toContain('Did you mean "todo_task"?');
  });
});

describe('validateTranslationReferences — apps, dashboards, global actions', () => {
  const stack = {
    objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
    actions: [
      { name: 'export_csv', label: 'Export' },
      { name: 'convert_lead', label: 'Convert', objectName: 'crm_lead' },
    ],
    apps: [
      {
        name: 'crm_app',
        navigation: [
          { id: 'group_sales', type: 'group', children: [{ id: 'nav_leads', type: 'object', objectName: 'crm_lead' }] },
        ],
      },
    ],
    dashboards: [
      {
        name: 'pipeline_dashboard',
        widgets: [{ id: 'pipeline_by_stage' }],
        header: { actions: [{ label: 'Refresh', actionUrl: '/refresh' }] },
      },
    ],
  };

  it('accepts app / navigation / dashboard / widget / header-action keys that resolve', () => {
    const findings = validateTranslationReferences({
      ...stack,
      translations: [
        {
          en: {
            apps: { crm_app: { label: 'CRM', navigation: { group_sales: { label: 'Sales' } } } },
            dashboards: {
              pipeline_dashboard: {
                label: 'Pipeline',
                widgets: { pipeline_by_stage: { title: 'By Stage' } },
                actions: { '/refresh': { label: 'Refresh' } },
              },
            },
            globalActions: { export_csv: { label: 'Export' } },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('flags an app name, a navigation id, and a widget id that do not resolve', () => {
    const findings = validateTranslationReferences({
      ...stack,
      translations: [
        {
          en: {
            apps: { crm: { label: 'CRM' } },
            dashboards: { pipeline_dashboard: { widgets: { revenue_gauge: { title: 'Revenue' } } } },
          },
        },
      ],
    });
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0].en.apps.crm',
      'translations[0].en.dashboards.pipeline_dashboard.widgets.revenue_gauge',
    ]);
    expect(findings[0].message).toContain('Did you mean "crm_app"?');
  });

  it('tells an object-bound action filed under globalActions where it belongs', () => {
    const findings = validateTranslationReferences({
      ...stack,
      translations: [{ en: { globalActions: { convert_lead: { label: 'Convert' } } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('objects.crm_lead._actions.convert_lead');
    expect(findings[0].hint).toContain('Move these keys under');
  });
});

describe('validateTranslationReferences — namespaces deliberately not judged', () => {
  it('ignores messages, validationMessages, settings, metadataForms and settingsCommon', () => {
    const findings = validateTranslationReferences({
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      translations: [
        {
          en: {
            messages: { 'crm.lead.convert.success': 'Converted.' },
            validationMessages: { discount_limit: 'Too much.' },
            settings: { mail: { title: 'Mail', keys: { from: { label: 'From' } } } },
            metadataForms: { object: { label: 'Object' } },
            settingsCommon: { sourceLabels: { env: 'Environment' } },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('ignores an object-first bundle shape rather than reporting its keys', () => {
    // `o.<object>` is the `translation` METADATA TYPE, not `stack.translations`.
    const findings = validateTranslationReferences({
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      translations: [{ o: { crm_ghost: { label: 'Ghost' } }, _globalOptions: { currency: { usd: 'USD' } } }],
    });
    expect(findings).toEqual([]);
  });

  it('returns nothing for a stack with no translations at all', () => {
    expect(validateTranslationReferences({ objects: [{ name: 'crm_lead' }] })).toEqual([]);
    expect(validateTranslationReferences({})).toEqual([]);
    expect(validateTranslationReferences(null as unknown as Record<string, unknown>)).toEqual([]);
  });
});

describe('validateTranslationReferences — the canonical view-record shape', () => {
  // Reduced from HotCRM: a view record is a CONTAINER whose object binding
  // lives inside `list.data.object`, with the named tabs under `listViews`.
  // Reading `view.name` / `view.data.object` at the record root resolves
  // nothing here, drops the record, and reports every view key the app ships —
  // ~40 correct keys on the real corpus.
  const leadViews = {
    objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
    views: [
      {
        list: {
          type: 'grid',
          name: 'all_leads',
          data: { provider: 'object', object: 'crm_lead' },
        },
        listViews: {
          my_leads: { name: 'my_leads', type: 'grid', data: { provider: 'object', object: 'crm_lead' } },
          kanban_by_status: { name: 'kanban_by_status', type: 'kanban' },
        },
        formViews: {
          default: {
            type: 'simple',
            data: { provider: 'object', object: 'crm_lead' },
            sections: [{ name: 'contact_info', label: 'Contact Info' }],
          },
        },
      },
    ],
  };

  it('resolves the default list, every named tab, and a form section', () => {
    const findings = validateTranslationReferences({
      ...leadViews,
      translations: [
        {
          en: {
            objects: {
              crm_lead: {
                label: 'Lead',
                _views: {
                  all_leads: { label: 'All Leads' },
                  my_leads: { label: 'My Leads' },
                  kanban_by_status: { label: 'By Status' },
                  default: { label: 'Default Form' },
                },
                _sections: { contact_info: { label: 'Contact' } },
              },
            },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('still flags a view key no container declares', () => {
    const findings = validateTranslationReferences({
      ...leadViews,
      translations: [
        { en: { objects: { crm_lead: { label: 'Lead', _views: { hot_leads: { label: 'Hot' } } } } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.hot_leads');
    expect(findings[0].hint).toContain('all_leads');
  });

  it('resolves views embedded on the object itself', () => {
    const findings = validateTranslationReferences({
      objects: [
        {
          name: 'crm_lead',
          fields: { name: { type: 'text' } },
          listViews: { recent: { name: 'recent', type: 'grid' } },
        },
      ],
      translations: [{ en: { objects: { crm_lead: { label: 'Lead', _views: { recent: { label: 'Recent' } } } } } }],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateTranslationReferences — section anchors', () => {
  it('resolves a section named on a form view or a record:details page', () => {
    const stack = {
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      views: [
        {
          name: 'lead_form',
          objectName: 'crm_lead',
          formViews: { default: { sections: [{ name: 'contact_info', label: 'Contact Info' }] } },
        },
      ],
      pages: [
        {
          name: 'lead_detail',
          object: 'crm_lead',
          regions: [
            {
              components: [
                { type: 'record:details', properties: { sections: [{ name: 'timeline', label: 'Timeline' }] } },
              ],
            },
          ],
        },
      ],
      translations: [
        {
          en: {
            objects: {
              crm_lead: {
                label: 'Lead',
                _sections: { contact_info: { label: 'Contact' }, timeline: { label: 'Timeline' } },
              },
            },
          },
        },
      ],
    };
    expect(validateTranslationReferences(stack)).toEqual([]);
  });

  it('explains that an unnamed section cannot be translated at all', () => {
    const findings = validateTranslationReferences({
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      views: [{ name: 'lead_form', objectName: 'crm_lead', formViews: { default: { sections: [{ label: 'Deal' }] } } }],
      translations: [{ en: { objects: { crm_lead: { label: 'Lead', _sections: { deal_info: { label: 'Deal' } } } } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toContain('declares no named section at all');
  });
});
