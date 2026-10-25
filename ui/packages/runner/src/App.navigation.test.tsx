/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * In-app navigation must carry the URL's query string with it (objectui#3578).
 *
 * The Runner keeps two families of settings in the query string, and both are
 * addressable state under ADR-0054 C3 (shared, and expected back after a
 * reload):
 *
 * - `?api=<base>` — the metadata API base, read once at mount by `App.tsx`'s
 *   loader `useMemo`.
 * - `?__debug`, `?__debug_schema`, … — `@object-ui/core`'s debug flags, read
 *   from `window.location.search` by `parseDebugFlags` / `useDebugMode` in the
 *   tree the Runner renders.
 *
 * `handleNavigate` used to `pushState` a bare path, which dropped every one of
 * them from the address bar on the first sidebar click. The already-memoised
 * loader kept serving that session, so the loss was invisible until F5 (or a
 * colleague opening the copied URL) fell back to the empty `LocalBundleLoader`
 * and rendered `Page not found`.
 *
 * These assertions drive the real component so they are meaningful against the
 * unmodified source — see the PR body for the recorded red run.
 *
 * The metadata loader is stubbed because `src/app-data/` is git-ignored and
 * absent from a fresh checkout: `loadAppConfig` returns an app document with a
 * sidebar menu (the reported repro path), and `loadPage` returns `null` so the
 * main area falls to the built-in 404 block instead of the ComponentRegistry
 * (which would make this a `dom-heavy` test for no added coverage).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';

vi.mock('./lib/MetadataLoader', () => {
  const APP_CONFIG = {
    name: 'runner_demo_app',
    title: 'Runner Demo',
    layout: 'sidebar',
    menu: [
      { label: 'Customers', path: '/customers' },
      // A nav target that declares its own query. No metadata in this repo
      // spells one today, but plain concatenation would turn it into the
      // malformed `/orders?tab=open?api=…`, so the merge branch is pinned.
      { label: 'Open orders', path: '/orders?tab=open' },
    ],
  };
  class StubLoader {
    async loadAppConfig() {
      return APP_CONFIG;
    }
    async loadPage() {
      return null;
    }
  }
  return { LocalBundleLoader: StubLoader, NetworkLoader: StubLoader };
});

// Static, module-scope import: `App.tsx` pulls in `@object-ui/components` and
// the two plugin packages for their registration side effects, and that cost
// must not land inside a test's timeout budget (AGENTS.md §测试纪律).
import RunnerApp from './App';

const API_BASE = 'https://backend.example.com/api';

/** Click a sidebar entry and return the URL string handed to `pushState`. */
async function navigateVia(label: string): Promise<string> {
  const pushState = vi.spyOn(window.history, 'pushState');
  try {
    const link = await screen.findByRole('link', { name: label });
    // `act` around the click so the page reload the navigation kicks off
    // settles inside it, instead of updating state after the test returns.
    await act(async () => {
      fireEvent.click(link);
    });
    expect(pushState).toHaveBeenCalledTimes(1);
    return String(pushState.mock.calls[0][2]);
  } finally {
    pushState.mockRestore();
  }
}

describe('RunnerApp in-app navigation', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('carries `?api=` across a sidebar navigation so reload and share still work', async () => {
    window.history.replaceState({}, '', `/?api=${API_BASE}`);

    render(<RunnerApp />);
    const pushed = await navigateVia('Customers');

    expect(pushed).toBe(`/customers?api=${API_BASE}`);
    expect(window.location.pathname).toBe('/customers');
    // What a reload would read back.
    expect(new URLSearchParams(window.location.search).get('api')).toBe(API_BASE);
  });

  it('carries the WHOLE query string, not just `api`', async () => {
    // `__debug_schema` is `@object-ui/core`'s debug flag (parseDebugFlags), the
    // Runner's second query-string consumer.
    window.history.replaceState({}, '', `/?api=${API_BASE}&__debug_schema=&lang=de`);

    render(<RunnerApp />);
    const pushed = await navigateVia('Customers');

    expect(pushed).toBe(`/customers?api=${API_BASE}&__debug_schema=&lang=de`);
  });

  it('appends no stray `?` when the URL has no query string', async () => {
    window.history.replaceState({}, '', '/');

    render(<RunnerApp />);
    const pushed = await navigateVia('Customers');

    expect(pushed).toBe('/customers');
    expect(pushed).not.toContain('?');
    expect(window.location.search).toBe('');
  });

  it('merges into a target that declares its own query instead of concatenating', async () => {
    window.history.replaceState({}, '', `/?api=${API_BASE}`);

    render(<RunnerApp />);
    const pushed = await navigateVia('Open orders');

    // The target's own `tab` is kept and the preserved `api` is merged in
    // behind it. This branch rebuilds the query through `URLSearchParams`, so
    // the value comes out canonically percent-encoded rather than verbatim —
    // a different spelling of the same parameter, not a different parameter.
    expect(pushed).toBe('/orders?tab=open&api=https%3A%2F%2Fbackend.example.com%2Fapi');
    expect(new URLSearchParams(window.location.search).get('api')).toBe(API_BASE);
    // Never the malformed shape a bare `to + location.search` would produce.
    expect(pushed.match(/\?/g)).toHaveLength(1);
  });
});
