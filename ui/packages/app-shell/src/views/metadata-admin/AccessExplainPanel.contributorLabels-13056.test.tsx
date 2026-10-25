// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13056 — each pipeline layer's "Contributed by" chips name the
 * position or permission set by label.
 *
 * `POST /api/v1/security/explain` answers a layer's contributors by `kind` and
 * `name` only. The chips printed those names although the metadata carries a
 * label for each, and the Principal card on the same result already drew them
 * by label (objectui#12693). The chips now take the label from the same read:
 *
 *  - a `position` contributor by its `meta/position` label, a `permission_set`
 *    contributor by its `meta/permission` label, the name first on the chip's
 *    `title`, then the kind and `via` the title carried before;
 *  - CONTROL: a contributor no row labels, and a `system` contributor, stay
 *    their name, the title the kind and `via` alone; the Principal card's chips
 *    read as before; one list read per type for a run.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchSpy = vi.fn();
// The metadata rows the client lists, by type. A `mock` prefix so the hoisted
// factory may close over it.
let mockRows: Record<string, unknown[] | Error> = {};
const mockList = vi.fn(async (type: string) => {
  const rows = mockRows[type];
  if (rows instanceof Error) throw rows;
  return rows ?? [];
});
const mockClient = { list: (type: string) => mockList(type) };

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => fetchSpy,
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ find: vi.fn(async () => []) }),
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => mockClient,
}));
// The record and user pickers have their own coverage.
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

import { AccessExplainPanel, type ExplainDecision } from './AccessExplainPanel';

afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
  mockList.mockClear();
  mockRows = {};
});

const DECISION: ExplainDecision = {
  allowed: true,
  object: 'uxscratch_widget',
  operation: 'read',
  principal: {
    userId: 'u_1',
    positions: ['org_member'],
    permissionSets: ['member_default'],
  },
  layers: [
    {
      layer: 'object_crud',
      verdict: 'grants',
      detail: 'granted',
      contributors: [
        { kind: 'position', name: 'org_member', via: 'everyone' },
        { kind: 'permission_set', name: 'member_default', via: 'position:org_member' },
        { kind: 'position', name: 'unknown_position' },
        { kind: 'system', name: 'baseline' },
      ],
    },
  ],
};

const LABELLED_ROWS = {
  object: [{ item: { name: 'uxscratch_widget', label: 'Widget' } }],
  position: [{ name: 'org_member', label: 'Organization Member' }],
  permission: [{ item: { name: 'member_default', label: 'Member — Standard Access' } }],
};

/** Mount the panel scoped to a package on the decision's object, run Explain, and wait for the result. */
async function explain(decision: ExplainDecision = DECISION): Promise<void> {
  render(
    <AccessExplainPanel open onOpenChange={() => {}} packageId="com.example.uxscratch" defaultObject={decision.object} />,
  );
  await waitFor(() => expect(screen.getByLabelText('Object')).toHaveAttribute('role', 'combobox'));
  fetchSpy.mockResolvedValue({ ok: true, status: 200, statusText: '', json: async () => decision });
  fireEvent.click(screen.getByRole('button', { name: /explain$/i }));
  await screen.findByTestId('explain-verdict');
}

/** The object-CRUD layer's card, where its "Contributed by" chips are drawn. */
const layer = () => within(screen.getByTestId('explain-layer-object_crud'));

describe('Explain access names each layer\'s contributors by label (objectui#13056)', () => {
  it('draws a position and a permission-set contributor by label, the name first on the title', async () => {
    mockRows = LABELLED_ROWS;
    await explain();

    await waitFor(() =>
      expect(layer().getByText('Organization Member')).toHaveAttribute('title', 'org_member · position · via everyone'),
    );
    expect(layer().getByText('Member — Standard Access')).toHaveAttribute(
      'title',
      'member_default · permission_set · via position:org_member',
    );
    expect(layer().queryByText('org_member')).toBeNull();
    expect(layer().queryByText('member_default')).toBeNull();
  });

  it('labels a contributor the Principal card does not cite — the read covers the layers too', async () => {
    mockRows = LABELLED_ROWS;
    await explain({ ...DECISION, principal: { userId: 'u_1', positions: [], permissionSets: [] } });

    await waitFor(() => expect(layer().getByText('Organization Member')).toBeInTheDocument());
    expect(layer().getByText('Member — Standard Access')).toBeInTheDocument();
  });

  it('CONTROL: an unlabelled contributor and a system contributor stay their name, the title the kind alone', async () => {
    mockRows = LABELLED_ROWS;
    await explain();
    await layer().findByText('Organization Member');

    expect(layer().getByText('unknown_position')).toHaveAttribute('title', 'position');
    expect(layer().getByText('baseline')).toHaveAttribute('title', 'system');
  });

  it('CONTROL: the Principal card\'s chips read as before, and each type is listed once for a run', async () => {
    mockRows = LABELLED_ROWS;
    await explain();
    await layer().findByText('Organization Member');

    const card = screen.getAllByText('Organization Member').find((el) => el.getAttribute('title') === 'org_member');
    expect(card).toBeTruthy();
    const reads = mockList.mock.calls.map(([type]) => type);
    expect(reads.filter((type) => type === 'position')).toHaveLength(1);
    expect(reads.filter((type) => type === 'permission')).toHaveLength(1);
  });

  it('CONTROL: a list that fails leaves every contributor as its name', async () => {
    mockRows = { ...LABELLED_ROWS, position: new Error('boom'), permission: new Error('boom') };
    await explain();
    await waitFor(() => expect(mockList.mock.calls.some(([type]) => type === 'permission')).toBe(true));

    expect(layer().getByText('org_member')).toHaveAttribute('title', 'position · via everyone');
    expect(layer().getByText('member_default')).toHaveAttribute('title', 'permission_set · via position:org_member');
  });
});
