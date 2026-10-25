// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — in the collapsed (icon-mode) sidebar the rail scrolls
 * vertically when its rows overflow (objectui#12794).
 *
 * The `SidebarContent` primitive sets `overflow-hidden` under its icon-mode
 * variant, so the rows below the fold could not be reached until the sidebar
 * expanded (measured in a browser; the readings are on the pull request). The
 * call site now passes a same-variant `overflow-auto` with `overflow-x-hidden`
 * and no scrollbar. The pins DERIVE the variant from the bare primitive's own
 * `…:overflow-hidden` token, so a primitive that changes its icon-mode
 * condition turns this red instead of leaving a variant that no longer
 * matches. The test DOM computes no Tailwind, so the pins read the class list.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.iconModeRecentLabel-12744.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` (the real `SidebarProvider`, `Sidebar` and
 * `SidebarContent`) stay REAL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
  useObjectLabel: () => ({
    objectLabel: ({ label }: { label?: string }) => label,
    viewLabel: (_o: string, _v: string, fallback?: string) => fallback,
    dashboardLabel: ({ label }: { label?: string }) => label,
    appLabel: ({ label }: { label?: string }) => label,
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('@object-ui/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/permissions')>()),
  usePermissions: () => ({ can: () => true, hasCapabilities: () => true }),
}));

let metadataState: { apps: unknown[]; objects: unknown[] };
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => metadataState,
}));

vi.mock('../../providers/ExpressionProvider', () => ({
  useExpressionContext: () => ({ evaluator: null }),
  evaluateVisibility: (expr: unknown) => expr !== false && expr !== 'false',
  evaluateNavigationVisibility: (expr: unknown) => expr !== false && expr !== 'false',
}));

vi.mock('../../utils', () => ({
  resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : ''),
  matchAppBySegment: (apps: Array<{ name?: string }>, segment?: string) =>
    apps.find((a) => a?.name === segment),
  appRouteSegment: (app: { name?: string }) => app?.name,
}));

vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => null }));
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: [] }) }));
vi.mock('../../hooks/useFavorites', () => ({
  useFavorites: () => ({ favorites: [], removeFavorite: vi.fn() }),
}));
vi.mock('../../hooks/useNavPins', () => ({
  useNavPins: () => ({ togglePin: vi.fn(), applyPins: (items: unknown) => items }),
}));
vi.mock('../../hooks/useNavActionDispatch', () => ({
  useNavActionDispatch: () => vi.fn(),
}));
vi.mock('../../context/NavigationContext', () => ({
  useNavigationContext: () => ({ context: 'app', currentAppName: 'crm' }),
}));
vi.mock('../ContextSelectors', () => ({
  useAppContextSelectors: () => ({ contextValues: {}, element: null }),
  contextSelectorQueryKey: (id: string) => (id === 'active_package' ? 'package' : id),
  STUDIO_PACKAGE_SELECTOR_ID: 'active_package',
}));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: () => null,
}));

import { Sidebar, SidebarContent, SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';

function sidebarUi(open: boolean) {
  metadataState = {
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        active: true,
        navigation: [{ id: 'nav_accounts', type: 'object', objectName: 'account', label: 'Accounts' }],
      },
    ],
    objects: [],
  };
  return (
    <MemoryRouter initialEntries={['/apps/crm']}>
      <SidebarProvider defaultOpen={open}>
        <UnifiedSidebar activeAppName="crm" />
      </SidebarProvider>
    </MemoryRouter>
  );
}

const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);
const contentOf = (container: HTMLElement) =>
  container.querySelector('[data-sidebar="content"]') as HTMLElement;

/**
 * The bare primitive's class list, with the call site's old `pt-2`: what the
 * content element carried before this fix, and the source of the icon-mode
 * variant the fix has to override.
 */
function primitiveTokens(open: boolean): string[] {
  const { container, unmount } = render(
    <SidebarProvider defaultOpen={open}>
      <Sidebar collapsible="icon">
        <SidebarContent className="pt-2" />
      </Sidebar>
    </SidebarProvider>,
  );
  const list = tokens(contentOf(container));
  unmount();
  return list;
}

/** The variant prefix the primitive clips the rail under, read off its `…:overflow-hidden` token. */
function iconModePrefix(): string {
  const clip = primitiveTokens(false).find((t) => t.endsWith(':overflow-hidden'));
  expect(clip, 'the primitive clips the icon rail with a variant-scoped overflow-hidden').toBeDefined();
  return clip!.slice(0, -'overflow-hidden'.length);
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
});

describe('UnifiedSidebar — the icon rail scrolls vertically when its rows overflow (objectui#12794)', () => {
  it('collapsed to icons: the rail scrolls vertically, stays clipped sideways and draws no scrollbar', () => {
    const prefix = iconModePrefix();
    const { container } = render(sidebarUi(false));
    const peer = container.querySelector('.group.peer[data-state]');
    expect(peer).toHaveAttribute('data-state', 'collapsed');
    expect(peer).toHaveAttribute('data-collapsible', 'icon');

    const list = tokens(contentOf(container));
    expect(list).toContain(`${prefix}overflow-auto`);
    expect(list).toContain(`${prefix}overflow-x-hidden`);
    expect(list).toContain(`${prefix}[scrollbar-width:none]!`);
    // No icon-mode clip survives the merge to compete with the shorthand.
    expect(list).not.toContain(`${prefix}overflow-hidden`);
    expect(list).not.toContain(`${prefix}overflow-y-hidden`);
    expect(list).not.toContain(`${prefix}overflow-y-clip`);
    expect(list).not.toContain(`${prefix}overflow-clip`);
  });

  it('expanded: every class that applies off icon mode is what it was before (CONTROL)', () => {
    const prefix = iconModePrefix();
    const before = primitiveTokens(true).filter((t) => !t.startsWith(prefix));
    expect(before).toContain('overflow-auto');

    const { container } = render(sidebarUi(true));
    expect(container.querySelector('.group.peer[data-state]')).toHaveAttribute('data-state', 'expanded');
    const now = tokens(contentOf(container)).filter((t) => !t.startsWith(prefix));
    expect(now).toEqual(before);
  });
});
