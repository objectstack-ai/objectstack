// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateTranslationReferences,
  TRANSLATION_TARGET_UNKNOWN,
  TRANSLATION_OPTION_KEY_UNKNOWN,
} from './validate-translation-references.js';
// Real shipped metadata — see the `#5415` describe block for why this is
// imported rather than reduced by hand.
import { Contact } from '../../../examples/app-showcase/src/data/objects/contact.object.js';
import { ContactViews } from '../../../examples/app-showcase/src/ui/views/contact.view.js';

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

  // #5415. `collectViewRecord` walked `['listViews', 'formViews']` and the
  // record's own `sections`; the CONTAINER's default form — `defineView({ form:
  // … })`, the one `ObjectForm` renders when no named form view is asked for —
  // was in neither, so its named sections contributed nothing and a correct
  // translation of a heading that DOES render was reported as an unknown
  // target.
  it('resolves a section named on the container default `form`', () => {
    const stack = {
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      views: [
        {
          list: { type: 'grid', name: 'all_leads', data: { provider: 'object', object: 'crm_lead' } },
          form: {
            type: 'simple',
            data: { provider: 'object', object: 'crm_lead' },
            sections: [{ name: 'contact_info', label: 'Contact Info' }],
          },
        },
      ],
      translations: [
        { en: { objects: { crm_lead: { label: 'Lead', _sections: { contact_info: { label: 'Contact' } } } } } },
      ],
    };
    expect(validateTranslationReferences(stack)).toEqual([]);
  });

  it('binds the default `form` by its OWN data, not by the list beside it', () => {
    // Two objects in one record: the list shows leads, the form edits contacts.
    // The section belongs to whatever `form.data.object` says — the same
    // resolution the CLI i18n walker's `viewObjectName` performs.
    //
    // Both directions are asserted in ONE stack on purpose. "crm_lead is still
    // reported" alone would pass just as well if the default form contributed
    // NOTHING (the pre-#5415 behaviour) — it is the `crm_contact` half, which
    // resolves only once the form is collected under its own binding, that
    // makes the pair falsifiable.
    const stack = (objectName: string) => ({
      objects: [
        { name: 'crm_lead', fields: { name: { type: 'text' } } },
        { name: 'crm_contact', fields: { name: { type: 'text' } } },
      ],
      views: [
        {
          list: { type: 'grid', name: 'all_leads', data: { provider: 'object', object: 'crm_lead' } },
          form: {
            type: 'simple',
            data: { provider: 'object', object: 'crm_contact' },
            sections: [{ name: 'contact_info', label: 'Contact Info' }],
          },
        },
      ],
      translations: [
        { en: { objects: { [objectName]: { label: 'X', _sections: { contact_info: { label: 'Contact' } } } } } },
      ],
    });

    expect(validateTranslationReferences(stack('crm_contact'))).toEqual([]);

    const findings = validateTranslationReferences(stack('crm_lead'));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._sections.contact_info');
  });
});

/**
 * #5415, pinned against the metadata the repo actually ships.
 *
 * `examples/app-showcase` is imported here rather than reduced by hand on
 * purpose: the defect was an anchor MISSING from a list, and a hand-written
 * fixture can only pin the anchors whoever wrote it remembered. The showcase
 * contact surface is the exact shape that exposed it —
 *
 *   - the object declares `field.group` and NO `fieldGroups[]`, so the object
 *     side contributes no section anchor at all;
 *   - the container's default `form` names all four sections;
 *   - `formViews.create` names none of its own (a sparse create override with
 *     one unnamed section) — which is what keeps the "still reports a real
 *     unknown" control below honest.
 *
 * So every `_sections` key this surface legitimately carries comes from
 * `view.form.sections[].name`, and nothing else.
 */
describe('validateTranslationReferences — the showcase contact surface (#5415)', () => {
  const showcaseContactStack = (translations: unknown[]) => ({
    objects: [Contact],
    views: [ContactViews],
    translations,
  });

  const sectionBundle = (sections: Record<string, unknown>) => [
    { 'zh-CN': { objects: { showcase_contact: { _sections: sections } } } },
  ];

  it('accepts every section the default form names', () => {
    // `ObjectForm` renders these four headings and resolves each through
    // `sectionLabel(object, section.name, …)` — translating them is correct.
    const findings = validateTranslationReferences(
      showcaseContactStack(
        sectionBundle({
          contact: { label: '联系方式' },
          work: { label: '工作' },
          status: { label: '状态' },
          notes: { label: '备注' },
        }),
      ),
    );
    expect(findings).toEqual([]);
  }, 60_000);

  it('still reports a section name nothing declares, and names the real ones', () => {
    // The over-widening control: `contract` is a typo of `contact`, and
    // `who_is_this` is the LABEL of `formViews.create`'s unnamed section — an
    // unnamed section is not translatable, so neither key may resolve.
    const findings = validateTranslationReferences(
      showcaseContactStack(sectionBundle({ contract: { label: '合同' }, who_is_this: { label: '这是谁' } })),
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.rule)).toEqual([TRANSLATION_TARGET_UNKNOWN, TRANSLATION_TARGET_UNKNOWN]);
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0]["zh-CN"].objects.showcase_contact._sections.contract',
      'translations[0]["zh-CN"].objects.showcase_contact._sections.who_is_this',
    ]);
    // The hint now enumerates the anchors the object really has, instead of
    // claiming it "declares no named section at all".
    for (const finding of findings) {
      expect(finding.hint).toContain('Declared sections: contact, notes, status, work');
      expect(finding.hint).not.toContain('declares no named section at all');
    }
  }, 60_000);
});
