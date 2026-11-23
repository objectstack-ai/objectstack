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
 *
 * objectstack#36485 — the menu is also the door into the design mode:
 * 「Edit app」 under the list, in one group with 「Add app」, on the page
 * header button's former gate (a workspace admin holding `manage_metadata`,
 * an app whose package Studio lists, a read-only one included), not while the
 * mode is on. Real subjects added: `useAppStudioEntry`'s gate over a stubbed
 * package list, and the shell's real design-mode controller.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
/** What the session's auth answers beyond the real hook: the deployment's posture, the platform operator flag. */
let authOverride: Record<string, unknown> = {};
vi.mock('@object-ui/auth', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the real module, spread whole
  const actual = await importOriginal<Record<string, any>>();
  return {
    ...actual,
    useWorkspaceAdminStatus: () => ({ isAdmin: admin, isResolved: true }),
    useAuth: () => ({ ...actual.useAuth(), ...authOverride }),
  };
});
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
import { DesignModeProvider, useDesignModeController } from '../designMode';

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

/** Whether the stubbed package list serves CRM's package writable. */
let writable = true;

/** The package list (`GET /api/v1/packages`), read for a viewer who may author: CRM's package, writable or not. */
function stubPackageList() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).endsWith('/api/v1/packages')
          ? { data: { packages: [{ manifest: { id: 'com.acme.crm', name: 'CRM' }, writable }] } }
          : { data: [] },
    })),
  );
}

beforeEach(() => {
  writable = true;
  stubPackageList();
});

afterEach(() => {
  cleanup();
  apps = [];
  admin = false;
  canAuthor = true;
  authOverride = {};
  vi.unstubAllGlobals();
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

describe('「Edit app」 in the app menu enters the design mode (objectstack#36485)', () => {
  /** The shell's hold on the mode, as `ConsoleLayout` keeps it, and whether it is on. */
  function Shell({ children }: { children: ReactNode }) {
    const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
    return (
      <DesignModeProvider value={mode}>
        <output data-testid="mode">{mode.active ? 'on' : 'off'}</output>
        {children}
      </DesignModeProvider>
    );
  }

  async function mountMenu({ held = true, route = '/apps/crm/crm_lead', active = 'crm' } = {}) {
    const menuNode = <SidebarAppMenu activeAppName={active} onAppChange={vi.fn()} />;
    render(<MemoryRouter initialEntries={[route]}>{held ? <Shell>{menuNode}</Shell> : menuNode}</MemoryRouter>);
    // The package list's verdict settled, so an absent item is a reading.
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }

  const editApp = () => menu().queryByTestId('sidebar-app-menu-edit-app');

  beforeEach(() => {
    apps = [CRM, SERVICE, SETUP];
    admin = true;
  });

  it('a workspace admin who may author sees it under the list, in one group with 「Add app」', async () => {
    await mountMenu();
    const item = editApp();
    expect(item).not.toBeNull();
    expect(item).toHaveTextContent('Edit app');
    expect(item!.querySelector('svg.lucide-blocks')).not.toBeNull();
    const lastRow = menu().getByTestId('sidebar-app-menu-row-setup');
    const add = menu().getByTestId('sidebar-app-menu-add');
    const rule = item!.previousElementSibling;
    expect(rule?.tagName).toBe('HR');
    expect(lastRow.compareDocumentPosition(rule!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(item!.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // One group: the rule above it is the menu's only one, none between it and 「Add app」.
    expect(screen.getByTestId('sidebar-app-menu').querySelectorAll('hr')).toHaveLength(1);
  });

  it('choosing it turns the mode on in place; while it is on the menu offers it no more', async () => {
    await mountMenu();
    expect(screen.getByTestId('mode')).toHaveTextContent('off');
    await act(async () => fireEvent.click(editApp()!));
    expect(screen.getByTestId('mode')).toHaveTextContent('on');
    expect(editApp()).toBeNull();
    // The rest of the menu is unchanged.
    expect(menu().getByTestId('sidebar-app-menu-add')).toBeInTheDocument();
    expect(menu().getByTestId('sidebar-app-menu-row-crm')).toBeInTheDocument();
  });

  it('an installed (read-only) package\'s app has it too, and it enters the same mode (objectstack#36363)', async () => {
    writable = false;
    await mountMenu();
    await act(async () => fireEvent.click(editApp()!));
    expect(screen.getByTestId('mode')).toHaveTextContent('on');
  });

  it('where the customization door is walled off for this caller, a read-only package\'s app gets none; a writable one keeps it', async () => {
    authOverride = { getAuthConfig: async () => ({ features: { tenancyPosture: 'isolated' } }), user: { isPlatformAdmin: false } };
    writable = false;
    await mountMenu();
    expect(editApp()).toBeNull();
    cleanup();
    writable = true;
    // A fresh transport, so the list is read again rather than answered from the session's hold.
    stubPackageList();
    await mountMenu();
    expect(editApp()).not.toBeNull();
  });

  it('control: a member, and an admin who may not author, get none', async () => {
    admin = false;
    await mountMenu();
    expect(editApp()).toBeNull();
    cleanup();
    admin = true;
    canAuthor = false;
    await mountMenu();
    expect(editApp()).toBeNull();
  });

  it('control: none on an app whose package Studio does not list (the console\'s own Setup), nor where no shell holds the mode', async () => {
    await mountMenu({ active: 'setup', route: '/apps/setup/system' });
    expect(editApp()).toBeNull();
    cleanup();
    await mountMenu({ held: false });
    expect(editApp()).toBeNull();
  });
});
