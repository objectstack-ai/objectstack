// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#2600 B1 — "first screen sees the matrix". The pillar is called the
 * Permission Matrix, so the low-frequency identity form (name / label) and the
 * capability picker must NOT push the matrix below the fold:
 *   - the identity strip collapses to a one-line summary and expands on click;
 *   - a zero-grant writable set shows an explicit "none granted · add"
 *     affordance instead of the picker's option chips (which read as owned).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

function makeClient(set: Record<string, unknown>) {
  return {
    layered: async () => ({ effective: set, code: null, overlay: null, overlayScope: null }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
  } as any;
}

let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));
// Stub the capability picker so the B1 collapse logic is isolated from the
// live sys_capability registry read.
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  CapabilityMultiSelectField: () => <div data-testid="cap-picker" />,
  parseCapabilityNames: (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : []),
}));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

async function renderSet(extra: Record<string, unknown> = {}) {
  clientImpl = makeClient({
    name: 'sales_perms',
    label: 'Sales',
    isProfile: false,
    objects: {},
    fields: {},
    ...extra,
  });
  render(
    <MemoryRouter>
      <PermissionMatrixEditPage type="permission" name="sales_perms" />
    </MemoryRouter>,
  );
  await screen.findByText('Sales');
}

describe('PermissionMatrixEditPage — B1 first-screen collapse (objectui#2600)', () => {
  it('collapses the identity form by default and expands on click', async () => {
    await renderSet();

    // Name/label are summary text, not editable inputs, on first paint.
    expect(screen.queryByDisplayValue('sales_perms')).toBeNull();
    expect(screen.queryByDisplayValue('Sales')).toBeNull();
    expect(screen.getByText('Sales')).toBeInTheDocument();

    // Clicking the summary strip (labelled "Sales") reveals the inputs.
    fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
    expect(screen.getByDisplayValue('sales_perms')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Sales')).toBeInTheDocument();
  });

  it('collapses zero-grant capabilities to a "none · add" affordance', async () => {
    await renderSet({ systemPermissions: [] });

    // The option-chip picker is hidden; an explicit none-granted line shows.
    expect(screen.queryByTestId('cap-picker')).toBeNull();
    const add = screen.getByRole('button', { name: /Add capability/i });
    expect(add).toBeInTheDocument();

    // Opting in reveals the picker.
    fireEvent.click(add);
    expect(screen.getByTestId('cap-picker')).toBeInTheDocument();
  });

  it('keeps the picker inline when the set already grants capabilities', async () => {
    await renderSet({ systemPermissions: ['studio.access'] });
    // Non-empty grants must remain visible without an extra click.
    expect(screen.getByTestId('cap-picker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add capability/i })).toBeNull();
  });

  // objectui#3332 — a large capability chip wall (44+ grants → 20+ rows) is a
  // non-shrinking sibling of the flex-1 object matrix; unbounded it squeezed
  // the matrix to ~9px with no page scrollbar. The picker must sit inside a
  // height-capped, internally-scrolling container so the matrix keeps the rest
  // of the viewport.
  it('caps the capability area with its own scroll so the matrix stays reachable (objectui#3332)', async () => {
    await renderSet({
      systemPermissions: Array.from({ length: 44 }, (_, i) => `navigation.item_${i}`),
    });
    const wrap = screen.getByTestId('capability-scroll');
    expect(wrap).toContainElement(screen.getByTestId('cap-picker'));
    expect(wrap.className).toContain('overflow-y-auto');
    expect(wrap.className).toMatch(/max-h-/);
  });
});
