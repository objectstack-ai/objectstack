// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// A `page:tabs` item's `label` had no translation key. `pages.<page>.components`
// is keyed by component id, a tab item is not a component and carries no id,
// and `translatePage` never read `items[].label`, so a localized page kept its
// tab strip in the authoring language (measured on HotCRM's
// `sales_home_page`: three English tabs under a translated header).
//
// The key is `pages.<page>.components.<tabsId>.items.<value>.label`: the tabs
// component's own id, then the item's `value`, the stable `?tab=` token the
// renderer already reads. Unlike a key with no reader, `translatePage` reads
// this one, so the extractor offers the slot and coverage demands it. An item
// without a `value` gets no key: its renderer token is index-derived, and an
// array index is never a bundle key (the identity-first direction of the
// #14749 ruling).

import { describe, it, expect } from 'vitest';
import { collectExpectedEntries, extractTranslations } from '../src/utils/i18n-extract';
import { computeI18nCoverage } from '../src/utils/i18n-coverage';
import { TranslationDataSchema, translatePage } from '@objectstack/spec/system';

const homePage = () => ({
  name: 'sales_home_page',
  label: 'Sales Home',
  regions: [{
    name: 'main',
    components: [{
      type: 'page:tabs',
      id: 'home_tabs',
      properties: {
        items: [
          { label: 'My Leads', value: 'my_leads', children: [{ type: 'record:related_list', id: 'home_my_leads', properties: { title: 'Leads' } }] },
          { label: { en: 'My Open Deals', 'zh-CN': '我的商机' }, value: 'my_deals', children: [] },
          // No `value`: no key, whatever its label says.
          { label: 'My Open Tasks', children: [] },
        ] as any[],
      },
    }],
  }],
});

/** Every `…components.<id>.items.*` path the walker emits, as dot-paths. */
const itemEntries = (config: any) =>
  collectExpectedEntries(config).filter((e) => e.path[0] === 'pages' && e.path[4] === 'items');

describe('the extractor scaffolds a key for every valued tab item', () => {
  it('emits `pages.<page>.components.<tabsId>.items.<value>.label`, and nothing for an item without a `value`', () => {
    expect(itemEntries({ pages: [homePage()] }).map((e) => e.path.join('.'))).toEqual([
      'pages.sales_home_page.components.home_tabs.items.my_leads.label',
      'pages.sales_home_page.components.home_tabs.items.my_deals.label',
    ]);
  });

  it('seeds a plain label, and records an inline locale map as authored with no seed', () => {
    const [leads, deals] = itemEntries({ pages: [homePage()] });
    expect(leads.sourceValue).toBe('My Leads');
    expect(deals.sourceValue).toBeUndefined();
    expect(deals.inlineLocales).toEqual({ en: 'My Open Deals', 'zh-CN': '我的商机' });
  });

  it('CONTROL: the panel children keep their component keys', () => {
    const paths = collectExpectedEntries({ pages: [homePage()] }).map((e) => e.path.join('.'));
    expect(paths).toContain('pages.sales_home_page.components.home_my_leads.title');
  });

  it('emits nothing for `items` on a component that is not `page:tabs`', () => {
    const page = homePage();
    (page.regions[0].components[0] as any).type = 'page:accordion';
    expect(itemEntries({ pages: [page] })).toEqual([]);
  });

  it('emits nothing for a tabs component with no id', () => {
    const page = homePage();
    delete (page.regions[0].components[0] as any).id;
    expect(itemEntries({ pages: [page] })).toEqual([]);
  });
});

describe('the emitted key is the key the schema declares and the resolver reads', () => {
  it('`TranslationDataSchema` accepts a bundle written at the extracted path, and `translatePage` applies it', () => {
    const out = extractTranslations({ pages: [homePage()] }, { locales: ['zh-CN'] });
    const zh = out.bundles['zh-CN'] as any;
    expect(zh?.pages?.sales_home_page?.components?.home_tabs?.items?.my_leads).toBeDefined();

    const data = { pages: { sales_home_page: { components: { home_tabs: { items: { my_leads: { label: '我的线索' } } } } } } };
    expect(TranslationDataSchema.safeParse(data).success).toBe(true);
    const translated: any = translatePage(homePage(), { 'zh-CN': data } as any, { locale: 'zh-CN' });
    expect(translated.regions[0].components[0].properties.items[0].label).toBe('我的线索');
  });
});

describe('coverage', () => {
  const config = (items: Record<string, unknown>) => ({
    pages: [homePage()],
    i18n: { supportedLocales: ['en', 'zh-CN'] },
    translations: [{ 'zh-CN': { pages: { sales_home_page: { components: { home_tabs: { items } } } } } }],
  });

  const itemIssues = (report: { issues: Array<{ key: string }> }) =>
    report.issues.filter((i) => i.key.includes('.items.')).map((i) => i.key);

  it('reports an untranslated tab label', () => {
    expect(itemIssues(computeI18nCoverage(config({})))).toEqual([
      'pages.sales_home_page.components.home_tabs.items.my_leads.label',
    ]);
  });

  it('stays quiet once the pack keys it — and about the inline-map item that covers its locale', () => {
    expect(itemIssues(computeI18nCoverage(config({ my_leads: { label: '我的线索' } })))).toEqual([]);
  });
});
