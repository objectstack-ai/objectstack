// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12605 — inside an app the product mark stays in the bar as the way
 * home, and `⌘⇧H` / `Ctrl+Shift+H` goes home from any app page.
 *
 * What this file pins, through the real `AppHeader` under a real router:
 *   - the left group reads: sidebar trigger, the product mark, the `/` rule,
 *     the app pill, the PREVIEW chip;
 *   - the mark is named 「PRODUCT home」 (the product name from
 *     `getProductName`) and a click on it lands on `/home`;
 *   - the home chord, with ⌘ and with Ctrl, lands on `/home` as a PUSH, and
 *     Back returns to the app page; typed into a text field it does nothing;
 *   - the chord is advertised to the keyboard-shortcuts dialog while the app
 *     bar is mounted, with the chord the listener answers;
 *   - the pill is drawn at every width: no breakpoint class hides it.
 *
 * CONTROLS: the home page draws the same mark (one element, same test id),
 * named and linked the same way, and neither listens for nor advertises the
 * chord — Home is where it goes.
 *
 * Layout is not measured — jsdom applies no stylesheet — so, as in
 * `AppHeader.appBarLeftGroup-12461`, the order of the elements and the
 * responsive classes the header controls are what is asserted.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    language: 'en',
    t: (key: string, options?: Record<string, unknown>) =>
      String(options?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
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
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../CurrentOrganizationIndicator', () => ({ CurrentOrganizationIndicator: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({
  LocalizedSidebarTrigger: ({ className }: { className?: string }) => (
    <button type="button" data-testid="sidebar-trigger-stub" className={className} />
  ),
}));
vi.mock('../InboxPopover', () => ({ InboxPopover: () => null }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
// The pill is a recorder: its own rendering is `AppSwitcher.homeMenu-12605`'s.
// A bare stub, the shape the other `AppHeader` suites use: the header must
// not read anything else off this module (the chord lives in the registry).
vi.mock('../AppSwitcher', () => ({
  AppSwitcher: (p: { activeAppName: string }) => <div data-testid="app-switcher-stub" data-active={p.activeAppName} />,
}));
vi.mock('../../context/NavigationContext.js', () => ({
  useNavigationContext: () => ({ currentAppName: 'crm', recordTitle: undefined }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'Lin Yue', email: 'linyue@example.com' },
    signOut: vi.fn(),
    isAuthEnabled: true,
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    getAuthConfig: undefined,
  }),
  getUserInitials: () => 'LY',
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [{ name: 'crm', label: 'CRM', _packageId: 'com.example.crm' }],
    dashboards: [],
    pages: [],
    reports: [],
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }),
}));

import { AppHeader } from '../AppHeader';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { GO_HOME_SHORTCUT, useAdvertisedShortcuts, type ShortcutChord } from '../../chrome/advertisedShortcuts';
import { getProductName } from '../../runtime-config';

const MEMBER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u1',
  tenantId: 'org_1',
  roles: [],
  permissionSets: [],
  systemPermissions: [],
  objects: {},
  fields: {},
};

/** Where the router is, how it got there, and a Back button. */
function RouterProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location" data-path={location.pathname} data-nav={navigationType} />
      <button type="button" data-testid="go-back" onClick={() => navigate(-1)} />
    </>
  );
}

/** The registry's own reading. */
function AdvertisedReading() {
  const advertised = useAdvertisedShortcuts();
  return (
    <output
      data-testid="advertised"
      data-reading={JSON.stringify(advertised.map(({ id, chord }) => ({ id, chord })))}
    />
  );
}

function mount(initialPath: string) {
  return render(
    <MePermissionsProvider initialPermissions={MEMBER}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CommandPaletteProvider>
          <Routes>
            <Route
              path="/apps/:appName/*"
              element={
                <>
                  <AppHeader variant="app" appName="CRM" activeAppName="crm" onAppChange={vi.fn()} objects={[]} />
                  <input data-testid="typing" />
                </>
              }
            />
            <Route path="/home" element={<AppHeader variant="home" />} />
          </Routes>
          <RouterProbe />
          <AdvertisedReading />
        </CommandPaletteProvider>
      </MemoryRouter>
    </MePermissionsProvider>,
  );
}

const location = () => screen.getByTestId('location');
const advertised = (): Array<{ id: string; chord: ShortcutChord }> =>
  JSON.parse(screen.getByTestId('advertised').dataset.reading ?? '[]');
const mark = () => screen.getByTestId('app-bar-product-home');
const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/** The keydowns the advertised chord stands for: ⌘ and Ctrl both. */
function chordEvents(chord: ShortcutChord): KeyboardEventInit[] {
  const base = { key: chord.key.toUpperCase(), shiftKey: Boolean(chord.shift) };
  return [{ ...base, metaKey: true }, { ...base, ctrlKey: true }];
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  cleanup();
});

describe('inside an app the product mark is the way home (objectui#12605)', () => {
  it('the left group: sidebar trigger, product mark, `/` rule, app pill, PREVIEW chip', () => {
    mount('/apps/crm/lead');
    const trigger = screen.getByTestId('sidebar-trigger-stub');
    const separator = screen.getByTestId('app-bar-home-separator');
    const pill = screen.getByTestId('app-switcher-stub');
    const badge = screen.getByTestId('platform-preview-badge');

    expect(follows(trigger, mark())).toBe(true);
    expect(mark().nextElementSibling).toBe(separator);
    expect(follows(separator, pill)).toBe(true);
    expect(follows(pill, badge)).toBe(true);
    // The rule is decorative and carries no text.
    expect(separator).toHaveAttribute('aria-hidden');
    expect(separator.textContent).toBe('');
  });

  it('the mark is named 「PRODUCT home」 and links to `/home`', () => {
    mount('/apps/crm/lead');
    const link = screen.getByRole('link', { name: `${getProductName()} home` });
    expect(link).toBe(mark());
    expect(link).toHaveAttribute('href', '/home');
  });

  it('a click on the mark lands on `/home`', () => {
    mount('/apps/crm/lead');
    fireEvent.click(mark());
    expect(location()).toHaveAttribute('data-path', '/home');
  });

  it('the app pill is drawn at every width — no breakpoint class hides it', () => {
    mount('/apps/crm/lead');
    const wrapper = screen.getByTestId('app-switcher-stub').parentElement!;
    expect(wrapper.className.split(/\s+/)).not.toContain('hidden');
  });
});

describe('`⌘⇧H` / `Ctrl+Shift+H` goes home from any app page (objectui#12605)', () => {
  it('is advertised while the app bar is mounted, as ⌘⇧H', () => {
    mount('/apps/crm/lead');
    expect(advertised()).toContainEqual({ id: 'go-home', chord: { key: 'h', mod: true, shift: true } });
  });

  it('the advertised chord, with ⌘ and with Ctrl, pushes `/home`; Back returns to the app page', () => {
    mount('/apps/crm/lead');
    const chord = advertised().find((s) => s.id === GO_HOME_SHORTCUT.id)!.chord;
    for (const event of chordEvents(chord)) {
      cleanup();
      mount('/apps/crm/lead/view/open');
      expect(location()).toHaveAttribute('data-path', '/apps/crm/lead/view/open');
      fireEvent.keyDown(document.body, event);
      expect(location()).toHaveAttribute('data-path', '/home');
      expect(location()).toHaveAttribute('data-nav', 'PUSH');
      act(() => {
        fireEvent.click(screen.getByTestId('go-back'));
      });
      expect(location()).toHaveAttribute('data-path', '/apps/crm/lead/view/open');
    }
  });

  it('typed into a text field, the chord stays the field\'s', () => {
    mount('/apps/crm/lead');
    fireEvent.keyDown(screen.getByTestId('typing'), { key: 'H', shiftKey: true, metaKey: true });
    expect(location()).toHaveAttribute('data-path', '/apps/crm/lead');
  });

  it('CONTROL — Shift is part of the chord: ⌘H alone does nothing', () => {
    mount('/apps/crm/lead');
    fireEvent.keyDown(document.body, { key: 'h', metaKey: true });
    expect(location()).toHaveAttribute('data-path', '/apps/crm/lead');
  });
});

describe('CONTROL — the home page draws the same mark and leaves the chord alone (objectui#12605)', () => {
  it('one mark, named and linked the same way; no `/` rule and no advertisement', () => {
    mount('/home');
    expect(screen.getByRole('link', { name: `${getProductName()} home` })).toBe(mark());
    expect(mark()).toHaveAttribute('href', '/home');
    expect(mark()).toHaveAttribute('title', getProductName());
    expect(screen.queryByTestId('app-bar-home-separator')).not.toBeInTheDocument();
    expect(advertised().map((s) => s.id)).not.toContain('go-home');
  });

  it('the mark keeps its x: the home bar holds the sidebar trigger\'s 28 px slot empty before it', () => {
    mount('/home');
    const slot = screen.getByTestId('app-bar-trigger-slot');
    expect(slot).toHaveAttribute('aria-hidden');
    expect(slot.nextElementSibling).toBe(mark());
    // The trigger is `h-7 w-7` (LocalizedSidebarTrigger) and the bar gives it
    // `shrink-0 mr-1`; the empty slot is the same box with the same gap.
    expect(slot.className.split(/\s+/)).toEqual(expect.arrayContaining(['h-7', 'w-7', 'shrink-0', 'mr-1']));
    cleanup();
    mount('/apps/crm/lead');
    expect(screen.queryByTestId('app-bar-trigger-slot')).not.toBeInTheDocument();
    const trigger = screen.getByTestId('sidebar-trigger-stub');
    expect(trigger.className.split(/\s+/)).toEqual(expect.arrayContaining(['shrink-0', 'mr-1']));
    expect(trigger.nextElementSibling).toBe(mark());
  });
});
