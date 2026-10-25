// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The header's "Search ⌘K" trigger is drawn only where a command palette is
 * mounted (objectui#11912).
 *
 * `useCommandPalette()` answers an inert fallback outside a
 * `CommandPaletteProvider`, and only `ConsoleLayout` mounted one (the `/studio`
 * landing mounts one too since objectui#11863). `HomeLayout`
 * and `AiChatPage` mount the `home` variant, `OrganizationsLayout` and
 * `OrganizationLayout` the `orgs` variant, all without a provider — so on
 * `/home`, `/ai` and the organizations frames the trigger was shown and a click
 * (or `Ctrl+K`) opened nothing.
 *
 * Real subjects: `AppHeader`, the real `CommandPaletteProvider` and a real
 * `MemoryRouter`, so the control case reads the palette's open state the way
 * `CommandPalette` itself reads it (`useCommandPalette().open`, backed by
 * `?palette=1`). The chrome this card does not touch (menus, presence,
 * switchers, icons, the inbox) is stubbed the way
 * `AppHeader.designInStudioNeedsAuthoring-10899.test.tsx` stubs it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';

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
      dashboardLabel: label,
      pageLabel: label,
      reportLabel: label,
      viewLabel: (_o: string, _v: string, fallback?: string) => fallback ?? '',
      appLabel: label,
    };
  },
}));

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const strip = (p: any) => {
    const { asChild, variant, size, align, sideOffset, ...rest } = p ?? {};
    return rest;
  };
  const Pass = ({ children, ...p }: any) => <div {...strip(p)}>{children}</div>;
  return {
    ...actual,
    Button: ({ children, asChild, variant, size, ...p }: any) =>
      asChild ? <span {...p}>{children}</span> : <button type="button" {...p}>{children}</button>,
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
    DropdownMenuSeparator: () => null,
    DropdownMenuGroup: Pass,
    Avatar: Pass,
    AvatarImage: () => null,
    AvatarFallback: Pass,
    Popover: Pass,
    PopoverTrigger: Pass,
    PopoverContent: () => null,
    cn: (...c: any[]) => c.filter(Boolean).join(' '),
  };
});

vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, prop) => {
      if (prop === 'then' || prop === '__esModule' || typeof prop === 'symbol') return target[prop];
      return Icon;
    },
    has: (_target, prop) => prop !== 'then',
  });
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
vi.mock('../WorkspaceSwitcher', () => ({ WorkspaceSwitcher: () => null }));
vi.mock('../LocaleSwitcher', () => ({ LocaleSwitcher: () => null }));
vi.mock('../ConnectionStatus', () => ({ ConnectionStatus: () => null }));
vi.mock('../AppSwitcher', () => ({ AppSwitcher: () => null }));
vi.mock('../LocalizedSidebarTrigger', () => ({ LocalizedSidebarTrigger: () => null }));
vi.mock('../PreviewBadge', () => ({ PreviewBadge: () => null }));
// Rendered in every variant, so it doubles as the "the header drew" control.
vi.mock('../InboxPopover', () => ({ InboxPopover: () => <div data-testid="inbox-bell" /> }));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
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
  useMetadata: () => ({ apps: [], dashboards: [], pages: [], reports: [] }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: () => Promise.resolve({ data: [] }), getClient: () => undefined }),
}));

import { AppHeader, type AppHeaderVariant } from '../AppHeader';
import { CommandPaletteProvider, useCommandPalette } from '../../context/CommandPaletteProvider';

const DESKTOP = 'action:command-palette:open';
const MOBILE = 'action:command-palette:open-mobile';

/** The palette's open state and the URL, as `CommandPalette` would read them. */
function PaletteProbe() {
  const { open } = useCommandPalette();
  const { search } = useLocation();
  return <output data-testid="palette-probe" data-open={String(open)} data-search={search} />;
}

/** The frame each variant is mounted in by the console. */
const FRAME: Record<AppHeaderVariant, string> = {
  home: '/home',
  orgs: '/organizations',
  studio: '/studio',
  app: '/apps/crm',
};

function header(variant: AppHeaderVariant) {
  return <AppHeader variant={variant} appName={variant === 'app' ? 'crm' : undefined} />;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the header search trigger renders only where a command palette is mounted (objectui#11912)', () => {
  // `home` is /home and /ai; `orgs` is /organizations and /organizations/SLUG.
  // `studio` (the /studio front door, which mounts a palette since
  // objectui#11863) and `app` without a provider are not console frames, but
  // they pin that the gate is the palette's presence, not the variant name.
  it.each<AppHeaderVariant>(['home', 'orgs', 'studio', 'app'])(
    'the `%s` variant with no CommandPaletteProvider draws neither trigger',
    (variant) => {
      render(<MemoryRouter initialEntries={[FRAME[variant]]}>{header(variant)}</MemoryRouter>);
      // The header did render — the absence below is not an empty tree.
      expect(screen.getByTestId('inbox-bell')).toBeInTheDocument();
      expect(screen.queryByTestId(DESKTOP)).not.toBeInTheDocument();
      expect(screen.queryByTestId(MOBILE)).not.toBeInTheDocument();
      expect(document.querySelector('[aria-keyshortcuts]')).toBeNull();
    },
  );

  // `studio` is the /studio front door's own frame: `StudioLanding` mounts the
  // provider with the palette's `studio` scope (objectui#11863).
  it.each<AppHeaderVariant>(['app', 'home', 'studio'])(
    'CONTROL — the `%s` variant under a CommandPaletteProvider draws both triggers, and each opens the palette',
    (variant) => {
      for (const testId of [DESKTOP, MOBILE]) {
        const { unmount } = render(
          <MemoryRouter initialEntries={[FRAME[variant]]}>
            <CommandPaletteProvider>
              {header(variant)}
              <PaletteProbe />
            </CommandPaletteProvider>
          </MemoryRouter>,
        );
        expect(screen.getByTestId(DESKTOP)).toBeInTheDocument();
        expect(screen.getByTestId(MOBILE)).toBeInTheDocument();

        const probe = screen.getByTestId('palette-probe');
        expect(probe).toHaveAttribute('data-open', 'false');
        fireEvent.click(screen.getByTestId(testId));
        expect(probe).toHaveAttribute('data-open', 'true');
        expect(probe.getAttribute('data-search')).toContain('palette=1');
        unmount();
      }
    },
  );
});
