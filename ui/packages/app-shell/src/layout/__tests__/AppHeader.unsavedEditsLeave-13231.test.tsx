// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The header's menus ask before leaving a page that holds unsaved edits
 * (objectui#13231).
 *
 * ## What was broken
 *
 * Measured in Chromium on a dirty `/apps/crm/system/settings/localization`: a
 * sidebar link, the page's own crumb and "All apps" asked first (objectui#13163),
 * but Help › All documentation, the avatar's Profile, My Organizations and
 * Create organization, and the workspace switcher's Manage members, Create
 * organization and another organization each left at once and the edit was
 * lost. Those entries call `navigate()` from a menu button, which no link
 * listener sees. The organization switch sent `set-active` first and then
 * reloaded the document, so the organization had switched before anything
 * could ask.
 *
 * ## What is driven here
 *
 * The real `AppHeader` in its `app` variant, with the real `WorkspaceSwitcher`
 * inside it (two organizations, so it renders), under a real `MemoryRouter`.
 * Only `navigate` is a spy, so each case reads where the header sent the user.
 * A page's unsaved edits are registered with the seam directly
 * (`registerUnsavedEdits`), the way a page's hook does; the pages' own
 * registration is pinned beside them. Menu primitives pass through, so each
 * entry is a button whose `onClick` is the header's own.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
  useObjectLabel: () => {
    const label = (x: { name?: string; label?: string } | string) =>
      typeof x === 'string' ? x : String(x?.label ?? x?.name ?? '');
    return {
      objectLabel: label,
      objectPluralLabel: label,
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    };
  },
}));

/** Passthrough menu primitives: every entry is a button carrying the header's own `onClick`. */
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const strip = (p: Record<string, unknown> | undefined) => {
    const { asChild: _a, variant: _v, size: _s, align: _al, sideOffset: _so, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div {...strip(p)}>{children}</div>
  );
  return {
    ...actual,
    Button: ({
      children,
      asChild,
      variant: _v,
      size: _s,
      ...p
    }: { children?: React.ReactNode; asChild?: boolean } & Record<string, unknown>) =>
      asChild ? <span {...p}>{children}</span> : <button type="button" {...p}>{children}</button>,
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuItem: ({ children, onClick, ...p }: { children?: React.ReactNode; onClick?: () => void } & Record<string, unknown>) =>
      p.asChild ? <>{children}</> : <button type="button" onClick={onClick} {...strip(p)}>{children}</button>,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    Avatar: Pass,
    AvatarImage: () => null,
    AvatarFallback: Pass,
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
  };
});

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useOffline: () => ({ isOnline: true }),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PresenceAvatars: () => null,
  useTenantPresence: () => [],
}));

vi.mock('../ModeToggle', () => ({ ModeToggle: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../NotificationPreferencesMenu', () => ({ NotificationPreferencesMenu: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
/** The app switcher's rows hand `onAppChange` the app they name; one row stands in for them. */
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: ({ onAppChange }: { onAppChange: (segment: string) => void }) => (
    <button type="button" data-testid="app-switcher-row-sales" onClick={() => onAppChange('sales')}>
      Sales
    </button>
  ),
}));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
// The organization switch reloads to the console root; a hash keeps the harness on its document.
vi.mock('../../console/organizations/resolveHomeUrl', () => ({ resolveRootUrl: () => '#switched-to-globex' }));

const ACME = { id: 'org_acme', name: 'Acme', slug: 'acme' };
const GLOBEX = { id: 'org_globex', name: 'Globex', slug: 'globex' };

const auth = vi.hoisted(() => ({
  signOut: vi.fn(async () => undefined),
  switchOrganization: vi.fn(async (_id: string) => undefined),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  // One stable function identity for the file: the header and the switcher
  // read it in an effect keyed on it (see `AppHeader.myOrganizations`).
  const getAuthConfig = () => Promise.resolve({ features: { multiOrgEnabled: true } });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => ({
      user: { id: 'u1', name: 'Ada Admin', email: 'ada@example.com' },
      signOut: auth.signOut,
      isAuthEnabled: true,
      organizations: [ACME, GLOBEX],
      activeOrganization: ACME,
      isOrganizationsLoading: false,
      switchOrganization: auth.switchOrganization,
      getAuthConfig,
    }),
    getUserInitials: () => 'AA',
    useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  };
});

/** CRM, and an app the user reaches from the avatar menu (`hidden: true`). */
const APPS = [
  { name: 'crm', label: 'CRM', active: true },
  { name: 'personal_settings', label: 'Personal Settings', active: true, hidden: true },
];
vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({ apps: APPS, dashboards: [], pages: [], reports: [] }),
}));

const ADAPTER = vi.hoisted(() => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }));
vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ADAPTER,
}));

import { AppHeader } from '../AppHeader';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

const QUESTION = 'You have unsaved changes. Are you sure you want to leave?';
const PAGE = '/apps/crm/system/settings/localization';

/**
 * The prompt, answered by the test: Cancel unless a case says OK. Stubbed as a
 * global because happy-dom's window has no `confirm` to spy on.
 */
function stubConfirm() {
  const spy = vi.fn((_message?: string): boolean => false);
  vi.stubGlobal('confirm', spy);
  return spy;
}
let confirmSpy: ReturnType<typeof stubConfirm>;
const onAppChange = vi.fn();
let release: (() => void) | null = null;

/** A page on screen holds an unsaved edit, as a dirty settings page registers it. */
function holdUnsavedEdit() {
  release = registerUnsavedEdits(QUESTION);
}

async function renderHeader() {
  render(
    <MemoryRouter initialEntries={[PAGE]}>
      <AppHeader variant="app" appName="CRM" activeAppName="crm" onAppChange={onAppChange} objects={[]} />
    </MemoryRouter>,
  );
  // The auth config read settles, so the create entries have their final gate.
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/** The header's own departures from a menu button: entry → where it leads. */
const MENU_DEPARTURES: Array<{ entry: string; click: () => void; to: string }> = [
  { entry: 'Help › All documentation', click: () => fireEvent.click(screen.getByRole('button', { name: 'All documentation' })), to: '/docs' },
  { entry: 'avatar › Profile', click: () => fireEvent.click(screen.getByRole('button', { name: 'Profile' })), to: '/apps/account/component/account/profile_card' },
  { entry: 'avatar › My Organizations', click: () => fireEvent.click(screen.getByTestId('header-my-organizations')), to: '/organizations?manage=1' },
  { entry: 'avatar › Create organization', click: () => fireEvent.click(screen.getByTestId('header-create-workspace')), to: '/organizations?create=1' },
  { entry: 'avatar › a hidden app', click: () => fireEvent.click(screen.getByRole('button', { name: 'Personal Settings' })), to: '/apps/personal_settings' },
  { entry: 'workspace › Manage members', click: () => fireEvent.click(screen.getByTestId('workspace-manage-members')), to: '/organizations/acme/members' },
  { entry: 'workspace › Create organization', click: () => fireEvent.click(screen.getByTestId('workspace-create')), to: '/organizations?create=1' },
];

/** The workspace switcher's row for the other organization. */
const globexRow = () => screen.getAllByRole('button').find((b) => b.textContent?.trim().endsWith('Globex') && !b.hasAttribute('data-testid'))!;

beforeEach(() => {
  navigate.mockReset();
  onAppChange.mockReset();
  auth.signOut.mockClear();
  auth.switchOrganization.mockClear();
  confirmSpy = stubConfirm();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))));
  window.history.replaceState(null, '', PAGE);
});

afterEach(() => {
  cleanup();
  release?.();
  release = null;
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('the header menus ask before leaving unsaved edits (objectui#13231)', () => {
  for (const { entry, click, to } of MENU_DEPARTURES) {
    it(`${entry}: asks; Cancel stays, OK goes to ${to}`, async () => {
      holdUnsavedEdit();
      await renderHeader();

      click();
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
      expect(navigate).not.toHaveBeenCalled();

      confirmSpy.mockReturnValue(true);
      click();
      expect(confirmSpy).toHaveBeenCalledTimes(2);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(to);
    });
  }

  it('workspace › another organization asks BEFORE set-active; Cancel sends nothing and keeps the organization', async () => {
    holdUnsavedEdit();
    await renderHeader();

    fireEvent.click(globexRow());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(auth.switchOrganization).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('workspace › another organization: OK switches, then reloads, with no second prompt from the tab-close guard', async () => {
    holdUnsavedEdit();
    confirmSpy.mockReturnValue(true);
    let unloadHeldDuringSwitch: boolean | undefined;
    auth.switchOrganization.mockImplementationOnce(async () => {
      const unload = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(unload);
      unloadHeldDuringSwitch = unload.defaultPrevented;
    });
    await renderHeader();

    fireEvent.click(globexRow());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(auth.switchOrganization).toHaveBeenCalledWith('org_globex');
    // Asked first, switched after: the question precedes `set-active`.
    expect(confirmSpy.mock.invocationCallOrder[0]).toBeLessThan(auth.switchOrganization.mock.invocationCallOrder[0]);
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
    expect(unloadHeldDuringSwitch).toBe(false);
    expect(window.location.hash).toBe('#switched-to-globex');
  });

  it('the app switcher: picking another app asks; Cancel stays, OK switches', async () => {
    holdUnsavedEdit();
    await renderHeader();

    fireEvent.click(screen.getByTestId('app-switcher-row-sales'));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(onAppChange).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('app-switcher-row-sales'));
    expect(onAppChange).toHaveBeenCalledWith('sales');
  });

  it('Log out asks; Cancel keeps the session, OK signs out', async () => {
    holdUnsavedEdit();
    await renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('the go-home shortcut asks; Cancel stays, OK goes home', async () => {
    holdUnsavedEdit();
    await renderHeader();

    fireEvent.keyDown(document, { key: 'h', metaKey: true, shiftKey: true });
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.keyDown(document, { key: 'h', metaKey: true, shiftKey: true });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe('CONTROL: nothing registered, nothing asked (objectui#13231)', () => {
  it('every menu departure goes at once', async () => {
    await renderHeader();
    for (const { click, to } of MENU_DEPARTURES) {
      click();
      expect(navigate).toHaveBeenLastCalledWith(to);
    }
    expect(navigate).toHaveBeenCalledTimes(MENU_DEPARTURES.length);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('another organization switches at once', async () => {
    await renderHeader();
    fireEvent.click(globexRow());
    expect(auth.switchOrganization).toHaveBeenCalledWith('org_globex');
    expect(confirmSpy).not.toHaveBeenCalled();
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  });
});
