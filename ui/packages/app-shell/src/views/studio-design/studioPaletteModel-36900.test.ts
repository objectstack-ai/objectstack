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
 *  4. a pick leaves, re-enters the page open on another query, or stays.
 */

import { describe, expect, it } from 'vitest';
import { STUDIO_ITEM_PILLAR, studioItemPath, studioMetadataItemAddress } from './studioAddress';
import { buildStudioMenu, studioMenuScope } from './studioMenuModel';
import {
  buildStudioPaletteGroups,
  studioPaletteDeparture,
  studioPaletteItemAddress,
  studioPaletteItemsOf,
  studioPalettePackages,
} from './studioPaletteModel';

const PKG = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

describe("a package's palette lists its items and its pair's (ADR-0146 D3)", () => {
  it('reads the package and its .custom pair', () => {
    expect(studioPalettePackages(PKG)).toEqual([PKG, PAIR]);
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
    expect(studioPaletteItemsOf('object', rows, { packages: [PKG, PAIR] })).toEqual([
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
        packages: [PKG],
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
    expect(studioPaletteItemAddress(PKG, { type: 'object', name: 'crm_account', packageId: PKG })).toBe(
      '/studio/com.acme.crm/data?surface=object%3Acrm_account',
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
