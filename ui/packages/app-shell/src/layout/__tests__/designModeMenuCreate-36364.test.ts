// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A new dashboard made from the design mode's 「Add menu item」
 * (objectstack#36364): created, empty, in the package the menu is saved to,
 * before the menu that opens it; refused, with nothing written, where the
 * menu cannot be saved; removed again when the menu is refused.
 *
 * Real subjects: `saveAppMenuWithNewItem` over the real `prepareAppMenuSave`,
 * `writeAppMenu` and `saveDashboardInPlace`; `freeItemName` and
 * `uniqueItemName` over the real pinyin dictionary. The package doors and the
 * metadata client are fakes that record every call.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const emitMetadataRefresh = vi.hoisted(() => vi.fn());
vi.mock('../../assistant/assistantBus', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  emitMetadataRefresh,
}));

import { loadHanRomanizer } from '../../views/metadata-admin/romanizeHan';
import type { Menu } from '../designModeMenu';
import type { AppMenuSaveDoors } from '../designModeMenuSave';
import {
  freeItemName,
  newItemBody,
  saveAppMenuWithNewItem,
  uniqueItemName,
  type NewMenuItem,
} from '../designModeMenuCreate';

const TEXTS = {
  notListed: 'not listed',
  pendingDraft: 'pending draft',
  noVersion: 'no version',
  notWritable: 'not writable',
  itemPendingDraft: 'item pending draft',
  itemLeft: 'item left',
};
const ITEM: NewMenuItem = { kind: 'dashboard', name: 'hui_kuan_fen_xi', label: '回款分析' };
const ENTRY = { id: 'nav_item_1', type: 'dashboard', dashboardName: 'hui_kuan_fen_xi' };
const NAVIGATION: Menu = [{ id: 'insights', type: 'group', label: 'Insights', children: [ENTRY] }];
const SERVED: Menu = [{ id: 'insights', type: 'group', label: 'Insights', children: [] }];

type Call = [string, ...unknown[]];

function doors(opts: {
  listed?: boolean;
  writable: boolean;
  version?: string;
  pairWritable?: boolean;
  ensure?: () => Promise<never>;
  refuse?: (call: Call) => unknown;
}) {
  const calls: Call[] = [];
  const record = async (call: Call) => {
    calls.push(call);
    const refusal = opts.refuse?.(call);
    if (refusal) throw refusal;
    return {};
  };
  const d: AppMenuSaveDoors = {
    listPackages: async () =>
      new Map(
        opts.listed === false
          ? []
          : [['com.acme.crm', { id: 'com.acme.crm', name: 'CRM', writable: opts.writable, manifest: opts.version ? { version: opts.version } : {} }]],
      ),
    ensureCustomization: async (base) => {
      calls.push(['ensure', base]);
      if (opts.ensure) return opts.ensure();
      return { basePackageId: base, packageId: `${base}.custom`, namespace: 'crm_custom', created: true, writable: opts.pairWritable ?? true };
    },
    client: {
      layered: async () => {
        const code = { name: 'crm', label: 'CRM', navigation: SERVED };
        return { code, effective: code };
      },
      save: (...args) => record(['save', ...args]),
      publish: (...args) => record(['publish', ...args]),
      reset: (...args) => record(['reset', ...args]),
    },
  };
  return { d, calls };
}

const input = { appName: 'crm', packageId: 'com.acme.crm', served: SERVED, navigation: NAVIGATION, item: ITEM };
const body = newItemBody(ITEM);

beforeAll(async () => {
  await loadHanRomanizer();
});
beforeEach(() => emitMetadataRefresh.mockReset());

describe('a new dashboard from the design mode (objectstack#36364)', () => {
  it('is created empty: a name, the label and no cards', () => {
    expect(body).toEqual({ name: 'hui_kuan_fen_xi', label: '回款分析', widgets: [] });
  });

  it("a writable app: the dashboard is created and published in the app's package, then the menu, in that order", async () => {
    const { d, calls } = doors({ writable: true });
    await saveAppMenuWithNewItem(input, TEXTS, d);
    expect(calls.map(([verb, type]) => `${verb} ${type}`)).toEqual(['save dashboard', 'publish dashboard', 'save app', 'publish app']);
    expect(calls[0]).toEqual(['save', 'dashboard', 'hui_kuan_fen_xi', body, { mode: 'draft', ifNoneMatch: '*', packageId: 'com.acme.crm' }]);
    expect(calls[1]).toEqual(['publish', 'dashboard', 'hui_kuan_fen_xi', { packageId: 'com.acme.crm' }]);
    expect((calls[2][3] as { navigation: Menu }).navigation).toEqual(NAVIGATION);
    expect(calls[2][4]).toEqual({ mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' });
  });

  it("an installed app: both go to its customization package, the pair asked of the ensure door before anything is written", async () => {
    const { d, calls } = doors({ writable: false, version: '1.4.0' });
    await saveAppMenuWithNewItem(input, TEXTS, d);
    expect(calls.map(([verb, type]) => `${verb} ${type ?? ''}`.trim())).toEqual([
      'ensure com.acme.crm',
      'save dashboard',
      'publish dashboard',
      'save app',
      'publish app',
    ]);
    // A new dashboard declares no override: it is the pair's own, not a customization of the base's.
    expect(calls[1]).toEqual(['save', 'dashboard', 'hui_kuan_fen_xi', body, { mode: 'draft', ifNoneMatch: '*', packageId: 'com.acme.crm.custom' }]);
    expect(calls[2]).toEqual(['publish', 'dashboard', 'hui_kuan_fen_xi', { packageId: 'com.acme.crm.custom' }]);
    expect(calls[3][4]).toEqual({ mode: 'draft', packageId: 'com.acme.crm.custom', ifNoneMatch: '*' });
  });

  it.each([
    ['the app’s package is not listed', { listed: false, writable: true }, 'not listed'],
    ['the installed app states no version', { writable: false }, 'no version'],
    ['the customization package is not writable', { writable: false, version: '1.4.0', pairWritable: false }, 'not writable'],
    ['the ensure door refuses', { writable: false, version: '1.4.0', ensure: async () => Promise.reject(new Error('403 walled')) }, '403 walled'],
  ])('where the menu cannot be saved (%s), nothing is created', async (_case, opts, message) => {
    const { d, calls } = doors(opts);
    await expect(saveAppMenuWithNewItem(input, TEXTS, d)).rejects.toThrow(message);
    expect(calls.filter(([verb]) => verb !== 'ensure')).toEqual([]);
  });

  it('a refused menu removes the dashboard it was made for, and the refusal is the menu’s', async () => {
    const refused = Object.assign(new Error('the app publish was refused'), { status: 422 });
    const { d, calls } = doors({ writable: true, refuse: ([verb, type]) => (verb === 'publish' && type === 'app' ? refused : null) });
    await expect(saveAppMenuWithNewItem(input, TEXTS, d)).rejects.toBe(refused);
    expect(calls.map(([verb, type, , opt]) => `${verb} ${type} ${JSON.stringify(opt ?? null)}`)).toEqual([
      'save dashboard {"name":"hui_kuan_fen_xi","label":"回款分析","widgets":[]}',
      'publish dashboard {"packageId":"com.acme.crm"}',
      'save app {"name":"crm","label":"CRM","navigation":[{"id":"insights","type":"group","label":"Insights","children":[{"id":"nav_item_1","type":"dashboard","dashboardName":"hui_kuan_fen_xi"}]}]}',
      'publish app {"packageId":"com.acme.crm"}',
      // The menu's own draft, discarded (`writeAppMenu`).
      'reset app {"state":"draft","packageId":"com.acme.crm"}',
      // The dashboard itself, removed from its package: not only its draft.
      'reset dashboard {"packageId":"com.acme.crm"}',
    ]);
    expect(emitMetadataRefresh).toHaveBeenCalled();
  });

  it('a refused menu whose dashboard cannot be removed says the dashboard was left', async () => {
    const { d } = doors({
      writable: true,
      refuse: ([verb, type, , opt]) =>
        (verb === 'save' && type === 'app') || (verb === 'reset' && type === 'dashboard' && !(opt as { state?: string })?.state)
          ? new Error(`${verb} ${type} refused`)
          : null,
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(saveAppMenuWithNewItem(input, TEXTS, d)).rejects.toThrow('save app refused item left');
    err.mockRestore();
  });

  it('a draft already pending under the new name is refused before the menu is written', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 409, code: 'METADATA_CONFLICT' });
    const { d, calls } = doors({ writable: true, refuse: ([verb, type]) => (verb === 'save' && type === 'dashboard' ? conflict : null) });
    await expect(saveAppMenuWithNewItem(input, TEXTS, d)).rejects.toThrow('item pending draft');
    expect(calls.map(([verb, type]) => `${verb} ${type}`)).toEqual(['save dashboard']);
  });
});

describe('the new dashboard’s machine name (objectstack#36364)', () => {
  it('reads as its name: a Chinese name through its pinyin, else the kind', () => {
    // Word breaks follow the runtime's segmenter; the syllables are the pinyin's.
    expect(uniqueItemName('dashboard', '回款分析', [])).toMatch(/^hui_?kuan_?fen_?xi$/);
    expect(uniqueItemName('dashboard', 'Payment analysis', [])).toBe('payment_analysis');
    expect(uniqueItemName('dashboard', '!!!', [])).toBe('dashboard');
    expect(uniqueItemName('dashboard', 'Payment analysis', ['payment_analysis', 'payment_analysis_2'])).toBe('payment_analysis_3');
  });

  it('is a name no dashboard holds in any package, asked of the server', async () => {
    const held = new Set(['dashboard/payment_analysis']);
    const get = vi.fn(async (type: string, name: string) => (held.has(`${type}/${name}`) ? { name } : null));
    expect(await freeItemName('dashboard', 'Payment analysis', [], { get })).toBe('payment_analysis_2');
    expect(get.mock.calls).toEqual([
      ['dashboard', 'payment_analysis'],
      ['dashboard', 'payment_analysis_2'],
    ]);
  });

  it('a name that cannot be checked is not used', async () => {
    const get = vi.fn(async () => {
      throw new Error('read failed');
    });
    await expect(freeItemName('dashboard', 'Payment analysis', [], { get })).rejects.toThrow('read failed');
  });
});
