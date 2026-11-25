// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37197 — the docs portal (`/docs…`) draws in an app-less variant
 * of the app shell from 768 px up: the shell's sidebar in its `docsPortal`
 * mode (a neutral head, the docs tree as the body), no top bar, the page
 * header's app-less button group and the expand button, and no app guessed —
 * the navigation context stays Home's, nothing is written to the current or
 * the last app, and the help menu names no app's docs whatever the URL or the
 * app open before. A phone keeps Home's frame with the docs bar (the PHONE
 * CONTROL in every block).
 *
 * Harness: the real `DocsPortalShell`, `@object-ui/layout`'s real `AppShell`,
 * the real `ShellPageActionsScope`, the real docs-navigation slot and the real
 * `NavigationProvider`. The sidebar, Home's layout and palette, the help menu
 * and the AI drawer are stubs that report what they were handed.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSidebar } from '@object-ui/components';
// The shell's reach includes the palette's lazy record preview
// (`import('@object-ui/plugin-detail')`): pay that load during collection.
import '@object-ui/plugin-detail';

const rememberApp = vi.hoisted(() => vi.fn());
/** The data adapter the shell reads its connection state from; none unless a test sets one. */
const adapter = vi.hoisted(() => ({ value: null as null | { getConnectionState: () => string; onConnectionStateChange: () => () => void } }));

vi.mock('../../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../../../layout/useConsoleChatDock', () => ({
  useConsoleChatDock: () => ({ control: null, rail: null, sheet: null }),
}));
// The one app carries its own brand: the portal must not take it (design point 5).
vi.mock('../../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        active: true,
        _packageId: 'com.acme.crm',
        navigation: [],
        branding: { primaryColor: '#e11d48', accentColor: '#f59e0b' },
      },
    ],
  }),
}));
vi.mock('../../../providers/AdapterProvider', () => ({ useAdapter: () => adapter.value }));
vi.mock('../../../providers/ExpressionProvider', () => ({
  ExpressionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
// A tripwire only: nothing the portal draws calls it, and the last-app check in
// storage is what carries the "no app remembered" pin. A frame that remembers
// an app (as an app's layout does) would call it, and the assertions on it
// would go red with the storage check.
vi.mock('../../../context/LastAppProvider', () => ({
  useLastApp: () => ({ lastApp: null, rememberApp }),
}));
vi.mock('../../../layout/UnifiedSidebar', async () => {
  const { SidebarDocsNavTarget } = await import('../../../layout/sidebarDocsNavSlot');
  return {
    UnifiedSidebar: (props: { docsPortal?: boolean; activeAppName?: string; docsNav?: boolean }) => (
      <div
        data-testid="sidebar-stub"
        data-docs-portal={String(props.docsPortal === true)}
        data-active-app={props.activeAppName ?? ''}
        data-docs-nav={String(props.docsNav === true)}
      >
        <SidebarDocsNavTarget />
      </div>
    ),
  };
});
vi.mock('../../home/HomeLayout', () => ({
  HomeLayout: ({ variant, children }: { variant?: string; children: React.ReactNode }) => (
    <div data-testid="home-layout" data-variant={variant ?? 'home'}>
      <header data-testid="docs-bar-stub" />
      {children}
    </div>
  ),
  HomeCommandPalette: () => <div data-testid="home-palette-stub" />,
}));
vi.mock('../../../layout/HelpMenu', () => ({
  HelpMenu: (props: { inApp: boolean; appPackageId?: string }) => (
    <div data-testid="help-stub" data-in-app={String(props.inApp)} data-app-package={props.appPackageId ?? ''} />
  ),
}));

import { DocsPortalShell } from '../DocsPortalShell';
import { NavigationProvider, useNavigationContext } from '../../../context/NavigationContext';
import { SidebarDocsNav } from '../../../layout/sidebarDocsNavSlot';
import { useShellPageActionsSlot, useShellSidebarExpandSlot } from '../../../layout/shellPageActionsSlot';
import { ChromeBannerSlot } from '../../../layout/chromeBannerHost';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

/** What the navigation context says while the portal is up. */
function ContextProbe() {
  const { context, currentAppName } = useNavigationContext();
  return <div data-testid="nav-context" data-context={context} data-current-app={currentAppName ?? ''} />;
}

/** An app the person had open before the portal, as an app's layout leaves it. */
function OpenedBefore({ app }: { app: string }) {
  const { setCurrentAppName } = useNavigationContext();
  React.useEffect(() => setCurrentAppName(app), [app, setCurrentAppName]);
  return null;
}

/** A docs page as `DocShell` draws one: its tree into the sidebar, its header from the shell's slots. */
function DocsPageStandIn() {
  const renderActions = useShellPageActionsSlot();
  const renderExpand = useShellSidebarExpandSlot();
  const { setOpen } = useSidebar();
  return (
    <div data-testid="page">
      <SidebarDocsNav>
        <nav aria-label="Documentation navigation" data-testid="portal-tree">
          All documentation
        </nav>
      </SidebarDocsNav>
      {renderActions || renderExpand ? (
        <div data-testid="docs-page-header">
          {renderExpand?.()}
          {renderActions?.({})}
        </div>
      ) : null}
      <button type="button" data-testid="collapse" onClick={() => setOpen(false)}>
        collapse
      </button>
    </div>
  );
}

function PhonePageStandIn() {
  const renderActions = useShellPageActionsSlot();
  return (
    <div data-testid="page">
      <SidebarDocsNav>
        <nav data-testid="portal-tree">All documentation</nav>
      </SidebarDocsNav>
      {renderActions ? <div data-testid="docs-page-header" /> : null}
    </div>
  );
}

function mountAt(path: string, width: number, options: { openedBefore?: string; banner?: boolean } = {}) {
  setWidth(width);
  const phone = width < 768;
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavigationProvider>
        {options.openedBefore ? <OpenedBefore app={options.openedBefore} /> : null}
        {/* A standing banner, mounted above the routes as `ConsoleShell` mounts them. */}
        {options.banner ? (
          <div data-testid="shell-banner-slot">
            <ChromeBannerSlot>
              <div data-testid="impersonation-banner-stub">Impersonating</div>
            </ChromeBannerSlot>
          </div>
        ) : null}
        <ContextProbe />
        <DocsPortalShell>{phone ? <PhonePageStandIn /> : <DocsPageStandIn />}</DocsPortalShell>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

const PORTAL_PATHS = ['/docs', '/docs/crm', '/docs/crm/crm_intro'];

afterEach(() => {
  cleanup();
  rememberApp.mockClear();
  adapter.value = null;
  for (const name of ['--primary', '--accent', '--ring', '--brand-primary']) document.documentElement.style.removeProperty(name);
  document.cookie = 'sidebar_state=; path=/; max-age=0';
  window.localStorage.clear();
  setWidth(1440);
});

describe('the docs portal draws in the app-less shell from 768 px up (objectstack#37197)', () => {
  it.each(PORTAL_PATHS)('%s at 768 and 1440 px: the shell sidebar in its portal mode, the docs tree as its body, no top bar', (path) => {
    for (const width of [768, 1440]) {
      mountAt(path, width);
      expect(document.querySelectorAll('header'), `${width} px`).toHaveLength(0);
      expect(screen.queryByTestId('home-layout'), `${width} px`).toBeNull();
      const sidebar = screen.getByTestId('sidebar-stub');
      expect(sidebar, `${width} px`).toHaveAttribute('data-docs-portal', 'true');
      expect(sidebar, `${width} px`).toHaveAttribute('data-active-app', '');
      expect(sidebar, `${width} px`).toHaveAttribute('data-docs-nav', 'false');
      expect(within(sidebar).getByTestId('portal-tree'), `${width} px`).toBeInTheDocument();
      expect(within(screen.getByTestId('page')).queryByTestId('portal-tree'), `${width} px`).toBeNull();
      expect(screen.getByTestId('docs-portal-shell'), `${width} px`).toContainElement(screen.getByTestId('page'));
      cleanup();
    }
  });

  it.each(PORTAL_PATHS)('PHONE CONTROL — %s at 390 px keeps Home\'s frame with the docs bar, no sidebar', (path) => {
    mountAt(path, 390);
    expect(screen.getByTestId('home-layout')).toHaveAttribute('data-variant', 'docs');
    expect(screen.getByTestId('docs-bar-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();
    expect(screen.queryByTestId('docs-portal-shell')).toBeNull();
    // No sidebar, so the page keeps nothing in a sidebar and draws no shell header.
    expect(screen.queryByTestId('portal-tree')).toBeNull();
    expect(screen.queryByTestId('docs-page-header')).toBeNull();
  });
});

describe('the portal guesses no app (objectstack#37197)', () => {
  it('opened cold, the context is Home\'s and no current or last app is written', () => {
    for (const width of [1440, 390]) {
      mountAt('/docs/crm/crm_intro', width);
      const probe = screen.getByTestId('nav-context');
      expect(probe, `${width} px`).toHaveAttribute('data-context', 'home');
      expect(probe, `${width} px`).toHaveAttribute('data-current-app', '');
      expect(rememberApp, `${width} px`).not.toHaveBeenCalled();
      expect(Object.keys(window.localStorage).filter((key) => /last.?app/i.test(key)), `${width} px`).toEqual([]);
      cleanup();
    }
  });

  it('after an app was open, the head names none and the help menu offers no app\'s docs, even on a package-named path', () => {
    mountAt('/docs/com.acme.crm/crm_intro', 1440, { openedBefore: 'crm' });
    expect(screen.getByTestId('sidebar-stub')).toHaveAttribute('data-active-app', '');
    const help = within(screen.getByTestId('docs-page-header')).getByTestId('help-stub');
    expect(help).toHaveAttribute('data-in-app', 'false');
    expect(help).toHaveAttribute('data-app-package', '');
    // The app open before stays what it was: read, never rewritten.
    expect(screen.getByTestId('nav-context')).toHaveAttribute('data-current-app', 'crm');
    expect(rememberApp).not.toHaveBeenCalled();
  });

  it('the palette is Home\'s, scoped as on Home', () => {
    mountAt('/docs', 1440);
    expect(screen.getByTestId('home-palette-stub')).toBeInTheDocument();
  });
});

describe('the portal\'s page header carries the shell\'s group and expand button (objectstack#37197)', () => {
  it('the app-less group is drawn; collapsed, the header carries the expand button and the corner fallback stays away', () => {
    mountAt('/docs/crm/crm_intro', 1440);
    const header = screen.getByTestId('docs-page-header');
    expect(within(header).getByTestId('shell-page-actions')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-sidebar-expand')).toBeNull();
    fireEvent.click(screen.getByTestId('collapse'));
    expect(header).toContainElement(screen.getByTestId('shell-sidebar-expand'));
    expect(screen.queryByTestId('shell-sidebar-expand-fallback')).toBeNull();
    expect(screen.getAllByTestId('shell-sidebar-expand')).toHaveLength(1);
  });

  it('PHONE CONTROL — no group and no expand button on a phone (its bar carries them)', () => {
    mountAt('/docs/crm/crm_intro', 390);
    expect(screen.queryByTestId('shell-page-actions')).toBeNull();
    expect(screen.queryByTestId('shell-sidebar-expand')).toBeNull();
  });
});

describe('the portal takes no app\'s brand: the default accent (objectstack#37197, design point 5)', () => {
  /** The accent variables an app's brand sets on the document root (`AppShell`'s branding). */
  const brand = () => ({
    primary: document.documentElement.style.getPropertyValue('--primary'),
    accent: document.documentElement.style.getPropertyValue('--accent'),
  });

  it('after an app with a brand was open, the portal draws the default accent: no --primary, no --accent on the root', () => {
    // What an app's shell leaves on the root while its page is up.
    document.documentElement.style.setProperty('--primary', '347 77% 50%');
    document.documentElement.style.setProperty('--accent', '38 92% 50%');
    mountAt('/docs/crm/crm_intro', 1440, { openedBefore: 'crm' });
    expect(screen.getByTestId('docs-portal-shell')).toBeInTheDocument();
    expect(brand()).toEqual({ primary: '', accent: '' });
  });

  it('PHONE CONTROL — Home\'s docs frame sets no brand either', () => {
    mountAt('/docs/crm/crm_intro', 390, { openedBefore: 'crm' });
    expect(screen.getByTestId('home-layout')).toHaveAttribute('data-variant', 'docs');
    expect(brand()).toEqual({ primary: '', accent: '' });
  });
});

describe('the portal\'s standing banners and connection notice sit at the top of its content (objectstack#37197)', () => {
  it('at 1440 px a standing banner is drawn once, in the box at the top of the content, not above the shell', () => {
    mountAt('/docs/crm/crm_intro', 1440, { banner: true });
    const banners = screen.getAllByTestId('impersonation-banner-stub');
    expect(banners).toHaveLength(1);
    const box = screen.getByTestId('docs-portal-banners');
    expect(box).toContainElement(banners[0]);
    expect(screen.getByTestId('shell-banner-slot')).not.toContainElement(banners[0]);
    // The box comes before the page, at the top of the content area.
    expect(box.compareDocumentPosition(screen.getByTestId('page')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a lost connection is a notice in that box; a live one draws nothing', () => {
    adapter.value = { getConnectionState: () => 'disconnected', onConnectionStateChange: () => () => {} };
    mountAt('/docs/crm/crm_intro', 1440);
    const notice = screen.getByTestId('console-connection-banner');
    expect(screen.getByTestId('docs-portal-banners')).toContainElement(notice);
    expect(notice).toHaveTextContent(/disconnected/i);
    cleanup();
    adapter.value = { getConnectionState: () => 'connected', onConnectionStateChange: () => () => {} };
    mountAt('/docs/crm/crm_intro', 1440);
    expect(screen.queryByTestId('console-connection-banner')).toBeNull();
  });

  it('PHONE CONTROL — on a phone the banner stays where the shell mounts it, drawn once, and no notice box is mounted', () => {
    adapter.value = { getConnectionState: () => 'disconnected', onConnectionStateChange: () => () => {} };
    mountAt('/docs/crm/crm_intro', 390, { banner: true });
    const banners = screen.getAllByTestId('impersonation-banner-stub');
    expect(banners).toHaveLength(1);
    expect(screen.getByTestId('shell-banner-slot')).toContainElement(banners[0]);
    expect(screen.queryByTestId('docs-portal-banners')).toBeNull();
    expect(screen.queryByTestId('console-connection-banner')).toBeNull();
  });
});
