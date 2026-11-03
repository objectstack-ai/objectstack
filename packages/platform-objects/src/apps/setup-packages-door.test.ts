// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The full package list lives in Studio; Setup carries no unfiltered door to it
// (#25098, ruling 甲 amending #23892 ruling B).
//
// The console's `developer:packages` component is the one list of what is
// installed. Opened with no `source` filter it is a development surface, so its
// unfiltered entry lives in Studio only (Overview → Packages). Setup reaches
// installed packages through the marketplace-filtered "Installed Apps" door —
// `developer:packages` with `params: { source: 'marketplace' }` — which
// `@objectstack/cloud-connection` contributes to Setup's `group_apps` wherever
// the marketplace capability is present, and pins on its side
// (`marketplace-installed-ui-entry.pin.test.ts`).
//
// This file is the platform-objects half: what THIS package ships for each app.
// Both directions are pinned, because either regression is silent at runtime —
// an unfiltered Setup entry simply renders, and a Studio entry that goes
// missing leaves the full list reachable only by a hand-typed URL.
import { describe, it, expect } from 'vitest';

import { SETUP_APP } from './setup.app.js';
import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { STUDIO_APP } from './studio.app.js';

type NavItem = {
  id?: string;
  type?: string;
  componentRef?: string;
  params?: Record<string, unknown>;
  children?: NavItem[];
};

const PACKAGES_REF = 'developer:packages';

/** Every nav item in a tree, depth-first. */
const walk = (items: unknown[] | undefined, out: NavItem[] = []): NavItem[] => {
  for (const raw of items ?? []) {
    const item = raw as NavItem | undefined;
    if (!item) continue;
    out.push(item);
    if (Array.isArray(item.children)) walk(item.children, out);
  }
  return out;
};

/** A `developer:packages` entry with no `source` filter: the full list. */
const isUnfilteredPackagesDoor = (item: NavItem): boolean =>
  item.componentRef === PACKAGES_REF && item.params?.source === undefined;

const setupItems = (): NavItem[] => [
  ...walk(SETUP_APP.navigation as unknown[]),
  ...SETUP_NAV_CONTRIBUTIONS.flatMap((c) => walk(c.items as unknown[])),
];

describe('the unfiltered package list is a Studio surface, not a Setup one (#25098)', () => {
  it('the predicate tells the full list from the marketplace-filtered door', () => {
    // Controls on the predicate itself, so the absence below cannot pass
    // because the predicate matches nothing.
    expect(isUnfilteredPackagesDoor({ type: 'component', componentRef: PACKAGES_REF })).toBe(true);
    expect(
      isUnfilteredPackagesDoor({ type: 'component', componentRef: PACKAGES_REF, params: { source: 'marketplace' } }),
    ).toBe(false);
  });

  it('Setup ships no unfiltered `developer:packages` entry', () => {
    const items = setupItems();
    // Control: the walk reads the real Setup shell and its contributions.
    expect(items.some((i) => i.id === 'group_apps')).toBe(true);
    expect(items.some((i) => i.id === 'nav_packaged_actions')).toBe(true);

    expect(items.filter(isUnfilteredPackagesDoor)).toEqual([]);
    expect(items.filter((i) => i.id === 'nav_packages')).toEqual([]);
  });

  it('Studio still ships the unfiltered entry, under Overview', () => {
    const overview = walk(STUDIO_APP.navigation as unknown[]).find((i) => i.id === 'group_overview');
    expect(overview, 'Studio lost its group_overview').toBeDefined();

    const doors = walk(overview!.children).filter(isUnfilteredPackagesDoor);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ id: 'nav_packages', type: 'component', componentRef: PACKAGES_REF });
  });
});
