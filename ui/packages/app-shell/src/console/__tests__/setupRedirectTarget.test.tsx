// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `SetupRedirect` — the stable `/setup` deep link into platform administration
 * (objectui#2794).
 *
 * ## The defect
 *
 * System settings had no direct URL. `/_console/setup` bounced the visitor back
 * to `/_console/home`, so the entry point could only be reached by clicking the
 * home launcher's 「系统设置」 card: nothing to bookmark, nothing to paste into a
 * runbook, and asymmetric with Studio, which does have a stable front door.
 *
 * ## What the target is, and why it is not spelled out
 *
 * The card recorded the address it landed on as
 * `/apps/com.objectstack.setup/dashboard/system_overview`. Only the FIRST
 * segment pair of that is a fact about Setup; the rest is a fact about Setup's
 * navigation on the day it was measured. `resolveSetupAppPath` therefore
 * resolves the app ROOT — `/apps/<segment>` — and lets `AppContent`'s existing
 * landing resolution (first reachable navigation item) pick the page, which is
 * how every other app root already opens and how the home launcher's card
 * already navigates. Re-spelling `dashboard/system_overview` here would fork
 * that policy and start drifting the next time Setup's nav is re-ordered.
 *
 * The segment itself comes from `appRouteSegment()` — package id under ADR-0048,
 * app name as the per-tenant fallback — so this alias and `home/AppCard.tsx`
 * cannot disagree about where Setup lives.
 *
 * ## The absent-app case is the interesting one
 *
 * "Setup is missing from metadata" is reachable in normal operation, not just on
 * a stripped build: `SETUP_APP.requiredPermissions = ['setup.access']`, so a
 * viewer without it is served metadata with no Setup app at all. Falling back to
 * `/home` there would re-create the exact defect this component fixes, and
 * falling back to the bare `/apps/setup` would be worse than it looks — that URL
 * is `AppContent`'s `isSetupRoute` pseudo-route, which resolves to the DEFAULT
 * app, i.e. it would silently render some other app. The fallback is the
 * canonical package-id URL, which matches no pseudo-route and therefore lands in
 * `AppContent`'s own `requestedAppMissing` branch — the same "App not available"
 * screen any other missing app produces.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

/** Swapped per test — the App metadata the shell has loaded. */
let apps: unknown[] = [];
let loading = false;

vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps, objects: [], loading, error: null, refresh: async () => {} }),
}));

import {
  SetupRedirect,
  resolveSetupAppPath,
  SETUP_APP_PACKAGE_ID,
  SETUP_APP_NAME,
} from '../ConsoleShell';

/** The Setup app as a stock deployment ships it (ADR-0048 one-app package). */
const SETUP_APP = { name: SETUP_APP_NAME, label: 'Setup', _packageId: SETUP_APP_PACKAGE_ID };

/** Reports where the redirect actually landed, including search and hash. */
function Landing() {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="landing">{`${pathname}${search}${hash}`}</div>;
}

function landedFrom(entry: string): string {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/setup" element={<SetupRedirect />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId('landing').textContent ?? '';
}

describe('resolveSetupAppPath — the policy, without a router', () => {
  it('THE FIX: a stock deployment resolves the Setup app root, never /home', () => {
    const target = resolveSetupAppPath([{ name: 'crm' }, SETUP_APP, { name: 'showcase' }]);
    expect(target).toBe('/apps/com.objectstack.setup');
    expect(target).not.toBe('/home');
  });

  it('keys the segment on the package id — the same address AppCard builds', () => {
    // Two vendors' apps may share a display name; ADR-0048 makes the package id
    // the route key, and `appRouteSegment()` is the one place that decides it.
    expect(resolveSetupAppPath([SETUP_APP])).toBe(`/apps/${SETUP_APP_PACKAGE_ID}`);
  });

  it('falls back to the app NAME for a Setup app with no owning package', () => {
    // Runtime/DB-authored apps carry no `_packageId`; `matchAppBySegment` treats
    // the name as a friendly alias, so the alias must too.
    expect(resolveSetupAppPath([{ name: SETUP_APP_NAME, label: 'Setup' }])).toBe('/apps/setup');
  });

  it('prefers the package-id match over a same-named impostor', () => {
    const impostor = { name: SETUP_APP_NAME, _packageId: 'com.acme.setup' };
    expect(resolveSetupAppPath([impostor, SETUP_APP])).toBe(`/apps/${SETUP_APP_PACKAGE_ID}`);
  });

  it('ABSENT SETUP APP: falls back to the canonical package-id URL — not /home', () => {
    // Reachable without a broken build: a viewer lacking `setup.access` is
    // served metadata with no Setup app.
    for (const list of [[], [{ name: 'crm' }], null, undefined]) {
      const target = resolveSetupAppPath(list as never);
      expect(target).toBe(`/apps/${SETUP_APP_PACKAGE_ID}`);
      expect(target).not.toBe('/home');
    }
  });

  it('ABSENT SETUP APP: the fallback is NOT the bare /apps/setup pseudo-route', () => {
    // `/apps/setup` is `AppContent`'s `isSetupRoute`, which falls back to the
    // DEFAULT app — a silently wrong app instead of an honest "not available".
    expect(resolveSetupAppPath([{ name: 'crm', isDefault: true }])).not.toBe('/apps/setup');
  });
});

describe('SetupRedirect — the routed component', () => {
  beforeEach(() => {
    apps = [];
    loading = false;
  });

  it('THE FIX: /setup lands on the Setup app, not back on home', () => {
    apps = [{ name: 'crm' }, SETUP_APP];
    expect(landedFrom('/setup')).toBe('/apps/com.objectstack.setup');
  });

  it('holds the redirect while metadata is still loading', () => {
    // Deciding off an empty-because-unloaded app list would send a legitimate
    // deep link to the "App not available" screen on every cold load.
    loading = true;
    apps = [];
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <Routes>
          <Route path="/setup" element={<SetupRedirect />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('landing')).not.toBeInTheDocument();
  });

  it('preserves search and hash across the hop, like SystemRedirect beside it', () => {
    apps = [SETUP_APP];
    expect(landedFrom('/setup?tab=general#audit')).toBe(
      '/apps/com.objectstack.setup?tab=general#audit',
    );
  });
});
