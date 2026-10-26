// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * UnifiedSidebar — in the collapsed (icon-mode) sidebar the hidden Recent
 * label takes no pointer events (objectui#12744).
 *
 * The `SidebarGroupLabel` primitive hides a label there with `opacity-0` and
 * `-mt-8` only, so the invisible Recent label lay over the lower half of the
 * navigation row just above it, and a click on that row's icon toggled Recent
 * instead of navigating (measured in a browser; the readings are on the pull
 * request). The label now carries a pointer-events-none variant, and the pins
 * DERIVE that variant from the primitive's own `…:opacity-0` token, so it is
 * checked to be the condition the primitive hides the label under. The test
 * DOM computes no Tailwind, so the pins read the class list.
 *
 * Harness: the provider / chrome mocks of
 * `UnifiedSidebar.recentPackage-11863.test.tsx`; `@object-ui/layout` and
 * `@object-ui/components` (the real `SidebarProvider`, `Sidebar` and
 * `SidebarGroupLabel`) stay REAL.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/** What the recent-items store holds. */
const recent = vi.hoisted(() => ({ items: [] as unknown[] }));

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
vi.mock('../../hooks/useRecentItems', () => ({ useRecentItems: () => ({ recentItems: recent.items }) }));
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

import { SidebarProvider } from '@object-ui/components';
import { UnifiedSidebar } from '../UnifiedSidebar';

const METADATA = {
  id: 'metadata:object:account',
  type: 'metadata',
  label: 'account',
  href: '/apps/crm/metadata/object/account',
  visitedAt: '2026-10-16T09:00:00.000Z',
};

/** The measured shape: a navigation row, then the Recent group right below it. */
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

/** The variant prefix the primitive hides this label under, read off its `…:opacity-0` token. */
function hidingPrefix(label: Element): string {
  const hide = tokens(label).find((t) => t.endsWith(':opacity-0'));
  expect(hide, 'the primitive hides the label with a variant-scoped opacity-0').toBeDefined();
  return hide!.slice(0, -'opacity-0'.length);
}

const recentLabel = () =>
  screen.getByText('Recent').closest('[data-sidebar="group-label"]') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  recent.items = [METADATA];
});

describe('UnifiedSidebar — the hidden Recent label takes no pointer events in icon mode (objectui#12744)', () => {
  it('collapsed to icons: the Recent label stops taking pointer events exactly where the primitive hides it', () => {
    const { container } = render(sidebarUi(false));
    const peer = container.querySelector('.group.peer[data-state]');
    expect(peer).toHaveAttribute('data-state', 'collapsed');
    expect(peer).toHaveAttribute('data-collapsible', 'icon');

    const label = recentLabel();
    expect(tokens(label)).toContain(`${hidingPrefix(label)}pointer-events-none`);
  });

  it('expanded: the Recent label still takes pointer events and opens and closes Recent', async () => {
    const user = userEvent.setup();
    render(sidebarUi(true));
    const label = recentLabel();

    const prefix = hidingPrefix(label);
    for (const t of tokens(label).filter((x) => x.endsWith('pointer-events-none'))) {
      expect(t).toBe(`${prefix}pointer-events-none`);
    }

    const group = label.closest('[data-sidebar="group"]') as HTMLElement;
    expect(within(group).queryByRole('link', { name: /\baccount$/ })).not.toBeInTheDocument();
    await user.click(label);
    expect(within(group).getByRole('link', { name: /\baccount$/ })).toHaveAttribute('href', METADATA.href);
    await user.click(label);
    expect(within(group).queryByRole('link', { name: /\baccount$/ })).not.toBeInTheDocument();
  });
});
