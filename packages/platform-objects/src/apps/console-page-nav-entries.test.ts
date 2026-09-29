// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20142 — the framework half of three console pages' navigation contract.
//
// objectui#10520 (PR objectui#10576) retired the console's System Hub card wall
// and its Developer Hub, which had been the only in-app links to three pages,
// and registered each page under a component-registry key instead. Framework
// navigation reaches a console page only through a `type: 'component'` item
// whose `componentRef` is such a key, so until an entry names the key the page
// is reachable by typed URL alone. This file pins the two entries this package
// declares; `audit:log` is contributed by `@objectstack/plugin-audit` (it lives
// and dies with that plugin) and is pinned beside it in
// `packages/plugins/plugin-audit/src/audit-nav-contribution.test.ts`.
//
// Why a pin rather than a code comment: `componentRef` is a free string, and
// `validate-nav-target-refs` deliberately does not resolve component refs (the
// registry is not visible to the linter). A misspelt key parses, merges and
// ships, and the console renders "Component not registered" in its place.
// Each repo pins its own half of the seam: objectui pins the registration in
// `apps/console/src/__tests__/orphanedPageComponentRefs-10520.test.tsx`, this
// file pins the ref the entry names.
//
// The keys below were MEASURED, not recalled: read from objectui at the commit
// objectstack's `.objectui-sha` pins (dd3f7e1be3561d63267d7162f3fc0ac52e72834d),
// where `registerSystemComponents.tsx` registers `audit:log` and `ai:approvals`
// and `registerDeveloperComponents.tsx` registers `developer:integrations`,
// all three imported for their side effect by `apps/console/src/main.tsx`.
// A pin bump that renames one of them must change this list in the same PR.

import { describe, it, expect } from 'vitest';
import { AppSchema, NavigationContributionSchema } from '@objectstack/spec/ui';
import { CORE_SERVICE_PROVIDER } from '@objectstack/spec/system';

import { SETUP_NAV_CONTRIBUTIONS } from './setup-nav.contributions.js';
import { STUDIO_APP } from './studio.app.js';

/** The registry keys the pinned console registers for the three pages. */
const MEASURED_CONSOLE_KEYS = ['audit:log', 'ai:approvals', 'developer:integrations'] as const;

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  objectName?: string;
  componentRef?: string;
  requiresService?: string;
  requiredPermissions?: string[];
  children?: NavItem[];
};

/** Every contributed Setup nav item, with the group it is contributed into. */
const setupItems = (): Array<{ group?: string; priority?: number; item: NavItem }> =>
  SETUP_NAV_CONTRIBUTIONS.flatMap((c) =>
    ((c.items ?? []) as NavItem[]).map((item) => ({ group: c.group, priority: c.priority, item })),
  );

/** The children of one Studio group, by id. */
const studioGroup = (id: string): NavItem[] => {
  const group = ((STUDIO_APP.navigation ?? []) as NavItem[]).find((g) => g.id === id);
  expect(group, `Studio lost its ${id} group`).toBeDefined();
  return group?.children ?? [];
};

describe('the AI Approvals entry targets the console page and is gated on the ai service (#20142)', () => {
  const entry = () => {
    const found = setupItems().find(({ item }) => item.id === 'nav_ai_approvals');
    expect(found, 'Setup lost its nav_ai_approvals entry').toBeDefined();
    return found!;
  };

  it('routes to the `ai:approvals` registry key, in group_approvals', () => {
    expect(entry().item).toMatchObject({
      type: 'component',
      componentRef: 'ai:approvals',
      label: 'AI Approvals',
    });
    expect(entry().group).toBe('group_approvals');
    // The component item has no object route, so an object gate would be a
    // dead key that reads as one.
    expect(entry().item.objectName).toBeUndefined();
  });

  it('comes after plugin-approvals\' own entries (priority 100), so the inbox stays first', () => {
    expect(entry().priority).toBeGreaterThan(100);
  });

  it('is gated on the `ai` service, which no open-framework package provides', () => {
    expect(entry().item.requiresService).toBe('ai');
    // The premise that makes the gate load-bearing: the discovery table that
    // names each core slot's installable provider records NONE for `ai`
    // (`@objectstack/service-ai` is Cloud/Enterprise only). So a Community
    // Edition boot registers no `ai` service and `filterAppForUser` strips the
    // entry server-side (ADR-0057 D10). If an open provider ever ships, this
    // premise changes and the gate's purpose must be re-read, not the entry
    // silently left to render.
    expect(CORE_SERVICE_PROVIDER.ai).toBeNull();
  });

  it('parses as a NavigationContribution the runtime merge accepts', () => {
    const contribution = SETUP_NAV_CONTRIBUTIONS.find((c) =>
      (c.items ?? []).some((i) => (i as NavItem).id === 'nav_ai_approvals'),
    );
    expect(() => NavigationContributionSchema.parse(contribution)).not.toThrow();
  });
});

describe('the Integrations & APIs entry targets the console page (#20142)', () => {
  const entry = (): NavItem => {
    const found = studioGroup('group_developer').find((i) => i.id === 'nav_integrations');
    expect(found, 'Studio lost its nav_integrations entry').toBeDefined();
    return found!;
  };

  it('routes to the `developer:integrations` registry key, last in group_developer', () => {
    expect(entry()).toMatchObject({
      type: 'component',
      componentRef: 'developer:integrations',
      label: 'Integrations & APIs',
    });
    expect(studioGroup('group_developer').map((i) => i.id)).toEqual([
      'nav_api_console',
      'nav_flow_runs',
      'nav_public_forms',
      'nav_integrations',
    ]);
  });

  it('carries no gate beyond Studio\'s own, like its neighbours', () => {
    expect(entry().requiresService).toBeUndefined();
    expect(entry().requiredPermissions).toBeUndefined();
  });

  it('the Studio app still satisfies AppSchema', () => {
    expect(() => AppSchema.parse(STUDIO_APP)).not.toThrow();
  });
});

describe('each ref names a key the pinned console registers (#20142)', () => {
  it('the two refs this package declares are among the measured keys', () => {
    const refs = [
      setupItems().find(({ item }) => item.id === 'nav_ai_approvals')?.item.componentRef,
      studioGroup('group_developer').find((i) => i.id === 'nav_integrations')?.componentRef,
    ];
    for (const ref of refs) {
      expect(MEASURED_CONSOLE_KEYS as readonly (string | undefined)[]).toContain(ref);
    }
  });

  it('every measured key is a registry KEY, never a console path', () => {
    // objectui#2763's boundary: navigation names a key and the console owns the
    // URL it resolves to (`ai:approvals` → `/apps/APP/component/ai/approvals`).
    for (const key of MEASURED_CONSOLE_KEYS) {
      expect(key).toMatch(/^[a-z0-9_-]+:[a-z0-9_-]+$/);
      expect(key).not.toContain('/');
    }
  });
});
