// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Setup position page shows, read-only, what each permission set the
 * position names grants (objectstack#26187, ruling 6416233738 Q1).
 *
 * One `PermissionPreview` per named set, in the order the position names them,
 * each under the set's name and a link to the set's page. No union of the sets
 * is computed here and nothing is editable. A named set the server does not
 * serve says so on one line, for that set only; a set whose read is refused
 * says that instead, since a refused read is not an absent set. A position that
 * names no set says so.
 *
 * The sets are read through the metadata client the page already uses
 * (`client.get('permission', name)`), stubbed here.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/** The sets the stubbed server serves, by name. */
const SERVED: Record<string, Record<string, unknown>> = {
  sales_read: {
    name: 'sales_read',
    label: 'Sales read',
    objects: { account: { allowRead: true, readScope: 'unit_and_below' } },
  },
  sales_write: {
    name: 'sales_write',
    label: 'Sales write',
    objects: { opportunity: { allowRead: true, allowEdit: true, readScope: 'org', writeScope: 'own' } },
  },
};

/** Names whose read the stubbed server refuses. */
const REFUSED = new Set<string>(['locked_set']);

const mockClient = {
  get: vi.fn(async (type: string, name: string) => {
    if (type !== 'permission') return null;
    if (REFUSED.has(name)) throw new Error('You do not have permission to perform this action.');
    return SERVED[name] ?? null;
  }),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => mockClient,
}));

import { PositionPermissionSetsSection } from './PositionPermissionSetsSection';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mount(permissionSets: unknown) {
  render(
    <MemoryRouter initialEntries={['/apps/setup/metadata/position/sales_rep?scope=environment']}>
      <PositionPermissionSetsSection name="sales_rep" draft={{ name: 'sales_rep', permissionSets }} />
    </MemoryRouter>,
  );
}

/** The rendered set blocks, in document order. */
const setBlocks = () => screen.getAllByTestId('position-permission-set');

describe('the position page shows each named permission set read-only (#26187)', () => {
  it('two named sets give two previews, in declared order, each with its own scopes', async () => {
    mount(['sales_write', 'sales_read']);

    await waitFor(() => expect(screen.getAllByTestId('position-permission-set-preview')).toHaveLength(2));
    const blocks = setBlocks();
    expect(blocks.map((b) => b.getAttribute('data-set-name'))).toEqual(['sales_write', 'sales_read']);

    // Each block's heading is the set's name, linking to the set's page in the
    // same (environment) scope.
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['sales_write', 'sales_read']);
    expect(within(blocks[0]).getByRole('link', { name: 'sales_write' })).toHaveAttribute(
      'href',
      '/apps/setup/metadata/permission/sales_write?scope=environment',
    );
    expect(within(blocks[1]).getByRole('link', { name: 'sales_read' })).toHaveAttribute(
      'href',
      '/apps/setup/metadata/permission/sales_read?scope=environment',
    );

    // Each preview shows its OWN set's object rows and scopes: no union.
    expect(within(blocks[0]).getByText('opportunity')).toBeInTheDocument();
    expect(within(blocks[0]).queryByText('account')).toBeNull();
    expect(within(blocks[0]).getByText('org')).toBeInTheDocument();
    expect(within(blocks[0]).getByText('own')).toBeInTheDocument();
    expect(within(blocks[1]).getByText('account')).toBeInTheDocument();
    expect(within(blocks[1]).queryByText('opportunity')).toBeNull();
    expect(within(blocks[1]).getByText('unit+below')).toBeInTheDocument();

    expect(mockClient.get).toHaveBeenCalledWith('permission', 'sales_write');
    expect(mockClient.get).toHaveBeenCalledWith('permission', 'sales_read');
  });

  it('is read-only: no form control is offered', async () => {
    mount(['sales_write']);
    await screen.findByTestId('position-permission-set-preview');
    const block = setBlocks()[0];
    expect(within(block).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(block).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
  });

  it('a named set the server does not serve shows one "not found" line, and only for that set', async () => {
    mount(['sales_read', 'ghost_set', 'sales_write']);

    const missing = await screen.findByTestId('position-permission-set-missing');
    expect(missing).toHaveTextContent('ghost_set');
    expect(missing).toHaveTextContent(/not found/i);
    await waitFor(() => expect(screen.getAllByTestId('position-permission-set-preview')).toHaveLength(2));
    expect(setBlocks().map((b) => b.getAttribute('data-set-name'))).toEqual(['sales_read', 'ghost_set', 'sales_write']);
    expect(within(setBlocks()[1]).queryByTestId('position-permission-set-preview')).toBeNull();
    expect(screen.getAllByTestId('position-permission-set-missing')).toHaveLength(1);
  });

  it('a refused read is said as a refusal, not as "not found"', async () => {
    mount(['locked_set', 'sales_read']);

    const failed = await screen.findByTestId('position-permission-set-read-failed');
    expect(failed).toHaveTextContent('locked_set');
    expect(failed).toHaveTextContent('You do not have permission to perform this action.');
    expect(screen.queryByTestId('position-permission-set-missing')).toBeNull();
    await waitFor(() => expect(screen.getAllByTestId('position-permission-set-preview')).toHaveLength(1));
  });

  it('a position that names no set shows the empty state and reads nothing', async () => {
    mount([]);
    expect(await screen.findByTestId('position-permission-sets-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('position-permission-set')).toBeNull();
    expect(mockClient.get).not.toHaveBeenCalled();
  });

  it('a position with no permissionSets key at all shows the same empty state', async () => {
    mount(undefined);
    expect(await screen.findByTestId('position-permission-sets-empty')).toBeInTheDocument();
    expect(mockClient.get).not.toHaveBeenCalled();
  });
});
