import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { RequireAiSurface } from '../ConsoleShell';
import { useAiSurfaceEnabled } from '../../hooks/useAiSurface';

// The guard gates purely on the AI-surface signal (the agent catalog); that
// hook's own plumbing is covered by useAiSurface.test.ts.
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: vi.fn(() => ({ enabled: true, isLoading: false })),
}));
const mockSurface = vi.mocked(useAiSurfaceEnabled);

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
    mockSurface.mockReturnValue({ enabled: true, isLoading: false });
  });

  it('renders the AI surface when the server serves agents (cloud install)', () => {
    renderGuardedAi();
    expect(screen.getByText('AI CHAT')).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('redirects to home when no agents are served (Community Edition) — no dead-end chat', () => {
    mockSurface.mockReturnValue({ enabled: false, isLoading: false });
    renderGuardedAi();
    expect(screen.queryByText('AI CHAT')).not.toBeInTheDocument();
    expect(screen.getByText('HOME')).toBeInTheDocument();
  });

  it('waits (neither chat nor redirect) while the agent catalog is still resolving', () => {
    mockSurface.mockReturnValue({ enabled: false, isLoading: true });
    renderGuardedAi();
    expect(screen.queryByText('AI CHAT')).not.toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('bounces to the DECLARED landing, not the launcher, where one is declared (objectui#7373)', () => {
    // The card's case, on this guard: a stale `/ai` bookmark opened against a
    // control plane that serves no agent. Pre-#7373 the default was the `/home`
    // literal, so the customer landed among environment cards that cannot act
    // on anything their deployment has. This pin fails on that implementation.
    mockSurface.mockReturnValue({ enabled: false, isLoading: false });
    renderGuardedAi([
      { name: 'cloud_control', label: 'Cloud', isDefault: true },
      { name: 'account', label: 'Account' },
    ]);
    expect(screen.getByText('DECLARED LANDING')).toBeInTheDocument();
    expect(screen.queryByText('HOME')).not.toBeInTheDocument();
  });

  it('keeps the launcher for an ordinary environment that declares nothing', () => {
    // The status quo, stated as its own case so the two answers cannot be
    // confused for one: an app list WITHOUT a declaration still resolves to the
    // launcher, and so does a guard mounted outside a metadata provider (every
    // other case in this file).
    mockSurface.mockReturnValue({ enabled: false, isLoading: false });
    renderGuardedAi([{ name: 'crm', label: 'CRM' }, { name: 'setup', label: 'Setup' }]);
    expect(screen.getByText('HOME')).toBeInTheDocument();
    expect(screen.queryByText('DECLARED LANDING')).not.toBeInTheDocument();
  });
});
