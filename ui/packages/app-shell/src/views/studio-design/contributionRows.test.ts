// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29786 — the placement rules for the items other packages
 * contribute to a read-only base, from the base's one customization read.
 *
 * Pinned:
 *  - only a read answer yields contributions; off / loading / failed yield none;
 *  - each entry keeps its kind, and its package is named from the list, else by id;
 *  - a `nav` entry goes under the group it names when the app declares a
 *    `type: 'group'` item of that id at any depth, else at the top level, and
 *    the undeclared group is named; an entry naming no group is top level;
 *    an entry for another app is left out; a non-group item sharing the id
 *    is no container (the server's fold asks the same);
 *  - fields are indexed per object; a flow joins its object's group, or gets
 *    a group of its own before "No object".
 */

import { describe, expect, it } from 'vitest';
import type { PackageCustomizationsState } from './CustomizationMark';
import {
  baseContributionsOf,
  contributedFieldsOf,
  findDeclaredNavGroup,
  placeNavContributions,
  placesAnyNav,
  withContributedFlowGroups,
} from './contributionRows';

const BASE = 'com.example.hotcrm';
const SERVICE = 'com.example.hotcrm.service';
const ACME = 'com.acme.addon';

const READ = {
  packageId: BASE,
  overrides: [],
  extensions: [],
  switchedOff: [],
  contributions: [
    { kind: 'field' as const, object: 'crm_account', name: 'acme_score', packageId: ACME },
    { kind: 'flow' as const, object: 'crm_account', name: 'acme_sync', packageId: ACME },
    { kind: 'flow' as const, object: 'crm_case', name: 'case_escalate', packageId: SERVICE },
    { kind: 'nav' as const, app: 'crm_app', name: 'nav_top', packageId: SERVICE },
    { kind: 'nav' as const, app: 'crm_app', group: 'service_group', name: 'nav_cases', packageId: SERVICE },
    { kind: 'nav' as const, app: 'crm_app', group: 'ghost_group', name: 'nav_knowledge', packageId: SERVICE },
    { kind: 'nav' as const, app: 'other_app', name: 'nav_elsewhere', packageId: SERVICE },
  ],
  counts: { overrides: 0, extensions: 0, switchedOff: 0, contributions: 7 },
};

const readState = (): PackageCustomizationsState => ({
  status: 'read',
  read: READ,
  index: { baseId: BASE, pairId: `${BASE}.custom`, overrides: new Set() },
  baseName: 'HotCRM',
  contributorNames: new Map([[SERVICE, 'HotCRM Service']]),
});

describe('baseContributionsOf', () => {
  it('splits a read answer by kind, naming each package from the list, else by its id', () => {
    const c = baseContributionsOf(readState())!;
    expect(c.fields).toEqual([
      { kind: 'field', object: 'crm_account', name: 'acme_score', packageId: ACME, packageName: ACME },
    ]);
    expect(c.flows.map((f) => [f.object, f.name, f.packageName])).toEqual([
      ['crm_account', 'acme_sync', ACME],
      ['crm_case', 'case_escalate', 'HotCRM Service'],
    ]);
    expect(c.nav.map((n) => [n.app, n.group ?? null, n.name])).toEqual([
      ['crm_app', null, 'nav_top'],
      ['crm_app', 'service_group', 'nav_cases'],
      ['crm_app', 'ghost_group', 'nav_knowledge'],
      ['other_app', null, 'nav_elsewhere'],
    ]);
    expect('group' in c.nav[0]!).toBe(false);
  });

  it('yields nothing before or without an answer', () => {
    expect(baseContributionsOf(null)).toBeNull();
    expect(baseContributionsOf({ status: 'off' })).toBeNull();
    expect(baseContributionsOf({ status: 'loading' })).toBeNull();
    expect(baseContributionsOf({ status: 'failed', message: 'nope' })).toBeNull();
  });
});

describe('placeNavContributions', () => {
  const NAV = [
    { id: 'nav_home', type: 'dashboard', dashboardName: 'home' },
    { id: 'outer', type: 'group', children: [{ id: 'service_group', type: 'group', children: [] }] },
  ];

  it('puts an entry under the declared group it names, at any depth', () => {
    const p = placeNavContributions(baseContributionsOf(readState()), 'crm_app', NAV);
    expect(p.byGroup.get('service_group')?.map((e) => e.name)).toEqual(['nav_cases']);
    expect([...p.byGroup.keys()]).toEqual(['service_group']);
  });

  it('puts an entry naming no group, or an undeclared one, at the top level and names the undeclared group', () => {
    const p = placeNavContributions(baseContributionsOf(readState()), 'crm_app', NAV);
    expect(p.top.map((r) => [r.entry.name, r.undeclaredGroup])).toEqual([
      ['nav_top', null],
      ['nav_knowledge', 'ghost_group'],
    ]);
  });

  it('leaves out the entries for another app, and places nothing without an app or a read', () => {
    const p = placeNavContributions(baseContributionsOf(readState()), 'other_app', NAV);
    expect(p.top.map((r) => r.entry.name)).toEqual(['nav_elsewhere']);
    expect(placesAnyNav(placeNavContributions(baseContributionsOf(readState()), null, NAV))).toBe(false);
    expect(placesAnyNav(placeNavContributions(null, 'crm_app', NAV))).toBe(false);
    expect(placesAnyNav(placeNavContributions(baseContributionsOf(readState()), 'no_such_app', NAV))).toBe(false);
  });

  it('a non-group item sharing the id is no container: the entry goes to the top level', () => {
    const nav = [{ id: 'service_group', type: 'object', objectName: 'crm_case' }];
    expect(findDeclaredNavGroup(nav, 'service_group')).toBeUndefined();
    const p = placeNavContributions(baseContributionsOf(readState()), 'crm_app', nav);
    expect(p.byGroup.size).toBe(0);
    expect(p.top.find((r) => r.entry.name === 'nav_cases')?.undeclaredGroup).toBe('service_group');
  });
});

describe('contributedFieldsOf', () => {
  it('indexes the fields of one object by name', () => {
    const c = baseContributionsOf(readState());
    expect([...contributedFieldsOf(c, 'crm_account').keys()]).toEqual(['acme_score']);
    expect(contributedFieldsOf(c, 'crm_case').size).toBe(0);
    expect(contributedFieldsOf(c, null).size).toBe(0);
    expect(contributedFieldsOf(null, 'crm_account').size).toBe(0);
  });
});

describe('withContributedFlowGroups', () => {
  type G = { key: string; objectName: string | null; label: string };
  const make = (object: string): G => ({ key: object, objectName: object, label: `(${object})` });

  it('joins a flow to its object’s group, and gives an object with no group one before "No object"', () => {
    const groups: G[] = [
      { key: 'crm_account', objectName: 'crm_account', label: 'Account' },
      { key: '', objectName: null, label: 'No object' },
    ];
    const out = withContributedFlowGroups(groups, baseContributionsOf(readState()), make);
    expect(out.map(({ group, contributed }) => [group.key, contributed.map((f) => f.name)])).toEqual([
      ['crm_account', ['acme_sync']],
      ['crm_case', ['case_escalate']],
      ['', []],
    ]);
  });

  it('appends the new groups when the rail has no "No object" group, and changes nothing without a read', () => {
    const groups: G[] = [{ key: 'crm_account', objectName: 'crm_account', label: 'Account' }];
    expect(withContributedFlowGroups(groups, baseContributionsOf(readState()), make).map((g) => g.group.key)).toEqual([
      'crm_account',
      'crm_case',
    ]);
    expect(withContributedFlowGroups(groups, null, make)).toEqual([{ group: groups[0], contributed: [] }]);
  });
});
