// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The write behind the design mode's 「Save」 for the app's menu
 * (objectstack#36363): where Studio's menu editing writes it, published at
 * once, never over somebody's pending draft, and composed from the app as
 * STORED, never as served (review 7081226692): the served menu is translated
 * for the reader and pruned of what the reader may not open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emitMetadataRefresh = vi.hoisted(() => vi.fn());
vi.mock('../../assistant/assistantBus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh,
}));

import { TranslationItemSchema, translateApp } from '@objectstack/spec/system';
import { withEntryIds, moveBy, inShownOrder, insertEntry, patchEntry, type Menu } from '../designModeMenuModel';
import {
  __resetDefaultLocale,
  fetchDeploymentLocales,
  isSameLanguage,
  labelLanguageOf,
  menuTranslationName,
  saveAppMenu,
  type AppMenuSaveDoors,
  type DeploymentLocales,
} from '../designModeMenuSave';

const TEXTS = { notListed: 'not listed', pendingDraft: 'pending draft', noVersion: 'no version', notWritable: 'not writable' };
const NAV = [{ id: 'leads', type: 'object', objectName: 'crm_lead' }];

function doors(opts: {
  writable: boolean;
  version?: string;
  stored?: Menu;
  pairWritable?: boolean;
  save?: () => Promise<unknown>;
  publish?: () => Promise<unknown>;
}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const d: AppMenuSaveDoors = {
    listPackages: async () =>
      new Map([
        ['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: opts.writable, manifest: opts.version ? { version: opts.version } : {} }],
      ]),
    ensureCustomization: async (base) => {
      calls.push(['ensure', base]);
      return { basePackageId: base, packageId: `${base}.custom`, namespace: 'crm_custom', created: false, writable: opts.pairWritable ?? true };
    },
    client: {
      layered: async (...args) => {
        calls.push(['layered', ...args]);
        const code = { name: 'crm', label: 'CRM', navigation: opts.stored ?? [], _packageId: 'com.acme.crm', _diagnostics: [] };
        return { code, effective: code };
      },
      save: async (...args) => {
        calls.push(['save', ...args]);
        return opts.save ? opts.save() : {};
      },
      publish: async (...args) => {
        calls.push(['publish', ...args]);
        return opts.publish ? opts.publish() : {};
      },
      reset: async (...args) => {
        calls.push(['reset', ...args]);
        return {};
      },
    },
  };
  return { d, calls };
}

/** The navigation the save wrote. */
const savedNav = (calls: Array<[string, ...unknown[]]>) =>
  (calls.find(([c]) => c === 'save')![3] as { navigation: Menu }).navigation;

beforeEach(() => emitMetadataRefresh.mockReset());

describe('saving the app menu (objectstack#36363)', () => {
  it('a writable package: the stored app with its new menu, saved there as a draft and published', async () => {
    const { d, calls } = doors({ writable: true });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV }, TEXTS, d);
    expect(calls).toEqual([
      ['layered', 'app', 'crm', { packageId: 'com.acme.crm' }],
      ['save', 'app', 'crm', { name: 'crm', label: 'CRM', navigation: NAV }, { mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' }],
      ['publish', 'app', 'crm', { packageId: 'com.acme.crm' }],
    ]);
    expect(emitMetadataRefresh).toHaveBeenCalledTimes(1);
  });

  it("an installed (read-only) package: saved into its customization package, declaring the override at the base's version", async () => {
    const { d, calls } = doors({ writable: false, version: '6.5.0' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV }, TEXTS, d);
    expect(calls).toEqual([
      ['layered', 'app', 'crm', { packageId: 'com.acme.crm' }],
      ['ensure', 'com.acme.crm'],
      [
        'save',
        'app',
        'crm',
        { name: 'crm', label: 'CRM', navigation: NAV, overrides: { package: 'com.acme.crm', basedOn: '6.5.0' } },
        { mode: 'draft', packageId: 'com.acme.crm.custom', ifNoneMatch: '*' },
      ],
      ['publish', 'app', 'crm', { packageId: 'com.acme.crm.custom' }],
    ]);
  });

  it('a read-only package that states no version is refused before anything is created or written', async () => {
    const { d, calls } = doors({ writable: false });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV }, TEXTS, d)).rejects.toThrow('no version');
    expect(calls.map(([c]) => c)).toEqual(['layered']);
  });

  it('a customization package the server answers not writable is refused before anything is written to it', async () => {
    const { d, calls } = doors({ writable: false, version: '6.5.0', pairWritable: false });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV }, TEXTS, d)).rejects.toThrow('not writable');
    expect(calls.map(([c]) => c)).toEqual(['layered', 'ensure']);
  });

  it('a package the server does not list is refused, before anything is read', async () => {
    const { d, calls } = doors({ writable: true });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.other', served: [], navigation: NAV }, TEXTS, d)).rejects.toThrow('not listed');
    expect(calls).toEqual([]);
  });

  it("a draft already pending is not overwritten nor published: the save says so", async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { d, calls } = doors({ writable: true, save: () => Promise.reject(conflict) });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV }, TEXTS, d)).rejects.toThrow('pending draft');
    expect(calls.map(([c]) => c)).toEqual(['layered', 'save']);
    expect(emitMetadataRefresh).not.toHaveBeenCalled();
  });

  it('a refused publish discards the draft this save wrote, and the refusal is passed on', async () => {
    const { d, calls } = doors({ writable: true, publish: () => Promise.reject(new Error('Package is read-only')) });
    await expect(saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: [], navigation: NAV }, TEXTS, d)).rejects.toThrow('Package is read-only');
    expect(calls.map(([c]) => c)).toEqual(['layered', 'save', 'publish', 'reset']);
    expect(calls[3]).toEqual(['reset', 'app', 'crm', { state: 'draft', packageId: 'com.acme.crm' }]);
  });
});

describe('the save writes the stored menu with the edits, never the served one (review 7081226692)', () => {
  // As stored: the source-language labels, and an entry this reader may not open.
  const STORED: Menu = [
    { id: 'leads', type: 'object', objectName: 'crm_lead', label: 'Leads' },
    { id: 'payroll', type: 'object', objectName: 'hr_payroll', label: 'Payroll', requiredPermissions: ['hr.admin'] },
    { id: 'accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
    { id: 'sales', type: 'group', label: 'Sales', children: [{ id: 'cases', type: 'object', objectName: 'crm_case', label: 'Cases' }] },
  ];
  // As served to a zh-CN reader without hr.admin: translated, payroll pruned.
  const SERVED: Menu = [
    { id: 'leads', type: 'object', objectName: 'crm_lead', label: '线索' },
    { id: 'accounts', type: 'object', objectName: 'crm_account', label: '客户' },
    { id: 'sales', type: 'group', label: '销售', children: [{ id: 'cases', type: 'object', objectName: 'crm_case', label: '工单' }] },
  ];

  it('a move under a translated menu writes the stored labels, every untouched entry byte for byte', async () => {
    const { d, calls } = doors({ writable: true, stored: STORED });
    const edited = moveBy(SERVED, 'accounts', -1);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED, navigation: edited }, TEXTS, d);
    const nav = savedNav(calls);
    // The entry moved is put before the one it passed; the pruned one keeps its stored place.
    expect(nav.map((e) => e.label)).toEqual(['Accounts', 'Leads', 'Payroll', 'Sales']);
    expect(JSON.stringify(nav)).not.toMatch(/线索|客户|销售|工单/);
    // Untouched: the same stored objects.
    expect(nav[1]).toBe(STORED[0]);
    expect(nav[3]).toBe(STORED[3]);
  });

  it('an entry pruned from the reader stays in the stored menu, where it was', async () => {
    const { d, calls } = doors({ writable: true, stored: STORED });
    const added = { id: 'reports', type: 'report', reportName: 'pipeline', label: 'Pipeline' };
    const edited = insertEntry(SERVED, 'sales', 1, added);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED, navigation: edited }, TEXTS, d);
    const nav = savedNav(calls);
    expect(nav.slice(0, 3)).toEqual(STORED.slice(0, 3));
    expect(nav[1]).toBe(STORED[1]);
    expect((nav[3].children as Menu).map((e) => e.id)).toEqual(['cases', 'reports']);
  });

  it('a rename writes the one key it changed; a removal removes only that entry', async () => {
    const { d, calls } = doors({ writable: true, stored: STORED });
    let edited = patchEntry(SERVED, 'cases', { label: 'Tickets' });
    edited = edited.filter((e) => e.id !== 'leads');
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED, navigation: edited }, TEXTS, d);
    const nav = savedNav(calls);
    expect(nav.map((e) => e.id)).toEqual(['payroll', 'accounts', 'sales']);
    expect(nav[2].children).toEqual([{ id: 'cases', type: 'object', objectName: 'crm_case', label: 'Tickets' }]);
  });

  it('stored entries without an id are matched by their target and written without one', async () => {
    const idless: Menu = [
      { type: 'object', objectName: 'crm_lead', label: 'Leads' },
      { type: 'object', objectName: 'hr_payroll', label: 'Payroll' },
      { type: 'object', objectName: 'crm_account', label: 'Accounts' },
    ];
    // The served copy, payroll pruned, given ids as the editor gives them.
    const served = withEntryIds([
      { type: 'object', objectName: 'crm_lead', label: '线索' },
      { type: 'object', objectName: 'crm_account', label: '客户' },
    ]);
    const { d, calls } = doors({ writable: true, stored: idless });
    const edited = moveBy(served, String(served[1].id), -1);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served, navigation: edited }, TEXTS, d);
    expect(savedNav(calls)).toEqual([idless[2], idless[0], idless[1]]);
  });

  it("a move beside another package's entry writes none of that package's entries (M1)", async () => {
    // The revenue module's Quotes, appended to Sales when the app is served; not stored.
    const served: Menu = SERVED.map((e) =>
      e.id === 'sales'
        ? { ...e, children: [...(e.children as Menu), { id: 'quote', type: 'object', objectName: 'crm_quote', label: '报价' }] }
        : e,
    );
    const { d, calls } = doors({ writable: true, stored: STORED });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served, navigation: moveBy(served, 'quote', -1) }, TEXTS, d);
    expect(savedNav(calls)).toEqual(STORED);
    expect(JSON.stringify(savedNav(calls))).not.toMatch(/quote|报价/);
  });

  it('an entry naming no target is left out of the save (N3)', async () => {
    const { d, calls } = doors({ writable: true, stored: STORED });
    const edited = insertEntry(SERVED, null, 0, { id: 'blank', type: 'object' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED, navigation: edited }, TEXTS, d);
    expect(savedNav(calls)).toEqual(STORED);
  });
});

describe('the save writes the order the editor showed as `order` (objectstack#36591)', () => {
  const object = (id: string, label: string, order?: number, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'object',
    objectName: `crm_${id}`,
    label,
    ...(order === undefined ? {} : { order }),
    ...extra,
  });
  /** As stored, authored out of `order`; the sidebar reads Customers, Contacts, Opportunities. */
  const STORED: Menu = [object('opportunity', 'Opportunities', 2), object('contact', 'Contacts', 1), object('customer', 'Customers', 0)];
  /** The editor's seed, as `DesignModeMenu` makes it. */
  const seed = (nav: Menu) => withEntryIds(inShownOrder(nav));
  const written = async (stored: Menu, served: Menu, edit: (m: Menu) => Menu) => {
    const { d, calls } = doors({ writable: true, stored });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served, navigation: edit(served) }, TEXTS, d);
    return savedNav(calls).map((e) => [e.id, e.order]);
  };

  it('an entry added at the end is numbered after the rest, and each entry gets its shown place', async () => {
    const served = seed(STORED);
    const nav = await written(STORED, served, (m) => insertEntry(m, null, 3, { id: 'nav_item_1', type: 'object', objectName: 'crm_case' }));
    expect(nav).toEqual([['customer', 0], ['contact', 1], ['opportunity', 2], ['nav_item_1', 3]]);
  });

  it('a move up is written as `order`; a rename beside it writes its label, and `order` is never read as an edit', async () => {
    const served = seed(STORED);
    const { d, calls } = doors({ writable: true, stored: STORED });
    const navigation = patchEntry(moveBy(served, 'contact', -1), 'opportunity', { label: 'Deals' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served, navigation }, TEXTS, d);
    expect(savedNav(calls)).toEqual([
      object('contact', 'Contacts', 0),
      object('customer', 'Customers', 1),
      object('opportunity', 'Deals', 2),
    ]);
  });

  it('an entry pruned from the reader keeps its shown place among the rest', async () => {
    const stored: Menu = [...STORED, object('payroll', 'Payroll', 1.5, { requiredPermissions: ['hr.admin'] })];
    const served = seed(STORED);
    const nav = await written(stored, served, (m) => moveBy(m, 'customer', 1));
    expect(nav).toEqual([['contact', 0], ['customer', 1], ['payroll', 2], ['opportunity', 3]]);
  });

  it('CONTROL: a menu carrying no `order` is saved by array order and gains no `order` key', async () => {
    const stored: Menu = STORED.map(({ order: _order, ...e }) => e);
    const served = seed(stored);
    const nav = await written(stored, served, (m) => moveBy(m, 'customer', -1));
    expect(nav).toEqual([['opportunity', undefined], ['customer', undefined], ['contact', undefined]]);
  });
});

describe('the session language against the default one', () => {
  it.each([
    ['en', 'en', true],
    ['EN-us', 'en-US', true],
    ['en', 'en-US', true],
    ['zh-CN', 'zh-CN', true],
    ['zh_CN', 'zh-CN', true],
    ['zh-CN', 'en', false],
    ['zh-CN', 'zh-TW', false],
    ['', 'en', false],
  ])('%s against %s: %s', (language, locale, same) => {
    expect(isSameLanguage(language, locale)).toBe(same);
  });
});

/**
 * objectstack#36504 — a name typed outside the app's source language is that
 * language's translation (`apps.APP.navigation.ID.label` in the translation
 * item `APP_menu_LOCALE`, in the package the menu is written to), and the
 * stored label is kept; review N5 of objectstack#36437 — a link added outside
 * the source language is stored without a name, its name translated.
 */
describe('a name typed outside the source language is that language\'s translation (objectstack#36504)', () => {
  /** An English app, defaulting its users to zh-CN. */
  const EN_SOURCE: DeploymentLocales = { codes: ['zh-CN', 'en'], defaultLocale: 'zh-CN', sourceLocale: 'en' };
  const STORED: Menu = [
    { id: 'leads', type: 'object', objectName: 'crm_lead', label: 'Leads' },
    { id: 'accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
  ];
  const SERVED_ZH: Menu = [
    { id: 'leads', type: 'object', objectName: 'crm_lead', label: '线索' },
    { id: 'accounts', type: 'object', objectName: 'crm_account', label: '客户' },
  ];

  /** The menu doors over `stored`, holding the translation item `translation` (when given) at every package. */
  function translationDoors(opts: {
    writable?: boolean;
    stored?: Menu;
    translation?: Record<string, unknown>;
    locales?: DeploymentLocales | null;
    saveTranslation?: () => Promise<unknown>;
  }) {
    const calls: Array<[string, ...unknown[]]> = [];
    const d: AppMenuSaveDoors = {
      listPackages: async () =>
        new Map([['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: opts.writable ?? true, manifest: { version: '6.5.0' } }]]),
      ensureCustomization: async (base) => {
        calls.push(['ensure', base]);
        return { basePackageId: base, packageId: `${base}.custom`, namespace: 'crm_custom', created: false, writable: true };
      },
      readLocales: async () => (opts.locales === undefined ? EN_SOURCE : opts.locales),
      client: {
        layered: async (...args) => {
          calls.push(['layered', ...args]);
          if (args[0] === 'translation') {
            return opts.translation ? { code: null, overlay: opts.translation, effective: opts.translation, overlayVersion: 'v7' } : { code: null, overlay: null, effective: null };
          }
          const code = { name: 'crm', label: 'CRM', navigation: opts.stored ?? STORED };
          return { code, effective: code };
        },
        save: async (...args) => {
          calls.push(['save', ...args]);
          if (args[0] === 'translation' && opts.saveTranslation) return opts.saveTranslation();
          return {};
        },
        publish: async (...args) => {
          calls.push(['publish', ...args]);
          return {};
        },
        reset: async (...args) => {
          calls.push(['reset', ...args]);
          return {};
        },
      },
    };
    return { d, calls };
  }
  const writes = (calls: Array<[string, ...unknown[]]>) => calls.filter(([c]) => c !== 'layered' && c !== 'ensure');
  const savedOf = (calls: Array<[string, ...unknown[]]>, type: string) =>
    calls.find(([c, t]) => c === 'save' && t === type)?.[3] as Record<string, any> | undefined;

  it('a rename under zh-CN over an English source: the zh-CN translation is written and published, the stored label is not', async () => {
    const { d, calls } = translationDoors({});
    const navigation = patchEntry(SERVED_ZH, 'leads', { label: '潜在客户' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation, labels: { language: 'zh-CN' } }, TEXTS, d);
    // A rename and nothing else: the translation alone is written, the app is not.
    expect(writes(calls)).toEqual([
      [
        'save',
        'translation',
        'crm_menu_zh_cn',
        { name: 'crm_menu_zh_cn', locale: 'zh-CN', apps: { crm: { navigation: { leads: { label: '潜在客户' } } } } },
        { mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' },
      ],
      ['publish', 'translation', 'crm_menu_zh_cn', { packageId: 'com.acme.crm', ifNoneMatch: '*' }],
    ]);
    expect(emitMetadataRefresh).toHaveBeenCalledTimes(1);
    // The item is one the metadata door takes.
    expect(TranslationItemSchema.safeParse(savedOf(calls, 'translation')).success).toBe(true);

    // Read back the way the server serves the app: zh-CN reads the new name, an English reader the base label.
    const bundle = { 'zh-CN': { apps: { crm: { navigation: { leads: { label: '潜在客户' } } } } } };
    const app = { name: 'crm', navigation: STORED as never };
    const zh = translateApp(app, bundle as never, { locale: 'zh-CN', defaultLocale: 'en' });
    const en = translateApp(app, bundle as never, { locale: 'en', defaultLocale: 'en' });
    expect((zh.navigation as any[]).map((n) => n.label)).toEqual(['潜在客户', 'Accounts']);
    expect((en.navigation as any[]).map((n) => n.label)).toEqual(['Leads', 'Accounts']);
  });

  it('a rename beside a move under zh-CN: the translation first, then the menu with its stored labels', async () => {
    const { d, calls } = translationDoors({});
    const navigation = moveBy(patchEntry(SERVED_ZH, 'leads', { label: '潜在客户' }), 'accounts', -1);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation, labels: { language: 'zh-CN' } }, TEXTS, d);
    expect(writes(calls).map(([c, t]) => `${c} ${t}`)).toEqual(['save translation', 'publish translation', 'save app', 'publish app']);
    expect(savedOf(calls, 'app')!.navigation).toEqual([STORED[1], STORED[0]]);
  });

  it('the translation item as stored keeps its other keys and entries; the publish is pinned to the row read', async () => {
    const translation = {
      name: 'crm_menu_zh_cn',
      locale: 'zh-CN',
      label: 'Menu names',
      apps: { crm: { label: '客户关系', navigation: { accounts: { label: '客户' } } } },
      _packageId: 'com.acme.crm',
    };
    const { d, calls } = translationDoors({ translation });
    const navigation = patchEntry(SERVED_ZH, 'leads', { label: '潜在客户' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation, labels: { language: 'zh-CN' } }, TEXTS, d);
    expect(savedOf(calls, 'translation')).toEqual({
      name: 'crm_menu_zh_cn',
      locale: 'zh-CN',
      label: 'Menu names',
      apps: { crm: { label: '客户关系', navigation: { accounts: { label: '客户' }, leads: { label: '潜在客户' } } } },
    });
    expect(calls.find(([c, t]) => c === 'publish' && t === 'translation')).toEqual([
      'publish',
      'translation',
      'crm_menu_zh_cn',
      { packageId: 'com.acme.crm', ifMatch: 'v7' },
    ]);
  });

  it("an installed app: the translation goes to its customization package, the pair's own translations being read first", async () => {
    const { d, calls } = translationDoors({ writable: false });
    const navigation = patchEntry(SERVED_ZH, 'leads', { label: '潜在客户' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation, labels: { language: 'zh-CN' } }, TEXTS, d);
    expect(writes(calls).map(([c, t, , , o]) => [c, t, (o as { packageId?: string } | undefined)?.packageId])).toEqual([
      ['save', 'translation', 'com.acme.crm.custom'],
      ['publish', 'translation', undefined],
    ]);
    expect(calls.find(([c, t]) => c === 'publish' && t === 'translation')![3]).toMatchObject({ packageId: 'com.acme.crm.custom' });
  });

  it('a rename in the source language over the stored label keeps today\'s write: the stored label, no translation', async () => {
    const { d, calls } = translationDoors({});
    const navigation = patchEntry(STORED, 'leads', { label: 'Prospects' });
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: STORED, navigation, labels: { language: 'en-US' } }, TEXTS, d);
    expect(writes(calls).map(([c, t]) => `${c} ${t}`)).toEqual(['save app', 'publish app']);
    expect(savedOf(calls, 'app')!.navigation[0]).toEqual({ id: 'leads', type: 'object', objectName: 'crm_lead', label: 'Prospects' });
  });

  it('a rename in the source language over a translation the reader was shown is that language\'s translation', async () => {
    const served: Menu = [{ ...STORED[0], label: 'Leads (en bundle)' }, STORED[1]];
    const { d, calls } = translationDoors({});
    await saveAppMenu(
      { appName: 'crm', packageId: 'com.acme.crm', served, navigation: patchEntry(served, 'leads', { label: 'Prospects' }), labels: { language: 'en' } },
      TEXTS,
      d,
    );
    expect(savedOf(calls, 'app')).toBeUndefined();
    expect(savedOf(calls, 'translation')).toMatchObject({ name: 'crm_menu_en', locale: 'en', apps: { crm: { navigation: { leads: { label: 'Prospects' } } } } });
  });

  it('a source locale that differs from the default: a rename in the default language is a translation (the gap the card closes)', async () => {
    const { d, calls } = translationDoors({ stored: SERVED_ZH });
    // Stored labels in Chinese, as served: the shown label equals the stored one.
    await saveAppMenu(
      { appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation: patchEntry(SERVED_ZH, 'leads', { label: '潜在客户' }), labels: { language: 'zh-CN' } },
      TEXTS,
      d,
    );
    expect(savedOf(calls, 'app')).toBeUndefined();
    expect(savedOf(calls, 'translation')!.apps.crm.navigation).toEqual({ leads: { label: '潜在客户' } });
  });

  it('N5: a link added under zh-CN is stored without a name, its name the zh-CN translation of the id it is stored under', async () => {
    // The stored menu took `nav_item_1` since the editor read it: the link is stored under a fresh id.
    const stored: Menu = [...STORED, { id: 'nav_item_1', type: 'object', objectName: 'crm_case', label: 'Cases', requiredPermissions: ['x'] }];
    const { d, calls } = translationDoors({ stored });
    const link = { id: 'nav_item_1', type: 'url', label: '帮助中心', url: 'https://help.example.com' };
    const navigation = insertEntry(SERVED_ZH, null, 2, link);
    await saveAppMenu({ appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation, labels: { language: 'zh-CN' } }, TEXTS, d);
    const nav = savedOf(calls, 'app')!.navigation as Menu;
    const written = nav.find((e) => e.type === 'url')!;
    expect(written).toEqual({ id: 'nav_item_2', type: 'url', url: 'https://help.example.com' });
    expect(savedOf(calls, 'translation')!.apps.crm.navigation).toEqual({ nav_item_2: { label: '帮助中心' } });
    expect(writes(calls).map(([c, t]) => `${c} ${t}`)).toEqual(['save translation', 'publish translation', 'save app', 'publish app']);
  });

  it('N5 CONTROL: a link added in the source language keeps its typed name as its stored label', async () => {
    const { d, calls } = translationDoors({});
    const link = { id: 'nav_item_1', type: 'url', label: 'Help', url: 'https://help.example.com' };
    await saveAppMenu(
      { appName: 'crm', packageId: 'com.acme.crm', served: STORED, navigation: insertEntry(STORED, null, 2, link), labels: { language: 'en' } },
      TEXTS,
      d,
    );
    expect((savedOf(calls, 'app')!.navigation as Menu)[2]).toEqual(link);
    expect(savedOf(calls, 'translation')).toBeUndefined();
  });

  it('a cleared name under zh-CN drops the entry from the translation item, and leaves the stored label', async () => {
    const translation = { name: 'crm_menu_zh_cn', locale: 'zh-CN', apps: { crm: { navigation: { leads: { label: '潜在客户' }, accounts: { label: '客户' } } } } };
    const { d, calls } = translationDoors({ translation });
    const served: Menu = [{ ...SERVED_ZH[0], label: '潜在客户' }, SERVED_ZH[1]];
    await saveAppMenu(
      { appName: 'crm', packageId: 'com.acme.crm', served, navigation: patchEntry(served, 'leads', { label: undefined }), labels: { language: 'zh-CN' } },
      TEXTS,
      d,
    );
    expect(savedOf(calls, 'translation')!.apps.crm.navigation).toEqual({ accounts: { label: '客户' } });
    expect(savedOf(calls, 'app')).toBeUndefined();
  });

  it('the languages unread: no language is known to be the source, so a rename is a translation and the base label is kept', async () => {
    const { d, calls } = translationDoors({ locales: null });
    await saveAppMenu(
      { appName: 'crm', packageId: 'com.acme.crm', served: STORED, navigation: patchEntry(STORED, 'leads', { label: 'Prospects' }), labels: { language: 'en' } },
      TEXTS,
      d,
    );
    expect(savedOf(calls, 'app')).toBeUndefined();
    expect(savedOf(calls, 'translation')).toMatchObject({ name: 'crm_menu_en', locale: 'en' });
  });

  it('a pending draft of the translation is refused and said; nothing is published, the menu not written', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { d, calls } = translationDoors({ saveTranslation: () => Promise.reject(conflict) });
    const navigation = moveBy(patchEntry(SERVED_ZH, 'leads', { label: '潜在客户' }), 'accounts', -1);
    await expect(
      saveAppMenu(
        { appName: 'crm', packageId: 'com.acme.crm', served: SERVED_ZH, navigation, labels: { language: 'zh-CN' } },
        { ...TEXTS, translationPendingDraft: 'translation pending' },
        d,
      ),
    ).rejects.toThrow('translation pending');
    expect(writes(calls).map(([c, t]) => `${c} ${t}`)).toEqual(['save translation']);
  });

  it('the language a label is typed in, as the deployment names it', () => {
    expect(labelLanguageOf('zh', EN_SOURCE)).toEqual({ locale: 'zh-CN', source: false });
    expect(labelLanguageOf('EN-us', EN_SOURCE)).toEqual({ locale: 'en', source: true });
    expect(labelLanguageOf('ja-JP', EN_SOURCE)).toEqual({ locale: 'ja-JP', source: false });
    expect(labelLanguageOf('en', null)).toEqual({ locale: 'en', source: false });
    expect(menuTranslationName('crm', 'zh-CN')).toBe('crm_menu_zh_cn');
    expect(menuTranslationName('crm', 'zh-Hant-TW')).toBe('crm_menu_zh_hant_tw');
  });
});

describe('the deployment\'s languages, its source language among them (objectstack#36504)', () => {
  const answer = (data: Record<string, unknown>) =>
    vi.fn(async () => new Response(JSON.stringify({ success: true, data }), { status: 200 }));
  beforeEach(() => __resetDefaultLocale());

  it('reads `sourceLocale` beside the default one', async () => {
    vi.stubGlobal('fetch', answer({ locales: [{ code: 'zh-CN', label: 'zh-CN', isDefault: true }, { code: 'en', label: 'en', isDefault: false }], sourceLocale: 'en' }));
    expect(await fetchDeploymentLocales()).toEqual({ codes: ['zh-CN', 'en'], defaultLocale: 'zh-CN', sourceLocale: 'en' });
    vi.unstubAllGlobals();
  });

  it('a server that states no source language authors in its default one', async () => {
    vi.stubGlobal('fetch', answer({ locales: [{ code: 'en', label: 'en', isDefault: true }] }));
    expect(await fetchDeploymentLocales()).toEqual({ codes: ['en'], defaultLocale: 'en', sourceLocale: 'en' });
    vi.unstubAllGlobals();
  });

  it('a failed read is no language at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await fetchDeploymentLocales()).toBeNull();
    vi.unstubAllGlobals();
  });
});
