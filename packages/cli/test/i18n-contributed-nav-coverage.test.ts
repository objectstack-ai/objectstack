// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#24993 — a navigation item a package CONTRIBUTES into another
// package's app (`manifest.navigationContributions`, ADR-0029 D7) owes its
// translation under the TARGET app, like an item the app declares itself.
//
// The runtime folds a contributed item into the target app's navigation and
// `translateApp` resolves its label from `apps.<target>.navigation.<id>.label`;
// `translation-target-unknown` accepts that key (#18203). The walker read
// `apps[].navigation` only, so the key was never expected: deleting a
// contributed item's zh-CN label left `os lint --strict` and `os i18n check`
// green, measured on HotCRM's `nav_case`, while the same deletion on one of
// the app's own items reported `i18n/missing-navigation`.
//
// The fixture is the card's shape: a service module contributing into the
// app's group and adding a group of its own, composed module-first with
// `manifest: 'preserve'`, so the contributions live only in the module's
// `packages[]` body. Both doors hand `computeI18nCoverage` the
// `authoringRuleUnionStack` of that composition, which is what these pins do.

import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';
import { TRANSLATION_TARGET_UNKNOWN, validateTranslationReferences } from '@objectstack/lint';

import { collectExpectedEntries } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage } from '../src/utils/i18n-coverage.js';
import { authoringRuleUnionStack } from '../src/utils/stack-collections.js';

const I18N = { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' };
const engines = { protocol: '^18' };

const appManifest = {
  id: 'com.example.cnav.app', name: 'Contributed Nav App', namespace: 'cnv', version: '1.0.0', type: 'app', engines,
};

/** Into the app's own group, and a group of the module's own with a child. */
const CONTRIBUTIONS = [
  {
    app: 'cnv_desk',
    group: 'grp_service',
    items: [{ id: 'nav_case', type: 'object', objectName: 'cnv_case', label: 'Cases' }],
  },
  {
    app: 'cnv_desk',
    items: [{
      id: 'grp_knowledge',
      type: 'group',
      label: 'Knowledge',
      children: [{ id: 'nav_article', type: 'object', objectName: 'cnv_article', label: 'Articles' }],
    }],
  },
];

const svcManifest = {
  id: 'com.example.cnav.svc', name: 'Contributed Nav Service', namespace: 'cnv', version: '1.0.0', type: 'module', engines,
  navigationContributions: CONTRIBUTIONS,
};

const object = (name: string, label: string) => ({
  name, label, pluralLabel: label, sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
});

const app = {
  name: 'cnv_desk',
  label: 'Desk',
  navigation: [{
    id: 'grp_service',
    type: 'group',
    label: 'Service',
    children: [{ id: 'nav_accounts', type: 'object', objectName: 'cnv_account', label: 'Accounts' }],
  }],
};

/** The zh-CN navigation labels, every one present; a case deletes one. */
const OWN_NAV_ZH = { grp_service: { label: '服务' }, nav_accounts: { label: '客户' } };
const CONTRIBUTED_NAV_ZH = { nav_case: { label: '工单' }, grp_knowledge: { label: '知识' }, nav_article: { label: '文章' } };

const without = (labels: Record<string, unknown>, id?: string) =>
  Object.fromEntries(Object.entries(labels).filter(([key]) => key !== id));

/** The app package carries the app's own labels; the module, the labels of what it contributes. */
function stacks(drop?: string) {
  const appStack = defineStack({
    manifest: appManifest,
    objects: [object('cnv_account', 'Account')],
    apps: [app],
    i18n: I18N,
    translations: [{ 'zh-CN': { apps: { cnv_desk: { label: '服务台', navigation: without(OWN_NAV_ZH, drop) } } } }],
  } as any);
  const svcStack = defineStack({
    manifest: svcManifest,
    objects: [object('cnv_case', 'Case'), object('cnv_article', 'Article')],
    i18n: I18N,
    translations: [{ 'zh-CN': { apps: { cnv_desk: { navigation: without(CONTRIBUTED_NAV_ZH, drop) } } } }],
  } as any);
  return { appStack, svcStack };
}

/** Module first, as HotCRM composes it: the top-level manifest is the app's. */
function composed(drop?: string): Record<string, unknown> {
  const { appStack, svcStack } = stacks(drop);
  return authoringRuleUnionStack(composeStacks([svcStack, appStack], { manifest: 'preserve' }) as any);
}

const navEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'apps' && e.path[2] === 'navigation');

const zhNavIssueKeys = (config: any) =>
  computeI18nCoverage(config, { strict: true }).issues
    .filter((i) => i.locale === 'zh-CN' && i.source === 'navigation')
    .map((i) => i.key);

describe('what the walker expects from a contributed navigation item (#24993)', () => {
  it('reads the contributions from the module\'s package body alone — the fixture is the card\'s shape', () => {
    const stack = composed() as any;
    expect(stack.manifest.navigationContributions).toBeUndefined();
    expect(stack.packages.map((p: any) => p.manifest.navigationContributions?.length ?? 0)).toEqual([2, 0]);
  });

  it('expects each contributed item under the TARGET app, seeded with its own label, after the app\'s own items', () => {
    const entries = navEntries(composed());
    expect(entries.map((e) => e.path.join('.'))).toEqual([
      'apps.cnv_desk.navigation.grp_service.label',
      'apps.cnv_desk.navigation.nav_accounts.label',
      'apps.cnv_desk.navigation.nav_case.label',
      'apps.cnv_desk.navigation.grp_knowledge.label',
      'apps.cnv_desk.navigation.nav_article.label',
    ]);
    expect(entries[2]).toMatchObject({ sourceValue: 'Cases', inline: 'Cases', source: 'navigation', appName: 'cnv_desk' });
    expect(entries[4]).toMatchObject({ sourceValue: 'Articles', inline: 'Articles', source: 'navigation', appName: 'cnv_desk' });
  });

  it('reads a single stack\'s own manifest too, keyed under an app the stack only contributes into', () => {
    const single = defineStack({
      manifest: { ...svcManifest, navigationContributions: [{ app: 'crm_enterprise', items: CONTRIBUTIONS[0].items }] },
      objects: [object('cnv_case', 'Case')],
    } as any);
    expect(navEntries(single).map((e) => e.path.join('.'))).toEqual(['apps.crm_enterprise.navigation.nav_case.label']);
  });

  it('expects each key once when the top-level manifest is the contributor\'s copy', () => {
    const { appStack, svcStack } = stacks();
    const appLast = authoringRuleUnionStack(composeStacks([appStack, svcStack], { manifest: 'preserve' }) as any) as any;
    // Both carriers hold the module's contributions here.
    expect(appLast.manifest.navigationContributions).toHaveLength(2);
    expect(navEntries(appLast).map((e) => e.path.join('.'))).toEqual([
      'apps.cnv_desk.navigation.grp_service.label',
      'apps.cnv_desk.navigation.nav_accounts.label',
      'apps.cnv_desk.navigation.nav_case.label',
      'apps.cnv_desk.navigation.grp_knowledge.label',
      'apps.cnv_desk.navigation.nav_article.label',
    ]);
  });

  it('keeps the app\'s own entry when a contribution reuses one of its ids', () => {
    const config = {
      apps: [app],
      manifest: { navigationContributions: [{ app: 'cnv_desk', items: [{ id: 'nav_accounts', type: 'url', url: '/x', label: 'Elsewhere' }] }] },
    };
    const entries = navEntries(config);
    expect(entries.map((e) => e.path.join('.'))).toEqual([
      'apps.cnv_desk.navigation.grp_service.label',
      'apps.cnv_desk.navigation.nav_accounts.label',
    ]);
    expect(entries[1].sourceValue).toBe('Accounts');
  });
});

describe('the coverage gate reports a missing contributed item as it reports an own one (#24993)', () => {
  it('reports no navigation gap while every label is translated', () => {
    expect(zhNavIssueKeys(composed())).toEqual([]);
  });

  it('reports a deleted contributed item', () => {
    expect(zhNavIssueKeys(composed('nav_case'))).toEqual(['apps.cnv_desk.navigation.nav_case.label']);
  });

  it('reports a deleted child of a contributed group', () => {
    expect(zhNavIssueKeys(composed('nav_article'))).toEqual(['apps.cnv_desk.navigation.nav_article.label']);
  });

  it('control: reports a deleted item the app declares itself, as before', () => {
    expect(zhNavIssueKeys(composed('nav_accounts'))).toEqual(['apps.cnv_desk.navigation.nav_accounts.label']);
  });

  it('reports the deleted key once when both carriers hold the contribution', () => {
    const { appStack, svcStack } = stacks('nav_case');
    const appLast = authoringRuleUnionStack(composeStacks([appStack, svcStack], { manifest: 'preserve' }) as any);
    expect(zhNavIssueKeys(appLast)).toEqual(['apps.cnv_desk.navigation.nav_case.label']);
  });
});

describe('every contributed key the walker expects is one translation-target-unknown accepts (#24993)', () => {
  /** A zh-CN bundle carrying exactly the navigation keys the walker expects. */
  const bundleOf = (config: any) => {
    const navigation: Record<string, { label: string }> = {};
    const apps: Record<string, { navigation: typeof navigation }> = {};
    for (const entry of navEntries(config)) {
      const [, appName, , id] = entry.path;
      apps[appName] ??= { navigation: {} };
      apps[appName].navigation[id] = { label: 'x' };
    }
    return { 'zh-CN': { apps } };
  };
  const unknownTargets = (stack: any, bundle: unknown) =>
    validateTranslationReferences({ ...stack, translations: [bundle] })
      .filter((f) => f.rule === TRANSLATION_TARGET_UNKNOWN)
      .map((f) => f.path);

  it('accepts every expected key on the composed stack', () => {
    const stack = composed();
    expect(unknownTargets(stack, bundleOf(stack))).toEqual([]);
  });

  it('accepts the expected key under an app the stack only contributes into', () => {
    const single = defineStack({
      manifest: { ...svcManifest, navigationContributions: [{ app: 'crm_enterprise', items: CONTRIBUTIONS[0].items }] },
      objects: [object('cnv_case', 'Case')],
    } as any) as any;
    expect(unknownTargets(single, bundleOf(single))).toEqual([]);
  });

  it('control: still refuses a navigation id nothing declares or contributes', () => {
    const stack = composed();
    const bundle = { 'zh-CN': { apps: { cnv_desk: { navigation: { nav_ghost: { label: 'x' } } } } } };
    expect(unknownTargets(stack, bundle)).toEqual(['translations[0]["zh-CN"].apps.cnv_desk.navigation.nav_ghost']);
  });
});
