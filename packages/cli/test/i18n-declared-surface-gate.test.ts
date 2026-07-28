// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#3370 — "declared metadata is localizable" has to hold for the
// WHOLE declared surface, not just object and field labels.
//
// The leak that prompted this: `sys_approval_request` declares its decision
// actions INLINE on the object, and the coverage detector only ever walked the
// TOP-LEVEL `config.actions` array. So Approve / Reject / Reassign were
// extractable but ungated — they shipped English into a zh-CN workspace and no
// lint run could notice. Coverage now shares the extractor's walker, so any
// surface `os i18n extract` can scaffold is a surface `os lint` can gate.
//
// The other half of the contract, and the reason this file leads with it: a
// project that does not do i18n must stay at ZERO issues. The gate is opt-in by
// construction — it only checks locales the project itself declared, via an
// `i18n.supportedLocales` block or by shipping a bundle. Break that and every
// monolingual customer project starts failing lint for a feature it never asked
// for.

import { describe, it, expect } from 'vitest';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { collectExpectedEntries } from '../src/utils/i18n-extract';

/** Only the user's own metadata; the platform metadata-form baseline is folded away by `os lint`. */
const userIssues = (report: { issues: Array<{ source: string }> }) =>
  report.issues.filter((i) => i.source !== 'metadataForm');

/** An object that declares its actions inline — the `sys_approval_request` shape. */
const approvalLike = {
  name: 'sys_approval_request',
  label: 'Approval Request',
  fields: { status: { label: 'Status' } },
  actions: [
    {
      name: 'approval_approve',
      label: 'Approve',
      successMessage: 'Approved.',
      params: [{ name: 'comment', label: 'Comment' }],
    },
    {
      name: 'approval_reject',
      label: 'Reject',
      confirmText: 'Reject this request?',
    },
  ],
};

describe('a project that does not do i18n', () => {
  it('reports nothing — no bundles, no i18n block, labels authored inline', () => {
    const report = computeI18nCoverage({ objects: [approvalLike] });

    expect(report.locales).toEqual(['en']);
    expect(userIssues(report)).toEqual([]);
  });

  it('stays silent when the source language is not English', () => {
    // Labels authored in Chinese, no bundles, no declared locales. The inline
    // label IS the source text whatever language it happens to be in — telling
    // this project it "owes an en translation" would be pure noise.
    const report = computeI18nCoverage({
      i18n: { defaultLocale: 'zh-CN', supportedLocales: ['zh-CN'] },
      objects: [
        {
          name: 'kehu',
          label: '客户',
          fields: { name: { label: '名称' } },
          actions: [{ name: 'merge', label: '合并' }],
        },
      ],
    });

    expect(report.defaultLocale).toBe('zh-CN');
    expect(userIssues(report)).toEqual([]);
  });
});

describe('declared action labels are gated (objectstack#3370)', () => {
  // A zh-CN bundle that translates the object but forgets the decision actions
  // — exactly the state that shipped English buttons into the approval drawer.
  const configMissingActionLabels = {
    objects: [approvalLike],
    translations: [
      {
        'zh-CN': {
          objects: {
            sys_approval_request: {
              label: '审批请求',
              fields: { status: { label: '状态' } },
            },
          },
        },
      },
    ],
  };

  it('flags an inline-declared action label with no translation', () => {
    const keys = computeI18nCoverage(configMissingActionLabels).issues.map((i) => i.key);

    expect(keys).toContain('objects.sys_approval_request._actions.approval_approve.label');
    expect(keys).toContain('objects.sys_approval_request._actions.approval_reject.label');
  });

  it('flags the rest of an action\'s declared copy too', () => {
    const keys = computeI18nCoverage(configMissingActionLabels).issues.map((i) => i.key);

    expect(keys).toContain('objects.sys_approval_request._actions.approval_approve.successMessage');
    expect(keys).toContain('objects.sys_approval_request._actions.approval_reject.confirmText');
    expect(keys).toContain('objects.sys_approval_request._actions.approval_approve.params.comment.label');
  });

  it('attributes them to the action source so `os lint` does not fold them as platform noise', () => {
    const actionIssues = computeI18nCoverage(configMissingActionLabels).issues.filter(
      (i) => i.key.includes('_actions.approval_approve'),
    );

    expect(actionIssues.length).toBeGreaterThan(0);
    for (const issue of actionIssues) expect(issue.source).toBe('action');
  });

  it('goes quiet once the labels are translated', () => {
    const report = computeI18nCoverage({
      objects: [approvalLike],
      translations: [
        {
          'zh-CN': {
            objects: {
              sys_approval_request: {
                label: '审批请求',
                fields: { status: { label: '状态' } },
                _actions: {
                  approval_approve: {
                    label: '通过',
                    successMessage: '已通过。',
                    params: { comment: { label: '审批意见' } },
                  },
                  approval_reject: { label: '拒绝', confirmText: '拒绝该请求？' },
                },
              },
            },
          },
        },
      ],
    });

    expect(userIssues(report)).toEqual([]);
  });
});

describe('the i18n block declares which locales are gated', () => {
  const config = {
    i18n: { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN', 'ja-JP'] },
    objects: [approvalLike],
  };

  it('checks every declared locale even when no bundle exists for it yet', () => {
    // Without the block this project would be checked against 'en' alone (no
    // bundles to discover), and a wholly untranslated zh-CN would pass.
    const report = computeI18nCoverage(config);

    expect(report.locales.sort()).toEqual(['en', 'ja-JP', 'zh-CN']);
    const zhKeys = report.issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key);
    expect(zhKeys).toContain('objects.sys_approval_request._actions.approval_approve.label');
  });

  it('keeps the default locale satisfied by the inline labels', () => {
    const enIssues = userIssues(computeI18nCoverage(config)).filter((i) => i.locale === 'en');

    expect(enIssues).toEqual([]);
  });

  it('promotes declared-locale gaps to errors under --i18n-strict', () => {
    const relaxed = computeI18nCoverage(config).issues.filter((i) => i.locale === 'zh-CN');
    const strict = computeI18nCoverage(config, { strict: true }).issues.filter((i) => i.locale === 'zh-CN');

    expect(relaxed.every((i) => i.severity === 'warning')).toBe(true);
    expect(strict.every((i) => i.severity === 'error')).toBe(true);
  });
});

describe('the gated surface tracks the extractable surface', () => {
  // One walker feeds both `os i18n extract` and the coverage gate. If someone
  // re-forks them, a surface goes extractable-but-ungated again and this fails.
  const kitchenSink: any = {
    objects: [
      {
        name: 'account',
        label: 'Account',
        description: 'Customer accounts',
        fields: { name: { label: 'Name', help: 'Legal name', placeholder: 'Acme Inc.' } },
        listViews: { recent: { label: 'Recent', description: 'Last 30 days' } },
        actions: [
          {
            name: 'merge',
            label: 'Merge',
            params: [{ name: 'target', label: 'Target', helpText: 'Account to merge into' }],
            resultDialog: { title: 'Merged', acknowledge: 'Done' },
          },
        ],
      },
    ],
    apps: [{ name: 'sales', label: 'Sales', navigation: [{ id: 'home', label: 'Home' }] }],
    dashboards: [{ name: 'pipeline', label: 'Pipeline', widgets: [{ id: 'won', title: 'Won' }] }],
    pages: [{ name: 'about', label: 'About' }],
    translations: [{ 'zh-CN': {} }],
  };

  it('gates every authored string the extractor can scaffold', () => {
    const authored = collectExpectedEntries(kitchenSink)
      .filter((e) => e.inline !== undefined && e.source !== 'metadataType'
        && e.source !== 'metadataFormSection' && e.source !== 'metadataFormField')
      .map((e) => e.path.join('.'));
    const gated = new Set(
      computeI18nCoverage(kitchenSink).issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key),
    );

    expect(authored.length).toBeGreaterThan(10);
    expect(authored.filter((key) => !gated.has(key))).toEqual([]);
  });

  it('covers the surfaces the old detector walked past', () => {
    const gated = new Set(
      computeI18nCoverage(kitchenSink).issues.filter((i) => i.locale === 'zh-CN').map((i) => i.key),
    );

    for (const key of [
      'objects.account.description',
      'objects.account.fields.name.help',
      'objects.account.fields.name.placeholder',
      'objects.account._views.recent.label',
      'objects.account._actions.merge.label',
      'objects.account._actions.merge.params.target.label',
      'objects.account._actions.merge.resultDialog.title',
      'apps.sales.label',
      'apps.sales.navigation.home.label',
      'dashboards.pipeline.label',
      'dashboards.pipeline.widgets.won.title',
      'pages.about.label',
    ]) {
      expect({ key, gated: gated.has(key) }).toEqual({ key, gated: true });
    }
  });
});
