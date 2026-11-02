// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12513 — the installed card's link leaves Studio for Setup, and says
 * so: it reads "Open in Setup" and carries an outward arrow, while its route
 * (the package's metadata directory, objectui#11808) and its testid stay.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
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

describe('Studio landing: the installed card’s Setup exit says where it goes (objectui#12513)', () => {
  it('reads "Open in Setup" with an outward arrow, on the same route', async () => {
    packages.list = [READ_ONLY];
    renderLanding();

    await screen.findByText('Showcase');
    const link = screen.getByTestId('studio-landing-overlay');
    expect(link).toHaveAccessibleName('Open in Setup');
    expect(link).toHaveAttribute('href', '/apps/setup/metadata?package=com.example.showcase');
    expect(link.querySelector('svg.lucide-arrow-up-right')).not.toBeNull();
    // The overlay explanation stays on the link's tooltip.
    expect(link).toHaveAttribute('title', expect.stringContaining('environment overlay'));
    expect(within(link).queryByText('Customize with an overlay')).toBeNull();
  });

  it('no longer builds the Packaged automation route (ADR-0146 D11)', () => {
    // Setup › Packaged automation retired: its flows half is Studio's, so
    // Studio builds no route to it (`nav_packaged_automation` is tombstoned).
    expect('packagedAutomationPath' in landing).toBe(false);
  });
});
