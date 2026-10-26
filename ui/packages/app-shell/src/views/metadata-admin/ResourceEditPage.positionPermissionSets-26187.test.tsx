// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26187 — the Setup position page mounts the read-only permission
 * previews: one per permission set the position names, in declared order, under
 * the definition and beside the holders. Studio (no scope) does not, and nor
 * does another type in the Setup scope.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const POSITION = { name: 'sales_rep', label: 'Sales Rep', permissionSets: ['sales_write', 'sales_read'] };

const SETS: Record<string, Record<string, unknown>> = {
  sales_read: { name: 'sales_read', objects: { account: { allowRead: true, readScope: 'unit' } } },
  sales_write: { name: 'sales_write', objects: { opportunity: { allowRead: true, allowEdit: true, writeScope: 'own' } } },
};

const mockClient = {
  list: vi.fn(async () => []),
  listDrafts: vi.fn(async () => []),
  get: vi.fn(async (type: string, name: string) => (type === 'permission' ? SETS[name] ?? null : null)),
  getDraft: vi.fn(async () => null),
  references: vi.fn(async () => []),
  layered: vi.fn(async () => ({
    code: null,
    overlay: POSITION,
    overlayScope: null,
    effective: POSITION,
    provenance: 'org',
  })),
};

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    permissionSets: { type: 'array', items: { type: 'string' } },
  },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [
        { type: 'position', name: 'position', label: 'Position', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
        { type: 'dashboard', name: 'dashboard', label: 'Dashboard', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
      ],
    }),
  };
});
vi.mock('./PositionHoldersSection', () => ({
  PositionHoldersSection: ({ name }: { name: string }) => <div data-testid="position-holders-stub">{name}</div>,
}));

import { MetadataResourceEditPage } from './ResourceEditPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function mount(type: string, search: string) {
  render(
    <MemoryRouter initialEntries={[`/apps/setup/metadata/${type}/sales_rep${search}`]}>
      <MetadataResourceEditPage type={type} name="sales_rep" />
    </MemoryRouter>,
  );
  await waitFor(() => expect(mockClient.layered).toHaveBeenCalled());
}

describe("the Setup position page shows its named permission sets read-only (#26187)", () => {
  it('renders one preview per named set, in declared order, beside the holders', async () => {
    await mount('position', '?scope=environment');

    await waitFor(() => expect(screen.getAllByTestId('position-permission-set-preview')).toHaveLength(2));
    expect(
      screen.getAllByTestId('position-permission-set').map((b) => b.getAttribute('data-set-name')),
    ).toEqual(['sales_write', 'sales_read']);
    expect(screen.getByTestId('position-holders-stub')).toHaveTextContent('sales_rep');
  });

  it('does not render in Studio (no scope)', async () => {
    await mount('position', '');
    await screen.findByDisplayValue('Sales Rep').catch(() => undefined);
    expect(screen.queryByTestId('position-permission-sets')).toBeNull();
    expect(mockClient.get).not.toHaveBeenCalledWith('permission', expect.anything());
  });

  it('does not render for another type in the Setup scope', async () => {
    await mount('dashboard', '?scope=environment');
    await screen.findByDisplayValue('Sales Rep').catch(() => undefined);
    expect(screen.queryByTestId('position-permission-sets')).toBeNull();
  });
});
