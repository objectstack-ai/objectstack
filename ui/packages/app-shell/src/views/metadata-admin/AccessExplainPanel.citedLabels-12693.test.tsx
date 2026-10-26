// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12693 — the *Explain access* result names what it cites by label.
 *
 * `POST /api/v1/security/explain` answers the principal's positions and
 * permission sets, and the object, by name only. The Principal card's chips
 * and the verdict banner printed those names although the metadata carries a
 * label for each. The panel now draws:
 *
 *  - each position chip and permission-set chip by the label its metadata row
 *    carries, the name kept on the chip's `title`, with one list read per type
 *    for a run, not one read per chip;
 *  - the banner's object by the label the object picker already holds;
 *  - CONTROL: a name no row labels — absent from the list, or listed with no
 *    label — stays the text, with no `title`; a list that fails leaves every
 *    name; the request body is unchanged.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const fetchSpy = vi.fn();
// The metadata rows the client lists, by type. A `mock` prefix so the hoisted
// factory may close over it.
let mockRows: Record<string, unknown[] | Error> = {};
const mockList = vi.fn(async (type: string) => {
  const rows = mockRows[type];
  if (rows instanceof Error) throw rows;
  return rows ?? [];
});
// One client for every render, so the panel's list effect runs once per open.
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
    positions: ['org_member', 'unlabelled_position', 'unknown_position'],
    permissionSets: ['showcase_member_default', 'unknown_set'],
  },
  layers: [{ layer: 'object_crud', verdict: 'grants', detail: 'granted', contributors: [] }],
};

const LABELLED_ROWS = {
  object: [{ item: { name: 'uxscratch_widget', label: 'Widget' } }, { item: { name: 'uxscratch_part' } }],
  position: [
    { name: 'org_member', label: 'Organization Member' },
    { name: 'unlabelled_position' },
    { name: 'other_position', label: 'Other' },
  ],
  permission: [{ item: { name: 'showcase_member_default', label: 'Showcase Member' } }],
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

/** A chip on the Principal card, found by its text: no other text on the result carries these names. */
const chip = (text: string) => screen.getByText(text);

describe('Explain access names the cited items by label (objectui#12693)', () => {
  it('draws each position and permission-set chip by its label, the name on its title', async () => {
    mockRows = LABELLED_ROWS;
    await explain();

    await waitFor(() => expect(chip('Organization Member')).toHaveAttribute('title', 'org_member'));
    expect(chip('Showcase Member')).toHaveAttribute('title', 'showcase_member_default');
    expect(screen.queryByText('org_member')).toBeNull();
    expect(screen.queryByText('showcase_member_default')).toBeNull();
  });

  it('CONTROL: a name no row labels stays the text, with no title', async () => {
    mockRows = LABELLED_ROWS;
    await explain();
    await screen.findByText('Organization Member');

    for (const name of ['unlabelled_position', 'unknown_position', 'unknown_set']) {
      expect(chip(name)).not.toHaveAttribute('title');
    }
  });

  it('reads each cited type once for a run, not once per chip', async () => {
    mockRows = LABELLED_ROWS;
    await explain();
    await screen.findByText('Organization Member');

    const reads = mockList.mock.calls.map(([type]) => type);
    expect(reads.filter((type) => type === 'position')).toHaveLength(1);
    expect(reads.filter((type) => type === 'permission')).toHaveLength(1);
  });

  it("names the banner's object by the label the object picker holds", async () => {
    mockRows = LABELLED_ROWS;
    await explain();

    expect(screen.getByTestId('explain-verdict').textContent).toContain('“Widget”');
    expect(screen.getByTestId('explain-verdict').textContent).not.toContain('uxscratch_widget');
  });

  it('CONTROL: an object with no label reads as its name in the banner', async () => {
    mockRows = LABELLED_ROWS;
    await explain({ ...DECISION, object: 'uxscratch_part' });

    expect(screen.getByTestId('explain-verdict').textContent).toContain('“uxscratch_part”');
  });

  it('CONTROL: a list that fails leaves every name as the text', async () => {
    mockRows = { ...LABELLED_ROWS, position: new Error('boom'), permission: new Error('boom') };
    await explain();
    await waitFor(() => expect(mockList.mock.calls.some(([type]) => type === 'permission')).toBe(true));

    expect(chip('org_member')).not.toHaveAttribute('title');
    expect(chip('showcase_member_default')).not.toHaveAttribute('title');
  });

  it('CONTROL: the explain request still sends the object by its name', async () => {
    mockRows = LABELLED_ROWS;
    await explain();

    expect(JSON.parse(String(fetchSpy.mock.calls[0][1].body))).toEqual({ object: 'uxscratch_widget', operation: 'read' });
  });
});
