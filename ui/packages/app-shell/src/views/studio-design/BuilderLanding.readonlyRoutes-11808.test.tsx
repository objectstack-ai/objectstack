// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11808 — a read-only package's Studio landing card points at the
 * routes that exist for it, and Duplicate stays on writable bases.
 *
 * ADR-0070 D4's Duplicate clones a writable base; a code or installed package
 * is customized by org overlay where the item's metadata type declares
 * `allowEnvironmentOverlay` (ADR-0005). Measured before this card: the read-only card
 * was one button that opened the package for browsing, with no route forward.
 *
 * The routes are read off the real `BuilderLanding` under a real router: the
 * overlay link lands on the package's metadata directory, and the marketplace
 * link appears only when the runtime serves a marketplace — read through the
 * REAL `initRuntimeConfig()` over a stubbed `GET /api/v1/runtime/config`, the
 * way `HomePage.marketplaceDisabled.test.tsx` drives the same flag.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { t } from '../metadata-admin/i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';

const READ_ONLY = { id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' };
const WRITABLE = { id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' };

afterEach(() => {
  cleanup();
  packages.list = [];
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

/** Boot the REAL runtime-config module over a served `/runtime/config` body. */
async function bootRuntime(features: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = { features: { installLocal: false, ...features } };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
    }),
  );
  await initRuntimeConfig();
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
        <Route path="/apps/setup/metadata" element={<div data-testid="metadata-directory" />} />
        <Route path="/apps/setup/system/marketplace" element={<div data-testid="marketplace" />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The card a package renders in: the element holding both its name and its links. */
function cardOf(name: string): HTMLElement {
  const card = screen.getByText(name).closest('.rounded-lg.border');
  if (!(card instanceof HTMLElement)) throw new Error(`no card found for ${name}`);
  return card;
}

describe('Studio landing: a read-only package points at the routes it has (objectui#11808)', () => {
  it('links the read-only card to the package’s metadata directory, the org-overlay route', async () => {
    await bootRuntime({ marketplace: true });
    packages.list = [READ_ONLY];
    renderLanding();

    await screen.findByText('Showcase');
    expect(screen.getByTestId('studio-landing-readonly-hint')).toBeInTheDocument();
    const overlay = within(cardOf('Showcase')).getByTestId('studio-landing-overlay');
    expect(overlay).toHaveAttribute('href', '/apps/setup/metadata?package=com.example.showcase');
    expect(overlay).toHaveAccessibleName(t('engine.studio.landing.overlay', 'en-US'));

    fireEvent.click(overlay);
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/apps/setup/metadata?package=com.example.showcase'),
    );
    expect(screen.getByTestId('metadata-directory')).toBeInTheDocument();
  });

  it('still opens the read-only package for browsing from the card itself', async () => {
    await bootRuntime({ marketplace: true });
    packages.list = [READ_ONLY];
    renderLanding();

    fireEvent.click(await screen.findByText('Showcase'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/com.example.showcase/data'));
  });

  it('offers Duplicate on a writable base only, never on a read-only package (ADR-0070 D4)', async () => {
    await bootRuntime({ marketplace: true });
    packages.list = [WRITABLE, READ_ONLY];
    renderLanding();

    await screen.findByText('Showcase');
    const dupTitle = t('engine.studio.landing.dupTitle', 'en-US');
    expect(within(cardOf('Acme')).getByTitle(dupTitle)).toBeInTheDocument();
    expect(within(cardOf('Showcase')).queryByTitle(dupTitle)).not.toBeInTheDocument();
    // The overlay route is the read-only card's, not the writable base's.
    expect(within(cardOf('Acme')).queryByTestId('studio-landing-overlay')).not.toBeInTheDocument();
  });

  it('links the marketplace when the runtime serves one', async () => {
    await bootRuntime({ marketplace: true });
    packages.list = [READ_ONLY];
    renderLanding();

    const marketplace = await screen.findByTestId('studio-landing-marketplace');
    expect(marketplace).toHaveAttribute('href', '/apps/setup/system/marketplace');
    fireEvent.click(marketplace);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/apps/setup/system/marketplace'));
    expect(screen.getByTestId('marketplace')).toBeInTheDocument();
  });

  it('offers no marketplace link on a runtime without one, and keeps the overlay route', async () => {
    await bootRuntime({ marketplace: false });
    packages.list = [READ_ONLY];
    renderLanding();

    await screen.findByText('Showcase');
    expect(screen.queryByTestId('studio-landing-marketplace')).not.toBeInTheDocument();
    expect(within(cardOf('Showcase')).getByTestId('studio-landing-overlay')).toBeInTheDocument();
  });

  it('renders no read-only section at all when every package is writable', async () => {
    await bootRuntime({ marketplace: true });
    packages.list = [WRITABLE];
    renderLanding();

    await screen.findByText('Acme');
    expect(screen.queryByTestId('studio-landing-readonly-hint')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-landing-marketplace')).not.toBeInTheDocument();
    expect(screen.queryByTestId('studio-landing-overlay')).not.toBeInTheDocument();
  });
});
