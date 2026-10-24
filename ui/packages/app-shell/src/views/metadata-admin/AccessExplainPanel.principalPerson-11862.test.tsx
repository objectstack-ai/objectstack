// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11862 — the *Explain access* result names the principal as a
 * person, not as a raw user id.
 *
 * The Principal line printed `decision.principal.userId` (and
 * `onBehalfOf.userId`) as the bare id, although the user picker right above it
 * shows a name. Each id now resolves through the lookup the picker reads —
 * `sys_user` through the data adapter — and the line shows the name and the
 * email as the primary text, with the id as secondary text:
 *
 *  - a known id reads as its person, the id beneath;
 *  - CONTROL: an id the lookup does not answer reads as the id alone;
 *  - an agent acting on behalf of a person names the person it acts for;
 *  - the user picked in the picker is named from the row the picker handed
 *    back, with no second lookup;
 *  - a lookup that fails leaves the id, as the line read before.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const fetchSpy = vi.fn();
// The data adapter's `find` — the lookup the user picker reads. A `mock`
// prefix so the hoisted factories may close over it.
const mockFind = vi.fn();
const mockAdapter = { find: (...args: unknown[]) => mockFind(...args) };
// The row the stubbed user picker hands back when its "pick" button is used.
let mockPickedRow: Record<string, unknown> | null = null;

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => fetchSpy,
}));
vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => mockAdapter,
}));
vi.mock('./useMetadata', () => ({
  useMetadataClient: () => ({ list: async () => [] }),
}));
// The picker has its own coverage. This stub renders one button for the USER
// picker that hands back `mockPickedRow`, as the real dialog's selection does.
vi.mock('@object-ui/fields', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/fields')>()),
  RecordPickerDialog: (props: { objectName: string; onSelectRecords: (rows: unknown[]) => void }) =>
    props.objectName === 'sys_user' ? (
      <button type="button" onClick={() => props.onSelectRecords([mockPickedRow])}>
        pick user
      </button>
    ) : null,
}));

import { AccessExplainPanel, type ExplainDecision } from './AccessExplainPanel';

afterEach(() => {
  cleanup();
  fetchSpy.mockReset();
  mockFind.mockReset();
  mockPickedRow = null;
});

const decisionFor = (principal: ExplainDecision['principal']): ExplainDecision => ({
  allowed: true,
  object: 'crm_lead',
  operation: 'read',
  principal,
  layers: [{ layer: 'object_crud', verdict: 'grants', detail: 'granted', contributors: [] }],
});

const jsonResponse = (body: unknown) => ({ ok: true, status: 200, statusText: '', json: async () => body });

async function explain(decision: ExplainDecision): Promise<HTMLElement> {
  fetchSpy.mockResolvedValue(jsonResponse(decision));
  fireEvent.change(screen.getByLabelText('Object'), { target: { value: 'crm_lead' } });
  fireEvent.click(screen.getByRole('button', { name: /explain$/i }));
  return screen.findByTestId('explain-principal');
}

const ADA = { id: 'u_1', name: 'Ada Lovelace', email: 'ada@example.com' };

describe('objectui#11862 — the Principal line names a person, not a raw user id', () => {
  it('a known id reads as its name and email, with the id as secondary text', async () => {
    mockFind.mockResolvedValue([ADA]);
    render(<AccessExplainPanel open onOpenChange={() => {}} />);
    const principal = await explain(decisionFor({ userId: 'u_1', positions: [], permissionSets: [] }));

    await within(principal).findByText('Ada Lovelace');
    expect(within(principal).getByText('ada@example.com')).toBeInTheDocument();
    // The id is still on the line, as secondary text: small and monospace.
    expect(within(principal).getByText('u_1')).toHaveClass('font-mono', 'text-[10px]');
    // Asked of the picker's lookup — `sys_user` — for exactly that id.
    expect(mockFind).toHaveBeenCalledTimes(1);
    expect(mockFind).toHaveBeenCalledWith('sys_user', { $filter: { id: { $in: ['u_1'] } }, $top: 1 });
  });

  it('CONTROL: an id the lookup does not answer reads as the id alone', async () => {
    mockFind.mockResolvedValue([]);
    render(<AccessExplainPanel open onOpenChange={() => {}} />);
    const principal = await explain(decisionFor({ userId: 'u_9', positions: [], permissionSets: [] }));

    await waitFor(() => expect(mockFind).toHaveBeenCalledTimes(1));
    expect(principal).toHaveTextContent(/^u_9$/);
  });

  it('an agent on behalf of a person names the person it acts for', async () => {
    mockFind.mockResolvedValue([ADA]);
    render(<AccessExplainPanel open onOpenChange={() => {}} />);
    const principal = await explain(
      decisionFor({ userId: 'svc_bot', onBehalfOf: { userId: 'u_1' }, positions: [], permissionSets: [] }),
    );

    await within(principal).findByText('Ada Lovelace');
    expect(within(principal).getByText('svc_bot')).toBeInTheDocument();
    expect(mockFind).toHaveBeenCalledWith('sys_user', { $filter: { id: { $in: ['svc_bot', 'u_1'] } }, $top: 2 });
  });

  it('the picked user is named from the row the picker handed back, with no second lookup', async () => {
    mockPickedRow = { id: 'u_2', name: 'Bob Stone', email: 'bob@example.com' };
    render(<AccessExplainPanel open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'pick user' }));
    const principal = await explain(decisionFor({ userId: 'u_2', positions: [], permissionSets: [] }));

    expect(within(principal).getByText('Bob Stone')).toBeInTheDocument();
    expect(within(principal).getByText('bob@example.com')).toBeInTheDocument();
    expect(within(principal).getByText('u_2')).toBeInTheDocument();
    expect(mockFind).not.toHaveBeenCalled();
  });

  it('a lookup that fails leaves the id, as the line read before', async () => {
    mockFind.mockRejectedValue(new Error('OBJECT_API_DISABLED'));
    render(<AccessExplainPanel open onOpenChange={() => {}} />);
    const principal = await explain(decisionFor({ userId: 'u_1', positions: [], permissionSets: [] }));

    await waitFor(() => expect(mockFind).toHaveBeenCalledTimes(1));
    expect(principal).toHaveTextContent(/^u_1$/);
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });
});
