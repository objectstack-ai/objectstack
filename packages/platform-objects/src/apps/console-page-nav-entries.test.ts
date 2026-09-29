// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20142 — the framework half of the console pages' navigation contract, for
// the entry this package declares.
//
// objectui#10520 (PR objectui#10576) retired the console's System Hub card wall
// and its Developer Hub, which had been the only in-app links to three pages,
// and registered each page under a component-registry key instead. Framework
// navigation reaches a console page only through a `type: 'component'` item
// whose `componentRef` is such a key, so until an entry names the key the page
// is reachable by typed URL alone. Of the three:
//  - `developer:integrations` is Studio's, declared here and pinned below;
//  - `audit:log` is contributed by `@objectstack/plugin-audit` (it lives and
//    dies with that plugin) and is pinned beside it in
//    `packages/plugins/plugin-audit/src/audit-nav-contribution.test.ts`;
//  - `ai:approvals` is NOT this repository's to contribute: ADR-0029 D7 has
//    each capability plugin contribute its own entries, and the `ai`
//    capability's owner is `@objectstack/service-ai` in Cloud/Enterprise.
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
// where `registerSystemComponents.tsx` registers `audit:log` and
// `registerDeveloperComponents.tsx` registers `developer:integrations`, both
// imported for their side effect by `apps/console/src/main.tsx`. A pin bump
// that renames one of them must change this list in the same PR.

import { describe, it, expect } from 'vitest';
import { AppSchema } from '@objectstack/spec/ui';

import { STUDIO_APP } from './studio.app.js';

/** The registry keys the pinned console registers for the pages this repo links. */
const MEASURED_CONSOLE_KEYS = ['audit:log', 'developer:integrations'] as const;

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  componentRef?: string;
  requiresService?: string;
  requiredPermissions?: string[];
  children?: NavItem[];
};

/** The children of one Studio group, by id. */
const studioGroup = (id: string): NavItem[] => {
  const group = ((STUDIO_APP.navigation ?? []) as NavItem[]).find((g) => g.id === id);
  expect(group, `Studio lost its ${id} group`).toBeDefined();
  return group?.children ?? [];
};

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
  it('the ref this package declares is among the measured keys', () => {
    const ref = studioGroup('group_developer').find((i) => i.id === 'nav_integrations')?.componentRef;
    expect(MEASURED_CONSOLE_KEYS as readonly (string | undefined)[]).toContain(ref);
  });

  it('every measured key is a registry KEY, never a console path', () => {
    // objectui#2763's boundary: navigation names a key and the console owns the
    // URL it resolves to (`developer:integrations` →
    // `/apps/APP/component/developer/integrations`).
    for (const key of MEASURED_CONSOLE_KEYS) {
      expect(key).toMatch(/^[a-z0-9_-]+:[a-z0-9_-]+$/);
      expect(key).not.toContain('/');
    }
  });
});
