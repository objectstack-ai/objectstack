/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The audit log's Object column, the detail drawer's title and its
 * target-record line name a row's object by its served label, the label the
 * same page's Object filter already offers.
 *
 * All three used to print the stored API name (`crm_account`,
 * `sys_flow_dispatch`), so in a Chinese console a row read 更新 beside
 * `crm_account`, and telling which business object changed meant knowing its
 * API name.
 *
 * The transport is stubbed at the seams the page reads through:
 *  - the console's metadata cache (`useMetadata().objects`) serves the objects
 *    as a zh console receives them: `crm_account` labelled 客户, and
 *    `crm_blank` served with a blank label. `nightly_widget` is stored on a
 *    row but served by no object;
 *  - `fetch` answers `/data/sys_audit_log` with the ledger below;
 *  - the console adapter (`useAdapter`) serves `sys_user` to the actor lookup.
 *
 * Pinned:
 *  - each Object cell shows its object's served label, and an object the
 *    metadata does not serve, or serves without a label, shows its stored
 *    name; a row with no object shows the dash;
 *  - the drawer's title and its target-record line show the same label, for a
 *    served object and for an unserved one;
 *  - the Object filter keeps its `Label (name)` choices.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { ADAPTER, METADATA, SERVED_OBJECTS } = vi.hoisted(() => {
  const SERVED_OBJECTS = Object.freeze([
    { name: 'crm_account', label: '客户' },
    { name: 'crm_blank', label: '   ' },
    { name: 'sys_audit_log', label: '审计日志' },
  ]) as readonly unknown[];
  return {
    // objectstack#33864 — `crm_account` is readable through the adapter, so
    // its record can be named; every other object answers no definition and
    // no rows (the actor lookup's `sys_user` included).
    ADAPTER: {
      find: async (objectName: string) =>
        objectName === 'crm_account'
          ? { data: [{ id: 'acc_1', name: 'Acme Corp' }], total: 1 }
          : { data: [], total: 0 },
      findOne: async () => null,
      getObjectSchema: async (objectName: string) =>
        objectName === 'crm_account'
          ? { name: 'crm_account', label: '客户', nameField: 'name', fields: { name: { type: 'text', label: 'Name' } } }
          : undefined,
    },
    SERVED_OBJECTS,
    // Mutable per test: the served objects.
    METADATA: { objects: SERVED_OBJECTS },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: METADATA.objects }),
}));

// Imported after the mocks so the page picks them up.
import { AuditLogPage } from './AuditLogPage';

/** The stored ledger, newest first: a served object, an unserved one, a blank-labelled one, and none. */
const LEDGER = [
  { id: 'log_1', created_at: '2026-11-02T03:00:00.000Z', action: 'update', object_name: 'crm_account', record_id: 'acc_1', user_id: null },
  { id: 'log_2', created_at: '2026-11-02T02:00:00.000Z', action: 'create', object_name: 'nightly_widget', record_id: 'wid_1', user_id: null },
  { id: 'log_3', created_at: '2026-11-02T01:00:00.000Z', action: 'update', object_name: 'crm_blank', record_id: 'blk_1', user_id: null },
  { id: 'log_4', created_at: '2026-11-02T00:00:00.000Z', action: 'login', object_name: null, record_id: null, user_id: null },
];

beforeEach(() => {
  METADATA.objects = SERVED_OBJECTS;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ object: 'sys_audit_log', records: LEDGER, total: LEDGER.length }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(): void {
  render(<MemoryRouter><AuditLogPage /></MemoryRouter>);
}

/** The body rows of the log table. */
function bodyRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1);
}

/** The Object cell's text, by row. */
function objectCells(): string[] {
  return bodyRows().map((row) => row.querySelectorAll('td')[2]?.textContent ?? '');
}

/** Open the detail drawer of the row at `index`. */
async function openDrawer(index: number): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(bodyRows()[index]!);
  });
  return screen.findByRole('dialog');
}

/** The drawer title's object, the text after its action badge. */
function drawerTitleObject(dialog: HTMLElement): string {
  const title = within(dialog).getByRole('heading');
  const badge = title.firstElementChild?.textContent ?? '';
  return (title.textContent ?? '').slice(badge.length);
}

/** The drawer's target-record line, `object / record`. */
function drawerTarget(dialog: HTMLElement): string {
  const caption = within(dialog).getByText('Target record');
  return caption.nextElementSibling?.textContent?.trim() ?? '';
}

describe('AuditLogPage — the Object column and drawer show the served object label', () => {
  it('labels each Object cell with its served label, and an unserved or unlabelled object with its stored name', async () => {
    renderPage();
    await waitFor(() => expect(objectCells()).toHaveLength(LEDGER.length));

    expect(objectCells()).toEqual(['客户', 'nightly_widget', 'crm_blank', '—']);
  });

  it("names a served object by its label in the drawer's title and target line", async () => {
    renderPage();
    await waitFor(() => expect(objectCells()).toHaveLength(LEDGER.length));

    const dialog = await openDrawer(0);
    expect(drawerTitleObject(dialog)).toBe('客户');
    expect(drawerTarget(dialog)).toBe('客户 / acc_1');
  });

  it("names an unserved object by its stored name in the drawer's title and target line", async () => {
    renderPage();
    await waitFor(() => expect(objectCells()).toHaveLength(LEDGER.length));

    const dialog = await openDrawer(1);
    expect(drawerTitleObject(dialog)).toBe('nightly_widget');
    expect(drawerTarget(dialog)).toBe('nightly_widget / wid_1');
  });

  it('shows stored names when the metadata serves no objects', async () => {
    METADATA.objects = [];
    renderPage();
    await waitFor(() => expect(objectCells()).toHaveLength(LEDGER.length));

    expect(objectCells()).toEqual(['crm_account', 'nightly_widget', 'crm_blank', '—']);
  });

  it('keeps the Object filter on its Label (name) choices', async () => {
    renderPage();
    await waitFor(() => expect(objectCells()).toHaveLength(LEDGER.length));

    await act(async () => {
      fireEvent.click(screen.getByRole('combobox', { name: 'Object' }));
    });
    const options = (await screen.findAllByRole('option')).map((o) => o.textContent);
    expect(options).toContain('客户 (crm_account)');
    expect(options).toContain('crm_blank');
  });
});

/** The Record cell's text, by row. */
function recordCells(): string[] {
  return bodyRows().map((row) => row.querySelectorAll('td')[3]?.textContent ?? '');
}

/**
 * objectstack#33864 — the Record column names the audited record by its
 * display name (`ux-conventions.labels-over-machine-names`), read through the
 * grid's batched `referenceVia` pointer resolver (`record_id` is the id half
 * of the pair `object_name` types). The raw id stays the cell's tooltip.
 */
describe('AuditLogPage — the Record column names the audited record (objectstack#33864)', () => {
  it("shows a readable record's display name, the raw id as its tooltip", async () => {
    renderPage();
    await waitFor(() => expect(recordCells()[0]).toBe('Acme Corp'));
    const cell = bodyRows()[0]!.querySelectorAll('td')[3]!;
    expect(cell.querySelector('[data-record-pointer="readable"]')).toHaveAttribute('title', 'acc_1');
    expect(recordCells()[0]).not.toContain('acc_1');
  });

  it('CONTROL: a record no read answers reads as unavailable, never as a bare id; a row with no record shows the dash', async () => {
    renderPage();
    await waitFor(() => expect(recordCells()[1]).toBe('nightly_widget · record unavailable'));
    const cell = bodyRows()[1]!.querySelectorAll('td')[3]!;
    expect(cell.querySelector('[data-record-pointer="unreadable"]')).toHaveAttribute('title', 'wid_1');
    expect(recordCells()[3]).toBe('—');
  });
});
