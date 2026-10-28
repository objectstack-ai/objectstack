/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27138 — the record page's in-place edit reads the row's own
 * write verdict from the same record projection the edit dialog reads.
 *
 * The persona may edit `rfa_contract` (the object grant allows edit) and the
 * projection lists `region` and `summary` as editable at field level; the
 * record is a row shared to them for reading only, so the server answers
 * `writable: false`. Rows, for `record:details` and for `record:highlights`:
 *   - `writable: false` → no field edits in place;
 *   - CONTROL `writable: true` → the `editable` fields edit in place, as before.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HighlightFieldsProvider, InlineEditProvider, RecordContextProvider, useInlineEdit } from '@object-ui/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordDetailsRenderer } from '../record-details';
import { RecordHighlightsRenderer } from '../record-highlights';

const OBJECT = 'rfa_contract';
const FIELDS = ['region', 'summary', 'ref_no'];

const OBJECT_SCHEMA = {
  name: OBJECT,
  label: 'Contract',
  // The title field the details body draws in the header, not as a row.
  nameField: 'name',
  highlightFields: FIELDS,
  fields: {
    name: { type: 'text', label: 'Name' },
    region: { type: 'text', label: 'Region' },
    summary: { type: 'text', label: 'Summary' },
    ref_no: { type: 'text', label: 'Reference number' },
  },
};

const PRINCIPAL: MePermissionsResponse = {
  authenticated: true,
  userId: 'u-1',
  tenantId: null,
  roles: ['finance'],
  permissionSets: ['rfa_fixture_member'],
  objects: { [OBJECT]: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: false } },
  // As `/auth/me/permissions` serves them: the conditioned entry as its lock.
  fields: {
    [`${OBJECT}.summary`]: { readable: true, editable: false },
    [`${OBJECT}.ref_no`]: { readable: true, editable: false },
  },
} as MePermissionsResponse;

const RECORD = { id: 'c1', name: 'MSA', region: 'EMEA', summary: 'Draft terms', ref_no: 'R-1' };

const ACCESS = {
  notWritable: { object: OBJECT, recordId: 'c1', readable: ['id', ...FIELDS], editable: ['region', 'summary'], writable: false },
  writable: { object: OBJECT, recordId: 'c1', readable: ['id', ...FIELDS], editable: ['region', 'summary'], writable: true },
};

function makeDS(access: (typeof ACCESS)[keyof typeof ACCESS], withMethod = true) {
  const listeners = new Set<(e: any) => void>();
  return {
    getObjectSchema: vi.fn(async () => OBJECT_SCHEMA),
    findOne: vi.fn(async () => ({ ...RECORD })),
    find: vi.fn(async () => ({ data: [] })),
    update: vi.fn(async (resource: string, id: string, data: any) => {
      const record = { ...RECORD, ...data };
      // As the adapter does: every successful write is reported to `onMutation` subscribers.
      for (const listener of listeners) listener({ type: 'update', resource, id, record });
      return record;
    }),
    onMutation: (listener: (e: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ...(withMethod ? { getRecordFieldAccess: vi.fn(async () => access) } : {}),
  };
}

/** Opens the page's inline-edit session, as the pencil does. */
function EnterEdit() {
  const inline = useInlineEdit();
  return <button type="button" onClick={() => inline?.enter()}>enter-edit</button>;
}

const BLOCKS = [
  { block: 'record:details', mount: () => <RecordDetailsRenderer schema={{} as never} /> },
  { block: 'record:highlights', mount: () => <RecordHighlightsRenderer schema={{ fields: FIELDS } as never} /> },
];

function renderPage(ds: ReturnType<typeof makeDS>, block: React.ReactNode, canEdit = true) {
  return render(
    <MePermissionsProvider initialPermissions={PRINCIPAL}>
      <RecordContextProvider
        objectName={OBJECT}
        recordId={RECORD.id}
        data={RECORD}
        objectSchema={OBJECT_SCHEMA}
        dataSource={ds as never}
      >
        <HighlightFieldsProvider>
          <InlineEditProvider canEdit={canEdit}>
            <EnterEdit />
            {block}
          </InlineEditProvider>
        </HighlightFieldsProvider>
      </RecordContextProvider>
    </MePermissionsProvider>,
  );
}

/** With the session open: which fields draw an input (edit in place) rather than their read display. */
function editable(): Record<string, boolean> {
  return {
    region: screen.queryByDisplayValue(RECORD.region) !== null,
    summary: screen.queryByDisplayValue(RECORD.summary) !== null,
    ref_no: screen.queryByDisplayValue(RECORD.ref_no) !== null,
  };
}

async function enterSession() {
  await screen.findByText(RECORD.summary);
  fireEvent.click(screen.getByText('enter-edit'));
}

beforeAll(() => Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 }));

beforeEach(() => {
  // `useRecordEditable` probes `POST /api/v1/security/explain`; serve it from a
  // double so no real socket opens. Its answer is orthogonal to the field locks.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true }),
    text: async () => '{"allowed":true}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe.each(BLOCKS)('[#27138] $block', ({ mount }) => {
  it('on a row the caller may read but not write, no field edits in place', async () => {
    const ds = makeDS(ACCESS.notWritable);
    renderPage(ds, mount());
    await enterSession();
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalledWith(OBJECT, 'c1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(editable()).toEqual({ region: false, summary: false, ref_no: false }));
  });

  it('CONTROL — on a writable row the editable fields edit in place', async () => {
    const ds = makeDS(ACCESS.writable);
    renderPage(ds, mount());
    await enterSession();
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalledWith(OBJECT, 'c1'));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await waitFor(() => expect(editable()).toEqual({ region: true, summary: true, ref_no: false }));
  });
});
