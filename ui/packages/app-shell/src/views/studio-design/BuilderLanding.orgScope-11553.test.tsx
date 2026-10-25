// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11553 — Studio's home reaches the organization's package-less flows.
 *
 * Measured on the stock showcase: the home said "No writable packages yet" and
 * its only entry was the read-only showcase package, whose Automations rail
 * lists packaged flows and not the clone. A package-less flow matches no
 * package card, so the home carries an entry of its own for them, and it is
 * there whether or not a writable package exists.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';

afterEach(() => {
  cleanup();
  packages.list = [];
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

function renderLanding() {
  return render(
    <MemoryRouter initialEntries={['/studio']}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Studio home → the package-less scope (objectui#11553)', () => {
  it('offers the entry on the measured shape: no writable package, one read-only package', async () => {
    packages.list = [{ id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' }];
    renderLanding();

    await screen.findByText('No writable packages yet — create one to start.');
    const entry = screen.getByTestId('studio-landing-org-scope');
    expect(entry).toHaveTextContent('Organization flows');
    expect(screen.getByText('Not in a package')).toBeInTheDocument();

    fireEvent.click(entry);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/~org/automations'));
    expect(screen.getByTestId('pillar-builder')).toBeInTheDocument();
  });

  it('offers it beside writable packages too, and a package card still opens that package', async () => {
    packages.list = [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }];
    renderLanding();

    await screen.findByText('Acme');
    expect(screen.getByTestId('studio-landing-org-scope')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Acme'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/com.acme.app/data'));
  });
});
