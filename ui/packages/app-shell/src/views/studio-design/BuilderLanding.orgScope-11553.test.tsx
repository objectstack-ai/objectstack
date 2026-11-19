// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11553 — Studio's home reaches the organization's package-less flows.
 *
 * Measured on the stock showcase: the home said "No writable packages yet" and
 * its only entry was the read-only showcase package, whose Automations rail
 * lists packaged flows and not the clone. A package-less flow matches no
 * package card, so the home carries an entry of its own for them, and it is
 * there whether or not a writable package exists. objectstack#34715: it is
 * named "Flows in no app", carries how many there are, and is drawn only when
 * there is at least one; a failed count still draws it, with no number.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches `import('@objectstack/lint')`: paid here, at collection, never inside a test's clock.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));
// The package-less flows the landing counts: an answer of N rows, or a failed read.
const packageLess = vi.hoisted(() => ({ answer: 1 as number | 'failed' }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => packages.list),
    // The landing reads the list's ids beside its entries (the same request,
    // objectstack#32615): both are answered by this double, never the network.
    fetchListedPackageIds: vi.fn(async () => new Set(packages.list.map((p) => String(p.id)))),
  };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));
// A read-only base's customization read (ADR-0146 D3) is not under test here:
// it stays pending, so no request leaves the file.
vi.mock('./packageCustomizations-io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./packageCustomizations-io')>()),
  fetchPackageCustomizations: vi.fn(() => new Promise<never>(() => {})),
}));

vi.mock('./packageSurfaces', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packageSurfaces')>();
  return {
    ...mod,
    loadPackageLessSurfaces: vi.fn(async () => {
      if (packageLess.answer === 'failed') throw new Error('HTTP 503');
      return Array.from({ length: packageLess.answer }, (_, i) => ({ type: 'flow', name: `org_flow_${i}`, label: `Org flow ${i}` }));
    }),
  };
});

import { BuilderLanding } from './BuilderLanding';
import { loadPackageLessSurfaces } from './packageSurfaces';

afterEach(() => {
  cleanup();
  packages.list = [];
  packageLess.answer = 1;
  vi.mocked(loadPackageLessSurfaces).mockClear();
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
  it('offers the entry, with its count, on the measured shape: no writable package, one read-only package', async () => {
    packages.list = [{ id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' }];
    packageLess.answer = 2;
    renderLanding();

    const entry = await screen.findByTestId('studio-landing-org-scope');
    expect(entry).toHaveTextContent('Flows in no app');
    expect(screen.getByTestId('studio-landing-org-scope-count')).toHaveTextContent('2');
    expect(screen.getByText('Outside any app')).toBeInTheDocument();
    // The count is the scope's own union: one unscoped read of flows.
    expect(vi.mocked(loadPackageLessSurfaces)).toHaveBeenCalledWith(expect.anything(), 'flow', expect.any(String));

    fireEvent.click(entry);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/~org/automations'));
    expect(screen.getByTestId('pillar-builder')).toBeInTheDocument();
  });

  it('offers it beside writable packages too, and a package card still opens that package', async () => {
    packages.list = [{ id: 'com.acme.app', name: 'Acme', writable: true, namespace: 'acme' }];
    renderLanding();

    await screen.findByText('Acme');
    expect(await screen.findByTestId('studio-landing-org-scope')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Acme'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/com.acme.app/data'));
  });

  it('draws no entry when no flow belongs to no package (objectstack#34715)', async () => {
    packages.list = [{ id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' }];
    packageLess.answer = 0;
    renderLanding();

    await screen.findByText('Showcase');
    await waitFor(() => expect(vi.mocked(loadPackageLessSurfaces)).toHaveBeenCalled());
    // CONTROL: the section the entry sits in is drawn, with its other entry.
    expect(screen.getByTestId('studio-landing-env-catalog')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-landing-org-scope')).not.toBeInTheDocument();
    expect(screen.queryByText('Flows in no app')).not.toBeInTheDocument();
  });

  it('a failed count still draws the entry, with no number: unknown is not zero', async () => {
    packages.list = [];
    packageLess.answer = 'failed';
    renderLanding();

    const entry = await screen.findByTestId('studio-landing-org-scope');
    expect(entry).toHaveTextContent('Flows in no app');
    expect(screen.queryByTestId('studio-landing-org-scope-count')).not.toBeInTheDocument();
  });
});
