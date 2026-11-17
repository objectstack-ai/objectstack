/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approval request page shows the business record whole (objectstack#34588;
 * maintainer 2026-11-17: 「审批页应该直接显示完整的记录；「动态」在最后」), pinned
 * against the card's acceptance:
 *
 * 1. a request on a record with more than ten fields and a child table shows
 *    every field and the child rows without leaving the page;
 * 2. a field changed after submission is marked "Changed", with its current value;
 * 3. a field the approver may not read appears nowhere;
 *
 * and its layout: the fields in the object's default record page sections, and
 * the right rail in the order progress, attachments, activity.
 *
 * The declared actions bar is doubled: what is under test is the page body.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../DeclaredActionsBar.js', () => ({
  DeclaredActionsBar: () => <div data-testid="declared-actions-probe" />,
}));

/** The approver may read every field but the margin. */
const DENIED = new Set(['purchase_request.internal_margin']);
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  const perms = {
    isLoaded: true,
    can: () => true,
    check: () => ({ allowed: true }),
    checkField: (object: string, field: string) => !DENIED.has(`${object}.${field}`),
    getFieldPermissions: () => ({ readable: true, writable: false }),
  };
  return { ...actual, usePermissions: () => perms };
});

import { AdapterCtx, MetadataCtx, RecordContextProvider } from '@object-ui/react';
import { ApprovalDecisionRenderer } from './ApprovalDecisionPanel';
import { resetApproverDirectoryCache } from '../../hooks/useApproverDirectory';

const PURCHASE_REQUEST = {
  name: 'purchase_request',
  label: 'Purchase Request',
  fieldGroups: [
    { key: 'request', label: 'Request' },
    { key: 'delivery', label: 'Delivery' },
  ],
  fields: {
    name: { type: 'text', label: 'Request No', group: 'request' },
    amount: { type: 'currency', label: 'Amount', group: 'request' },
    vendor: { type: 'text', label: 'Vendor', group: 'request' },
    category: {
      type: 'select',
      label: 'Category',
      group: 'request',
      options: [{ value: 'it', label: 'IT equipment' }, { value: 'office', label: 'Office supplies' }],
    },
    cost_center: { type: 'text', label: 'Cost Center', group: 'request' },
    budget_code: { type: 'text', label: 'Budget Code', group: 'request' },
    requested_on: { type: 'date', label: 'Requested On', group: 'request' },
    internal_margin: { type: 'number', label: 'Internal Margin', group: 'request' },
    ship_to: { type: 'text', label: 'Ship To', group: 'delivery' },
    needed_by: { type: 'date', label: 'Needed By', group: 'delivery' },
    carrier: { type: 'text', label: 'Carrier', group: 'delivery' },
    contact_phone: { type: 'text', label: 'Contact Phone', group: 'delivery' },
    justification: { type: 'textarea', label: 'Justification', group: 'delivery' },
    quote: { type: 'file', label: 'Quote', group: 'delivery' },
    secret_flag: { type: 'text', label: 'Secret Flag', hidden: true },
  },
};

const PURCHASE_LINE = {
  name: 'purchase_line',
  label: 'Purchase Line',
  pluralLabel: 'Purchase Lines',
  fields: {
    request: { type: 'master_detail', reference: 'purchase_request', label: 'Request' },
    item: { type: 'text', label: 'Item' },
    qty: { type: 'number', label: 'Qty' },
  },
};

/** The record as submitted: the request's `payload`. */
const SUBMITTED = {
  id: 'pr_1',
  name: 'PR-002',
  amount: 800,
  vendor: 'Contoso',
  category: 'it',
  cost_center: 'CC-10',
  budget_code: 'B-77',
  requested_on: '2026-11-10',
  internal_margin: 0.42,
  ship_to: 'Building 4',
  needed_by: '2026-12-01',
  carrier: 'DHL',
  contact_phone: '555-0100',
  justification: 'New laptops for the design team',
  quote: 'file_quote_1',
  secret_flag: 'hidden-value-xyz',
};

/** The record as it reads now: the vendor changed after submission. */
const CURRENT = { ...SUBMITTED, vendor: 'Fabrikam', internal_margin: 0.5 };

const LINES = [
  { id: 'l1', request: 'pr_1', item: 'Laptop 14-inch', qty: 4 },
  { id: 'l2', request: 'pr_1', item: 'Docking station', qty: 4 },
];

const THREAD = [
  { id: 'a1', request_id: 'areq_1', action: 'submit', actor_id: 'u9', actor_name: 'JIANGUO Zhuang', comment: 'Please approve', created_at: '2026-11-10T09:00:00Z' },
];

const REQUEST = {
  id: 'areq_1',
  process_name: 'flow:purchase_approval',
  object_name: 'purchase_request',
  record_id: 'pr_1',
  status: 'pending',
  submitter_id: 'u9',
  pending_approvers: ['u1'],
  pending_approver_names: { u1: 'Ada Approver' },
  viewer: { can_act: true, is_submitter: false, can_override: false },
  payload: SUBMITTED,
};

function makeAdapter(current: Record<string, unknown> | null) {
  return {
    getObjectSchema: vi.fn(async (name: string) => [PURCHASE_REQUEST, PURCHASE_LINE].find((o) => o.name === name) ?? null),
    findOne: vi.fn(async (object: string, id: string) => {
      if (object === 'purchase_request' && id === 'pr_1' && current) return current;
      throw Object.assign(new Error('not found'), { status: 404 });
    }),
    find: vi.fn(async (object: string) => {
      if (object === 'sys_approval_action') return { data: THREAD };
      if (object === 'purchase_line') return { data: LINES, total: LINES.length };
      return { data: [] };
    }),
  };
}

function mount(current: Record<string, unknown> | null = CURRENT) {
  const adapter = makeAdapter(current);
  const metadata = {
    objects: [PURCHASE_REQUEST, PURCHASE_LINE],
    getItem: async (type: string, name: string) =>
      type === 'object' ? ([PURCHASE_REQUEST, PURCHASE_LINE].find((o) => o.name === name) ?? null) : null,
  };
  render(
    <MetadataCtx.Provider value={metadata as never}>
      <AdapterCtx.Provider value={adapter as never}>
        <RecordContextProvider objectName="sys_approval_request" recordId={REQUEST.id} data={REQUEST}>
          <ApprovalDecisionRenderer />
        </RecordContextProvider>
      </AdapterCtx.Provider>
    </MetadataCtx.Provider>,
  );
  return { adapter, panel: screen.getByTestId('approval-decision-panel') };
}

const fieldKeys = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-submitted-field]')].map((el) => el.getAttribute('data-submitted-field'));

beforeEach(() => resetApproverDirectoryCache());
afterEach(cleanup);

describe('the request page shows the business record whole (objectstack#34588)', () => {
  it('acceptance 1: every readable field, past the old six, in the default record page\'s sections, and the child rows', async () => {
    const { panel } = mount();
    const record = await within(panel).findByTestId('submitted-record');
    await waitFor(() => expect(record.getAttribute('data-current')).toBe('readable'));
    expect(fieldKeys(record)).toEqual([
      'name', 'amount', 'vendor', 'category', 'cost_center', 'budget_code', 'requested_on',
      'ship_to', 'needed_by', 'carrier', 'contact_phone', 'justification',
    ]);
    // The object's field groups, in declared order, under their labels.
    const sections = [...record.querySelectorAll('[data-submitted-section]')];
    expect(sections.map((s) => s.getAttribute('data-submitted-section'))).toEqual(['group:request', 'group:delivery']);
    expect(sections.map((s) => s.firstElementChild?.textContent)).toEqual(['Request', 'Delivery']);
    // Through the record page's faces: an option by its label, a reference-free text as is.
    expect(record.querySelector('[data-submitted-field="category"]')?.textContent).toContain('IT equipment');
    // The child table's current rows, on this page.
    const children = await within(panel).findByTestId('submitted-child-tables');
    await waitFor(() => expect(children.textContent).toContain('Laptop 14-inch'));
    expect(children.textContent).toContain('Docking station');
  });

  it('acceptance 2: a field changed after submission is marked, with its current value; the rest are not', async () => {
    const { panel } = mount();
    const record = await within(panel).findByTestId('submitted-record');
    await waitFor(() => expect(record.querySelector('[data-submitted-field="vendor"]')?.getAttribute('data-changed')).toBe('true'));
    const vendor = record.querySelector('[data-submitted-field="vendor"]') as HTMLElement;
    expect(vendor.textContent).toContain('Contoso');
    expect(within(vendor).getByTestId('submitted-field-changed').textContent).toBe('Changed');
    expect(vendor.textContent).toContain('Fabrikam');
    expect(record.querySelectorAll('[data-changed="true"]')).toHaveLength(1);
  });

  it('acceptance 3: a field the approver may not read appears nowhere, from either row; a hidden one neither', async () => {
    const { panel } = mount();
    const record = await within(panel).findByTestId('submitted-record');
    await waitFor(() => expect(record.getAttribute('data-current')).toBe('readable'));
    expect(fieldKeys(record)).not.toContain('internal_margin');
    expect(panel.textContent).not.toContain('Internal Margin');
    expect(panel.textContent).not.toContain('0.42');
    expect(panel.textContent).not.toContain('Secret Flag');
    expect(panel.textContent).not.toContain('hidden-value-xyz');
  });

  it('the rail reads progress, attachments, activity, in that order, the activity last; the record sits beside it', async () => {
    const { panel } = mount();
    const rail = within(panel).getByTestId('approval-decision-rail');
    await within(rail).findByTestId('submitted-attachments');
    await waitFor(() => expect(within(rail).getByTestId('approval-decision-activity').textContent).toContain('JIANGUO Zhuang'));
    const order = [...rail.children].map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['approval-decision-progress', 'submitted-attachments', 'approval-decision-activity']);
    // The attachment is in the rail, not in the field grid.
    expect(within(rail).getByTestId('submitted-attachments').querySelector('[data-submitted-attachment="quote"]')).toBeTruthy();
    expect(fieldKeys(within(panel).getByTestId('approval-decision-record'))).not.toContain('quote');
    // The decisions sit above both columns.
    const actions = within(panel).getByTestId('declared-actions-probe');
    expect(actions.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the child table says its rows are current and offers no way to change them', async () => {
    const { panel } = mount();
    const children = await within(panel).findByTestId('submitted-child-tables');
    const table = children.querySelector('[data-submitted-child="purchase_line"]') as HTMLElement;
    expect(table.querySelector('[data-submitted-child-note]')?.textContent).toContain('Current rows');
    expect(within(table).queryByRole('button', { name: /^new$/i })).toBeNull();
    expect(within(table).queryByRole('button', { name: /^add/i })).toBeNull();
  });

  it('the record is read once, by id, with no params: the read the record page sends', async () => {
    const { adapter, panel } = mount();
    await within(panel).findByTestId('submitted-record');
    await waitFor(() => expect(adapter.findOne).toHaveBeenCalled());
    expect(adapter.findOne.mock.calls).toEqual([['purchase_request', 'pr_1']]);
  });

  it('CONTROL: a record the approver cannot read now marks nothing, says so, and draws no child table; the snapshot still shows whole', async () => {
    const { panel } = mount(null);
    const record = await within(panel).findByTestId('submitted-record');
    await waitFor(() => expect(record.getAttribute('data-current')).toBe('unreadable'));
    expect(within(record).getByTestId('submitted-record-current-unreadable')).toBeTruthy();
    expect(record.querySelectorAll('[data-changed="true"]')).toHaveLength(0);
    expect(fieldKeys(record)).toHaveLength(12);
    expect(record.querySelector('[data-submitted-field="vendor"]')?.textContent).toContain('Contoso');
    expect(within(panel).queryByTestId('submitted-child-tables')).toBeNull();
    expect(within(record).queryByTestId('submitted-record-open')).toBeNull();
  });
});
