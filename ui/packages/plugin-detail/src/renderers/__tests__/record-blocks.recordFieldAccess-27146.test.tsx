/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27146 (the residual of objectstack#26594, ruling B) — the record
 * page's in-place edit asks the server for THIS record's field projection, the
 * answer the record form's edit dialog already reads.
 *
 * The persona is the contract app's finance role: `summary` is locked from
 * `approved` onward (`FieldPermissionSchema.when`). `/auth/me/permissions`
 * holds no row, so it serves that entry as its lock, and before this card the
 * details body and the highlights strip disabled `summary` on the draft the
 * server lets the caller save. `ref_no` is locked on every row: the control
 * that a lock the server keeps stays locked.
 *
 * Rows, for `record:details` and for `record:highlights`, each under the record
 * page's providers (record context, inline-edit session):
 *   - a draft the server unlocks → `summary` edits in place, `ref_no` stays a
 *     read display;
 *   - an approved row → both stay read displays;
 *   - a save after which the server judges the row approved → asked again,
 *     and `summary` locks (the answer follows the stored row, not the mount);
 * and the controls:
 *   - a data source without the method keeps the row-blind lock;
 *   - a session that may not edit asks nothing.
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
  draft: { object: OBJECT, recordId: 'c1', readable: ['id', ...FIELDS], editable: ['region', 'summary'] },
  approved: { object: OBJECT, recordId: 'c1', readable: ['id', ...FIELDS], editable: ['region'] },
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

async function openSession() {
  await screen.findByText(RECORD.summary);
  fireEvent.click(screen.getByText('enter-edit'));
  await waitFor(() => expect(screen.getByDisplayValue(RECORD.region)).toBeInTheDocument());
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

describe.each(BLOCKS)('[#27146] $block', ({ mount }) => {
  it('on a draft the server unlocks, the conditioned field edits in place and the unconditioned lock holds', async () => {
    const ds = makeDS(ACCESS.draft);
    renderPage(ds, mount());
    await openSession();
    await waitFor(() => expect(editable()).toEqual({ region: true, summary: true, ref_no: false }));
    expect(ds.getRecordFieldAccess).toHaveBeenCalledWith(OBJECT, 'c1');
  });

  it('on a row the condition names, the field stays locked', async () => {
    const ds = makeDS(ACCESS.approved);
    renderPage(ds, mount());
    await openSession();
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalled());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(editable()).toEqual({ region: true, summary: false, ref_no: false });
  });

  it('a save that moves the row into the state the condition names locks the field again', async () => {
    const ds = makeDS(ACCESS.draft);
    renderPage(ds, mount());
    await openSession();
    await waitFor(() => expect(editable().summary).toBe(true));
    // The server now judges the stored row approved: the next answer locks `summary`.
    ds.getRecordFieldAccess!.mockResolvedValue(ACCESS.approved);
    await act(async () => { await ds.update(OBJECT, 'c1', { region: 'APAC' }); });
    await waitFor(() => expect(ds.getRecordFieldAccess).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(editable().summary).toBe(false));
    expect(editable().ref_no).toBe(false);
  });

  it('a data source without the method keeps the row-blind lock', async () => {
    const ds = makeDS(ACCESS.draft, false);
    renderPage(ds, mount());
    await openSession();
    expect(editable()).toEqual({ region: true, summary: false, ref_no: false });
  });

  it('a session that may not edit asks nothing', async () => {
    const ds = makeDS(ACCESS.draft);
    renderPage(ds, mount(), false);
    await screen.findByText(RECORD.summary);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(ds.getRecordFieldAccess).not.toHaveBeenCalled();
  });
});
