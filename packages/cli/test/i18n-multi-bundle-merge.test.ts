// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// objectstack#27087 — coverage merges a locale's bundles the way the runtime
// serves them.
//
// A multi-package artifact carries one translation bundle per package, and
// every one of them names the same locales. The runtime folds them per locale
// with one deep merge (`deepMerge` from `@objectstack/core`, called once per
// bundle by `loadTranslations`), so `GET /api/v1/i18n/translations/LOCALE`
// serves every package's keys. Coverage used to fold them with a merge of its
// own that kept only `objects`, `globalActions`, `apps` (whole entry,
// navigation included), `messages` and `metadataForms` from a later bundle:
// every dashboard, dataset, page, flow and report the second package
// translated read as missing, and its `apps.APP` entry dropped the first
// package's navigation labels. HotCRM measured 330 such findings under
// `os lint --strict`, each naming a key the runtime serves.
//
// The fixture is that shape: an app package and a module that contributes
// navigation into the app, composed module-first with `manifest: 'preserve'`,
// each shipping its own zh-CN bundle for exactly what it owns. Both doors hand
// `computeI18nCoverage` the `authoringRuleUnionStack` of that composition,
// which is what these pins do.
//
// Navigation needs nothing of its own: `apps.APP.navigation` is a map keyed by
// node id in the translation schema, so the deep merge already merges it per
// id. A module's bundle restates the app's `label` because the schema requires
// one on every `apps.APP` entry.

import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack } from '@objectstack/spec';
import { createMemoryI18n } from '@objectstack/core';

import { collectExpectedEntries } from '../src/utils/i18n-extract.js';
import { computeI18nCoverage, mergeTranslationBundles } from '../src/utils/i18n-coverage.js';
import { authoringRuleUnionStack } from '../src/utils/stack-collections.js';

const I18N = { defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'], fallbackLocale: 'en' };
const engines = { protocol: '^18' };

const object = (name: string, label: string) => ({
  name, label, pluralLabel: label, sharingModel: 'private',
  fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
});

/** One package's own surface: every family HotCRM's false findings named. */
const surface = (ns: string, objectName: string) => ({
  objects: [object(objectName, `${ns} Record`)],
  dashboards: [{ name: `${ns}_board`, label: `${ns} Board`, widgets: [{
    id: `${ns}_won`, title: `${ns} Won`, type: 'metric', dataset: `${ns}_metrics`, values: ['total'],
    layout: { x: 0, y: 0, w: 3, h: 2 },
  }] }],
  datasets: [{
    name: `${ns}_metrics`,
    label: `${ns} Metrics`,
    object: objectName,
    dimensions: [{ name: 'stage', label: 'Stage', field: 'name', type: 'string' }],
    measures: [{ name: 'total', label: 'Count', aggregate: 'count' }],
  }],
  pages: [{ name: `${ns}_home`, label: `${ns} Home` }],
  reports: [{ name: `${ns}_summary`, label: `${ns} Summary`, type: 'summary', dataset: `${ns}_metrics`, values: ['total'] }],
  flows: [{
    name: `${ns}_wizard`,
    label: `${ns} Wizard`,
    type: 'screen',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: `${ns}_step`, type: 'screen', label: 'Step', config: { title: `${ns} Step`, fields: [] } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: `${ns}_step` }, { id: 'e2', source: `${ns}_step`, target: 'end' }],
  }],
});

const appStack = {
  manifest: { id: 'com.example.mb.app', name: 'Multi Bundle App', namespace: 'mba', version: '1.0.0', type: 'app', engines },
  ...surface('mba', 'mba_account'),
  apps: [{
    name: 'mba_desk',
    label: 'Desk',
    navigation: [{
      id: 'grp_sales',
      type: 'group',
      label: 'Sales',
      children: [{ id: 'nav_accounts', type: 'object', objectName: 'mba_account', label: 'Accounts' }],
    }],
  }],
  i18n: I18N,
};

const moduleStack = {
  manifest: {
    id: 'com.example.mb.svc', name: 'Multi Bundle Service', namespace: 'mbs', version: '1.0.0', type: 'module', engines,
    navigationContributions: [{
      app: 'mba_desk',
      group: 'grp_sales',
      items: [{ id: 'nav_cases', type: 'object', objectName: 'mbs_case', label: 'Cases' }],
    }],
  },
  ...surface('mbs', 'mbs_case'),
  i18n: I18N,
};

/** Every path the walker expects of ONE package, read on that package alone. */
const ownedPaths = (input: Record<string, unknown>) =>
  collectExpectedEntries(defineStack(input as any))
    .filter((e) => e.inline !== undefined && !e.path[0].startsWith('metadataForm'))
    .map((e) => e.path);

/** A zh-CN bundle carrying exactly `paths`, less `drop`. */
function bundleOf(paths: string[][], extra: Record<string, unknown> = {}, drop?: string) {
  const zh: Record<string, any> = structuredClone(extra);
  for (const path of paths) {
    if (path.join('.') === drop) continue;
    let node = zh;
    for (const segment of path.slice(0, -1)) node = (node[segment] ??= {});
    node[path[path.length - 1]] = `zh:${path.join('.')}`;
  }
  return { 'zh-CN': zh };
}

const APP_PATHS = ownedPaths(appStack);
const MODULE_PATHS = ownedPaths(moduleStack);
/** The schema requires `label` on every `apps.APP` entry, so the module restates it. */
const MODULE_APP_LABEL = { apps: { mba_desk: { label: 'zh:apps.mba_desk.label' } } };

/** Module first, as HotCRM composes it: the top-level manifest is the app's. */
function composed(drop?: string): Record<string, unknown> {
  const app = defineStack({ ...appStack, translations: [bundleOf(APP_PATHS, {}, drop)] } as any);
  const mod = defineStack({ ...moduleStack, translations: [bundleOf(MODULE_PATHS, MODULE_APP_LABEL, drop)] } as any);
  return authoringRuleUnionStack(composeStacks([mod, app], { manifest: 'preserve' }) as any);
}

/** `os lint` folds the platform's `metadataForms` baseline away; so does this. */
const zhIssueKeys = (config: Record<string, unknown>) =>
  computeI18nCoverage(config, { strict: true, platformMetadataForms: 'exclude' }).issues
    .filter((i) => i.locale === 'zh-CN')
    .map((i) => i.key);

describe('the fixture is the card\'s shape (#27087)', () => {
  it('gives each package its own bundle for every family the false findings named', () => {
    const families = (paths: string[][]) => [...new Set(paths.map((p) => p[0]))].sort();
    expect(families(APP_PATHS)).toEqual(['apps', 'dashboards', 'datasets', 'flows', 'objects', 'pages', 'reports']);
    expect(families(MODULE_PATHS)).toEqual(['apps', 'dashboards', 'datasets', 'flows', 'objects', 'pages', 'reports']);
    // The module's only `apps` keys are the navigation ids it contributes.
    expect(MODULE_PATHS.filter((p) => p[0] === 'apps').map((p) => p.join('.')))
      .toEqual(['apps.mba_desk.navigation.nav_cases.label']);
  });

  it('carries both bundles on the composed stack, the module\'s first', () => {
    const translations = (composed() as any).translations as Array<Record<string, any>>;
    expect(translations).toHaveLength(2);
    expect(Object.keys(translations[0]['zh-CN'].dashboards)).toEqual(['mbs_board']);
    expect(Object.keys(translations[1]['zh-CN'].dashboards)).toEqual(['mba_board']);
  });
});

describe('coverage reads two packages\' bundles as the runtime merges them (#27087)', () => {
  it('reports nothing when each package translates everything it owns', () => {
    expect(zhIssueKeys(composed())).toEqual([]);
  });

  // Acceptance 1, in both directions: one deleted key, exactly one finding.
  for (const [owner, paths] of [['app', APP_PATHS], ['module', MODULE_PATHS]] as const) {
    for (const family of ['dashboards', 'datasets', 'pages', 'flows', 'reports', 'apps']) {
      // `apps.APP.label` is required by the schema, so the `apps` victim is a navigation label.
      const victim = paths.find((p) => p[0] === family && (family !== 'apps' || p[2] === 'navigation'))!.join('.');
      it(`reports exactly the key deleted from the ${owner}'s bundle: ${victim}`, () => {
        expect(zhIssueKeys(composed(victim))).toEqual([victim]);
      });
    }
  }

  it('reports the app\'s own navigation label deleted while the module restates the app', () => {
    expect(zhIssueKeys(composed('apps.mba_desk.navigation.nav_accounts.label')))
      .toEqual(['apps.mba_desk.navigation.nav_accounts.label']);
  });
});

describe('the lint\'s merge is the runtime\'s merge (#27087)', () => {
  /** What the runtime serves: every bundle loaded per locale, in order, then read back. */
  function served(bundles: Array<Record<string, Record<string, unknown>>>) {
    const i18n = createMemoryI18n();
    const locales = new Set<string>();
    for (const bundle of bundles) {
      for (const [locale, data] of Object.entries(bundle)) {
        i18n.loadTranslations(locale, data);
        locales.add(locale);
      }
    }
    return Object.fromEntries([...locales].map((l) => [l, i18n.getTranslations(l)]));
  }

  it('gives the served tree for the fixture\'s two bundles', () => {
    const bundles = (composed() as any).translations;
    expect(mergeTranslationBundles(bundles).merged).toEqual(served(bundles));
  });

  it('gives the served tree for a pair that overlaps at every depth', () => {
    const first = {
      en: { messages: { hello: 'Hello' } },
      'zh-CN': {
        objects: { acct: { label: '客户', fields: { name: { label: '名称', help: '法定名称' } }, _views: { all: { label: '全部' } } } },
        apps: { desk: { label: '服务台', navigation: { a: { label: '甲' }, b: { label: '乙' } } } },
        picklists: { stage: { label: '阶段', options: { open: '打开', won: '赢单' } } },
        dashboards: { board: { label: '看板', widgets: { w1: { title: '一' } } } },
        messages: { hello: '你好', bye: '再见' },
      },
    };
    const second = {
      'zh-CN': {
        objects: { acct: { fields: { name: { label: '客户名称' }, owner: { label: '负责人' } } }, case: { label: '工单' } },
        apps: { desk: { label: '服务台二', navigation: { b: { label: '乙二' }, c: { label: '丙' } } } },
        picklists: { stage: { options: { lost: '输单' } } },
        dashboards: { board: { widgets: { w2: { title: '二' } } } },
        flows: { wiz: { label: '向导' } },
        messages: { bye: '回见' },
      },
      'ja-JP': { messages: { hello: 'こんにちは' } },
    };
    const lint = mergeTranslationBundles([first, second]);
    expect(lint.merged).toEqual(served([first, second]));
    expect(lint.locales).toEqual(['en', 'ja-JP', 'zh-CN']);
    // Not vacuous: both sides kept the first bundle's leaves the second did not restate.
    const zh = lint.merged['zh-CN'] as any;
    expect(zh.apps.desk.navigation).toEqual({ a: { label: '甲' }, b: { label: '乙二' }, c: { label: '丙' } });
    expect(zh.objects.acct.fields.name).toEqual({ label: '客户名称', help: '法定名称' });
    expect(zh.dashboards.board.widgets).toEqual({ w1: { title: '一' }, w2: { title: '二' } });
  });
});

describe('controls (#27087)', () => {
  it('a single-bundle stack reads as before', () => {
    const single = (drop?: string) => defineStack({ ...appStack, translations: [bundleOf(APP_PATHS, {}, drop)] } as any);
    expect(zhIssueKeys(single())).toEqual([]);
    const victim = 'objects.mba_account.fields.name.label';
    expect(zhIssueKeys(single(victim))).toEqual([victim]);
  });

  it('a later bundle still overrides a leaf an earlier one set (last write wins)', () => {
    const merged = mergeTranslationBundles([
      { 'zh-CN': { messages: { hi: '旧' } } },
      { 'zh-CN': { messages: { hi: '新' } } },
    ]).merged;
    expect(merged['zh-CN']).toEqual({ messages: { hi: '新' } });
  });
});
