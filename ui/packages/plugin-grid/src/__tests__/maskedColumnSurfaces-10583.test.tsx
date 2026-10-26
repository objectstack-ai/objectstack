/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The OTHER grid surfaces a masked field's raw value reached (objectui#10583,
 * round 2). `maskedCellCopyRefusal-10583.test.tsx` pins the keyboard copy and
 * the tooltip; this file pins the three paths the contract review named:
 *
 *  1. INLINE EDIT — the editor was seeded with the raw row value. Reachable
 *     through the flag's own union: a view authoring `type: 'password'` over an
 *     object `text` field (or over no field def at all) is masked, while the
 *     object-level `isFieldInlineEditable` gate reads only the object's type.
 *  2. THE GRID'S CLIENT EXPORT — the `exportOptions` menu's fallback, taken
 *     when the data source has no `exportDownload`: CSV wrote every column's
 *     raw value and JSON wrote whole records.
 *  3. THE MOBILE CARD — the title row printed the first column raw, and the
 *     amount / stage branches, chosen by the field's NAME, printed it too.
 *  4. GROUPING (round 3) — a grouping entry on a masked field printed the raw
 *     value as the group label. The entry is now REFUSED (dropped, with a
 *     warning), not masked: masked labels would still bucket the records that
 *     share a credential, in its raw order.
 *
 * Each case carries a control in the same mounted tree (an ordinary field
 * edits, exports, draws), and the export pins carry a grid with no masked
 * field whose files are byte-identical to what the fallback always wrote.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const MASK = '••••••';
const CONTROL_VALUE = 'Row one';
const RAW = {
  password: 'RAW-PASSWORD-10583',
  secret: 'RAW-SECRET-10583',
  vault: 'RAW-VAULT-10583',
  pin: 'RAW-PIN-10583',
  hidden: 'RAW-HIDDEN-10583',
  secretValue: 'RAW-SECRET-VALUE-10583',
  status: 'RAW-STATUS-10583',
};

const ORIGINAL_INNER_WIDTH = window.innerWidth;
const setWidth = (px: number) =>
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => setWidth(1280));

afterEach(() => {
  setWidth(ORIGINAL_INNER_WIDTH);
  vi.restoreAllMocks();
  cleanup();
});

function makeDataSource(rows: Record<string, unknown>[], fields: Record<string, unknown>) {
  // ⚠️ No `exportDownload`: that is what sends the grid's export to its client fallback.
  return {
    find: vi.fn(async () => ({ data: rows, total: rows.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields })),
  } as any;
}

function renderGrid(schema: Record<string, unknown>, ds?: any) {
  const grid = <ObjectGrid schema={{ type: 'object-grid', pagination: { pageSize: 50 }, ...schema } as any} dataSource={ds} />;
  return render(
    <ActionProvider>
      {ds ? <SchemaRendererProvider dataSource={ds}>{grid}</SchemaRendererProvider> : grid}
    </ActionProvider>,
  );
}

/** The body cell under the header whose text is `label`, in the control row. */
function cellUnder(label: string): HTMLElement {
  const row = screen.getByText(CONTROL_VALUE).closest('tr');
  expect(row, 'CONTROL: the data row rendered').not.toBeNull();
  const headers = Array.from(row!.closest('table')!.querySelectorAll('thead th'));
  const index = headers.findIndex((th) => (th.textContent ?? '').trim() === label);
  expect(index, `CONTROL: a "${label}" column header rendered`).toBeGreaterThanOrEqual(0);
  return row!.children[index] as HTMLElement;
}

const rawInAnEditor = (raw: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).some((el) =>
    el.value.includes(raw),
  );

/* ── 1. inline edit ──────────────────────────────────────────────────────── */

describe('ObjectGrid — a masked column opens no inline editor (objectui#10583)', () => {
  const ROWS = [{ id: 'r1', name: CONTROL_VALUE, pin: RAW.pin }];
  // The view authors `type: 'password'` over a field the object declares `text`.
  const COLUMNS = [
    { field: 'name', label: 'Name' },
    { field: 'pin', label: 'PIN', type: 'password' },
  ];

  const cases = [
    {
      name: 'over an object `text` field',
      render: () =>
        renderGrid(
          { objectName: 'masked_edit_probe', columns: COLUMNS, editable: true, singleClickEdit: true },
          makeDataSource(ROWS, { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, pin: { type: 'text', label: 'PIN' } }),
        ),
    },
    {
      name: 'over no field def (inline rows)',
      render: () =>
        renderGrid({ data: { provider: 'value', items: ROWS }, columns: COLUMNS, editable: true, singleClickEdit: true }),
    },
  ];

  for (const c of cases) {
    it(`view \`type: 'password'\` ${c.name} — click and Enter open no editor; the text control edits`, async () => {
      c.render();
      await waitFor(() => expect(screen.queryByText(CONTROL_VALUE)).not.toBeNull());

      const masked = cellUnder('PIN');
      expect(masked.textContent, 'CONTROL: the authored password type drew the mask').toContain(MASK);
      fireEvent.click(masked);
      fireEvent.keyDown(masked, { key: 'Enter' });
      expect(masked.querySelector('input, textarea'), 'no editor in the masked cell').toBeNull();
      expect(rawInAnEditor(RAW.pin), 'no editor holds the raw value').toBe(false);
      expect(document.body.innerHTML, 'the raw value is nowhere in the DOM').not.toContain(RAW.pin);

      // CONTROL — the text column in the same editable grid opens its editor.
      // Held by reference: once it edits, its text lives in an input value.
      const control = cellUnder('Name');
      fireEvent.click(control);
      await waitFor(() =>
        expect(control.querySelector('input, textarea'), 'CONTROL: the text cell edits').not.toBeNull(),
      );
    });
  }
});

/* ── 2. the grid's client export ─────────────────────────────────────────── */

describe("ObjectGrid — the client export leaves every masked field out (objectui#10583)", () => {
  let blobs: Blob[];

  beforeEach(() => {
    blobs = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:objectui-10583';
    });
    for (const target of new Set([globalThis.URL, window.URL])) {
      Object.defineProperty(target, 'createObjectURL', { configurable: true, value: createObjectURL });
      Object.defineProperty(target, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    }
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  async function exportAs(format: 'CSV' | 'JSON'): Promise<string> {
    const toolbarExport = screen
      .getAllByRole('button', { name: /export/i })
      .find((el) => !/export as/i.test(el.textContent ?? ''));
    expect(toolbarExport, 'CONTROL: the export menu button rendered').toBeDefined();
    fireEvent.click(toolbarExport!);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`export as ${format}`, 'i') }));
    await waitFor(() => expect(blobs.length, `CONTROL: the ${format} export produced a file`).toBeGreaterThan(0));
    return blobs.pop()!.text();
  }

  const MASKED_ROWS = [
    {
      id: 'r1',
      name: CONTROL_VALUE,
      notes: 'plain note',
      api_key: RAW.password,
      token: RAW.secret,
      vault_key: RAW.vault,
      pin: RAW.pin,
      hidden_secret: RAW.hidden,
    },
  ];
  const MASKED_FIELDS = {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    notes: { type: 'text', label: 'Notes' },
    api_key: { type: 'password', label: 'API Key' },
    token: { type: 'secret', label: 'Token' },
    vault_key: { type: 'secret', label: 'Vault Key' },
    pin: { type: 'text', label: 'PIN' },
    // Not a column: only the JSON branch (whole records) could carry it.
    hidden_secret: { type: 'secret', label: 'Hidden' },
  };
  const MASKED_COLUMNS = [
    { field: 'name', label: 'Name' },
    { field: 'notes', label: 'Notes' },
    { field: 'api_key', label: 'API Key' },
    { field: 'token', label: 'Token' },
    { field: 'vault_key', label: 'Vault Key', type: 'text' },
    { field: 'pin', label: 'PIN', type: 'password' },
  ];

  function renderExportGrid(rows: Record<string, unknown>[], fields: Record<string, unknown>, columns: unknown[]) {
    renderGrid(
      { objectName: 'masked_export_probe', columns, exportOptions: { formats: ['csv', 'json'] } },
      makeDataSource(rows, fields),
    );
  }

  it('CSV — no masked column, header and all; the ordinary columns are written', async () => {
    renderExportGrid(MASKED_ROWS, MASKED_FIELDS, MASKED_COLUMNS);
    await waitFor(() => expect(screen.queryByText(CONTROL_VALUE)).not.toBeNull());
    const csv = await exportAs('CSV');
    expect(csv.split('\n')[0], 'only the ordinary columns').toBe('Name,Notes');
    expect(csv, 'CONTROL: the ordinary values are written').toContain(`${CONTROL_VALUE},plain note`);
    for (const raw of Object.values(RAW)) expect(csv).not.toContain(raw);
  });

  it('JSON — no masked field in any record, column or not; the other fields are written', async () => {
    renderExportGrid(MASKED_ROWS, MASKED_FIELDS, MASKED_COLUMNS);
    await waitFor(() => expect(screen.queryByText(CONTROL_VALUE)).not.toBeNull());
    const json = JSON.parse(await exportAs('JSON'));
    expect(json, 'CONTROL: the unmasked fields are written').toEqual([{ id: 'r1', name: CONTROL_VALUE, notes: 'plain note' }]);
  });

  it('CONTROL — a grid with no masked field exports byte-for-byte what the fallback always wrote', async () => {
    const rows = [{ id: 'r1', name: CONTROL_VALUE, notes: 'plain note' }];
    renderExportGrid(
      rows,
      { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, notes: { type: 'text', label: 'Notes' } },
      [{ field: 'name', label: 'Name' }, { field: 'notes', label: 'Notes' }],
    );
    await waitFor(() => expect(screen.queryByText(CONTROL_VALUE)).not.toBeNull());
    expect(await exportAs('CSV')).toBe(`Name,Notes\n${CONTROL_VALUE},plain note`);
    expect(await exportAs('JSON')).toBe(JSON.stringify(rows, null, 2));
  });
});

/* ── 3. the mobile card ──────────────────────────────────────────────────── */

describe('ObjectGrid — the mobile card draws a masked field through its cell (objectui#10583)', () => {
  it('below 768px — a masked TITLE column and masked fields named like amount / stage draw the mask, never the value', async () => {
    setWidth(375);
    const rows = [
      { id: 'r1', api_key: RAW.password, name: CONTROL_VALUE, secret_value: RAW.secretValue, token_status: RAW.status },
    ];
    renderGrid(
      {
        objectName: 'masked_card_probe',
        // `api_key` FIRST — the card's title row. `secret_value` would classify
        // as an amount and `token_status` as a stage, by name.
        columns: [
          { field: 'api_key', label: 'API Key' },
          { field: 'name', label: 'Name' },
          { field: 'secret_value', label: 'Secret Value' },
          { field: 'token_status', label: 'Token Status' },
        ],
      },
      makeDataSource(rows, {
        id: { type: 'text' },
        api_key: { type: 'password', label: 'API Key' },
        name: { type: 'text', label: 'Name' },
        secret_value: { type: 'secret', label: 'Secret Value' },
        token_status: { type: 'secret', label: 'Token Status' },
      }),
    );
    await waitFor(() => expect(screen.queryByText(CONTROL_VALUE), 'CONTROL: the card drew the ordinary field').not.toBeNull());
    expect(document.querySelector('table'), 'CONTROL: this is the card layout, not the table').toBeNull();

    const html = document.body.innerHTML;
    for (const raw of [RAW.password, RAW.secretValue, RAW.status]) {
      expect(html, `${raw} is nowhere in the card`).not.toContain(raw);
    }
    const masks = (document.body.textContent ?? '').split(MASK).length - 1;
    expect(masks, 'the title and both named fields draw the mask').toBe(3);
  });
});

/* ── 4. grouping ─────────────────────────────────────────────────────────── */

describe('ObjectGrid — a masked field is refused as a grouping key (objectui#10583)', () => {
  const RAW_GROUP = 'RAW-GROUP-10643';
  // Two records SHARE the credential: a masked-label grouping would still say so.
  const ROWS = [
    { id: 'r1', name: CONTROL_VALUE, category: 'Alpha', api_key: RAW_GROUP },
    { id: 'r2', name: 'Row two', category: 'Beta', api_key: RAW_GROUP },
    { id: 'r3', name: 'Row three', category: 'Alpha', api_key: 'RAW-OTHER-10643' },
  ];
  const FIELDS = {
    id: { type: 'text' },
    name: { type: 'text', label: 'Name' },
    category: { type: 'text', label: 'Category' },
    api_key: { type: 'password', label: 'API Key' },
  };
  const COLUMNS = [
    { field: 'name', label: 'Name' },
    { field: 'category', label: 'Category' },
    { field: 'api_key', label: 'API Key' },
  ];
  const groupRows = () => Array.from(document.querySelectorAll('[data-testid^="group-row-"]'));

  // objectui#10881: a grouped grid that fetches its own rows groups only over
  // a data source that answers the group header query (a find-only one is
  // refused), so this one answers it by counting ROWS under the query's own
  // `groupBy`. A masked key never reaches that query: it is dropped from the
  // grouping before the header query is asked.
  const groupedDataSource = () => ({
    ...makeDataSource(ROWS, FIELDS),
    queryGroupHeaders: vi.fn(async (_object: string, query: { groupBy?: string[] }) => {
      const by = query.groupBy ?? [];
      const counts = new Map<string, number>();
      for (const row of ROWS as Array<Record<string, unknown>>) {
        const key = JSON.stringify(by.map((field) => row[field] ?? null));
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts].map(([key, count]) => {
        const values = JSON.parse(key) as unknown[];
        return { ...Object.fromEntries(by.map((field, i) => [field, values[i]])), count };
      });
    }),
  });

  function renderGrouped(fields: Array<{ field: string }>) {
    renderGrid(
      { objectName: 'masked_group_probe', columns: COLUMNS, grouping: { fields } },
      groupedDataSource(),
    );
  }

  it('CONTROL — grouping by a text field draws its values as group labels', async () => {
    renderGrouped([{ field: 'category' }]);
    await waitFor(() => expect(groupRows().length, 'CONTROL: the grid grouped').toBe(2));
    const labels = groupRows().map((g) => g.textContent ?? '');
    expect(labels.some((l) => l.includes('Alpha')) && labels.some((l) => l.includes('Beta'))).toBe(true);
  });

  it('grouping by a password field is refused: no group, no raw label, and a warning names the field', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderGrouped([{ field: 'api_key' }]);
    await waitFor(() => expect(screen.queryByText(CONTROL_VALUE), 'CONTROL: the rows rendered').not.toBeNull());
    expect(groupRows(), 'no group was built on the masked field').toHaveLength(0);
    expect(document.body.innerHTML).not.toContain(RAW_GROUP);
    expect(document.body.innerHTML).not.toContain('RAW-OTHER-10643');
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('ObjectGrid grouping') && String(call[0]).includes('api_key')),
      'the refusal is reported, naming the field',
    ).toBe(true);
  });

  it('a masked level is dropped and the other levels still group', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderGrouped([{ field: 'category' }, { field: 'api_key' }]);
    await waitFor(() => expect(groupRows().length, 'the category level still groups').toBe(2));
    expect(document.body.innerHTML).not.toContain(RAW_GROUP);
  });
});
