// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup carries the package list's ADMINISTRATION face; Studio keeps the full
// list (objectstack#36834, amending ruling 甲 of #25098, which had kept every
// door to the list in Studio).
//
// The console's `developer:packages` component is the one list of what is
// installed, and it has two faces:
//
//   - opened with `face=admin` (a component entry's `params` are sent as the
//     query string), it is the administration face: every package of every
//     source with a Source filter, enable / disable, delete, and New Package,
//     which lands in Studio — and none of the authoring actions;
//   - opened with no `face`, it is the development surface with every action.
//
// So Setup ships exactly one entry to the list, `nav_packages` in `group_apps`,
// and it names the administration face. It is UNFILTERED (no `source`): the
// marketplace-filtered "Installed Apps" entry that
// `@objectstack/cloud-connection` used to contribute retired with this card,
// and seeing only marketplace installs is the page's own Source filter
// (`marketplace-installed-ui-entry.pin.test.ts` pins that retirement on its
// side).
//
// The Studio every boot serves is the console's own, at `/_console/studio`:
// the `@objectstack/studio` app this package declares (`studio.app.ts`) is not
// default-loaded (`apps/studio/src/index.ts`). Its served door to the full list
// is the console's, not a nav item: the Studio landing's "All packages" link and
// each package card's Manage, which opens the detail sheet with every action
// (#35196). The console pins that door
// (`ui/packages/app-shell/src/views/studio-design/BuilderLanding.packagesDoor-35196.test.tsx`).
//
// This file is the platform-objects half: what THIS package ships for each app.
// Every direction is pinned, because each regression is silent at runtime — a
// Setup entry that loses `face` simply renders the development surface, a
// second Setup entry simply renders, and the declared Studio app's entry is
// what a host that does load that app serves.
import { describe, it, expect } from 'vitest';

import { SETUP_APP } from './setup.app.js';
import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { STUDIO_APP } from './studio.app.js';

type NavItem = {
  id?: string;
  type?: string;
  componentRef?: string;
  params?: Record<string, unknown>;
  requiredPermissions?: string[];
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

/** Any entry that opens the package list, whatever its face or filter. */
const isPackagesDoor = (item: NavItem): boolean => item.componentRef === PACKAGES_REF;

/** The list's development surface: no `face`, no `source` filter. */
const isDevelopmentDoor = (item: NavItem): boolean =>
  isPackagesDoor(item) && item.params?.face === undefined && item.params?.source === undefined;

const setupItems = (): NavItem[] => [
  ...walk(SETUP_APP.navigation as unknown[]),
  ...SETUP_NAV_CONTRIBUTIONS.flatMap((c) => walk(c.items as unknown[])),
];

describe('Setup opens the package list on its administration face; Studio keeps the full list (#36834)', () => {
  it('the predicates tell the development surface from the administration face', () => {
    // Controls on the predicates themselves, so the readings below cannot pass
    // because a predicate matches nothing.
    expect(isDevelopmentDoor({ type: 'component', componentRef: PACKAGES_REF })).toBe(true);
    expect(isDevelopmentDoor({ type: 'component', componentRef: PACKAGES_REF, params: { face: 'admin' } })).toBe(false);
    expect(
      isDevelopmentDoor({ type: 'component', componentRef: PACKAGES_REF, params: { source: 'marketplace' } }),
    ).toBe(false);
    expect(isPackagesDoor({ type: 'component', componentRef: 'metadata:directory' })).toBe(false);
  });

  it('Setup ships exactly one package-list entry: `nav_packages` in `group_apps`, administration face, unfiltered', () => {
    const items = setupItems();
    // Control: the walk reads the real Setup shell and its contributions.
    expect(items.some((i) => i.id === 'group_apps')).toBe(true);
    expect(items.some((i) => i.id === 'nav_users')).toBe(true);

    const doors = items.filter(isPackagesDoor);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({
      id: 'nav_packages',
      type: 'component',
      componentRef: PACKAGES_REF,
      params: { face: 'admin' },
    });
    // Unfiltered: every source, the page's Source filter narrows it.
    expect(doors[0]!.params).toEqual({ face: 'admin' });
    // Never the development surface.
    expect(items.filter(isDevelopmentDoor)).toEqual([]);

    const appsGroup = SETUP_NAV_CONTRIBUTIONS.filter((c) => c.group === 'group_apps');
    expect(appsGroup.flatMap((c) => (c.items as NavItem[]).map((i) => i.id))).toEqual(['nav_packages']);
  });

  it('the entry is gated like Setup\'s other administration entries', () => {
    const entry = setupItems().find((i) => i.id === 'nav_packages');
    const settingsHub = setupItems().find((i) => i.id === 'nav_settings_hub');
    // Control: the pattern it follows is the one the hub carries today.
    expect(settingsHub?.requiredPermissions).toEqual(['manage_platform_settings']);
    expect(entry?.requiredPermissions).toEqual(settingsHub?.requiredPermissions);
  });

  // The declared `@objectstack/studio` app, for a host that loads it. Not the
  // door a default boot serves: that one is the console Studio landing's
  // (see the file header).
  it('the declared Studio app still ships the development-surface entry, under Overview', () => {
    const overview = walk(STUDIO_APP.navigation as unknown[]).find((i) => i.id === 'group_overview');
    expect(overview, 'Studio lost its group_overview').toBeDefined();

    const doors = walk(overview!.children).filter(isPackagesDoor);
    expect(doors).toHaveLength(1);
    expect(doors[0]).toMatchObject({ id: 'nav_packages', type: 'component', componentRef: PACKAGES_REF });
    expect(isDevelopmentDoor(doors[0]!)).toBe(true);
  });
});
