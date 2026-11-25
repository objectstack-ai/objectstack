// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36900 — the command palette on a Studio design page, as data
 * (`studioPaletteModel.ts`):
 *
 *  1. a package's items are its own and its `.custom` pair's, as its lists
 *     show them, named by the type's primary key;
 *  2. an item opens through the one address builder: its pillar while one
 *     designs its type, else its area page on its owning package;
 *  3. the groups are the left menu's, in its order, each with the items of
 *     the types it lists;
 *  4. a pick leaves, re-enters the page open on another query, or stays;
 *  5. leaving asks the shell's unsaved-edits seam (every registered editor,
 *     not only the surface's own work), and re-entering asks through the host.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';
import { STUDIO_ITEM_PILLAR, studioItemPath, studioMetadataItemAddress } from './studioAddress';
import { buildStudioMenu, studioMenuScope } from './studioMenuModel';
import {
  buildStudioPaletteGroups,
  openStudioPaletteAddress,
  studioPaletteDeparture,
  studioPaletteItemAddress,
  studioPaletteItemsOf,
  studioPalettePairId,
  studioSamePageSearch,
} from './studioPaletteModel';

const PKG = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

describe("a package's palette lists its items and its pair's (ADR-0146 D3)", () => {
  it('reads the package and its .custom pair; a pair has no pair of its own', () => {
    expect(studioPalettePairId(PKG)).toBe(PAIR);
    expect(studioPalettePairId(PAIR)).toBeNull();
  });

  it("keeps the two packages' rows, unwrapped, named by the type's key, once per name and package", () => {
    const rows = [
      { name: 'crm_account', label: 'Account', _packageId: PKG },
      { item: { name: 'crm_lead', label: { key: 'crm.lead', defaultValue: 'Lead' }, _packageId: PAIR } },
      { name: 'hr_employee', label: 'Employee', _packageId: 'com.acme.hr' },
      { name: 'loose_thing', label: 'Loose' },
      { name: '', _packageId: PKG },
      { name: 'crm_account', label: 'Account (member)', _packageId: PKG },
      null,
    ];
    expect(studioPaletteItemsOf('object', rows, { packageId: PKG, pairId: PAIR })).toEqual([
      { type: 'object', name: 'crm_account', label: 'Account', packageId: PKG },
      { type: 'object', name: 'crm_lead', label: { key: 'crm.lead', defaultValue: 'Lead' }, packageId: PAIR },
    ]);
  });

  it("applies the type's list predicate and primary key", () => {
    const rows = [
      { id: 'welcome', name: 'ignored', _packageId: PKG },
      { id: 'hidden', _packageId: PKG, container: true },
    ];
    expect(
      studioPaletteItemsOf('email_template', rows, {
        packageId: PKG,
        pairId: null,
        primaryKey: 'id',
        listFilter: (item) => item.container !== true,
      }).map((i) => i.name),
    ).toEqual(['welcome']);
  });
});

describe('an item opens through the one address builder (#36895)', () => {
  it('opens a type a pillar designs in that pillar, as studioItemPath does', () => {
    for (const type of Object.keys(STUDIO_ITEM_PILLAR)) {
      expect(studioPaletteItemAddress(PKG, { type, name: 'x', packageId: PAIR })).toBe(studioItemPath(PKG, type, 'x'));
    }
    // objectstack#36904 — an object opens its designer on its own address, scoped to its owner.
    expect(studioPaletteItemAddress(PKG, { type: 'object', name: 'crm_account', packageId: PKG })).toBe(
      '/studio/com.acme.crm/metadata/object/crm_account?package=com.acme.crm',
    );
  });

  it('opens any other type on its area page, scoped to the package that owns it, as its list row links it', () => {
    expect(studioPaletteItemAddress(PKG, { type: 'hook', name: 'on_lead', packageId: PAIR })).toBe(
      studioMetadataItemAddress(PKG, 'hook', 'on_lead', { query: `package=${encodeURIComponent(PAIR)}` }),
    );
    expect(studioPaletteItemAddress(PKG, { type: 'dashboard', name: 'pipeline', packageId: PKG })).toBe(
      '/studio/com.acme.crm/metadata/dashboard/pipeline?package=com.acme.crm',
    );
  });
});

describe("the palette's groups are the left menu's (decision 11)", () => {
  const menu = buildStudioMenu({
    scope: studioMenuScope(PKG),
    types: [
      { type: 'object', domain: 'data' },
      { type: 'hook', domain: 'data' },
      { type: 'dashboard', domain: 'ui' },
      { type: 'flow', domain: 'automation' },
      { type: 'permission', domain: 'security' },
      { type: 'agent', domain: 'ai' },
    ],
    counts: {},
  });

  it("keeps the menu's six groups in order, with the menu's own entries, and puts each item under its type's group", () => {
    const groups = buildStudioPaletteGroups(menu, [
      { type: 'flow', name: 'onboard', label: 'Onboard', packageId: PKG },
      { type: 'object', name: 'crm_account', label: 'Account', packageId: PKG },
      { type: 'dashboard', name: 'pipeline', label: 'Pipeline', packageId: PKG },
      { type: 'permission', name: 'sales_rep', label: 'Sales Rep', packageId: PAIR },
      { type: 'hook', name: 'on_lead', label: 'On lead', packageId: PKG },
    ]);
    expect(groups.map((g) => g.group)).toEqual(['data', 'ui', 'automation', 'system', 'security', 'ai']);
    expect(groups.map((g) => g.entries.map((e) => e.key))).toEqual(menu.map((g) => g.entries.map((e) => e.key)));
    expect(groups.map((g) => g.items.map((i) => i.name))).toEqual([
      ['crm_account', 'on_lead'],
      ['pipeline'],
      ['onboard'],
      [],
      ['sales_rep'],
      [],
    ]);
  });

  it('lists no item whose type the menu does not list', () => {
    const groups = buildStudioPaletteGroups(menu, [{ type: 'translation', name: 'zh', label: 'zh', packageId: PKG }]);
    expect(groups.flatMap((g) => g.items)).toEqual([]);
  });
});

describe('a pick leaves, re-enters or stays, as a menu entry does (decision 12)', () => {
  const at = { pathname: '/studio/com.acme.crm/access', search: '?surface=permission%3Asales_rep&palette=1' };

  it('leaves for another page', () => {
    expect(studioPaletteDeparture('/studio/com.acme.crm/data?surface=object%3Acrm_account', at)).toBe('leave');
  });

  it('re-enters the page open on another query', () => {
    expect(studioPaletteDeparture('/studio/com.acme.crm/access?surface=owd%3Aoverview', at)).toBe('reenter');
  });

  it("stays on the page already shown, the palette's own keys and the order aside", () => {
    expect(studioPaletteDeparture('/studio/com.acme.crm/access?surface=permission%3Asales_rep', at)).toBe('stay');
    expect(
      studioPaletteDeparture('/studio/x/metadata/hook?package=x&sort=name', {
        pathname: '/studio/x/metadata/hook',
        search: '?cmdk=1&sort=name&package=x',
      }),
    ).toBe('stay');
    expect(studioPaletteDeparture('/studio/x/data', { pathname: '/studio/x/data', search: '?palette=1' })).toBe('stay');
  });
});

describe('a pick leaves through the shell seam, and re-enters through the host (objectstack#36900 M1)', () => {
  const at = { pathname: '/studio/com.acme.crm/metadata/hook/on_lead', search: '?package=com.acme.crm&palette=1' };
  let release: (() => void) | null = null;
  afterEach(() => {
    release?.();
    release = null;
    vi.unstubAllGlobals();
  });

  /** This project has no DOM: the seam's `window` and `document`, with `confirm` as the test answers it. */
  function stubBrowser(confirm: (message?: string) => boolean) {
    const listeners = { addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal('window', { ...listeners, confirm });
    vi.stubGlobal('document', listeners);
  }

  it('with an editor registered (the item page), leaving asks its question: Cancel stays, OK goes', () => {
    const confirm = vi.fn((_message?: string) => false);
    stubBrowser(confirm);
    release = registerUnsavedEdits('Discard the item page edits?');
    const navigate = vi.fn();
    const reenter = vi.fn(() => true);

    openStudioPaletteAddress('/studio/com.acme.crm/data?surface=object%3Acrm_account', at, { navigate, reenter });
    expect(confirm).toHaveBeenCalledWith('Discard the item page edits?');
    expect(navigate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    openStudioPaletteAddress('/studio/com.acme.crm/data?surface=object%3Acrm_account', at, { navigate, reenter });
    expect(navigate).toHaveBeenCalledWith('/studio/com.acme.crm/data?surface=object%3Acrm_account');
    expect(reenter).not.toHaveBeenCalled();
  });

  it('CONTROL — with nothing registered, leaving goes at once and asks nothing', () => {
    const confirm = vi.fn((_message?: string) => false);
    stubBrowser(confirm);
    const navigate = vi.fn();
    openStudioPaletteAddress('/studio/com.acme.crm/data', at, { navigate, reenter: () => true });
    expect(confirm).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/studio/com.acme.crm/data');
  });

  it('re-entering hands the host the query it must wait for, and goes only on its yes', () => {
    const navigate = vi.fn();
    const reenter = vi.fn(() => false);
    const to = '/studio/com.acme.crm/metadata/hook/on_lead?package=com.acme.crm&sort=name';
    openStudioPaletteAddress(to, at, { navigate, reenter });
    expect(reenter).toHaveBeenCalledWith('?package=com.acme.crm&sort=name');
    expect(navigate).not.toHaveBeenCalled();
    reenter.mockReturnValue(true);
    openStudioPaletteAddress(to, at, { navigate, reenter });
    expect(navigate).toHaveBeenCalledWith(to);
  });

  it('the page already shown neither asks nor goes', () => {
    const navigate = vi.fn();
    const reenter = vi.fn(() => true);
    openStudioPaletteAddress('/studio/com.acme.crm/metadata/hook/on_lead?package=com.acme.crm', at, { navigate, reenter });
    expect(navigate).not.toHaveBeenCalled();
    expect(reenter).not.toHaveBeenCalled();
  });

  it("the re-entry's query matches the router's once the palette's own key is gone, in any order", () => {
    expect(studioSamePageSearch('?b=2&a=1&palette=1', '?a=1&b=2')).toBe(true);
    expect(studioSamePageSearch('?surface=owd%3Aoverview', '?surface=permission%3Asales_rep')).toBe(false);
  });
});
