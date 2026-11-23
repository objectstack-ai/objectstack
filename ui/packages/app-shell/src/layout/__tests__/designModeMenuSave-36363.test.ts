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

import { withEntryIds, moveBy, inShownOrder, insertEntry, patchEntry, type Menu } from '../designModeMenuModel';
import { isSameLanguage, saveAppMenu, type AppMenuSaveDoors } from '../designModeMenuSave';

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
