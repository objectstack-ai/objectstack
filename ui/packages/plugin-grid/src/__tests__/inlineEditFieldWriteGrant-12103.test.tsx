/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12103 — a list's in-cell edit asks the CALLER's field write grant.
 *
 * `inlineEditPermissionGate.test.tsx` owns the OBJECT-level half (the grid is
 * editable at all only when the caller holds `update`), and stubs the field
 * question out of the way. This file owns the FIELD-level half, through the
 * REAL `MePermissionsProvider` and the envelope measured on a live backend:
 * `allowEdit: true`, `allowTransfer: false`, and
 * `{ readable: true, editable: false }` for one field. The server refuses a
 * PATCH of that field and of the owner with 403; before this change both cells
 * opened an editor anyway.
 *
 * The observable is the user's: does clicking the cell open an editor, and
 * does the cell carry the editable cursor `data-table` draws only for a column
 * it will open.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SystemFieldName } from '@objectstack/spec/system';
import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'crm_account';
const OWNER = SystemFieldName.OWNER_ID;

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The measured envelope: may edit the object, may not edit annual revenue, may not transfer. */
function envelope(objectBits: Record<string, boolean> = {}): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u-rep',
    tenantId: null,
    roles: [],
    permissionSets: ['rep'],
    objects: {
      [OBJECT]: {
        allowRead: true,
        allowCreate: false,
        allowEdit: true,
        allowDelete: false,
        allowTransfer: false,
        ...objectBits,
      },
    },
    fields: { [`${OBJECT}.annual_revenue`]: { readable: true, editable: false } },
  };
}

function makeDataSource() {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Acme', annual_revenue: '5000', [OWNER]: 'Alice' },
  };
  return {
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ ...store[id] })),
    update: vi.fn(async (_o: string, id: string, changes: Record<string, any>) => ({ ...store[id], ...changes })),
    getObjectSchema: async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        annual_revenue: { type: 'text', label: 'Annual revenue' },
        // Typed `text` here so the cell's editor is an <input> the test can
        // see; the platform's owner is a lookup, and the gate keys on the
        // field, not on its type.
        [OWNER]: { type: 'text', label: 'Owner' },
      },
    }),
  } as any;
}

function renderGrid(perms: MePermissionsResponse | null) {
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    editable: true,
    singleClickEdit: true,
    columns: [
      { field: 'name', label: 'Name', type: 'text' },
      { field: 'annual_revenue', label: 'Annual revenue', type: 'text' },
      { field: OWNER, label: 'Owner', type: 'text' },
    ],
    pagination: { pageSize: 50 },
  };
  const grid = (
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} onEdit={() => {}} onDelete={() => {}} />
      </SchemaRendererProvider>
    </ActionProvider>
  );
  return render(perms ? <MePermissionsProvider initialPermissions={perms}>{grid}</MePermissionsProvider> : grid);
}

/** The cell showing `text` in the first body row. */
async function cell(text: string): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());
  const row = document.querySelector('tbody tr') as HTMLElement;
  const td = Array.from(row.querySelectorAll('td')).find((c) => c.textContent?.trim() === text);
  if (!td) throw new Error(`no cell reads ${text}`);
  return td as HTMLElement;
}

/** Click the cell and report whether an in-cell editor opened. */
async function opensEditor(text: string): Promise<boolean> {
  const td = await cell(text);
  // `data-table` draws the editable cursor only on a column it will open.
  const offered = td.className.includes('cursor-text');
  fireEvent.click(td);
  await new Promise((r) => setTimeout(r, 50));
  const opened = td.querySelector('input') != null;
  // The two observables agree, or the probe cannot tell the shapes apart.
  expect(opened, `${text}: cursor and editor disagree`).toBe(offered);
  return opened;
}

describe("a list's in-cell edit asks the field write grant (objectui#12103)", () => {
  it('a field marked editable: false keeps a read cell', async () => {
    renderGrid(envelope());
    expect(await opensEditor('5000')).toBe(false);
  });

  it('the owner field without the transfer grant keeps a read cell', async () => {
    renderGrid(envelope());
    expect(await opensEditor('Alice')).toBe(false);
  });

  it('the owner field WITH the transfer grant opens its editor', async () => {
    renderGrid(envelope({ allowTransfer: true }));
    expect(await opensEditor('Alice')).toBe(true);
  });

  it('CONTROL: an editable field in the same row is unchanged', async () => {
    renderGrid(envelope());
    expect(await opensEditor('Acme')).toBe(true);
  });

  it('CONTROL: with no permission provider every column edits, as before', async () => {
    renderGrid(null);
    expect(await opensEditor('5000')).toBe(true);
    cleanup();
    renderGrid(null);
    expect(await opensEditor('Alice')).toBe(true);
  });
});
