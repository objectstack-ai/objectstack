// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12513 gave the installed card's link into Setup an "Open in Setup"
 * label and an outward arrow, so it said that it left Studio. objectstack
 * ADR-0146 D1 (N-28) retired the page it opened: Setup's metadata directory
 * redirects into Studio's "All metadata" area, so the link would have left
 * Studio only to come straight back. The card now carries no Setup exit, and
 * the Packaged automation route Studio built (`packagedAutomationPath`) went
 * with that page (D11).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));
// A read-only base's customization read (ADR-0146 D3) is not under test here:
// it stays pending, so no request leaves the file.
vi.mock('./packageCustomizations-io', () => ({
  fetchPackageCustomizationCounts: vi.fn(() => new Promise<never>(() => {})),
}));

import * as landing from './BuilderLanding';

const { BuilderLanding } = landing;

const READ_ONLY = { id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' };

afterEach(() => {
  cleanup();
  packages.list = [];
});

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Studio landing: the installed card has no Setup exit (objectui#12513, ADR-0146 D1)', () => {
  it('a read-only package card links nowhere into Setup', async () => {
    packages.list = [READ_ONLY];
    renderLanding();

    await screen.findByText('Showcase');
    expect(screen.queryByTestId('studio-landing-overlay')).toBeNull();
    expect(screen.queryByText('Open in Setup')).toBeNull();
    for (const link of screen.queryAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/apps\/setup\/metadata/);
    }
  });

  it('no longer builds the overlay route into Setup’s metadata directory', () => {
    expect('overlayPath' in landing).toBe(false);
  });

  it('no longer builds the Packaged automation route (ADR-0146 D11)', () => {
    // Setup › Packaged automation retired: its flows half is Studio's, so
    // Studio builds no route to it (`nav_packaged_automation` is tombstoned).
    expect('packagedAutomationPath' in landing).toBe(false);
  });
});
