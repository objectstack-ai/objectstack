// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
// The contract the object branch's coverage is pinned against (#13835) — see
// the coverage describe block at the foot of this file. `@objectstack/spec` is
// already a runtime dependency of this package, so the pin adds no edge.
import { ObjectTranslationDataSchema } from '@objectstack/spec/system';
// The schema the #18441 fold is SIZED against — see the surface pin in that
// block. Same package, already a runtime dependency, so no new edge either.
import { ObjectExtensionSchema } from '@objectstack/spec/data';
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

/**
 * ⭐ Severity, re-judged in place (#16310) — ⛔ not deleted.
 *
 * Eight assertions in this file pinned `severity: 'warning'` on
 * `translation-target-unknown`, and that silence was deliberate: the rule's
 * Severity note AS IT THEN STOOD argued that an orphan key was inert — a few
 * bytes and one untranslated string, nothing crashes — so gating on it would
 * have been the over-statement ADR-0072 D1 forbids. ⛔ Do not go looking for
 * that argument in the rule: the same change rewrote the note, which now says
 * the opposite.
 *
 * The reading was measured wrong in the one direction that matters. An orphan
 * key is not inert; it is a confident-looking grep hit, in every locale, for a
 * surface that was deleted — which reads as "this exists and is translated" to
 * the next author, human or AI. Reported-but-unfailable meant a PR that deletes
 * a navigation entry, a form section or a view and leaves its locale keys behind
 * was green on every pipeline on the platform (measured: eight planted orphans
 * moved `os lint --json` from 12/10 to 20/18 findings, `passed: true`, exit 0).
 *
 * So every one of those eight now pins `error`. They are the SAME assertions
 * making the same statement one severity later, and they stay because the
 * severity is exactly what is worth pinning here.
 *
 * ⚠️ The neighbours are untouched on purpose: `translation-option-key-unknown`
 * still pins `warning` (see the "option keys" and "severity is narrow" blocks) —
 * a mis-keyed option names something real and its remedy is a rename, not a
 * deletion.
 */

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
    expect(findings[0].severity).toBe('error');
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
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
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

describe('validateTranslationReferences — nested conditional validation branches (#14700)', () => {
  // Mirrors the card's own fixture: `demo_account` with one `conditional`
  // rule whose `then` / `otherwise` are each a full, named rule.
  const conditionalStack = (validations: unknown[], objectNode: Record<string, unknown>) => ({
    objects: [
      {
        name: 'demo_account',
        label: 'Account',
        fields: {
          status: { type: 'select', label: 'Status' },
          churn_reason: { type: 'text', label: 'Churn reason' },
        },
        validations,
      },
    ],
    translations: [{ 'zh-CN': { objects: { demo_account: objectNode } } }],
  });

  const churnConsistencyRule = {
    type: 'conditional',
    name: 'churn_reason_consistency',
    message: 'Churn reason must match the account state.',
    when: "record.status == 'churned'",
    then: {
      type: 'script',
      name: 'churn_reason_present',
      message: 'A churned account needs a churn reason.',
      condition: 'record.churn_reason == null',
    },
    otherwise: {
      type: 'script',
      name: 'churn_reason_absent',
      message: 'A non-churned account must not carry a churn reason.',
      condition: 'record.churn_reason != null',
    },
  };

  it('accepts bundle entries for both branch names and the wrapper name at once', () => {
    // Before the fix, this reported `translation-target-unknown` on BOTH
    // branch keys — the card's own measurement — because the flat walk over
    // `obj.validations` never descended into `then` / `otherwise`, even
    // though `checkConditional` / `authoredRuleMessage` address the branch by
    // exactly this name at runtime.
    const findings = validateTranslationReferences(
      conditionalStack([churnConsistencyRule], {
        _validations: {
          // The wrapper's own message is never rendered by `checkConditional`
          // (#14518 keeps a bundle entry for it anyway, deliberately, so the
          // bundle mirrors the declared rule set 1:1).
          churn_reason_consistency: { message: 'Wrapper message (never rendered)' },
          churn_reason_present: { message: '流失账户需要填写流失原因。' },
          churn_reason_absent: { message: '未流失账户不应填写流失原因。' },
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('still flags a bundle entry naming no rule at any depth — real orphans stay caught', () => {
    const findings = validateTranslationReferences(
      conditionalStack([churnConsistencyRule], {
        _validations: {
          churn_reason_present: { message: '流失账户需要填写流失原因。' },
          churn_reason_absent: { message: '未流失账户不应填写流失原因。' },
          churn_reason_ghost: { message: 'Nothing declares this.' },
        },
      }),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0]["zh-CN"].objects.demo_account._validations.churn_reason_ghost',
    ]);
    expect(findings[0].rule).toBe(TRANSLATION_TARGET_UNKNOWN);
  });

  it('descends through a branch that is itself a nested conditional', () => {
    const outerGate = {
      type: 'conditional',
      name: 'outer_gate',
      message: 'outer',
      when: "record.status == 'churned'",
      then: {
        type: 'conditional',
        name: 'inner_gate',
        message: 'inner',
        when: 'record.churn_reason != null',
        then: {
          type: 'script',
          name: 'innermost_rule',
          message: 'deepest branch of all',
          condition: 'true',
        },
      },
    };
    const findings = validateTranslationReferences(
      conditionalStack([outerGate], { _validations: { innermost_rule: { message: '最深层的分支。' } } }),
    );
    expect(findings).toEqual([]);
  });

  it('skips an unnamed branch, same as an unnamed top-level rule already was (#14253)', () => {
    const gateWithUnnamedBranch = {
      type: 'conditional',
      name: 'gate',
      message: 'gate',
      when: "record.status == 'churned'",
      then: { type: 'script', message: 'has no name', condition: 'true' },
    };
    const findings = validateTranslationReferences(
      conditionalStack([gateWithUnnamedBranch], { _validations: { gate: { message: '门。' } } }),
    );
    expect(findings).toEqual([]);
  });
});

describe('validateTranslationReferences — the severity split is narrow (#16310)', () => {
  /**
   * The gating claim, pinned from the consumer's side rather than from the
   * rule's: a consumer selects this rule by its EXACT id, because the id is the
   * bare string the registry publishes — no namespace, and none added here (the
   * id shape was ruled out of scope: a namespace for this one rule would make it
   * the sixth prefixed id among 200 exported rule-id constants, or a migration
   * across two producers). So the two things a gate needs are the id string and
   * the severity, and both are asserted here together.
   */
  it('raises `translation-target-unknown` at `error`, selectable by its exact id', () => {
    const findings = validateTranslationReferences(
      leadStack([
        { 'zh-CN': { objects: { crm_lead: { fields: { assigned_to: { label: '负责人' } } } } } },
      ]),
    );
    const selected = findings.filter((f) => f.rule === 'translation-target-unknown');
    expect(selected).toHaveLength(1);
    expect(selected[0].severity).toBe('error');
    // The id is the literal a consumer's filter can be written against — the
    // constant and the wire string are the same value, asserted both ways so a
    // rename cannot pass this test by moving the constant alone.
    expect(TRANSLATION_TARGET_UNKNOWN).toBe('translation-target-unknown');
  });

  /**
   * ⛔ The promotion is ONE rule's, not "every warning becomes an error". The
   * sibling raised by the very same function keeps `warning`, so a tree whose
   * only translation defect is a mis-keyed option is unchanged — same finding,
   * same severity, same exit code as before.
   */
  it('leaves `translation-option-key-unknown` at `warning`', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: { fields: { source: { label: '来源', options: { 'direct-mail': '直邮' } } } },
            },
          },
        },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(TRANSLATION_OPTION_KEY_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
  });

  /** The negative control: a clean bundle still reports nothing, of any severity. */
  it('reports nothing on a bundle whose every key resolves', () => {
    const findings = validateTranslationReferences(
      leadStack([
        {
          'zh-CN': {
            objects: {
              crm_lead: { label: '线索', fields: { name: { label: '名称' } } },
            },
          },
        },
      ]),
    );
    expect(findings).toEqual([]);
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
    expect(findings[0].severity).toBe('error');
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

  // #14577 — the namespace-segment pre-pass stays rule-local (it is knowledge
  // about how this stack prefixes object names, not the shared helper's
  // business), but a miss now falls through to `suggestName` (#14268) instead
  // of a private Levenshtein copy. "amountsummary" is not a `_`-segment match
  // for "amount" (no underscore boundary), so the segment pre-pass misses;
  // `suggestName`'s containment scan still catches it — 7 edits apart, far
  // outside the `max(2, floor(len/3))` budget the private copy was bound by.
  it('falls through to suggestName (containment) when the namespace-segment pre-pass misses', () => {
    const findings = validateTranslationReferences({
      objects: [{ name: 'amountsummary', fields: { total: { type: 'number' } } }],
      translations: bundleFor('amount'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "amountsummary"?');
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

/**
 * Navigation CONTRIBUTED into an app by another package (#18203).
 *
 * `manifest.navigationContributions` (ADR-0029 D7) injects nav items into an
 * app the contributing package does not own. Those items are NOT in the target
 * app's `navigation` array, so a universe built from that array alone reports
 * every locale key for them as naming an item "which app X does not declare" —
 * with the advice *"Match the key to the navigation item's `id`, or drop it"*.
 *
 * ⚠️ That advice DELETES a translation the runtime honours. Measured downstream
 * on `objectstack-ai/hotcrm` `be11c07`: five contributed items, 15 findings
 * (5 × 3 non-default locales), while `GET /api/v1/meta/app?id=crm_enterprise`
 * returns all five WITH their `zh-CN` labels resolved from the app's own pack.
 *
 * The three `group` cases below are the load-bearing ones, and they are why the
 * universe can be a union rather than a re-implementation of the runtime fold:
 * `SchemaRegistry.applyNavContributions` PUSHES the items in every branch — into
 * the resolved group, or at the app top level when the group id names nothing
 * (which is a diagnostic, never a refusal; see `NavigationContributionSchema`'s
 * header). The fold chooses WHERE an item lands, never WHETHER. So a rule that
 * only asks "is this id addressable?" cannot diverge from the fold, and pinning
 * all three placements here is what keeps that true.
 */
describe('validateTranslationReferences — contributed navigation (#18203)', () => {
  /** Package `crm_core` owns the app; package `crm_service` contributes into it. */
  const contributedArtifact = (contributions: unknown[]) => ({
    packages: [
      {
        manifest: {
          id: 'crm_core',
          apps: [
            {
              name: 'crm_enterprise',
              navigation: [
                { id: 'group_sales', type: 'group', children: [{ id: 'nav_leads', type: 'object', objectName: 'crm_lead' }] },
                { id: 'group_service', type: 'group', children: [] },
              ],
            },
          ],
        },
      },
      { manifest: { id: 'crm_service', navigationContributions: contributions } },
    ],
    objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
    apps: [
      {
        name: 'crm_enterprise',
        navigation: [
          { id: 'group_sales', type: 'group', children: [{ id: 'nav_leads', type: 'object', objectName: 'crm_lead' }] },
          { id: 'group_service', type: 'group', children: [] },
        ],
      },
    ],
  });

  const localeKeys = (...navIds: string[]) => [
    {
      'zh-CN': {
        apps: {
          crm_enterprise: {
            label: '企业版 CRM',
            navigation: Object.fromEntries(navIds.map((id) => [id, { label: id }])),
          },
        },
      },
    },
  ];

  it('accepts a locale key for an item contributed into a group the app DOES declare', () => {
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        { app: 'crm_enterprise', group: 'group_service', priority: 100, items: [{ id: 'nav_case', type: 'object', objectName: 'crm_case' }] },
      ]),
      translations: localeKeys('nav_case'),
    });
    expect(findings).toEqual([]);
  });

  it('accepts one contributed into a group the app does NOT declare — the fold relocates, it does not drop', () => {
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        { app: 'crm_enterprise', group: 'group_nonexistent', items: [{ id: 'nav_knowledge', type: 'object', objectName: 'crm_kb' }] },
      ]),
      translations: localeKeys('nav_knowledge'),
    });
    expect(findings).toEqual([]);
  });

  it('accepts one contributed with no `group` at all — appended at the app top level', () => {
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        { app: 'crm_enterprise', items: [{ id: 'nav_service_dashboard', type: 'dashboard' }] },
      ]),
      translations: localeKeys('nav_service_dashboard'),
    });
    expect(findings).toEqual([]);
  });

  it('accepts a CHILD of a contributed group — contributed items carry subtrees', () => {
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        {
          app: 'crm_enterprise',
          group: 'group_service',
          items: [{ id: 'nav_reports', type: 'group', children: [{ id: 'nav_report_sla', type: 'report' }] }],
        },
      ]),
      translations: localeKeys('nav_reports', 'nav_report_sla'),
    });
    expect(findings).toEqual([]);
  });

  it('accepts the whole HotCRM set — the five items #18203 measured as 15 findings', () => {
    const items = ['nav_case', 'nav_knowledge', 'nav_service_dashboard', 'nav_my_cases', 'nav_report_sla'];
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        { app: 'crm_enterprise', group: 'group_service', priority: 100, items: items.map((id) => ({ id, type: 'object' })) },
      ]),
      translations: localeKeys(...items),
    });
    expect(findings).toEqual([]);
  });

  /**
   * ⭐ The control. Widening a universe trades a false positive for a blind spot
   * unless the genuine orphan still reports — so the same stack, one key that
   * NOTHING contributes, has to stay an error with its id and severity intact.
   */
  it('still reports a genuinely unknown navigation id, at `error`, with the rule id', () => {
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        { app: 'crm_enterprise', group: 'group_service', items: [{ id: 'nav_case', type: 'object' }] },
      ]),
      translations: localeKeys('nav_case', 'nav_deleted_surface'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].apps.crm_enterprise.navigation.nav_deleted_surface',
    });
    expect(findings[0].message).toContain('which app "crm_enterprise" does not declare');
    // The contributed id joins the population the hint enumerates, so the
    // remedy an author is handed lists what they may actually key to.
    expect(findings[0].hint).toContain('nav_case');
  });

  /**
   * A contribution is aimed at ONE app (`NavigationContributionSchema.app`), so
   * it may not make its ids addressable under a different one — otherwise the
   * widening would silence every app in an artifact at once.
   */
  it('does NOT accept a key under app A for an item contributed into app B', () => {
    const findings = validateTranslationReferences({
      ...contributedArtifact([
        { app: 'other_app', group: 'group_service', items: [{ id: 'nav_case', type: 'object' }] },
      ]),
      translations: localeKeys('nav_case'),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].apps.crm_enterprise.navigation.nav_case');
  });

  /**
   * The single-package shape. A project that is one `defineStack` carries no
   * `packages[]`; its contributions sit on the stack's own top-level
   * `manifest` (`StackSchema.manifest`). `os validate` judges exactly this
   * shape, so reading only the artifact form would leave the fast inner-loop
   * command reporting the false positive the build no longer does.
   */
  it('reads contributions off the stack\'s own top-level `manifest` when there is no `packages[]`', () => {
    const findings = validateTranslationReferences({
      manifest: {
        id: 'crm_service',
        navigationContributions: [
          { app: 'crm_enterprise', group: 'group_service', items: [{ id: 'nav_case', type: 'object' }] },
        ],
      },
      apps: [{ name: 'crm_enterprise', navigation: [{ id: 'group_service', type: 'group', children: [] }] }],
      translations: localeKeys('nav_case'),
    });
    expect(findings).toEqual([]);
  });

  /**
   * The per-PACKAGE leg of `os build` (`compile.ts` step 3b-ii) hands each
   * package its OWN body as the stack and the artifact's `packages[]` as
   * resolution context (`packageBodyAsStack`, #16611). The app-owning package
   * carries the translations and none of the contributions, so this is the
   * shape in which the false positive actually reached the HotCRM author —
   * the union run above it de-duplicates, so a fix that only worked on the
   * union would leave this leg reporting it alone.
   */
  it('accepts the key in the per-package leg, where the app owner declares no contribution itself', () => {
    const artifactPackages = [
      { manifest: { id: 'crm_core', apps: [{ name: 'crm_enterprise', navigation: [{ id: 'group_service', type: 'group', children: [] }] }] } },
      {
        manifest: {
          id: 'crm_service',
          navigationContributions: [
            { app: 'crm_enterprise', group: 'group_service', items: [{ id: 'nav_case', type: 'object' }] },
          ],
        },
      },
    ];
    const ownerBody = {
      id: 'crm_core',
      apps: [{ name: 'crm_enterprise', navigation: [{ id: 'group_service', type: 'group', children: [] }] }],
      translations: localeKeys('nav_case'),
    };
    // `packageBodyAsStack(body, entries)` — the body IS its own manifest.
    const findings = validateTranslationReferences({ ...ownerBody, manifest: ownerBody, packages: artifactPackages });
    expect(findings).toEqual([]);
  });
});

/**
 * ⭐ #18441 — the same class as the contributed-navigation block above, one
 * collection over: `objectExtensions[]` is the DECLARED cross-package
 * field-injection surface (canonical target key `extend`), and the fields it
 * carries never enter the target object's own `fields` declaration —
 * `ObjectQL.registerApp` registers the extension as its own `'extend'` layer
 * and the registry merges the layers on read.
 *
 * So a universe built from `stack.objects` alone reported the locale key for a
 * CORRECTLY injected field as an orphan, at `error`, in the same words as a
 * real typo. That indistinguishability is the defect, not the count: measured
 * on the probe stack below, the correct key and a `zzz_gone` typo each produced
 * exactly one finding whose rule, severity, message and remedy ("Point the key
 * at a declared field, or drop it") differed only in the field name — so the
 * author who extended the object correctly was told their correct key was
 * wrong, and the run FAILED on it.
 *
 * Both halves are pinned here: the injected names resolve, and every control
 * still fires. ⛔ The fold is exactly two rungs wide because the schema is —
 * see the last case in this block, which pins that surface against drift.
 */
describe('validateTranslationReferences — objectExtensions-injected surfaces (#18441)', () => {
  /**
   * The #18441 probe stack: `crm_lead` declares `name`; `sla_tier` and the
   * `sla_required` rule arrive through an extension aimed at it.
   */
  const extendedLead = (objectNode: Record<string, unknown>) => ({
    objects: [{ name: 'crm_lead', label: 'Lead', fields: { name: { type: 'text', label: 'Name' } } }],
    objectExtensions: [
      {
        extend: 'crm_lead',
        fields: { sla_tier: { type: 'text', label: 'SLA Tier' } },
        validations: [
          {
            name: 'sla_required',
            type: 'cross_field',
            message: 'An SLA tier is required once a due date is set',
            condition: 'record.sla_tier != null',
            fields: ['sla_tier'],
          },
        ],
      },
    ],
    translations: [{ 'zh-CN': { objects: { crm_lead: objectNode } } }],
  });

  it('accepts a locale key for a field an extension injects', () => {
    const findings = validateTranslationReferences(
      extendedLead({ label: '线索', fields: { sla_tier: { label: 'SLA 等级' } } }),
    );
    expect(findings).toEqual([]);
  });

  /**
   * ⭐ The control — and the reading that graded this card a bug. Widening a
   * universe trades a false positive for a blind spot unless the genuine
   * orphan still reports, so the same stack with one key nothing declares has
   * to stay an `error` with its rule id intact.
   */
  it('still reports a genuinely undeclared field on the same stack, at `error`', () => {
    const findings = validateTranslationReferences(extendedLead({ fields: { zzz_gone: { label: '没了' } } }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].objects.crm_lead.fields.zzz_gone',
    });
    // The injected name joins the population the remedy enumerates — which is
    // also the evidence the fold reached this run at all, rather than the leg
    // having gone quiet.
    expect(findings[0].hint).toContain('Declared fields: name, sla_tier.');
  });

  it('separates the two directions on ONE bundle — the injected key is silent, the typo is not', () => {
    const findings = validateTranslationReferences(
      extendedLead({ fields: { sla_tier: { label: 'SLA 等级' }, zzz_gone: { label: '没了' } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.crm_lead.fields.zzz_gone');
  });

  it('accepts a `_validations` key for a rule an extension merges in', () => {
    const findings = validateTranslationReferences(
      extendedLead({ _validations: { sla_required: { message: 'SLA 等级为必填' } } }),
    );
    expect(findings).toEqual([]);
  });

  it('still reports a `_validations` key naming no rule at any layer', () => {
    const findings = validateTranslationReferences(
      extendedLead({ _validations: { zzz_rule: { message: '没了' } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      path: 'translations[0]["zh-CN"].objects.crm_lead._validations.zzz_rule',
    });
    expect(findings[0].hint).toContain('Declared rules: sla_required.');
  });

  /**
   * The per-PACKAGE leg (`packageBodyAsStack`, #16611). Here the package that
   * OWNS the object carries the translations and declares no extension itself,
   * so the injected name is only readable through the artifact's own
   * `packages[]`. Without that carrier the union leg would accept this key and
   * the per-package leg would report it alone — one key, two verdicts.
   */
  it('reads an extension declared by a SIBLING package of the same artifact', () => {
    const ownerBody = {
      id: 'crm_core',
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      translations: [{ 'zh-CN': { objects: { crm_lead: { fields: { sla_tier: { label: 'SLA 等级' } } } } } }],
    };
    const artifactPackages = [
      { manifest: ownerBody },
      {
        manifest: {
          id: 'crm_service',
          objectExtensions: [{ extend: 'crm_lead', fields: { sla_tier: { type: 'text' } } }],
        },
      },
    ];
    const findings = validateTranslationReferences({
      ...ownerBody,
      manifest: ownerBody,
      packages: artifactPackages,
    });
    expect(findings).toEqual([]);
  });

  /**
   * Rung 2b of the §4 ladder. An extension exists to reach an object ANOTHER
   * package owns, so the target is routinely one this stack does not define —
   * and then the owner's field set is no more visible here than a platform
   * object's. The object key resolves (the extension is proof the stack means
   * that name) and the subtree is skipped WHOLLY, for rung 2's reason.
   */
  describe('rung 2b — an extension target this stack does not define', () => {
    const contributorStack = (bundleObjects: Record<string, unknown>) => ({
      objects: [{ name: 'svc_ticket', fields: { name: { type: 'text' } } }],
      objectExtensions: [{ extend: 'crm_lead', fields: { sla_tier: { type: 'text' } } }],
      translations: [{ 'zh-CN': { objects: bundleObjects } }],
    });

    it('accepts the object key, and judges nothing under it', () => {
      const findings = validateTranslationReferences(
        contributorStack({
          // `name` is the OWNER's field and `sla_tier` the injected one: from
          // here the two are indistinguishable, which is why neither is judged.
          crm_lead: { label: '线索', fields: { sla_tier: { label: 'SLA 等级' }, name: { label: '名称' } } },
        }),
      );
      expect(findings).toEqual([]);
    });

    /** ⭐ The control: 2b resolves the names an extension NAMES, not a path. */
    it('still reports an object neither defined nor extended, on the same stack', () => {
      const findings = validateTranslationReferences(
        contributorStack({
          crm_lead: { fields: { sla_tier: { label: 'SLA 等级' } } },
          zzz_nothing: { label: '没了' },
        }),
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        rule: TRANSLATION_TARGET_UNKNOWN,
        severity: 'error',
        path: 'translations[0]["zh-CN"].objects.zzz_nothing',
      });
    });

    it('an extension entry with no `extend` makes nothing addressable', () => {
      const findings = validateTranslationReferences({
        objects: [{ name: 'svc_ticket', fields: { name: { type: 'text' } } }],
        objectExtensions: [{ fields: { sla_tier: { type: 'text' } } }],
        translations: [{ 'zh-CN': { objects: { crm_lead: { fields: { sla_tier: { label: 'x' } } } } } }],
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.crm_lead');
    });
  });

  /**
   * ⛔ The fold reaches `fields.*` and `_validations.*` and no other rung,
   * because `ObjectExtensionSchema` reaches no further: an author cannot
   * contribute a view, a section, a filter-preset tab or an action through an
   * extension at all, so a key for one is an orphan exactly as it was.
   */
  it('folds no other rung — an extended object still reports its ghost view, section, tab and action', () => {
    const findings = validateTranslationReferences(
      extendedLead({
        _views: { zzz_board: { label: 'x' } },
        _sections: { zzz_sla: { label: 'x' } },
        _tabs: { zzz_breached: { label: 'x' } },
        _actions: { zzz_escalate: { label: 'x' } },
      }),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0]["zh-CN"].objects.crm_lead._views.zzz_board',
      'translations[0]["zh-CN"].objects.crm_lead._sections.zzz_sla',
      'translations[0]["zh-CN"].objects.crm_lead._tabs.zzz_breached',
      'translations[0]["zh-CN"].objects.crm_lead._actions.zzz_escalate',
    ]);
  });

  /**
   * …and the pin that keeps the sentence above true. The fold is sized against
   * the SCHEMA, so if `ObjectExtensionSchema` ever accepts one of these keys,
   * this fails here rather than leaving the rule reporting correct keys for a
   * surface that has started to exist. Both arms are asserted, so the refusal
   * reading is not a dead instrument: the two keys the fold DOES read parse.
   */
  it('pins the extension key surface the fold is sized against', () => {
    const refusedByName = (key: string): boolean => {
      const parsed = ObjectExtensionSchema.safeParse({ extend: 'crm_lead', [key]: [] } as unknown);
      if (parsed.success) return false;
      return parsed.error.issues.some(
        (issue) => issue.code === 'unrecognized_keys' && (issue.path ?? []).length === 0,
      );
    };
    const surface = ['views', 'listViews', 'actions', 'fieldGroups', 'sections', 'tabs', 'hooks'];
    expect(surface.map((key) => `${key}:${refusedByName(key) ? 'refused' : 'accepted'}`)).toEqual([
      'views:refused',
      'listViews:refused',
      'actions:refused',
      'fieldGroups:refused',
      'sections:refused',
      'tabs:refused',
      'hooks:refused',
    ]);
    expect(
      ObjectExtensionSchema.safeParse({ extend: 'crm_lead', fields: { sla_tier: { type: 'text' } } } as unknown).success,
    ).toBe(true);
    expect(
      ObjectExtensionSchema.safeParse({
        extend: 'crm_lead',
        validations: [
          {
            name: 'sla_required',
            type: 'cross_field',
            message: 'An SLA tier is required',
            condition: 'record.sla_tier != null',
            fields: ['sla_tier'],
          },
        ],
      } as unknown).success,
    ).toBe(true);
  });
});

/**
 * ⭐ #18442 — the app-name rung of the same rule. A package contributes items
 * into an app it does not own and ships the labels for the items it
 * contributed; declaring that app is the OTHER package's job. The rule told it
 * the app is one "which this stack does not define", at `error`, with the
 * remedy "Match the key to an app's `name`, or drop it" — and because the app
 * rung `continue`s, the whole subtree went with it.
 *
 * ⛔ Accepting it is not a new resolution-context decision. The runtime's own
 * contribution diagnostic already took that decision, in the opposite
 * direction of severity and one field over: `checkNavContributionGroups`
 * yields NOTHING for a contribution whose target app is absent, because "a
 * package may legally contribute into an app shipped by a DIFFERENT artifact
 * installed separately" — reporting the absent-app case there "would refuse the
 * supported cross-artifact case at build time". Both worlds are pinned below,
 * owner inside the artifact and owner outside it, because the false positive
 * was measured in both.
 */
describe('validateTranslationReferences — an app a package contributes into without declaring (#18442)', () => {
  const contribution = {
    app: 'crm_enterprise',
    group: 'group_service',
    priority: 100,
    items: [{ id: 'nav_case', type: 'object', objectName: 'crm_case' }],
  };
  /** The contributor package's own assembled body: contributions, translations, no apps. */
  const contributorBody = (bundleApps: Record<string, unknown>) => ({
    id: 'crm_service',
    navigationContributions: [contribution],
    translations: [{ 'zh-CN': { apps: bundleApps } }],
  });
  /** `packageBodyAsStack(body, entries)` — the body IS its own manifest. */
  const asPerPackageLeg = (body: Record<string, unknown>, entries: unknown[]) => ({
    ...body,
    manifest: body,
    packages: entries,
  });
  const ownerEntry = {
    manifest: {
      id: 'crm_core',
      apps: [{ name: 'crm_enterprise', navigation: [{ id: 'group_service', type: 'group', children: [] }] }],
    },
  };

  it('accepts the label the contributor ships for the item it contributed', () => {
    const body = contributorBody({ crm_enterprise: { navigation: { nav_case: { label: '个案' } } } });
    expect(validateTranslationReferences(asPerPackageLeg(body, [ownerEntry, { manifest: body }]))).toEqual([]);
  });

  it('accepts it with the app owner OUTSIDE the artifact too — the separately installed app', () => {
    const body = contributorBody({ crm_enterprise: { navigation: { nav_case: { label: '个案' } } } });
    expect(validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]))).toEqual([]);
  });

  it('accepts it on the single-`defineStack` shape, contributions on the stack\'s own `manifest`', () => {
    const findings = validateTranslationReferences({
      manifest: { id: 'crm_service', navigationContributions: [contribution] },
      translations: [{ 'zh-CN': { apps: { crm_enterprise: { navigation: { nav_case: { label: '个案' } } } } } }],
    });
    expect(findings).toEqual([]);
  });

  /**
   * Leaf copy under a contribution target resolves too: `stack.translations`
   * merge across the packages of a composition, so the app title a contributor
   * ships is read by the same resolver that reads the owner's. ⛔ This rule
   * judges whether a key RESOLVES, never which package ought to have written
   * it — from a per-package leg it cannot see who owns the app, and an
   * ownership verdict drawn from that blindness is the finding being removed.
   */
  it('accepts leaf copy under a contribution target', () => {
    const body = contributorBody({ crm_enterprise: { label: '企业版 CRM' } });
    expect(validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]))).toEqual([]);
  });

  /**
   * ⭐ The control. The nav rung stays judged under a contribution target — the
   * ids contributed from here are a complete universe for what this package may
   * address — and the diagnosis says which question it answered.
   */
  it('still reports an id nothing contributes, at `error`, with the contribution diagnosis', () => {
    const body = contributorBody({
      crm_enterprise: { navigation: { nav_case: { label: '个案' }, nav_deleted: { label: '没了' } } },
    });
    const findings = validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].apps.crm_enterprise.navigation.nav_deleted',
    });
    expect(findings[0].message).toContain('which this stack contributes into');
    expect(findings[0].hint).toContain('Contributed navigation ids: nav_case.');
  });

  /** ⭐ The other control: the widening is per contributed app, not per key. */
  it('still reports an app this stack neither defines nor contributes into', () => {
    const body = contributorBody({ zzz_not_an_app: { label: '没了' } });
    const findings = validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].apps.zzz_not_an_app',
    });
    expect(findings[0].hint).toContain('Apps this stack defines or contributes into: crm_enterprise.');
  });

  /**
   * A contribution names ONE target app, and that stays true when the target
   * is resolvable only BECAUSE of the contribution — otherwise one widening
   * would make every contributed id addressable under every contributed app.
   */
  it('keeps contributed ids per app', () => {
    const body = {
      id: 'crm_service',
      navigationContributions: [contribution, { app: 'ops_console', items: [{ id: 'nav_ops', type: 'dashboard' }] }],
      translations: [{ 'zh-CN': { apps: { ops_console: { navigation: { nav_case: { label: '个案' } } } } } }],
    };
    const findings = validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].apps.ops_console.navigation.nav_case');
    expect(findings[0].hint).toContain('Contributed navigation ids: nav_ops.');
  });

  it('resolves the app even when no contributed item carries an id, and says so', () => {
    const body = {
      id: 'crm_service',
      navigationContributions: [{ app: 'crm_enterprise', items: [{ type: 'object', objectName: 'crm_case' }] }],
      translations: [{ 'zh-CN': { apps: { crm_enterprise: { navigation: { nav_case: { label: '个案' } } } } } }],
    };
    const findings = validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].apps.crm_enterprise.navigation.nav_case');
    expect(findings[0].hint).toContain('contributes no identified item into "crm_enterprise" at all.');
  });

  /**
   * ⛔ The contribution wording is for contribution targets only: an app this
   * stack DECLARES keeps the diagnosis it had, so the new branch cannot leak
   * into the population #18203 already covers.
   */
  it('leaves the declared-app diagnosis alone', () => {
    const findings = validateTranslationReferences({
      apps: [{ name: 'crm_enterprise', navigation: [{ id: 'group_service', type: 'group', children: [] }] }],
      translations: [{ 'zh-CN': { apps: { crm_enterprise: { navigation: { nav_zzz: { label: '没了' } } } } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('which app "crm_enterprise" does not declare');
    expect(findings[0].hint).toContain('Declared navigation ids: group_service.');
  });
});

/**
 * ⭐ #19064 — the OBJECT rung of the same rule, on the same per-package leg.
 *
 * `os build` judges each package body as its own stack
 * (`packageBodyAsStack(body, entries)`, `compile.ts` step 3b-ii), where the
 * universe's object collection holds what THIS package declares and nothing
 * else. So a package that translates an object a SIBLING package of the same
 * artifact declares had its object key reported `translation-target-unknown`
 * at `error` — "which no object in this stack defines", remedy "Rename the key
 * to the object it was written for, drop it" — in the same words a genuine
 * typo gets, and the run FAILS on it.
 *
 * ⛔ Not a new resolution-context decision. `validateObjectReferences` took it
 * on this exact carrier for object NAMES (#16611 — `artifactProvidedObjectNames`
 * folded into its `resolvable` set), ADR-0130 makes the release artifact the
 * co-ownership boundary, and this rule's own docblock already declared the same
 * reach for this rung while the rung read `stack.objects` alone.
 *
 * What differs from the precedent is the RETURN, and two cases below are what
 * pin it: this universe is keyed by FACTS, not names, so the sibling's fields,
 * options, views, sections and rules are folded WITH the name. A name-only fold
 * would resolve the object key and then judge the owner's own field keys
 * against an empty fact set — the trap `objectExtensionsByTarget` records one
 * level up — and a wholesale subtree SKIP (rung 2b's answer, for a target whose
 * declaration is genuinely invisible from here) would leave this leg unable to
 * see a typo the union leg reports.
 */
describe('validateTranslationReferences — an object a SIBLING package of the artifact declares (#19064)', () => {
  /**
   * `examples/app-multi-package`'s shape — the same corpus
   * `validateObjectReferences`' #16611 block models: `core` owns `crm_account`
   * and `orders` reads it, and here `orders` also TRANSLATES it.
   */
  const CORE_BODY = {
    id: 'com.example.multi.core',
    objects: [
      {
        name: 'crm_account',
        label: 'Account',
        fields: {
          name: { type: 'text', label: 'Name' },
          industry: { type: 'select', label: 'Industry', options: [{ value: 'tech', label: 'Tech' }] },
        },
        validations: [
          {
            name: 'industry_required',
            type: 'cross_field',
            message: 'An industry is required',
            condition: 'record.industry != null',
            fields: ['industry'],
          },
        ],
      },
    ],
  };
  const ordersBody = (bundleObjects: Record<string, unknown>) => ({
    id: 'com.example.multi.orders',
    objects: [{ name: 'crm_order', fields: { number: { type: 'text' } } }],
    translations: [{ 'zh-CN': { objects: bundleObjects } }],
  });
  /** `packageBodyAsStack(body, entries)` — the body IS its own manifest. */
  const asPerPackageLeg = (body: Record<string, unknown>, entries: unknown[]) => ({
    ...body,
    manifest: body,
    packages: entries,
  });
  const perPackageLeg = (bundleObjects: Record<string, unknown>) => {
    const body = ordersBody(bundleObjects);
    return validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }, { manifest: CORE_BODY }]));
  };

  /**
   * ⭐ The reproduction, kept as the control: judged with its own entry alone,
   * the very same bundle still errors. Without this leg "no findings" above is
   * indistinguishable from the rung having gone quiet.
   */
  it('CONTROL — the same package judged ALONE still errors, so the context is what does the work', () => {
    const body = ordersBody({ crm_account: { label: '客户' } });
    const findings = validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }]));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].objects.crm_account',
    });
  });

  it('accepts the object key when a sibling package of the same artifact declares it', () => {
    expect(perPackageLeg({ crm_account: { label: '客户' } })).toEqual([]);
  });

  it("judges the subtree against the SIBLING's declaration — its field, option and rule keys resolve", () => {
    expect(
      perPackageLeg({
        crm_account: {
          label: '客户',
          fields: { industry: { label: '行业', options: { tech: '科技' } } },
          _validations: { industry_required: { message: '行业为必填' } },
        },
      }),
    ).toEqual([]);
  });

  /**
   * ⭐ The false-NEGATIVE control. Widening a universe trades a false positive
   * for a blind spot unless every genuine orphan still reports, so a name no
   * entry of the artifact declares stays an `error` with its rule id intact.
   */
  it('NON-DEGENERACY — a name NO package of the artifact declares still errors', () => {
    const findings = perPackageLeg({ zzz_not_an_object: { label: '没了' } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].objects.zzz_not_an_object',
    });
    // The remedy enumerates what the ARTIFACT provides, not this package's own
    // objects alone — the same reading `validateObjectReferences` pins for the
    // same widening, and the evidence the fold reached this run at all.
    expect(findings[0].hint).toContain('Defined objects: crm_account, crm_order.');
  });

  /** ⭐ The second false-negative control, one rung down: the subtree stays judged. */
  it('NON-DEGENERACY — a field the sibling does not declare is still an `error` under the resolved object', () => {
    const findings = perPackageLeg({ crm_account: { fields: { zzz_gone: { label: '没了' } } } });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: TRANSLATION_TARGET_UNKNOWN,
      severity: 'error',
      path: 'translations[0]["zh-CN"].objects.crm_account.fields.zzz_gone',
    });
    expect(findings[0].hint).toContain('Declared fields: industry, name.');
  });

  it('separates the two directions on ONE bundle — the sibling key is silent, the typo is not', () => {
    const findings = perPackageLeg({
      crm_account: { fields: { industry: { label: '行业' }, zzz_gone: { label: '没了' } } },
      zzz_not_an_object: { label: '没了' },
    });
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0]["zh-CN"].objects.crm_account.fields.zzz_gone',
      'translations[0]["zh-CN"].objects.zzz_not_an_object',
    ]);
  });

  /**
   * ⛔ Only the ADR-0130 D4 entry shape is read. A segment reference carries no
   * manifest content, and inventing a name for one would be the one mistake
   * this context must not make — a name in here SILENCES the ladder.
   */
  it('an entry with no readable body makes nothing addressable', () => {
    const body = ordersBody({ crm_account: { label: '客户' } });
    const findings = validateTranslationReferences(
      asPerPackageLeg(body, [{ manifest: body }, { ref: 'com.example.multi.core@1.0.0', integrity: 'sha512-zzz' }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.crm_account');
  });

  /**
   * Which layer's `options` a merged field ends up carrying is the registry's
   * precedence question, and `checkOptionKeys` is the only consumer of the
   * stored definition here — so the declaration this leg is JUDGING keeps the
   * slot, exactly as the `objectExtensions` fold decided one collection over.
   */
  it("keeps the stack's OWN declaration when a sibling declares the same object name", () => {
    const body = {
      id: 'com.example.multi.orders',
      objects: [{ name: 'crm_account', fields: { industry: { type: 'select', options: [{ value: 'retail' }] } } }],
      translations: [
        { 'zh-CN': { objects: { crm_account: { fields: { industry: { options: { retail: '零售' } } } } } } },
      ],
    };
    expect(
      validateTranslationReferences(asPerPackageLeg(body, [{ manifest: body }, { manifest: CORE_BODY }])),
    ).toEqual([]);
  });

  /**
   * The single-`defineStack` shape is untouched: `objects` is a STACK
   * collection, not a manifest key, so there is no `stack.manifest.objects`
   * form to read and a bundle keyed to a name nothing declares still errors.
   */
  it('leaves the single-stack shape alone — no `packages[]`, no widening', () => {
    const findings = validateTranslationReferences({
      objects: [{ name: 'crm_order', fields: { number: { type: 'text' } } }],
      translations: [{ 'zh-CN': { objects: { crm_account: { label: '客户' } } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.crm_account');
  });
});

describe('validateTranslationReferences — flows (#7646 / #11287)', () => {
  /**
   * One stack, shared by every case below — the clean run and the three
   * orphan runs differ ONLY in the bundle, so "no findings" is a verdict about
   * this metadata rather than a rule that never reached it.
   */
  const flowStack = {
    objects: [{ name: 'crm_lead', fields: { name: { type: 'text' }, owner: { type: 'lookup' } } }],
    flows: [
      {
        name: 'lead_conversion',
        type: 'screen',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'gate', type: 'decision', label: 'Qualified?' },
          {
            id: 'details',
            type: 'screen',
            label: 'Details',
            config: {
              title: 'Conversion Details',
              fields: [
                { name: 'opportunity_name', label: 'Opportunity Name' },
                { name: 'close_date', label: 'Close Date' },
              ],
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'gate' },
          { id: 'e2', source: 'gate', target: 'details' },
        ],
      },
    ],
  };

  const bundle = (flows: unknown) => ({ ...flowStack, translations: [{ 'zh-CN': { flows } }] });

  /**
   * The universe the collector actually reached, read back out of the rule's
   * OWN hint — the tail `listNames()` prints.
   *
   * This is the assertion the leg exists for. A universe collector that
   * silently reaches nothing reports nothing, which is indistinguishable from
   * a leg that looked and found no orphans; here the collected names come back
   * through the production code path, so a collector that reached nothing
   * prints an empty tail and fails.
   */
  const enumeratedUniverse = (hint: string, lead: string): string[] => {
    const matched = new RegExp(`${lead}: ([^.]*)\\.`).exec(hint);
    return matched ? matched[1].split(', ').filter(Boolean) : [];
  };

  it('reports nothing when the flow, the screen node and the field all resolve', () => {
    const findings = validateTranslationReferences(
      bundle({
        lead_conversion: {
          label: '线索转换',
          screens: {
            details: {
              title: '转换详情',
              fields: {
                opportunity_name: { label: '商机名称', placeholder: '请输入' },
                close_date: { label: '预计成交日期' },
              },
            },
          },
        },
      }),
    );
    expect(findings).toEqual([]);
  });

  it('fires on an orphan at level 1 — the flow name — and enumerates a non-empty flow universe', () => {
    const findings = validateTranslationReferences(
      bundle({ lead_conversions: { label: 'x', screens: { details: { title: 'y' } } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(TRANSLATION_TARGET_UNKNOWN);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].flows.lead_conversions');
    expect(findings[0].message).toContain('Did you mean "lead_conversion"?');
    // ⭐ the collector reached a real flow, so the zero above is a reading.
    expect(enumeratedUniverse(findings[0].hint, 'Defined flows')).toEqual(['lead_conversion']);
  });

  it('fires on an orphan at level 2 — the screen node id — and enumerates a non-empty screen universe', () => {
    const findings = validateTranslationReferences(
      bundle({ lead_conversion: { label: '线索转换', screens: { detail: { title: 'y' } } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('translations[0]["zh-CN"].flows.lead_conversion.screens.detail');
    expect(findings[0].message).toContain('Did you mean "details"?');
    expect(findings[0].hint).toContain('ScreenSpec.nodeId');
    expect(enumeratedUniverse(findings[0].hint, 'Declared screen node ids')).toEqual(['details']);
  });

  it('fires on an orphan at level 3 — the screen field name — and enumerates a non-empty field universe', () => {
    const findings = validateTranslationReferences(
      bundle({
        lead_conversion: {
          screens: { details: { title: '转换详情', fields: { opportunity: { label: 'x' } } } },
        },
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe(
      'translations[0]["zh-CN"].flows.lead_conversion.screens.details.fields.opportunity',
    );
    expect(findings[0].message).toContain('Did you mean "opportunity_name"?');
    expect(enumeratedUniverse(findings[0].hint, 'Declared screen field names')).toEqual([
      'close_date',
      'opportunity_name',
    ]);
  });

  it('diagnoses a key on a real node of the wrong type as such, not as a missing node', () => {
    const findings = validateTranslationReferences(
      bundle({ lead_conversion: { screens: { gate: { title: 'x' } } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('declares as a `decision` node, not a `screen`');
  });

  it('resolves a screen nested in an ADR-0031 region — the runner pauses on it, so its keys are not orphans', () => {
    const nestedStack = {
      flows: [
        {
          name: 'lead_conversion',
          type: 'screen',
          nodes: [
            {
              id: 'per_lead',
              type: 'loop',
              label: 'Each Lead',
              config: {
                collection: '{leads}',
                body: {
                  nodes: [
                    {
                      id: 'nested_screen',
                      type: 'screen',
                      label: 'Confirm',
                      config: { fields: [{ name: 'confirmed', label: 'Confirmed' }] },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    };
    const nestedBundle = (screens: unknown) => ({
      ...nestedStack,
      translations: [{ 'zh-CN': { flows: { lead_conversion: { screens } } } }],
    });

    expect(
      validateTranslationReferences(
        nestedBundle({ nested_screen: { title: '确认', fields: { confirmed: { label: '已确认' } } } }),
      ),
    ).toEqual([]);

    // …and the same nested universe still judges: one letter off and it fires,
    // so the green above is a resolution rather than an unreached subtree.
    const findings = validateTranslationReferences(
      nestedBundle({ nested_screen: { fields: { confirme: { label: '已确认' } } } }),
    );
    expect(findings).toHaveLength(1);
    expect(enumeratedUniverse(findings[0].hint, 'Declared screen field names')).toEqual(['confirmed']);
  });

  it('redirects a field key on an object-form screen to the objects group', () => {
    const findings = validateTranslationReferences({
      ...flowStack,
      flows: [
        {
          name: 'lead_conversion',
          type: 'screen',
          nodes: [
            { id: 'edit_lead', type: 'screen', label: 'Edit', config: { objectName: 'crm_lead', mode: 'edit' } },
          ],
        },
      ],
      translations: [
        {
          'zh-CN': {
            flows: { lead_conversion: { screens: { edit_lead: { title: '编辑', fields: { owner: { label: '负责人' } } } } } },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('OBJECT-FORM screen');
    expect(findings[0].hint).toContain('objects.crm_lead.fields.owner');
  });

  it('accepts a flow map keyed by name, the normalized stack shape', () => {
    const findings = validateTranslationReferences({
      flows: {
        lead_conversion: {
          type: 'screen',
          nodes: [{ id: 'details', type: 'screen', label: 'D', config: { fields: [{ name: 'opportunity_name' }] } }],
        },
      },
      translations: [
        { 'zh-CN': { flows: { lead_conversion: { screens: { details: { fields: { opportunity_name: { label: 'x' } } } } } } } },
      ],
    });
    expect(findings).toEqual([]);
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
 * #13835 — the `_tabs` leg, the `flows` leg of #11608 one group over.
 *
 * The asymmetry it closes: `collectExpectedEntries` already emits
 * `objects.<obj>._tabs.<tab>.label` and `os i18n check` DEMANDS a translation
 * for it, while this rule walked `fields` / `options` / `_views` / `_sections` /
 * `_actions` and never `_tabs` — so a key naming a preset that had been renamed
 * away warned nobody, and the tab bar rendered in the source locale above a
 * fully localized grid with every gate green.
 *
 * A list page carrying `interfaceConfig.userFilters.tabs` is the fixture shape
 * throughout, because it is the only carrier of `ViewTabSchema` that anything
 * renders (`translateInterfaceTabs`).
 */
describe('validateTranslationReferences — filter-preset tabs (#13835)', () => {
  /** A lead list page whose preset bar declares `urgent` and `mine`. */
  const tabStack = (translations: unknown[], page?: Record<string, unknown>) => ({
    objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
    pages: [
      page ?? {
        name: 'lead_list',
        object: 'crm_lead',
        interfaceConfig: {
          userFilters: {
            element: 'tabs',
            tabs: [
              { name: 'urgent', label: 'Urgent', filter: [] },
              { name: 'mine', label: 'Mine', filter: [] },
            ],
          },
        },
      },
    ],
    translations,
  });

  it('flags a `_tabs` key naming a preset no page declares', () => {
    const findings = validateTranslationReferences(
      tabStack([
        { 'zh-CN': { objects: { crm_lead: { _tabs: { overdue: { label: '逾期' } } } } } },
      ]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(TRANSLATION_TARGET_UNKNOWN);
    expect(findings[0].path).toBe('translations[0]["zh-CN"].objects.crm_lead._tabs.overdue');
    expect(findings[0].hint).toContain('Declared tabs: mine, urgent.');
  });

  it('accepts a `_tabs` key naming a declared preset', () => {
    const findings = validateTranslationReferences(
      tabStack([
        { 'zh-CN': { objects: { crm_lead: { _tabs: { urgent: { label: '紧急' }, mine: { label: '我的' } } } } } },
      ]),
    );
    expect(findings).toEqual([]);
  });

  // The false-negative direction, stated as one falsifiable pair: without the
  // leg BOTH bundles above are silent, so "orphan reported" alone does not
  // distinguish this rule from one that reports every `_tabs` key. The valid
  // half is what makes the orphan half mean something.
  it('separates the two directions on ONE stack', () => {
    const findings = validateTranslationReferences(
      tabStack([
        {
          en: {
            objects: {
              crm_lead: { _tabs: { urgent: { label: 'Urgent' }, overdue: { label: 'Overdue' } } },
            },
          },
        },
      ]),
    );
    expect(findings.map((f) => f.path)).toEqual([
      'translations[0].en.objects.crm_lead._tabs.overdue',
    ]);
  });

  it('binds tabs by `interfaceConfig.source` over the page-level `object`', () => {
    // The resolver's own order (`translateInterfaceTabs`): the preset bar
    // filters the records `interfaceConfig.source` names, which need not be the
    // page's record binding. Both directions in one fixture — "crm_lead is
    // still reported" alone would pass just as well if the page contributed
    // nothing at all, and it is the `crm_contact` half that falsifies that.
    const stack = (objectName: string) => ({
      objects: [
        { name: 'crm_lead', fields: { name: { type: 'text' } } },
        { name: 'crm_contact', fields: { name: { type: 'text' } } },
      ],
      pages: [
        {
          name: 'mixed',
          object: 'crm_lead',
          interfaceConfig: {
            source: 'crm_contact',
            userFilters: { element: 'tabs', tabs: [{ name: 'urgent', filter: [] }] },
          },
        },
      ],
      translations: [{ en: { objects: { [objectName]: { _tabs: { urgent: { label: 'Urgent' } } } } } }],
    });

    expect(validateTranslationReferences(stack('crm_contact'))).toEqual([]);

    const findings = validateTranslationReferences(stack('crm_lead'));
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._tabs.urgent');
  });

  it('de-duplicates one preset name authored on several pages over the same object', () => {
    // `walkObjectTabs` de-duplicates through an index so it emits each key
    // once; the universe is a Set, which is the same fact with nothing to
    // choose between two authorings. Pinned because a per-page fact set would
    // still ACCEPT this bundle — the observable difference is the hint.
    const findings = validateTranslationReferences({
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      pages: [
        {
          name: 'lead_list',
          object: 'crm_lead',
          interfaceConfig: { userFilters: { tabs: [{ name: 'urgent', filter: [] }] } },
        },
        {
          name: 'lead_board',
          object: 'crm_lead',
          interfaceConfig: { userFilters: { tabs: [{ name: 'urgent', filter: [] }, { name: 'mine', filter: [] }] } },
        },
      ],
      translations: [{ en: { objects: { crm_lead: { _tabs: { ghost: { label: 'Ghost' } } } } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toContain('Declared tabs: mine, urgent.');
  });

  it('says so when the object declares no preset bar at all, and names the dead carrier', () => {
    // `ListViewSchema.tabs` is `ViewTabSchema`'s other carrier and has no
    // renderer in either repo, so a `_tabs` key written for one resolves
    // nowhere. The hint has to say that, or an author reads the finding as a
    // bug in the rule and "fixes" it by moving the tab to a list view.
    const findings = validateTranslationReferences({
      objects: [{ name: 'crm_lead', fields: { name: { type: 'text' } } }],
      views: [
        {
          name: 'lead_list',
          objectName: 'crm_lead',
          tabs: [{ name: 'urgent', label: 'Urgent' }],
        },
      ],
      translations: [{ en: { objects: { crm_lead: { _tabs: { urgent: { label: 'Urgent' } } } } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('translations[0].en.objects.crm_lead._tabs.urgent');
    expect(findings[0].hint).toContain('declares a filter-preset tab bar at all');
    expect(findings[0].hint).toContain("list view's own `tabs` has no renderer");
  });

  it('reads the preset bar on a source-authored page, which the component walk skips', () => {
    // `walkPageComponents` skips `kind: 'html' | 'react' | 'jsx'` because their
    // `regions` are a derived cache. `interfaceConfig` is authored metadata at
    // the page root, and neither `translateInterfaceTabs` nor `walkObjectTabs`
    // consults `kind` — so skipping it here would report a key the runtime
    // resolves.
    const findings = validateTranslationReferences(
      tabStack(
        [{ en: { objects: { crm_lead: { _tabs: { urgent: { label: 'Urgent' } } } } } }],
        {
          name: 'lead_list',
          kind: 'react',
          object: 'crm_lead',
          source: 'export default () => null;',
          interfaceConfig: { userFilters: { tabs: [{ name: 'urgent', filter: [] }] } },
        },
      ),
    );
    expect(findings).toEqual([]);
  });

  it('suggests the near-miss spelling of a real preset', () => {
    const findings = validateTranslationReferences(
      tabStack([{ en: { objects: { crm_lead: { _tabs: { urgnt: { label: 'Urgent' } } } } } }]),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "urgent"?');
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

/**
 * #13835 — the coverage pin: the object branch's legs, held equal to
 * `ObjectTranslationDataSchema`'s key set.
 *
 * **Why a pin rather than a comment.** `_tabs` was not skipped by anyone's
 * decision — it arrived after the object branch was written, and the branch had
 * no way to notice. That is a defect of the CLASS "a group joined the shape and
 * no leg followed", and the same silence is available to the next group. This
 * ledger is the mechanical answer: it names every key the schema declares and
 * what this rule does about it, and the first assertion holds the two sets
 * equal, so a new group fails HERE — at a test whose name says what is missing
 * — rather than shipping a demanded-but-unchecked key.
 *
 * **The classification is not self-certifying.** A ledger of names alone would
 * let a new group be waved through by writing one line, which is the same
 * silence one layer up. So every `reference-checked` entry carries a bundle
 * whose key names something the stack does not declare, and the second
 * assertion requires that bundle to actually produce a finding. Claiming
 * coverage therefore costs a working leg; the only cheap route is
 * `leaf-copy`, which has to state a reason and is a deliberate, reviewable act.
 */
describe('validateTranslationReferences — object-branch coverage vs the schema (#13835)', () => {
  /** A stack declaring one real instance of every referenceable group. */
  const coverageStack = (objectNode: Record<string, unknown>) => ({
    objects: [
      {
        name: 'crm_lead',
        fields: { name: { type: 'text', label: 'Name' } },
        fieldGroups: [{ key: 'basics', label: 'Basics' }],
        actions: [{ name: 'convert_lead', label: 'Convert' }],
        validations: [{ name: 'lead_needs_name', type: 'script', message: 'Name is required' }],
      },
    ],
    views: [{ name: 'open_leads', objectName: 'crm_lead', label: 'Open Leads' }],
    pages: [
      {
        name: 'lead_list',
        object: 'crm_lead',
        interfaceConfig: { userFilters: { tabs: [{ name: 'urgent', filter: [] }] } },
      },
    ],
    translations: [{ en: { objects: { crm_lead: objectNode } } }],
  });

  type Coverage =
    | { kind: 'reference-checked'; ghost: Record<string, unknown>; path: string }
    | { kind: 'leaf-copy'; why: string };

  /**
   * Every key of `ObjectTranslationDataSchema`, and this rule's disposition.
   *
   * `leaf-copy` is the honest classification for a key whose VALUE is prose:
   * there is no identifier in it to resolve, so there is no reference to check
   * and a leg would have nothing to say. Group keys are the opposite — each is
   * a record keyed by a machine name that either exists in this stack or does
   * not.
   */
  const COVERAGE: Record<string, Coverage> = {
    label: { kind: 'leaf-copy', why: "the object's own translated label — prose, no identifier to resolve" },
    pluralLabel: { kind: 'leaf-copy', why: 'prose' },
    description: { kind: 'leaf-copy', why: 'prose' },
    fields: {
      kind: 'reference-checked',
      ghost: { fields: { ghost_field: { label: 'Ghost' } } },
      path: 'translations[0].en.objects.crm_lead.fields.ghost_field',
    },
    _views: {
      kind: 'reference-checked',
      ghost: { _views: { ghost_view: { label: 'Ghost' } } },
      path: 'translations[0].en.objects.crm_lead._views.ghost_view',
    },
    _sections: {
      kind: 'reference-checked',
      ghost: { _sections: { ghost_section: { label: 'Ghost' } } },
      path: 'translations[0].en.objects.crm_lead._sections.ghost_section',
    },
    _actions: {
      kind: 'reference-checked',
      ghost: { _actions: { ghost_action: { label: 'Ghost' } } },
      path: 'translations[0].en.objects.crm_lead._actions.ghost_action',
    },
    _tabs: {
      kind: 'reference-checked',
      ghost: { _tabs: { ghost_tab: { label: 'Ghost' } } },
      path: 'translations[0].en.objects.crm_lead._tabs.ghost_tab',
    },
    _validations: {
      kind: 'reference-checked',
      ghost: { _validations: { ghost_rule: { message: 'Ghost' } } },
      path: 'translations[0].en.objects.crm_lead._validations.ghost_rule',
    },
  };

  it('classifies every key `ObjectTranslationDataSchema` declares, and no key it does not', () => {
    // Read off the schema itself, so the pin tracks the contract rather than a
    // transcription of it that can drift.
    const declared = Object.keys(
      (ObjectTranslationDataSchema as unknown as { shape: Record<string, unknown> }).shape,
    ).sort();
    expect(Object.keys(COVERAGE).sort()).toEqual(declared);
  });

  it('backs every `reference-checked` claim with a leg that actually reports', () => {
    for (const [key, coverage] of Object.entries(COVERAGE)) {
      if (coverage.kind !== 'reference-checked') continue;
      const findings = validateTranslationReferences(coverageStack(coverage.ghost));
      expect(findings.map((f) => f.path), `group "${key}" has no working leg`).toEqual([coverage.path]);
      expect(findings[0].rule).toBe(TRANSLATION_TARGET_UNKNOWN);
    }
  });

  it('accepts a bundle that names the real instance of every group at once', () => {
    // The over-reporting control for the assertion above: the same eight-key
    // shape, spelled correctly, must be silent — otherwise "one finding per
    // ghost" could be a rule that reports everything.
    const findings = validateTranslationReferences(
      coverageStack({
        label: 'Lead',
        pluralLabel: 'Leads',
        description: 'A sales lead',
        fields: { name: { label: 'Name' } },
        _views: { open_leads: { label: 'Open' } },
        _sections: { basics: { label: 'Basics' } },
        _actions: { convert_lead: { label: 'Convert' } },
        _tabs: { urgent: { label: 'Urgent' } },
        _validations: { lead_needs_name: { message: 'A name is required' } },
      }),
    );
    expect(findings).toEqual([]);
  });
});
