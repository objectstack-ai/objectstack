// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Setup app's Packaged Actions entry points at the
// `automation:packaged-actions` COMPONENT the console registers, and the
// retired Packaged Automation entry stays retired (ADR-0146 D4, D11).
//
// Why this needs a pin rather than a code comment: the page is objectui's (app-
// shell `PackagedActionsPage`, registered under `automation:packaged-actions`
// in `builtinComponents`, pinned there by `PackagedActionsPage.navContribution
// .test.tsx`), and nothing at runtime says when the framework entry naming the
// ref goes missing: the page is then reachable only by a hand-typed URL. This
// file is the framework half of that cross-repo contract; the REF LITERAL below
// and objectui's `REF` constant must agree, and each side pins its own.
//
// What retired, and why the converse is pinned too: Setup › Packaged
// automation's FLOWS half moved into Studio (D4 put the flow switch on the
// flow's item, and its clone became Studio's New similar), so its entry, its
// `automation:packaged` ref and its page retired (D11). D4 keeps the ACTION
// switch where it was, so the actions half stays in Setup as its own entry.
//
// Two deliberate absences worth stating so they are not "fixed":
//  - no `requiresService: 'automation'` — the action switches ride the
//    `sys_metadata_activation` ledger this package registers (#12419) and work
//    on compositions with NO automation service; gating the entry on that
//    service would hide a page that still works there.
//  - no `requiredPermissions` — matches `nav_packages` beside it: the Setup
//    app's own `setup.access` gates the app, and the activation WRITE doors
//    enforce `manage_metadata` / the ADR-0126 §5 operator gate server-side.
import { describe, it, expect } from 'vitest';
import { NavigationContributionSchema } from '@objectstack/spec/ui';

import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  componentRef?: string;
  requiresService?: string;
  requiredPermissions?: string[];
  children?: NavItem[];
};

/** Every contributed Setup nav item, depth-first, with its owning group. */
const allItems = (): Array<{ group?: string; item: NavItem }> => {
  const out: Array<{ group?: string; item: NavItem }> = [];
  for (const c of SETUP_NAV_CONTRIBUTIONS) {
    const walk = (items: NavItem[] = []) => {
      for (const item of items) {
        if (!item) continue;
        out.push({ group: c.group, item });
        if (Array.isArray(item.children)) walk(item.children);
      }
    };
    walk((c.items ?? []) as NavItem[]);
  }
  return out;
};

const entry = (): { group?: string; item: NavItem } => {
  const found = allItems().find(({ item }) => item.id === 'nav_packaged_actions');
  expect(found, 'Setup lost its nav_packaged_actions entry').toBeDefined();
  return found as { group?: string; item: NavItem };
};

describe('the Setup Packaged Actions entry targets the console component (ADR-0146 D4)', () => {
  it('routes to the `automation:packaged-actions` registry key', () => {
    expect(entry().item).toMatchObject({
      type: 'component',
      componentRef: 'automation:packaged-actions',
      label: 'Packaged Actions',
    });
  });

  it('lives in group_apps beside Packages — package administration is Operate (ADR-0084)', () => {
    expect(entry().group).toBe('group_apps');
  });

  it('does not gate on the automation service (the action switches work without it, #12419)', () => {
    expect(entry().item.requiresService).toBeUndefined();
    expect(entry().item.requiredPermissions).toBeUndefined();
  });

  it('parses as a NavigationContribution the runtime merge accepts', () => {
    const contribution = SETUP_NAV_CONTRIBUTIONS.find((c) =>
      (c.items ?? []).some((i) => (i as NavItem).id === 'nav_packaged_actions'),
    );
    expect(contribution).toBeDefined();
    expect(() => NavigationContributionSchema.parse(contribution)).not.toThrow();
  });
});

describe('Setup › Packaged automation stays retired (ADR-0146 D11)', () => {
  it('no entry names the retired id or the retired `automation:packaged` ref', () => {
    const items = allItems().map(({ item }) => item);
    // Control: the walk reads the real array.
    expect(items.some((i) => i.id === 'nav_packages')).toBe(true);
    expect(items.filter((i) => i.id === 'nav_packaged_automation')).toEqual([]);
    expect(items.filter((i) => i.componentRef === 'automation:packaged')).toEqual([]);
  });
});
