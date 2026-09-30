// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: `translateApp` localizes a navigation entry's label by the entry's
 * `id`, never by the label's text — the "never translated by matching its
 * text" half of the order `BaseNavItemSchema.label` states in `ui/app.zod.ts`.
 *
 * Every entry below carries a label EQUAL to its target's machine name, the
 * one shape a text-matching rule would treat as "not customised". The bundle
 * holds every text-keyed route such a rule could take: the target's own
 * translation (`objects.<object>.label`, `objects.<object>._views.<view>.label`,
 * `dashboards.<dashboard>.label`) and a navigation key spelled like the text.
 * With no key for the entry's `id`, the label must come back unchanged; with
 * one, the answer must be that key's value and nothing else.
 */

import { describe, it, expect } from 'vitest';
import { translateApp } from './i18n-resolver';
import { TranslationBundleSchema, type TranslationBundle } from './translation.zod';
import { AppSchema } from '../ui/app.zod';

const app = {
  name: 'crm',
  label: 'CRM',
  navigation: [
    { id: 'nav_account', type: 'object', objectName: 'account', label: 'account' },
    { id: 'nav_pipeline', type: 'object', objectName: 'opportunity', viewName: 'pipeline', label: 'pipeline' },
    { id: 'nav_sales_overview', type: 'dashboard', dashboardName: 'sales_overview', label: 'sales_overview' },
  ],
};

/** Every route a text match could take, and no key for any entry's `id`. */
const textKeyedOnly: TranslationBundle = {
  'zh-CN': {
    objects: {
      account: { label: '客户' },
      opportunity: { label: '商机', _views: { pipeline: { label: '销售管道' } } },
    },
    dashboards: { sales_overview: { label: '销售总览' } },
    apps: {
      crm: {
        label: '客户关系',
        navigation: {
          account: { label: '按文本-客户' },
          pipeline: { label: '按文本-管道' },
          sales_overview: { label: '按文本-总览' },
        },
      },
    },
  },
};

/** The same bundle plus one key per entry `id`. */
const withIdKeys: TranslationBundle = {
  'zh-CN': {
    ...textKeyedOnly['zh-CN'],
    apps: {
      crm: {
        label: '客户关系',
        navigation: {
          ...textKeyedOnly['zh-CN'].apps!.crm.navigation,
          nav_account: { label: '我的客户' },
          nav_pipeline: { label: '我的管道' },
          nav_sales_overview: { label: '我的总览' },
        },
      },
    },
  },
};

const labels = (out: typeof app) => out.navigation.map((n) => n.label);

describe('translateApp — a nav label equal to its target name localizes only through the entry id', () => {
  it('both fixtures are authorable: the app and the bundles parse', () => {
    expect(AppSchema.safeParse(app).success).toBe(true);
    expect(TranslationBundleSchema.safeParse(textKeyedOnly).success).toBe(true);
    expect(TranslationBundleSchema.safeParse(withIdKeys).success).toBe(true);
  });

  it('with no key for the entry id, the label comes back unchanged', () => {
    const out = translateApp(app, textKeyedOnly, { locale: 'zh-CN' });
    expect(labels(out)).toEqual(['account', 'pipeline', 'sales_overview']);
  });

  it('with a key for the entry id, the label is that key and nothing else', () => {
    const out = translateApp(app, withIdKeys, { locale: 'zh-CN' });
    expect(labels(out)).toEqual(['我的客户', '我的管道', '我的总览']);
  });
});
