/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The snapshot summary the decision panel draws (objectui#12483): which keys
 * of a record snapshot it draws, and that it draws them only against the
 * object's DECLARED fields. The same face on the real record page, over the
 * console's routed approvals source and objectstack's served page, is pinned
 * in the console's `approvalRequestsDataSource.servedPageSummary-12483.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { RecordSnapshotSummary } from './RecordSnapshotSummary';
import { distinctLabels, planSnapshotSummary } from './snapshotSummaryPlan';

afterEach(cleanup);

const FIELDS: Record<string, Record<string, unknown>> = {
  owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', system: true },
  name: { type: 'text', label: 'Name' },
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  secret: { type: 'text', label: 'Secret', hidden: true },
  budget: { type: 'number', label: 'Budget' },
  fee: { type: 'currency', label: 'Fee' },
  amount: { type: 'currency', label: 'Amount' },
  note: { type: 'text', label: 'Note' },
};

describe('planSnapshotSummary (objectui#12483)', () => {
  it('reads the declared shape only: undeclared, hidden, bookkeeping, empty and unresolved-reference keys take no row', () => {
    const plan = planSnapshotSummary(
      {
        id: 'r1', owner_id: 'u_1', name: 'N', account: 'acc_1', secret: 's', budget: 5,
        legacy: 'x', note: '  ', amount: 10,
      },
      FIELDS,
      undefined,
    );
    expect(plan).toEqual({ lead: 'amount', rows: ['name', 'budget'], attachments: [], summed: null });
  });

  it('a reference the service resolved is a row', () => {
    expect(planSnapshotSummary({ account: 'acc_1' }, FIELDS, { account: 'Fabrikam' }).rows).toEqual(['account']);
  });

  it('the first non-zero declared currency leads, else the first declared currency; a name never does', () => {
    expect(planSnapshotSummary({ fee: 0, amount: 7 }, FIELDS, undefined).lead).toBe('amount');
    expect(planSnapshotSummary({ fee: 0, amount: 0 }, FIELDS, undefined)).toEqual({ lead: 'fee', rows: ['amount'], attachments: [], summed: null });
    // `budget` is a key the sheet's name guess matches, declared `number`.
    expect(planSnapshotSummary({ budget: 900 }, FIELDS, undefined)).toEqual({ lead: null, rows: ['budget'], attachments: [], summed: null });
  });

  it('a hidden field is dropped before the row cut, so the next one takes its slot', () => {
    const plan = planSnapshotSummary({ name: 'N', secret: 's', budget: 1, note: 'z' }, FIELDS, undefined, null, 2);
    expect(plan.rows).toEqual(['name', 'budget']);
  });
});

describe('distinctLabels (objectui#12483)', () => {
  it('qualifies only the shared labels, and every label when a qualified one still collides', () => {
    expect(distinctLabels([{ key: 'a', label: 'X' }, { key: 'b', label: 'X' }, { key: 'c', label: 'Y' }]))
      .toEqual(['X (a)', 'X (b)', 'Y']);
    expect(distinctLabels([{ key: 'a', label: 'X' }, { key: 'b', label: 'X' }, { key: 'c', label: 'X (a)' }]))
      .toEqual(['X (a)', 'X (b)', 'X (a) (c)']);
  });
});

function mount(defs: Record<string, unknown>, props: React.ComponentProps<typeof RecordSnapshotSummary>) {
  const metadata = { getItem: async (type: string, name: string) => (type === 'object' ? (defs[name] ?? null) : null) };
  return render(
    <MetadataCtx.Provider value={metadata as never}>
      <RecordSnapshotSummary {...props} />
    </MetadataCtx.Provider>,
  );
}

describe('RecordSnapshotSummary (objectui#12483)', () => {
  it('draws the lead and the rows under the declared labels once the definition answers', async () => {
    mount({ invoice: { name: 'invoice', fields: FIELDS } }, {
      objectName: 'invoice',
      snapshot: { name: 'INV-1', account: 'acc_1', amount: 0 },
      display: { account: 'Fabrikam' },
    });
    const summary = await screen.findByTestId('record-snapshot-summary');
    expect(summary.querySelector('[data-summary-lead]')?.getAttribute('data-summary-lead')).toBe('amount');
    const rows = [...summary.querySelectorAll('[data-summary-field]')].map((r) => r.textContent);
    expect(rows).toEqual(['NameINV-1', 'AccountFabrikam']);
  });

  it('CONTROL: draws nothing without the definition, without a snapshot, or for a definition of another object', async () => {
    const seen: string[] = [];
    const defs = { other: { name: 'other', fields: FIELDS } };
    const metadata = {
      getItem: async (_t: string, name: string) => {
        seen.push(name);
        return name === 'invoice' ? { name: 'other', fields: FIELDS } : null;
      },
    };
    render(
      <MetadataCtx.Provider value={metadata as never}>
        <RecordSnapshotSummary objectName="invoice" snapshot={{ name: 'INV-1' }} />
      </MetadataCtx.Provider>,
    );
    await waitFor(() => expect(seen).toContain('invoice'));
    expect(screen.queryByTestId('record-snapshot-summary')).toBeNull();
    cleanup();
    mount(defs, { objectName: 'other', snapshot: undefined });
    mount(defs, { objectName: 'missing', snapshot: { name: 'INV-1' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('record-snapshot-summary')).toBeNull();
  });
});

/**
 * objectui#12534: a `summary` that declares a `sum` over a field its summarized
 * object declares `currency` is the declared amount too, read from the spec's
 * `summaryOperations` declaration and the summarized object's definition.
 */
const ROLLUPS: Record<string, Record<string, unknown>> = {
  ...FIELDS,
  total: { type: 'summary', label: 'Total', summaryOperations: { object: 'line', field: 'amount', function: 'sum' } },
  approved: {
    type: 'summary', label: 'Approved',
    summaryOperations: { object: 'line', field: 'amount', function: 'sum', filter: { status: 'approved' } },
  },
  qty: { type: 'summary', label: 'Quantity', summaryOperations: { object: 'line', field: 'quantity', function: 'sum' } },
  lines: { type: 'summary', label: 'Lines', summaryOperations: { object: 'line', field: 'amount', function: 'count' } },
  peak: { type: 'summary', label: 'Peak', summaryOperations: { object: 'line', field: 'amount', function: 'max' } },
  other: { type: 'summary', label: 'Other', summaryOperations: { object: 'other_line', field: 'amount', function: 'sum' } },
};
const LINE = { name: 'line', fields: { amount: { type: 'currency', label: 'Amount' }, quantity: { type: 'number' } } };
const OTHER_LINE = { name: 'other_line', fields: { amount: { type: 'currency', label: 'Amount' } } };

describe('planSnapshotSummary: a `sum` over a currency field is the amount (objectui#12534)', () => {
  it('leads once the summarized definition is given; before, it is a row and the plan names that one object', () => {
    expect(planSnapshotSummary({ name: 'N', total: 40 }, ROLLUPS, undefined))
      .toEqual({ lead: null, rows: ['name', 'total'], attachments: [], summed: 'line' });
    expect(planSnapshotSummary({ name: 'N', total: 40 }, ROLLUPS, undefined, LINE))
      .toEqual({ lead: 'total', rows: ['name'], attachments: [], summed: 'line' });
  });

  it('CONTROL: a summary that is not a `sum` is a row and asks for no definition', () => {
    expect(planSnapshotSummary({ lines: 3, peak: 9 }, ROLLUPS, undefined, LINE))
      .toEqual({ lead: null, rows: ['lines', 'peak'], attachments: [], summed: null });
  });

  it('CONTROL: a `sum` over a field the summarized object does not declare `currency` is a row', () => {
    const plan = planSnapshotSummary({ qty: 12 }, ROLLUPS, undefined, LINE);
    expect(plan.lead).toBeNull();
    expect(plan.rows).toEqual(['qty']);
  });

  it('CONTROL: a definition of another object is not read as the summarized one', () => {
    expect(planSnapshotSummary({ total: 40 }, ROLLUPS, undefined, OTHER_LINE).lead).toBeNull();
  });

  it('the order is unchanged across both kinds: the first non-zero amount, else the first one', () => {
    // A non-zero currency ahead of the roll-up leads, and no definition is asked for.
    expect(planSnapshotSummary({ amount: 7, total: 40 }, ROLLUPS, undefined))
      .toEqual({ lead: 'amount', rows: ['total'], attachments: [], summed: null });
    expect(planSnapshotSummary({ amount: 0, total: 40 }, ROLLUPS, undefined, LINE).lead).toBe('total');
    expect(planSnapshotSummary({ total: 0, amount: 5 }, ROLLUPS, undefined, LINE).lead).toBe('amount');
    expect(planSnapshotSummary({ total: 0, amount: 0 }, ROLLUPS, undefined, LINE).lead).toBe('total');
    // A filtered `sum` is a `sum`.
    expect(planSnapshotSummary({ total: 0, approved: 25 }, ROLLUPS, undefined, LINE).lead).toBe('approved');
  });

  it('only the first `sum`\'s object is read: a `sum` over another object stays a row', () => {
    const plan = planSnapshotSummary({ other: 9, total: 40 }, ROLLUPS, undefined, OTHER_LINE);
    expect(plan).toEqual({ lead: 'other', rows: ['total'], attachments: [], summed: 'other_line' });
    expect(planSnapshotSummary({ other: 0, total: 40 }, ROLLUPS, undefined, OTHER_LINE).lead).toBe('other');
  });
});

describe('RecordSnapshotSummary: the summarized object\'s definition (objectui#12534)', () => {
  function mountRollups(answer: (name: string) => Promise<unknown>, snapshot: Record<string, unknown>) {
    const asked: string[] = [];
    const metadata = {
      getItem: async (type: string, name: string) => {
        asked.push(name);
        return type === 'object' ? answer(name) : null;
      },
    };
    render(
      <MetadataCtx.Provider value={metadata as never}>
        <RecordSnapshotSummary objectName="invoice" snapshot={snapshot} />
      </MetadataCtx.Provider>,
    );
    return asked;
  }
  const defs: Record<string, unknown> = { invoice: { name: 'invoice', fields: ROLLUPS }, line: LINE };
  const leadOf = (summary: HTMLElement) => summary.querySelector('[data-summary-lead]')?.getAttribute('data-summary-lead') ?? null;

  it('reads the one summarized definition once, and the roll-up leads', async () => {
    const asked = mountRollups(async (name) => defs[name] ?? null, { name: 'INV-1', total: 40, approved: 25 });
    const summary = await screen.findByTestId('record-snapshot-summary');
    expect(leadOf(summary)).toBe('total');
    expect(asked).toEqual(['invoice', 'line']);
  });

  it('CONTROL: a non-zero currency ahead of the roll-up leads, and no other definition is read', async () => {
    const asked = mountRollups(async (name) => defs[name] ?? null, { amount: 7, total: 40 });
    const summary = await screen.findByTestId('record-snapshot-summary');
    expect(leadOf(summary)).toBe('amount');
    expect(asked).toEqual(['invoice']);
  });

  it('CONTROL: an unreadable summarized definition leaves the roll-up an ordinary row', async () => {
    mountRollups(async (name) => (name === 'line' ? null : defs[name] ?? null), { name: 'INV-1', total: 40 });
    const summary = await screen.findByTestId('record-snapshot-summary');
    expect(leadOf(summary)).toBeNull();
    expect(summary.querySelector('[data-summary-field="total"]')).not.toBeNull();
  });

  it('waits for the summarized definition, so the amount does not move in after the rows', async () => {
    let release: (def: unknown) => void = () => {};
    const childAnswer = new Promise((resolve) => { release = resolve; });
    const asked = mountRollups((name) => (name === 'line' ? childAnswer : Promise.resolve(defs[name] ?? null)), {
      name: 'INV-1', total: 40,
    });
    await waitFor(() => expect(asked).toEqual(['invoice', 'line']));
    expect(screen.queryByTestId('record-snapshot-summary')).toBeNull();
    release(LINE);
    const summary = await screen.findByTestId('record-snapshot-summary');
    expect(leadOf(summary)).toBe('total');
  });
});

/**
 * objectui#11815 (ruling D): a declared deadline is judged against the
 * snapshot the face draws, so a done snapshot's past deadline reads neutral
 * and an open one's reads overdue. The snapshot's date and status were frozen
 * together; its own state is the consistent reading.
 */
describe('RecordSnapshotSummary — a declared deadline is judged against the snapshot (objectui#11815)', () => {
  const daysAgo = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const TASK = {
    name: 'task',
    fields: {
      name: { type: 'text', label: 'Name' },
      status: { type: 'text', label: 'Status' },
      due_date: { type: 'date', label: 'Due', dueLike: true, settledWhen: "record.status == 'done'" },
    },
  };
  const dueCell = async () => {
    const summary = await screen.findByTestId('record-snapshot-summary');
    return summary.querySelector('[data-summary-field="due_date"]')?.children[1] as HTMLElement | undefined;
  };

  it("a snapshot whose `settledWhen` holds draws its past deadline neutral", async () => {
    mount({ task: TASK }, { objectName: 'task', snapshot: { name: 'T', status: 'done', due_date: daysAgo(5) } });
    const cell = await dueCell();
    expect(cell?.textContent).toBe('5 days ago');
    expect(cell?.querySelector('.text-red-600')).toBeNull();
  });

  it("a snapshot whose `settledWhen` does not hold draws its past deadline overdue", async () => {
    mount({ task: TASK }, { objectName: 'task', snapshot: { name: 'T', status: 'open', due_date: daysAgo(5) } });
    const cell = await dueCell();
    expect(cell?.textContent).toBe('Overdue 5d');
    expect(cell?.querySelector('.text-red-600')).not.toBeNull();
  });
});

/**
 * Object and list values (objectstack#32854): an attachment, a field whose
 * type is in the spec's media family `FILE_REFERENCE_TYPES`, is drawn through
 * its own cell, openable, after the rows and outside the row cut; every other
 * object or list value is left out. The rule is in `RecordSnapshotSummary.tsx`'s
 * header.
 */
const ID_A = 'fil_a1b2c3';
const ID_B = 'fil_d4e5f6';
const CLAIM: Record<string, Record<string, unknown>> = {
  title: { type: 'text', label: 'Title' },
  amount: { type: 'currency', label: 'Amount' },
  category: { type: 'text', label: 'Category' },
  reason: { type: 'text', label: 'Reason' },
  invoice_no: { type: 'text', label: 'Invoice number' },
  status: { type: 'text', label: 'Status' },
  invoices: { type: 'file', label: 'E-invoices', multiple: true },
  receipt: { type: 'file', label: 'Receipt' },
  photo: { type: 'image', label: 'Photo' },
  badge: { type: 'avatar', label: 'Badge' },
  clip: { type: 'video', label: 'Clip' },
  memo: { type: 'audio', label: 'Memo' },
  private_scan: { type: 'file', label: 'Private scan', hidden: true },
  address: { type: 'address', label: 'Address' },
  spot: { type: 'location', label: 'Spot' },
  extra: { type: 'json', label: 'Extra' },
  labels: { type: 'multiselect', label: 'Labels', options: [{ label: 'A', value: 'a' }] },
  watchers: { type: 'lookup', reference: 'sys_user', label: 'Watchers', multiple: true },
};
const LEFT_OUT = {
  address: { street: '1 Main St', city: 'Springfield' },
  spot: { latitude: 1, longitude: 2 },
  extra: { a: 1 },
  labels: ['a'],
  watchers: ['u_1', 'u_2'],
};

describe('planSnapshotSummary: object and list values (objectstack#32854)', () => {
  it('a `multiple` file field is an attachment, outside the row cut and never the lead', () => {
    const plan = planSnapshotSummary(
      { amount: 120, title: 'Trip', category: 'Travel', reason: 'Visit', invoice_no: 'F-1', status: 'open', invoices: [ID_A, ID_B] },
      CLAIM, undefined, null, 2,
    );
    expect(plan).toEqual({ lead: 'amount', rows: ['title', 'category'], attachments: ['invoices'], summed: null });
  });

  it.each([
    ['file (single, stored id)', 'receipt', ID_A],
    ['file (single, expanded)', 'receipt', { id: ID_A, name: 'r.pdf', url: '/api/v1/storage/files/fil_a1b2c3' }],
    ['image', 'photo', ID_A],
    ['avatar', 'badge', ID_A],
    ['video', 'clip', [ID_A]],
    ['audio', 'memo', ID_A],
  ])('a %s field is an attachment', (_kind, key, value) => {
    expect(planSnapshotSummary({ title: 'T', [key]: value }, CLAIM, undefined)).toEqual(
      { lead: null, rows: ['title'], attachments: [key], summed: null },
    );
  });

  it('CONTROL: every other object or list value is left out, a row and an attachment alike', () => {
    expect(planSnapshotSummary({ title: 'T', ...LEFT_OUT }, CLAIM, undefined)).toEqual(
      { lead: null, rows: ['title'], attachments: [], summed: null },
    );
  });

  it('CONTROL: an empty, hidden or undeclared attachment takes no row', () => {
    const plan = planSnapshotSummary(
      { title: 'T', invoices: [], receipt: '  ', photo: {}, clip: null, private_scan: ID_A, legacy_file: [ID_B] },
      CLAIM, undefined,
    );
    expect(plan).toEqual({ lead: null, rows: ['title'], attachments: [], summed: null });
  });
});

describe('RecordSnapshotSummary: attachments are drawn and open (objectstack#32854)', () => {
  const claim = { name: 'expense_claim', fields: CLAIM };
  const draw = async (snapshot: Record<string, unknown>) => {
    mount({ expense_claim: claim }, { objectName: 'expense_claim', snapshot });
    return screen.findByTestId('record-snapshot-summary');
  };
  const linksOf = (el: Element | null | undefined) =>
    [...(el?.querySelectorAll('a[data-slot="file-download-link"]') ?? [])].map((a) => ({
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      name: a.textContent,
    }));

  it('a `multiple` file field draws each file as a link that opens it, after the six rows', async () => {
    const summary = await draw({
      amount: 120, title: 'Trip', category: 'Travel', reason: 'Visit', invoice_no: 'F-1', status: 'open',
      invoices: [ID_A, { id: ID_B, name: 'invoice-2.pdf', url: '/api/v1/storage/files/fil_d4e5f6' }],
    });
    expect([...summary.querySelectorAll('[data-summary-field]')].map((r) => r.getAttribute('data-summary-field')))
      .toEqual(['title', 'category', 'reason', 'invoice_no', 'status']);
    const row = summary.querySelector('[data-summary-attachment="invoices"]');
    expect(row?.firstElementChild?.textContent).toBe('E-invoices');
    expect(linksOf(row)).toEqual([
      { href: `/api/v1/storage/files/${ID_A}`, target: '_blank', name: 'File' },
      { href: '/api/v1/storage/files/fil_d4e5f6', target: '_blank', name: 'invoice-2.pdf' },
    ]);
  });

  it('a single file field draws its file as a link that opens it', async () => {
    const summary = await draw({ title: 'Trip', receipt: { id: ID_A, name: 'receipt.pdf', url: '/api/v1/storage/files/fil_a1b2c3' } });
    expect(linksOf(summary.querySelector('[data-summary-attachment="receipt"]'))).toEqual([
      { href: `/api/v1/storage/files/${ID_A}`, target: '_blank', name: 'receipt.pdf' },
    ]);
  });

  it.each([['video', 'clip'], ['audio', 'memo']])('a %s field draws its file as a link that opens it', async (_kind, key) => {
    const summary = await draw({ title: 'Trip', [key]: [ID_A] });
    expect(linksOf(summary.querySelector(`[data-summary-attachment="${key}"]`))).toEqual([
      { href: `/api/v1/storage/files/${ID_A}`, target: '_blank', name: 'File' },
    ]);
  });

  it.each([['image', 'photo'], ['avatar', 'badge']])('an %s field draws its thumbnail from the download endpoint', async (_kind, key) => {
    const summary = await draw({ title: 'Trip', [key]: ID_A });
    const img = summary.querySelector(`[data-summary-attachment="${key}"] img`);
    expect(img?.getAttribute('src')).toBe(`/api/v1/storage/files/${ID_A}`);
  });

  it('CONTROL: a left-out kind draws nothing, and the scalar rows are unchanged', async () => {
    const summary = await draw({ title: 'Trip', status: 'open', ...LEFT_OUT });
    expect([...summary.querySelectorAll('[data-summary-field]')].map((r) => r.textContent)).toEqual(['TitleTrip', 'Statusopen']);
    expect(summary.querySelectorAll('[data-summary-attachment]')).toHaveLength(0);
  });

  it('a snapshot holding only an attachment still draws the section', async () => {
    const summary = await draw({ invoices: [ID_A] });
    expect(linksOf(summary.querySelector('[data-summary-attachment="invoices"]'))).toHaveLength(1);
  });
});
