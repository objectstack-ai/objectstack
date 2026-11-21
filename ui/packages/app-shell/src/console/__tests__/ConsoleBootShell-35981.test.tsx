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
import { MemoryRouter } from 'react-router-dom';

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

  it('draws no app, no navigation entry and nothing to press', () => {
    at(RECORD, <ConsoleBootShell />);
    const frame = shell()!;
    // The app list decides which app this is, the permission answer and the
    // admin verdict which entries exist: the frame shows none of it.
    expect(frame.textContent?.trim()).toBe('');
    expect(frame.querySelectorAll('a, button, input, [role="menuitem"], [role="link"]')).toHaveLength(0);
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
