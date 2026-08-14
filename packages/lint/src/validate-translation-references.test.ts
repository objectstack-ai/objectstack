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
// …and the frozen snapshot of it (#8515), for the one case whose control needs
// a section that has no name.
import { SnapshotContact, SnapshotContactViews } from './showcase-shape.fixtures.js';

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
  //
  // The default list carries a `label` (#6038): without one it is
  // signature-identical to `listViews.my_leads` (`{type,label,columns}` all
  // equal), the composer collapses the two, and `all_leads` is not a runtime
  // view name at all — so the fixture would be asserting that a key nothing
  // resolves is legal. The label makes it the distinct default list this test
  // says it is. The collapse itself is pinned separately below.
  const leadViews = {
    objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
    views: [
      {
        list: {
          type: 'grid',
          name: 'all_leads',
          label: 'All Leads',
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

  // ── #6038 / #5164 leg 2: the default list's key is the RUNTIME's ─────────
  //
  // The composer (`expandViewContainer`) is the single producer of a view's
  // runtime identity, and these pin that this rule reads the key from it
  // instead of re-deriving one. Every fixture below is driven through the real
  // `validateTranslationReferences`, and every "legal" assertion is paired with
  // a planted bad key on the SAME fixture — a `toEqual([])` that passes because
  // the rule produced nothing at all would prove nothing.
  describe('the default list is keyed by the runtime identity, single spelling', () => {
    /** The showcase shape: a container declaring ONLY a nameless default list. */
    const namelessDefaultList = {
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      views: [
        {
          list: { type: 'grid', label: 'All Leads', data: { provider: 'object', object: 'crm_lead' } },
        },
      ],
    };

    const bundle = (views: Record<string, unknown>) => ({
      translations: [{ en: { objects: { crm_lead: { label: 'Lead', _views: views } } } }],
    });

    it('accepts `default` for a nameless default list — the key the registry holds', () => {
      const findings = validateTranslationReferences({
        ...namelessDefaultList,
        ...bundle({ default: { label: '全部线索' } }),
      });
      expect(findings).toEqual([]);
    });

    it('the same fixture still reports a key nothing declares (the green above is not an empty run)', () => {
      const findings = validateTranslationReferences({
        ...namelessDefaultList,
        ...bundle({ default: { label: '全部线索' }, hot_leads: { label: 'Hot' } }),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.hot_leads');
    });

    it('rejects the old `list` spelling — one key per view, and it is the runtime one', () => {
      const findings = validateTranslationReferences({
        ...namelessDefaultList,
        ...bundle({ list: { label: '全部线索' } }),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.list');
      expect(findings[0].hint).toContain('default');
    });

    it('a named default list keeps the author\'s `name`', () => {
      const stack = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            list: {
              type: 'grid',
              name: 'all_leads',
              label: 'All Leads',
              data: { provider: 'object', object: 'crm_lead' },
            },
            listViews: { my_leads: { type: 'grid', data: { provider: 'object', object: 'crm_lead' } } },
          },
        ],
      };
      expect(
        validateTranslationReferences({ ...stack, ...bundle({ all_leads: { label: 'A' }, my_leads: { label: 'M' } }) }),
      ).toEqual([]);
      // …and `default` is NOT legal here: the author named the view, so the
      // composer never falls back to `default`.
      const planted = validateTranslationReferences({ ...stack, ...bundle({ default: { label: 'D' } }) });
      expect(planted).toHaveLength(1);
      expect(planted[0].path).toBe('translations[0].en.objects.crm_lead._views.default');
    });

    it('a default list collapsed into a `listViews` entry contributes that entry\'s key, not its own `name`', () => {
      // Composer fact 2 — the `examples/app-crm` shape: `list` is
      // signature-identical to `listViews.all` (`{type,label,columns}` equal),
      // so the two are ONE registry entry named `all`. `list.name` resolves to
      // nothing and must not be a legal bundle key.
      const collapsed = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            list: { type: 'grid', name: 'all_leads', data: { provider: 'object', object: 'crm_lead' } },
            listViews: { all: { type: 'grid', data: { provider: 'object', object: 'crm_lead' } } },
          },
        ],
      };
      expect(validateTranslationReferences({ ...collapsed, ...bundle({ all: { label: '全部' } }) })).toEqual([]);
      const findings = validateTranslationReferences({ ...collapsed, ...bundle({ all_leads: { label: '全部' } }) });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.all_leads');
    });

    it('a collision-renamed default list is legal under the renamed key', () => {
      // Composer fact 3: `listViews.default` claims `crm_lead.default` first,
      // so the nameless default list is renamed `crm_lead.default_2` — and the
      // rename IS the registry key, so it is what a bundle must spell.
      const collided = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            list: { type: 'grid', data: { provider: 'object', object: 'crm_lead' } },
            listViews: { default: { type: 'kanban', data: { provider: 'object', object: 'crm_lead' } } },
          },
        ],
      };
      expect(
        validateTranslationReferences({ ...collided, ...bundle({ default: { label: 'D' }, default_2: { label: 'D2' } }) }),
      ).toEqual([]);
      const findings = validateTranslationReferences({ ...collided, ...bundle({ default_3: { label: 'D3' } }) });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.default_3');
    });

    it('the default FORM contributes sections but no `_views` name — `_views.*` is a list convention', () => {
      // The composer does name the default form `crm_lead.form`, but the i18n
      // walker emits no `_views` entry for any form view, so a `_views.form`
      // key would be one nothing reads. Its `_sections` still resolve (#5415).
      const withForm = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            list: { type: 'grid', label: 'All', data: { provider: 'object', object: 'crm_lead' } },
            form: {
              type: 'simple',
              data: { provider: 'object', object: 'crm_lead' },
              sections: [{ name: 'contact_info', label: 'Contact Info' }],
            },
          },
        ],
      };
      expect(
        validateTranslationReferences({
          ...withForm,
          translations: [
            {
              en: {
                objects: {
                  crm_lead: { label: 'Lead', _views: { default: { label: 'All' } }, _sections: { contact_info: { label: '联系方式' } } },
                },
              },
            },
          ],
        }),
      ).toEqual([]);
      const findings = validateTranslationReferences({ ...withForm, ...bundle({ form: { label: 'Form' } }) });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.form');
    });
  });

  // ── #6422 / #5164 leg 3: the NAMED entries' keys are the RUNTIME's too ────
  //
  // The composer constructs every `listViews.<key>` / `formViews.<key>`
  // identity from the MAP KEY alone — the inner `name` is ignored — and
  // renames on collision. This rule therefore reads the named entries' keys
  // from the composer (`namedViewKeys`), exactly as it reads the default
  // list's (`defaultListViewKey`). Same discipline as the #6038 block above:
  // every "legal" assertion is paired with a planted bad key on the SAME
  // fixture, so a green run is never an empty run.
  describe('named entries are keyed by the runtime identity, single spelling', () => {
    const bundle = (views: Record<string, unknown>) => ({
      translations: [{ en: { objects: { crm_lead: { label: 'Lead', _views: views } } } }],
    });

    it('an inner `name` diverging from its map key is not a legal `_views` key — the runtime never resolves it', () => {
      const stack = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            listViews: {
              my_leads: {
                name: 'open_leads',
                type: 'grid',
                data: { provider: 'object', object: 'crm_lead' },
              },
            },
          },
        ],
      };
      // The map key is the registry key…
      expect(
        validateTranslationReferences({ ...stack, ...bundle({ my_leads: { label: 'My Leads' } }) }),
      ).toEqual([]);
      // …and the inner `name` is a key nothing resolves. This spelling used to
      // be accepted ("authors write either", HotCRM); #5164's ruling — canonical
      // = the runtime identity's bare key — retires it on the named branches.
      const findings = validateTranslationReferences({
        ...stack,
        ...bundle({ open_leads: { label: 'Open Leads' } }),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.open_leads');
    });

    it('the same narrowing holds on the formViews branch', () => {
      const stack = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            formViews: {
              quick: {
                name: 'quick_form',
                type: 'simple',
                data: { provider: 'object', object: 'crm_lead' },
              },
            },
          },
        ],
      };
      expect(
        validateTranslationReferences({ ...stack, ...bundle({ quick: { label: 'Quick' } }) }),
      ).toEqual([]);
      const findings = validateTranslationReferences({
        ...stack,
        ...bundle({ quick_form: { label: 'Quick Form' } }),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.quick_form');
    });

    it('a collision-renamed formViews entry is legal under the renamed key — the author who wrote the registry key is not an orphan', () => {
      // The #6422 sharp case. The nameless default `list` claims
      // `crm_lead.default` first, so `formViews.default` is renamed
      // `crm_lead.default_2` — and the rename IS the registry key. Before this
      // rule asked the composer, it accepted `default` for the form (a key
      // that resolves to the LIST) and reported `default_2` — the one spelling
      // that actually resolves the form — as an orphan.
      //
      // The shape is dormant in shipped configs only because the view-ref lint
      // (`lint-view-refs.ts`) makes every view-key collision a hard error.
      // That dormancy depends on ANOTHER rule staying strict, which is exactly
      // why it is pinned here instead of trusted silently.
      const collided = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            list: { type: 'grid', data: { provider: 'object', object: 'crm_lead' } },
            formViews: {
              default: { type: 'simple', data: { provider: 'object', object: 'crm_lead' } },
            },
          },
        ],
      };
      // `default` resolves the list, `default_2` resolves the form: both are
      // registry keys, so both are legal bundle spellings.
      expect(
        validateTranslationReferences({
          ...collided,
          ...bundle({ default: { label: 'All' }, default_2: { label: 'Form' } }),
        }),
      ).toEqual([]);
      // Planted bad key on the SAME fixture: the green above is not an empty run.
      const findings = validateTranslationReferences({
        ...collided,
        ...bundle({ default_3: { label: 'Ghost' } }),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.default_3');
    });

    it('an inner `name` that MATCHES its map key stays legal — the narrowing removes a spelling, not a view', () => {
      // The overwhelmingly common authored shape (every in-repo config): the
      // author restates the map key as `name`. One key, one spelling — the
      // map key — and it still resolves.
      const stack = {
        objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
        views: [
          {
            listViews: {
              recent: { name: 'recent', type: 'grid', data: { provider: 'object', object: 'crm_lead' } },
            },
          },
        ],
      };
      expect(
        validateTranslationReferences({ ...stack, ...bundle({ recent: { label: 'Recent' } }) }),
      ).toEqual([]);
      const findings = validateTranslationReferences({
        ...stack,
        ...bundle({ recent: { label: 'Recent' }, stale: { label: 'Stale' } }),
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._views.stale');
    });
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

  /**
   * The same surface, read from the frozen snapshot instead of `examples/**`
   * (#8515). Used by the ONE case here whose control depends on
   * `formViews.create`'s section having no name: that namelessness is the defect
   * #8231 is fixing, and pinning it live made this rule's coverage require the
   * shipped app to stay broken. The cases above keep reading the live app,
   * because what they pin — the four named sections, and `_views.default` — is
   * what it gets right.
   */
  const snapshotContactStack = (translations: unknown[]) => ({
    objects: [SnapshotContact],
    views: [SnapshotContactViews],
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

  it('accepts `_views.default` — the key this very surface ships, and the one it was told to ship (#6038)', () => {
    // The specimen behind #5164/#6038, on the real metadata rather than a
    // reduction: `ContactViews` declares a nameless default `list`, the CLI
    // i18n walker demands `objects.showcase_contact._views.default.label`
    // (#6124), and `examples/app-showcase` ships exactly that key. Before this
    // rule read the key from the composer it answered "no view of object
    // showcase_contact declares `default`" — one `os lint` run, two rules, no
    // author action that satisfied both. The control below keeps this honest:
    // `list`, the spelling the walker used to demand, is NOT legal.
    expect(
      validateTranslationReferences(
        showcaseContactStack([
          { 'zh-CN': { objects: { showcase_contact: { _views: { default: { label: '联系人' } } } } } },
        ]),
      ),
    ).toEqual([]);

    const stale = validateTranslationReferences(
      showcaseContactStack([
        { 'zh-CN': { objects: { showcase_contact: { _views: { list: { label: '联系人' } } } } } },
      ]),
    );
    expect(stale).toHaveLength(1);
    expect(stale[0].path).toBe('translations[0]["zh-CN"].objects.showcase_contact._views.list');
    expect(stale[0].hint).toContain('default');
  }, 60_000);

  it('still reports a section name nothing declares, and names the real ones', () => {
    // The over-widening control: `contract` is a typo of `contact`, and
    // `who_is_this` is the LABEL of `formViews.create`'s unnamed section — an
    // unnamed section is not translatable, so neither key may resolve.
    const findings = validateTranslationReferences(
      snapshotContactStack(sectionBundle({ contract: { label: '合同' }, who_is_this: { label: '这是谁' } })),
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
