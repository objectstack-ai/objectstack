// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The Setup app's Packaged Automation entry points at the `automation:packaged`
// COMPONENT the console registers (#12457, ADR-0126 §7.4).
//
// Why this needs a pin rather than a code comment: the page shipped complete in
// objectui (app-shell `PackagedAutomationPage`, registered under
// `automation:packaged` in `builtinComponents`) with a nav test asserting the
// objectui half of the contract — ref registered, ref addresses
// `component/automation/packaged`, page mounts through that route
// (`PackagedAutomationPage.navContribution.test.tsx`). NOTHING asserted the
// framework half, so the epic closed with no `NavigationContribution` naming
// the ref and the page reachable only by a hand-typed URL — a defect invisible
// to `platform-core.builtin-apps-nav-render`, which walks only the destinations
// the merged nav declares. This file is the framework half of that cross-repo
// contract; the REF LITERAL below and objectui's `REF` constant must agree, and
// each side pins its own.
//
// Two deliberate absences worth stating so they are not "fixed":
//  - no `requiresService: 'automation'` — the page's action half rides the
//    `sys_metadata_activation` ledger this package registers (#12419) and works
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
  const found = allItems().find(({ item }) => item.id === 'nav_packaged_automation');
  expect(found, 'Setup lost its nav_packaged_automation entry (#12457)').toBeDefined();
  return found as { group?: string; item: NavItem };
};

describe('the Setup Packaged Automation entry targets the console component (#12457)', () => {
  it('routes to the `automation:packaged` registry key', () => {
    expect(entry().item).toMatchObject({
      type: 'component',
      componentRef: 'automation:packaged',
      label: 'Packaged Automation',
    });
  });

  it('lives in group_apps beside Packages — package administration is Operate (ADR-0084)', () => {
    expect(entry().group).toBe('group_apps');
  });

  it('does not gate on the automation service (the action half works without it, #12419)', () => {
    expect(entry().item.requiresService).toBeUndefined();
  });

  it('parses as a NavigationContribution the runtime merge accepts', () => {
    const contribution = SETUP_NAV_CONTRIBUTIONS.find((c) =>
      (c.items ?? []).some((i) => (i as NavItem).id === 'nav_packaged_automation'),
    );
    expect(contribution).toBeDefined();
    expect(() => NavigationContributionSchema.parse(contribution)).not.toThrow();
  });
});
