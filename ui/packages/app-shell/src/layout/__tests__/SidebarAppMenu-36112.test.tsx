// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36112 — the sidebar's app menu only switches apps: the viewer's
 * apps with the current one checked, the Setup app among them when the server
 * serves it, a search field once there are more than eight, and 「Add app」 at
 * the foot for a workspace admin who may author. It offers no way home, no
 * 「All apps」 and no Studio entry (the page's button group carries 「Edit app」).
 *
 * Real subjects: `SidebarAppMenu`, `AppMark`, the real launcher list. The
 * dropdown primitives pass through so the menu content renders without
 * radix's open/close machinery (`AppSwitcher.homeMenu-12605`'s idiom).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

type MockProps = Record<string, unknown> & { children?: ReactNode; onSelect?: () => void; className?: string };

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: MockProps) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: MockProps) => <div>{p.children}</div>,
  DropdownMenuContent: ({ children, className: _c, sideOffset: _s, align: _a, ...rest }: MockProps) => (
    <div {...rest}>{children}</div>
  ),
  DropdownMenuItem: ({ onSelect, children, asChild: _asChild, className: _c, ...rest }: MockProps) => (
    <div data-menu-row="" onClick={onSelect} {...rest}>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuSub: (p: MockProps) => <div>{p.children}</div>,
  DropdownMenuSubTrigger: ({ children, className: _c, ...rest }: MockProps) => <div {...rest}>{children}</div>,
  DropdownMenuSubContent: ({ children }: MockProps) => <div data-testid="add-app-choices">{children}</div>,
}));

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

let apps: Array<Record<string, unknown>> = [];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps }),
}));

let admin = false;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: admin, isResolved: true }),
}));
let canAuthor = true;
vi.mock('../../hooks/useCanAuthorMetadata', () => ({
  useCanAuthorMetadata: () => canAuthor,
}));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: true, isLoading: false }),
}));
vi.mock('../../runtime-config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isAiStudioEnabled: () => true,
  isMarketplaceEnabled: () => true,
}));

import { SidebarAppMenu, APP_MENU_SEARCH_FROM } from '../SidebarAppMenu';

const CRM = { name: 'crm', label: 'CRM', icon: 'flame', _packageId: 'com.acme.crm' };
const SERVICE = { name: 'service', label: 'Service', icon: 'headset' };
const SETUP = { name: 'setup', label: 'Setup', icon: 'settings', _packageId: 'com.objectstack.setup' };

function renderMenu(active = 'crm', onAppChange = vi.fn()) {
  render(
    <MemoryRouter>
      <SidebarAppMenu activeAppName={active} onAppChange={onAppChange} />
    </MemoryRouter>,
  );
  return onAppChange;
}

const menu = () => within(screen.getByTestId('sidebar-app-menu'));

afterEach(() => {
  cleanup();
  apps = [];
  admin = false;
  canAuthor = true;
});

describe('the sidebar app menu only switches apps (objectstack#36112)', () => {
  it('names the current app and lists every app, the current one checked, Setup among them', () => {
    apps = [CRM, SERVICE, SETUP];
    renderMenu('crm');
    expect(screen.getByTestId('sidebar-app-menu-trigger')).toHaveTextContent('CRM');
    for (const name of ['crm', 'service', 'setup']) {
      expect(menu().getByTestId(`sidebar-app-menu-row-${name}`)).toBeInTheDocument();
    }
    expect(menu().getByTestId('sidebar-app-menu-row-crm').querySelector('svg.lucide-check')).not.toBeNull();
    expect(menu().getByTestId('sidebar-app-menu-row-service').querySelector('svg.lucide-check')).toBeNull();
  });

  it('offers no way home, no 「All apps」 and no Studio entry', () => {
    apps = [CRM, SERVICE, SETUP];
    renderMenu('crm');
    for (const text of ['Back to home', 'All apps', 'Edit CRM in Studio', 'Open CRM in Studio']) {
      expect(menu().queryByText(text)).toBeNull();
    }
  });

  it('a viewer the server serves no Setup app to sees none', () => {
    apps = [CRM, SERVICE];
    renderMenu('crm');
    expect(menu().queryByTestId('sidebar-app-menu-row-setup')).toBeNull();
  });

  it('choosing another app opens it by its address; the current one does nothing', () => {
    apps = [CRM, SERVICE];
    const onAppChange = renderMenu('crm');
    fireEvent.click(menu().getByTestId('sidebar-app-menu-row-service'));
    expect(onAppChange).toHaveBeenCalledWith('service');
    fireEvent.click(menu().getByTestId('sidebar-app-menu-row-crm'));
    expect(onAppChange).toHaveBeenCalledTimes(1);
  });

  it(`draws a search field above the list only past ${APP_MENU_SEARCH_FROM} apps, and it narrows the list`, () => {
    apps = Array.from({ length: APP_MENU_SEARCH_FROM }, (_, i) => ({ name: `app${i}`, label: `App ${i}` }));
    renderMenu('app0');
    expect(menu().queryByTestId('sidebar-app-menu-search')).toBeNull();
    cleanup();
    apps = [...apps, { name: 'billing', label: 'Billing' }];
    renderMenu('app0');
    fireEvent.change(menu().getByTestId('sidebar-app-menu-search'), { target: { value: 'bill' } });
    expect(menu().getByTestId('sidebar-app-menu-row-billing')).toBeInTheDocument();
    expect(menu().queryByTestId('sidebar-app-menu-row-app1')).toBeNull();
    fireEvent.change(menu().getByTestId('sidebar-app-menu-search'), { target: { value: 'zzz' } });
    expect(menu().getByTestId('sidebar-app-menu-empty')).toBeInTheDocument();
  });

  it('「Add app」 is offered to a workspace admin who may author: AI, a template, the marketplace', () => {
    apps = [CRM];
    admin = true;
    renderMenu('crm');
    expect(menu().getByTestId('sidebar-app-menu-add')).toHaveTextContent('Add app');
    const choices = within(screen.getByTestId('add-app-choices'));
    expect(choices.getByTestId('sidebar-app-menu-add-build-with-ai')).toHaveAttribute('href', '/studio');
    expect(choices.getByTestId('sidebar-app-menu-add-template')).toHaveAttribute('href', '/apps/setup/system/marketplace');
    expect(choices.getByTestId('sidebar-app-menu-add-marketplace')).toHaveAttribute('href', '/apps/setup/system/marketplace');
  });

  it('control: a member, or an admin who may not author, gets no 「Add app」', () => {
    apps = [CRM];
    renderMenu('crm');
    expect(menu().queryByTestId('sidebar-app-menu-add')).toBeNull();
    cleanup();
    admin = true;
    canAuthor = false;
    renderMenu('crm');
    expect(menu().queryByTestId('sidebar-app-menu-add')).toBeNull();
  });
});
