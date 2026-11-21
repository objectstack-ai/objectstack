// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35981 — the console's boot fallback draws the chrome's empty
 * frame on an app route once the session has answered with a user, and the
 * splash everywhere else.
 *
 * The frame is what a full-page open of an app route shows while the gates
 * after the session read are out (the adapter, the organization list, the
 * permission answer, the app list and the admin verdict). What those gates
 * exist for is pinned here as what the frame does NOT draw: no app name, no
 * navigation entry, nothing to press. It also stays the boot wait
 * (`data-boot-splash`), so what waits for the first paint past the splash
 * still waits.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  isLoading: false,
  user: { id: 'u_35981', name: 'Ada Admin' } as { id: string; name: string } | null,
}));
vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/auth')>();
  return { ...actual, useAuth: () => authState };
});

import { ConsoleBootFallback, ConsoleBootShell } from '../ConsoleBootShell';
import { LoadingFallback } from '../ConsoleShell';
import { RedirectWithSplash } from '../../chrome/RedirectWithSplash';

const RECORD = '/apps/crm/account/record/acc_1';

afterEach(() => {
  cleanup();
  authState.isLoading = false;
  authState.user = { id: 'u_35981', name: 'Ada Admin' };
});

function at(path: string, element: React.ReactNode) {
  return render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
}

const shell = () => document.querySelector('[data-boot-shell]');
const splashMarker = () => document.querySelector('[data-boot-splash]');

describe('the console boot fallback (objectstack#35981)', () => {
  it('draws the chrome frame on an app route once the session has a user', () => {
    at(RECORD, <ConsoleBootFallback />);
    expect(shell()).not.toBeNull();
    // Still the boot wait: readiness waits and first-paint-deferred reads key on it.
    expect(shell()).toHaveAttribute('data-boot-splash');
    // The top bar and the route slot, the slot shaped like a record page.
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('[data-testid="route-metadata-skeleton"]')).not.toBeNull();
  });

  it('is what the shared LoadingFallback draws', () => {
    at(RECORD, <LoadingFallback />);
    expect(shell()).not.toBeNull();
  });

  it('is what a boot redirect paints during its hand-off, so the hand-off changes no pixels', () => {
    // The redirect fires from inside a gate that was drawing the frame
    // (`RequireOrganization` -> `/organizations`, `AppContent` -> home): it
    // paints the same frame until the destination renders.
    render(
      <MemoryRouter initialEntries={[RECORD]}>
        <Routes>
          <Route path="/apps/*" element={<RedirectWithSplash to="/organizations" replace />} />
          <Route path="/organizations" element={<div data-testid="organizations" />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-testid="organizations"]')).not.toBeNull();
    cleanup();
    // Measured at its first commit, before its navigation runs.
    let frameAtCommit: Element | null = null;
    function Probe() {
      React.useLayoutEffect(() => {
        frameAtCommit = shell();
      });
      return null;
    }
    render(
      <MemoryRouter initialEntries={[RECORD]}>
        <RedirectWithSplash to="/organizations" replace />
        <Probe />
      </MemoryRouter>,
    );
    expect(frameAtCommit).not.toBeNull();
  });

  it('draws no app, no navigation entry and nothing to press', () => {
    at(RECORD, <ConsoleBootShell />);
    const frame = shell()!;
    // The app list decides which app this is, the permission answer and the
    // admin verdict which entries exist: the frame shows none of it.
    expect(frame.textContent?.trim()).toBe('');
    expect(frame.querySelectorAll('a, button, input, [role="menuitem"], [role="link"]')).toHaveLength(0);
  });

  it('draws the shape the chrome will have: no app menu on a docs page, no app bar on a phone record page', () => {
    // The frame reads the same predicates as `ConsoleLayout`, so nothing it
    // draws is taken away when the chrome lands (objectstack#35424, #28483).
    const width = window.innerWidth;
    const setWidth = (w: number) =>
      Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
    const sidebar = () => shell()!.querySelector('[data-sidebar="sidebar"]');
    const header = () => shell()!.querySelector('header');
    try {
      setWidth(1440);
      at('/apps/crm/docs/manual/intro', <ConsoleBootShell />);
      expect(sidebar()).toBeNull();
      expect(header()).not.toBeNull();
      cleanup();

      setWidth(390);
      at(RECORD, <ConsoleBootShell />);
      expect(header()).toBeNull();
      cleanup();

      // Control: the app menu and the app bar wherever the chrome draws them.
      at('/apps/crm/account', <ConsoleBootShell />);
      expect(header()).not.toBeNull();
      cleanup();
      setWidth(1440);
      for (const path of [RECORD, '/apps/crm/account', '/apps/crm/docsearch']) {
        at(path, <ConsoleBootShell />);
        expect(sidebar(), path).not.toBeNull();
        expect(header(), path).not.toBeNull();
        cleanup();
      }
    } finally {
      setWidth(width);
    }
  });

  it('keeps the splash while the session read is out, off an app route, and with no user', () => {
    authState.isLoading = true;
    at(RECORD, <ConsoleBootFallback />);
    expect(shell()).toBeNull();
    expect(splashMarker()).not.toBeNull();
    cleanup();

    authState.isLoading = false;
    authState.user = null;
    at(RECORD, <ConsoleBootFallback />);
    expect(shell()).toBeNull();
    expect(splashMarker()).not.toBeNull();
    cleanup();

    authState.user = { id: 'u_35981', name: 'Ada Admin' };
    for (const path of ['/home', '/login', '/forms/intake', '/apps']) {
      at(path, <ConsoleBootFallback />);
      expect(shell(), path).toBeNull();
      expect(splashMarker(), path).not.toBeNull();
      cleanup();
    }
  });

  it('keeps the splash outside a router (a host that mounts the shell bare)', () => {
    render(<ConsoleBootFallback />);
    expect(shell()).toBeNull();
    expect(splashMarker()).not.toBeNull();
  });
});
