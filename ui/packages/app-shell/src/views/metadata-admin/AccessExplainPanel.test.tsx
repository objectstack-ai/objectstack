// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0090 D6 — integration test for the "why can this user access?" panel.
 * Drives the REAL AccessExplainPanel against a faked authenticated fetch:
 *   1. Submits { object, operation } to POST /api/v1/security/explain and
 *      renders the ExplainDecision — verdict banner, principal chain, the
 *      nine pipeline layers with verdict badges, and the composed readFilter.
 *   2. A 403 (manage_users / delegated-scope gate, D12) renders the friendly
 *      localized message instead of a raw error.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchSpy = vi.fn();
// objectui#2600 B2 — package object list backing the object dropdown; a
// `mock`-prefixed name so vitest allows the hoisted factory to close over it.
let mockObjectList: Array<Record<string, unknown>> = [];

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => fetchSpy,
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ({ find: vi.fn(async () => []) }),
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({ list: async () => mockObjectList }),
}));
// The user picker has its own coverage; a stub keeps this suite focused on
// the explain round-trip.
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: () => null,
}));

import { AccessExplainPanel, type ExplainDecision } from './AccessExplainPanel';

afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
  mockObjectList = [];
});

const DECISION: ExplainDecision = {
  allowed: true,
  object: 'crm_lead',
  operation: 'read',
  principal: {
    userId: 'u_1',
    positions: ['sales_rep', 'everyone'],
    permissionSets: ['sales_user', 'member_default'],
  },
  layers: [
    {
      layer: 'principal',
      verdict: 'neutral',
      detail: 'Principal u_1 holds position(s) [sales_rep, everyone] …',
      contributors: [
        { kind: 'position', name: 'sales_rep' },
        { kind: 'permission_set', name: 'sales_user', via: 'position:sales_rep' },
      ],
    },
    { layer: 'object_crud', verdict: 'grants', detail: "read on 'crm_lead' is granted by [sales_user].", contributors: [{ kind: 'permission_set', name: 'sales_user', via: 'position:sales_rep' }] },
    { layer: 'rls', verdict: 'narrows', detail: 'Row-level security narrows the row set.', contributors: [] },
  ],
  readFilter: { owner_id: 'u_1' },
};

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
});

function renderPanel() {
  return render(<AccessExplainPanel open onOpenChange={() => {}} />);
}

async function submit(object = 'crm_lead') {
  fireEvent.change(screen.getByLabelText('Object'), { target: { value: object } });
  fireEvent.click(screen.getByRole('button', { name: /explain$/i }));
}

describe('AccessExplainPanel (ADR-0090 D6)', () => {
  it('posts the explain request and renders the decision trace', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, DECISION));
    renderPanel();
    await submit();

    await waitFor(() => expect(screen.getByTestId('explain-verdict')).toBeInTheDocument());

    // request shape: POST /api/v1/security/explain with { object, operation }
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/security\/explain$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ object: 'crm_lead', operation: 'read' });

    // verdict + principal chain
    expect(screen.getByTestId('explain-verdict').textContent).toMatch(/ALLOWED/i);
    expect(screen.getByText('u_1')).toBeInTheDocument();
    expect(screen.getAllByText('sales_rep').length).toBeGreaterThan(0);
    expect(screen.getAllByText('sales_user').length).toBeGreaterThan(0);

    // pipeline layers render with verdict badges
    expect(screen.getByTestId('explain-layer-object_crud').textContent).toMatch(/grants/i);
    expect(screen.getByTestId('explain-layer-rls').textContent).toMatch(/narrows/i);

    // machine artifact — composed read filter
    expect(screen.getByText(/"owner_id": "u_1"/)).toBeInTheDocument();
  });

  it('renders a denied decision with the destructive banner', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { ...DECISION, allowed: false, layers: [{ layer: 'object_crud', verdict: 'denies', detail: 'No resolved permission set grants read.', contributors: [] }] }));
    renderPanel();
    await submit();

    await waitFor(() => expect(screen.getByTestId('explain-verdict')).toBeInTheDocument());
    expect(screen.getByTestId('explain-verdict').textContent).toMatch(/DENIED/i);
    expect(screen.getByTestId('explain-layer-object_crud').textContent).toMatch(/denies/i);
  });

  it('sends recordId and renders the record-grained row story (C2 / ADR-0095)', async () => {
    const RECORD_DECISION: ExplainDecision = {
      allowed: true,
      object: 'crm_lead',
      operation: 'read',
      principal: { userId: 'u_1', positions: ['sales_rep', 'everyone'], permissionSets: ['sales_user'], posture: 'MEMBER' },
      layers: [
        {
          layer: 'tenant_isolation',
          kernelTier: 'layer_0_tenant',
          verdict: 'narrows',
          detail: 'Layer 0 tenant isolation.',
          record: {
            outcome: 'admitted',
            rowFilter: { organization_id: 'org1' },
            matchesRecord: true,
            rules: [{ kind: 'tenant_filter', name: 'organization_isolation', effect: 'admits', via: 'organization org1' }],
            detail: "Record is inside the caller's active organization (org1).",
          },
        },
        {
          layer: 'sharing',
          kernelTier: 'layer_1_business',
          verdict: 'widens',
          detail: 'Sharing widens.',
          record: {
            outcome: 'admitted',
            rules: [{ kind: 'record_share', name: 'shr_1', grants: 'read', effect: 'admits', via: 'user:u_1' }],
            detail: '1 share attached; access is granted for this record.',
          },
        },
      ],
      readFilter: { organization_id: 'org1' },
      record: { recordId: 'rec_9', visible: true, decidedBy: 'sharing' },
    };
    fetchSpy.mockResolvedValue(jsonResponse(200, RECORD_DECISION));
    renderPanel();
    fireEvent.change(screen.getByLabelText('Object'), { target: { value: 'crm_lead' } });
    fireEvent.change(screen.getByLabelText(/Record/i), { target: { value: 'rec_9' } });
    fireEvent.click(screen.getByRole('button', { name: /explain$/i }));

    await waitFor(() => expect(screen.getByTestId('explain-record-verdict')).toBeInTheDocument());

    // request carried recordId
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ object: 'crm_lead', operation: 'read', recordId: 'rec_9' });

    // top-level record verdict + decidedBy
    expect(screen.getByTestId('explain-record-verdict').textContent).toMatch(/VISIBLE/i);
    expect(screen.getByTestId('explain-record-verdict').textContent).toMatch(/rec_9/);

    // posture chip + tenant_isolation Layer 0 + per-layer record attribution
    expect(screen.getByTestId('explain-posture').textContent).toMatch(/Member/i);
    expect(screen.getByTestId('explain-layer-tenant_isolation')).toBeInTheDocument();
    expect(screen.getByTestId('explain-record-tenant_isolation').textContent).toMatch(/admitted/i);
    expect(screen.getByTestId('explain-record-sharing').textContent).toMatch(/Record share/i);
    expect(screen.getAllByText(/"organization_id": "org1"/).length).toBeGreaterThan(0);
  });

  it('renders the friendly D12 message on 403 instead of a raw error', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(403, { code: 'PERMISSION_DENIED', message: '[Security] Access denied: …' }));
    renderPanel();
    await submit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).toMatch(/manage_users|delegated admin scope/i);
    expect(screen.queryByTestId('explain-verdict')).not.toBeInTheDocument();
  });

  // objectui#2600 B2 — with a package scope, the object field becomes a
  // dropdown of the package's objects instead of a free-text api-name input.
  it('renders a package-scoped object dropdown when packageId is set', async () => {
    mockObjectList = [
      { item: { name: 'showcase_account', label: 'Account' } },
      { item: { name: 'showcase_task' } },
    ];
    render(<AccessExplainPanel open onOpenChange={() => {}} packageId="com.example.showcase" />);

    // The object field swaps from a free-text input to the shared Select's
    // trigger once loaded (objectui#11865).
    await waitFor(() => expect(screen.getByLabelText('Object')).toHaveAttribute('role', 'combobox'));
    const objectField = screen.getByLabelText('Object');
    fireEvent.keyDown(objectField, { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Account (showcase_account)' })).toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'showcase_task' })).toBeInTheDocument();
    // The misleading free-text placeholder example is gone.
    expect(screen.queryByPlaceholderText(/crm_lead/)).toBeNull();

    // Selecting an object and explaining posts that object.
    fetchSpy.mockResolvedValue(jsonResponse(200, DECISION));
    fireEvent.click(within(listbox).getByRole('option', { name: 'Account (showcase_account)' }));
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /explain$/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as any)?.body ?? '{}'));
    expect(body.object).toBe('showcase_account');
  });

  // Unscoped (no packageId) keeps the free-text input as a fallback.
  it('falls back to a free-text object input without a package scope', async () => {
    renderPanel();
    expect(screen.getByLabelText('Object').tagName).toBe('INPUT');
  });
});
