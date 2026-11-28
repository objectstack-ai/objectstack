import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { RequireAiSurface } from '../ConsoleShell';
import { AiUnavailable } from '../ai/AiUnavailable';
import { useAiSurfaceEnabled } from '../../hooks/useAiSurface';

// The guard gates purely on the AI-surface signal (the agent catalog); that
// hook's own plumbing is covered by useAiSurface.test.ts.
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: vi.fn(() => ({ enabled: true, isLoading: false, buildServed: true })),
}));
const mockSurface = vi.mocked(useAiSurfaceEnabled);

/**
 * Who is looking, and whether this runtime offers authoring: the three terms
 * the no-assistant screen offers Studio's new-package flow on.
 */
const viewer = vi.hoisted(() => ({ isAdmin: true, canAuthorMetadata: true, aiStudio: true, phone: false }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => viewer.canAuthorMetadata,
}));
// objectstack#36732 — the width decides the Home target: a phone goes to the
// declared landing directly; a desktop, here outside the `/me/apps` provider,
// names `/home`, whose desktop route resolves the same landing.
vi.mock('../../hooks/usePhoneViewport', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  usePhoneViewport: () => viewer.phone,
}));
vi.mock('../../runtime-config', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isAiStudioEnabled: () => viewer.aiStudio,
}));
// `t` echoes the key, so a hardcoded string fails here.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (key: string) => `«${key}»`, language: 'en' }),
}));

/**
 * The app list this guard's home target is resolved from (objectui#7373).
 * `undefined` renders the guard with no metadata context at all — the shape
 * every case here had before that card, and the one a host that mounts the
 * guard outside `MetadataProvider` still gets.
 */
function withMetadata(
  apps: MetadataContextValue['apps'] | undefined,
  children: React.ReactNode,
) {
  if (!apps) return <>{children}</>;
  const value: MetadataContextValue = {
    apps,
    objects: [], dashboards: [], reports: [], pages: [],
    loading: false, error: null,
    refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
    getItem: async () => null, getItemsByType: () => [], getTypeStatus: () => 'ready',
  };
  return <MetadataCtx.Provider value={value}>{children}</MetadataCtx.Provider>;
}

function renderGuardedAi(apps?: MetadataContextValue['apps']) {
  return render(
    <MemoryRouter initialEntries={['/ai']}>
      {withMetadata(
        apps,
        <Routes>
          <Route
            path="/ai"
            element={
              <RequireAiSurface>
                <div>AI CHAT</div>
              </RequireAiSurface>
            }
          />
          <Route path="/home" element={<div>HOME</div>} />
          <Route path="/apps/cloud_control" element={<div>DECLARED LANDING</div>} />
        </Routes>,
      )}
    </MemoryRouter>,
  );
}

describe('RequireAiSurface', () => {
  beforeEach(() => {
    mockSurface.mockReturnValue({ enabled: true, isLoading: false, buildServed: true });
    viewer.isAdmin = true;
    viewer.canAuthorMetadata = true;
    viewer.aiStudio = true;
    viewer.phone = false;
  });

  it('renders the AI surface when the server serves agents (cloud install)', () => {
    renderGuardedAi();
    expect(screen.getByText('AI CHAT')).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('says in place that no assistant is enabled when no agents are served (objectstack#26614)', () => {
    // Community Edition. It used to redirect home, which read like a broken
    // link; now the URL stays and the screen says why, with the way home.
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    renderGuardedAi();
    expect(screen.queryByText('AI CHAT')).not.toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
    const page = screen.getByTestId('ai-unavailable');
    expect(page).toHaveTextContent('«console.ai.unavailableDescription»');
    // objectstack#37163 — on a desktop the way home names the app start page
    // it opens, in the app pill's words (phone: the describe at the end).
    expect(screen.getByTestId('ai-unavailable-home')).toHaveTextContent('«layout.appSwitcher.backToHome»');
    // Nothing failed, so nothing is offered again.
    expect(screen.queryByTestId('ai-unavailable-retry')).toBeNull();
  });

  it('offers Studio\'s new-package flow to a session that may author (objectstack#26614)', () => {
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    renderGuardedAi();
    const studio = screen.getByTestId('ai-unavailable-studio');
    expect(studio).toHaveTextContent('«home.build.inStudio»');
    expect(studio).toHaveAttribute('href', '/apps/setup/component/developer/packages?face=admin&new=package');
  });

  it.each([
    ['a non-admin', () => { viewer.isAdmin = false; }],
    ['a session without the authoring capability', () => { viewer.canAuthorMetadata = false; }],
    ['a runtime that offers no authoring', () => { viewer.aiStudio = false; }],
  ])('offers no Studio link to %s (objectstack#26614)', (_who, arrange) => {
    arrange();
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    renderGuardedAi();
    expect(screen.getByTestId('ai-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-unavailable-studio')).toBeNull();
  });

  it('waits (neither chat nor the no-assistant screen) while the agent catalog is still resolving', () => {
    mockSurface.mockReturnValue({ enabled: false, isLoading: true, buildServed: false });
    renderGuardedAi();
    expect(screen.queryByText('AI CHAT')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('leads home to the DECLARED landing, not the launcher, where one is declared (objectui#7373)', async () => {
    // The card's case, on this guard: a stale `/ai` bookmark opened against a
    // control plane that serves no agent. Pre-#7373 the default was the `/home`
    // literal, so the customer landed among environment cards that cannot act
    // on anything their deployment has. This pin fails on that implementation.
    // On a phone, which still has its own Home page (#36732).
    viewer.phone = true;
    const user = userEvent.setup();
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    renderGuardedAi([
      { name: 'cloud_control', label: 'Cloud', isDefault: true },
      { name: 'account', label: 'Account' },
    ]);
    await user.click(screen.getByTestId('ai-unavailable-home'));
    expect(screen.getByText('DECLARED LANDING')).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('on a desktop, outside the /me/apps provider, leads to /home — the route that resolves the declared landing (objectstack#36732)', async () => {
    // `/ai/*` is not under `LauncherAppsProvider`, so the guard cannot tell
    // whether a permission set hides the declared app. It names `/home`, which
    // on a desktop is no longer the launcher page but the resolver that lands
    // in the declared app once it knows.
    const user = userEvent.setup();
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    renderGuardedAi([
      { name: 'cloud_control', label: 'Cloud', isDefault: true },
      { name: 'account', label: 'Account' },
    ]);
    await user.click(screen.getByTestId('ai-unavailable-home'));
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('keeps the launcher for an ordinary environment that declares nothing', async () => {
    // The status quo, stated as its own case so the two answers cannot be
    // confused for one: an app list WITHOUT a declaration resolves to the
    // launcher. `/ai/*` sits outside the `/me/apps` provider, so on a desktop
    // Home names `/home`, the route that resolves the last-used / first app
    // once it knows which apps a permission set hides (#36732); a guard mounted
    // outside a metadata provider resolves there too (every other case here).
    const user = userEvent.setup();
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    renderGuardedAi([{ name: 'crm', label: 'CRM' }, { name: 'setup', label: 'Setup' }]);
    await user.click(screen.getByTestId('ai-unavailable-home'));
    expect(screen.getByText('HOME')).toBeInTheDocument();
    expect(screen.queryByText('DECLARED LANDING')).not.toBeInTheDocument();
  });
});

describe('the no-assistant screen\'s way home names where it goes, by viewport (objectstack#37163)', () => {
  beforeEach(() => {
    mockSurface.mockReturnValue({ enabled: false, isLoading: false, buildServed: false });
    viewer.phone = false;
  });

  it('on a desktop, where Home is an app\'s start page, it reads as the app pill\'s row does', () => {
    renderGuardedAi([{ name: 'crm', label: 'CRM' }]);
    const home = screen.getByTestId('ai-unavailable-home');
    expect(home).toHaveTextContent('«layout.appSwitcher.backToHome»');
    expect(home).not.toHaveTextContent('«console.ai.unavailableHome»');
  });

  it('CONTROL — on a phone, whose Home is still its app list, it keeps 「Back to home」', () => {
    viewer.phone = true;
    renderGuardedAi([{ name: 'crm', label: 'CRM' }]);
    const home = screen.getByTestId('ai-unavailable-home');
    expect(home).toHaveTextContent('«console.ai.unavailableHome»');
    expect(home).not.toHaveTextContent('«layout.appSwitcher.backToHome»');
  });
});

describe('the unreachable-service sentence names where its way home goes, by viewport', () => {
  // `AiChatPage` draws this shape when the agent catalog fails to load: the
  // sentence points at the button below it, so it names the same place.
  const echo = (key: string) => `«${key}»`;
  function renderUnreachable() {
    return render(
      <MemoryRouter>
        <AiUnavailable hasError onRetry={() => {}} onHome={() => {}} t={echo} />
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    viewer.phone = false;
  });

  it('on a desktop, where the button opens an app\'s start page, the sentence says so', () => {
    renderUnreachable();
    const screenEl = screen.getByTestId('ai-unavailable');
    expect(screenEl).toHaveTextContent('«console.ai.unavailableErrorDesktop»');
    expect(screenEl).not.toHaveTextContent('«console.ai.unavailableError»');
    expect(screen.getByTestId('ai-unavailable-home')).toHaveTextContent('«layout.appSwitcher.backToHome»');
  });

  it('CONTROL — on a phone, whose Home is still its app list, it keeps 「head back home」', () => {
    viewer.phone = true;
    renderUnreachable();
    const screenEl = screen.getByTestId('ai-unavailable');
    expect(screenEl).toHaveTextContent('«console.ai.unavailableError»');
    expect(screenEl).not.toHaveTextContent('«console.ai.unavailableErrorDesktop»');
    expect(screen.getByTestId('ai-unavailable-home')).toHaveTextContent('«console.ai.unavailableHome»');
  });
});
