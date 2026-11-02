// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29024 — an App Switcher row opens the app it
 * names, a package's second app included.
 *
 * `/apps/PACKAGE_ID` resolves to the package's FIRST app, so a row keyed on the
 * package id switched to that first app for every other app of the package. A
 * row now hands `onAppChange` the app's one address (`appAddressSegment`) among
 * the metadata app list: the package id where it resolves back to the app,
 * else the app's name. That list holds hidden apps too, so a package whose
 * first app is hidden addresses its visible second app by name.
 *
 * The menu harness is `AppSwitcher.launcherHiddenApps-26838.test.tsx`'s,
 * without a `/me/apps` answer (no provider: every active app is offered).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Passthrough dropdown primitives so the menu CONTENT renders without an
// interaction — the same idiom as WorkspaceSwitcher.test.tsx. What is under
// measurement is which apps reach the list, not radix's open/close machinery.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <div>{p.children}</div>,
  // Scoped: the trigger renders the ACTIVE app's label too, so an unscoped
  // `getByText` would match twice. Every assertion below reads the LIST.
  DropdownMenuContent: (p: any) => <div data-testid="app-switcher-menu">{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
  DropdownMenuLabel: (p: any) => <div {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChevronDown: () => <span />,
  Check: () => <span data-testid="active-check" />,
}));
// `getIcon` wraps lucide's DynamicIcon (a per-icon dynamic import); stub it so
// no unbounded module load races the assertions.
vi.mock('../../utils/getIcon', () => ({ getIcon: () => () => <span /> }));

// Spread the real module rather than replacing it: other modules in this graph
// import further exports from it, and a bare factory would blank them out.
vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({
      t: (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key,
    }),
    useObjectLabel: () => ({
      appLabel: ({ name, label }: { name: string; label?: string }) => label ?? name,
    }),
  };
});

// Keep the real route-segment matching (`appRouteSegment` / `matchAppBySegment`);
// only the keyed-i18n resolver is stubbed.
vi.mock('../../utils', async () => {
  const appRoute = await vi.importActual<typeof import('../../utils/appRoute')>('../../utils/appRoute');
  return {
    ...appRoute,
    resolveKeyedI18nLabel: (label: unknown) => (typeof label === 'string' ? label : undefined),
  };
});

let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps, loading: false }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));

import { AppSwitcher } from '../AppSwitcher';

function renderSwitcher(onAppChange: (segment: string) => void) {
  render(
    <MemoryRouter>
      <AppSwitcher activeAppName="crm" onAppChange={onAppChange} />
    </MemoryRouter>,
  );
  return within(screen.getByTestId('app-switcher-menu'));
}

beforeEach(() => {
  apps = [
    { name: 'crm', label: 'CRM' },
    { name: 'r6_app', label: 'R6 App', _packageId: 'com.qa.r6nav' },
    { name: 'r6_board', label: 'R6 Board', _packageId: 'com.qa.r6nav' },
    { name: 'lead_settings', label: 'Lead Settings', hidden: true, _packageId: 'com.qa.lead' },
    { name: 'lead_app', label: 'Lead App', _packageId: 'com.qa.lead' },
  ];
});

afterEach(() => {
  cleanup();
});

describe('AppSwitcher rows open the app they name (objectstack-ai/objectstack#29024)', () => {
  it('a package\'s second app is switched to by its name; the first keeps its package id', () => {
    const onAppChange = vi.fn();
    const menu = renderSwitcher(onAppChange);
    menu.getByText('R6 Board').click();
    menu.getByText('R6 App').click();
    expect(onAppChange.mock.calls).toEqual([['r6_board'], ['com.qa.r6nav']]);
  });

  it('a visible app behind its package\'s hidden first app is switched to by its name', () => {
    const onAppChange = vi.fn();
    const menu = renderSwitcher(onAppChange);
    expect(menu.queryByText('Lead Settings')).toBeNull();
    menu.getByText('Lead App').click();
    expect(onAppChange).toHaveBeenCalledWith('lead_app');
  });
});
