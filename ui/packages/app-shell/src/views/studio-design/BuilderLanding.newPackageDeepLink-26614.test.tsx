// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26614 — `/studio?new=package` lands on the Studio landing with
 * its create-package dialog open.
 *
 * Home's "New in Studio" chip and the `/ai` no-assistant screen link there
 * (`STUDIO_NEW_PACKAGE_PATH`) on a deployment with no AI agent, where Studio is
 * the way to build. What these cases pin, on the real `BuilderLanding` under a
 * real router: the dialog opens on arrival, the param is dropped from the
 * address with a replace (so a refresh does not reopen it), and the bare
 * landing still opens with the dialog closed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

// The dialog's form stack is not under test: the stand-in reports whether the
// landing asked for it open.
vi.mock('../metadata-admin/PackageFormDialog', () => ({
  PackageFormDialog: ({ open, mode }: { open: boolean; mode: string }) => (
    <div data-testid="package-form-dialog" data-open={String(open)} data-mode={mode} />
  ),
}));

import { BuilderLanding } from './BuilderLanding';
import { STUDIO_NEW_PACKAGE_PATH } from './studioNewPackage';

afterEach(() => {
  cleanup();
});

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderLandingAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/studio" element={<BuilderLanding />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the new-package deep link (objectstack#26614)', () => {
  it('opens the create-package dialog on arrival and drops the param from the address', async () => {
    renderLandingAt(STUDIO_NEW_PACKAGE_PATH);
    const dialog = screen.getByTestId('package-form-dialog');
    await waitFor(() => expect(dialog).toHaveAttribute('data-open', 'true'));
    expect(dialog).toHaveAttribute('data-mode', 'create');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/studio$/));
  });

  it('keeps any other param the address carries', async () => {
    renderLandingAt(`${STUDIO_NEW_PACKAGE_PATH}&q=crm`);
    await waitFor(() =>
      expect(screen.getByTestId('package-form-dialog')).toHaveAttribute('data-open', 'true'),
    );
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/studio\?q=crm$/));
  });

  it('CONTROL — the bare landing opens with the dialog closed', async () => {
    renderLandingAt('/studio');
    // Let the landing's package read settle before reading the dialog.
    await screen.findByText(/./, { selector: 'h1' });
    expect(screen.getByTestId('package-form-dialog')).toHaveAttribute('data-open', 'false');
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/studio$/);
  });

  it('an unknown value opens nothing', async () => {
    renderLandingAt('/studio?new=flow');
    await screen.findByText(/./, { selector: 'h1' });
    expect(screen.getByTestId('package-form-dialog')).toHaveAttribute('data-open', 'false');
  });
});
