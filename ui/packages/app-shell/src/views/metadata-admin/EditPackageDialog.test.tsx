// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditPackageDialog, type InstalledPackageRow } from './PackagesPage';

// EditPackageDialog is now a thin wrapper over the spec-driven PackageFormDialog
// (edit mode). It renders the manifest form via SchemaForm and PATCHes name /
// description / version, plus `dependencies` only when the author changed it
// (objectui#13121, pinned in PackageFormDialog.editDependencies-13121.test.tsx).
// The fixture below declares no `dependencies`, so the body holds the three.
// PackageFormDialog's apiJson uses the raw global fetch (fetch → res.text() →
// JSON.parse), so we stub global fetch and mirror the runtime's { success, data }
// envelope — exactly what `PATCH /api/v1/packages/:id` returns.
const PKG: InstalledPackageRow = {
  manifest: { id: 'com.acme.crm', name: 'Acme CRM', version: '1.0.0', description: 'old', type: 'app' },
  enabled: true,
  status: 'installed',
  source: 'authored',
  writable: true,
};

let calls: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const body = init.body ? JSON.parse(init.body as string) : {};
      const updated: InstalledPackageRow = { ...PKG, manifest: { ...PKG.manifest, ...body } };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: updated }),
      } as Response;
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('EditPackageDialog (spec-form wrapper)', () => {
  it('prefills from the manifest and PATCHes only the server-persisted fields', async () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<EditPackageDialog pkg={PKG} open onOpenChange={onOpenChange} onSaved={onSaved} />);

    // Stable submit affordance regardless of the SchemaForm field internals.
    fireEvent.click(await screen.findByTestId('package-form-submit'));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));

    // One PATCH to the package's REST id, carrying ONLY name/description/version.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/packages/com.acme.crm');
    expect(calls[0].init.method).toBe('PATCH');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      name: 'Acme CRM',
      description: 'old',
      version: '1.0.0',
    });

    // onSaved receives the server's updated package; the dialog closes.
    expect(onSaved.mock.calls[0][0].manifest.name).toBe('Acme CRM');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a server error and keeps the dialog open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        text: async () =>
          JSON.stringify({ success: false, error: { message: 'version must be semantic (e.g. 1.0.0)' } }),
      })),
    );
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<EditPackageDialog pkg={PKG} open onOpenChange={onOpenChange} onSaved={onSaved} />);

    fireEvent.click(await screen.findByTestId('package-form-submit'));

    expect(await screen.findByText(/version must be semantic/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
