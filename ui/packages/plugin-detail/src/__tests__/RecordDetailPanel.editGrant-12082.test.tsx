/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12082 — the record overlay's inline edit reads the `recordEdit` row
 * of the affordance-to-grant map, at its one seam: `RecordDetailPanel`.
 *
 * The calendar, the kanban and the gantt each mount `RecordDetailPanel` as the
 * record overlay and hand it an `onFieldSave` that writes the record. The panel
 * opened its inline-edit session on that handler's PRESENCE alone, so the
 * object-level verdict the record page reads for the same in-place edit — the
 * object's policy, the server's effective operation set and the caller's update
 * grant — was never asked of the overlay. Since objectui#12103 each field of
 * the body asks the row's FIELD question, which closes the plain read-only
 * shape (no field entry → `allowEdit`), but not the three object-level layers:
 * a field the permission set names `editable: true` under an object grant
 * without `allowEdit`, an operation set without `update`, and an object policy
 * that closes edit all still offered the editors, and the server refused the
 * write.
 *
 * Measured through the REAL panel, `DetailView` and `MePermissionsProvider`:
 * an affordance is offered when a double-click on a field value enters the
 * edit session (an input carrying the value appears).
 */
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { RecordDetailPanel } from '../RecordDetailPanel';

const OBJECT = 'crm_opportunity';
const RECORD = { id: 'o1', name: 'Acme renewal', note: 'Call back in May' };
const FIELDS = { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, note: { type: 'text', label: 'Note' } };

const SHAPES: Array<{ shape: string; bits: Record<string, boolean>; update: boolean }> = [
  { shape: 'create-only', bits: { allowCreate: true, allowRead: true, allowEdit: false, allowDelete: false }, update: false },
  { shape: 'edit-only', bits: { allowCreate: false, allowRead: true, allowEdit: true, allowDelete: false }, update: true },
  { shape: 'read-only', bits: { allowCreate: false, allowRead: true, allowEdit: false, allowDelete: false }, update: false },
  { shape: 'full', bits: { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true }, update: true },
];

const FULL = SHAPES[3].bits;

/**
 * The caller's permissions. `named` adds an explicit `editable: true` entry for
 * the field, so the field question answers yes and only the object-level row
 * can decide.
 */
const envelope = (bits: Record<string, unknown>, named = true): MePermissionsResponse => ({
  authenticated: true,
  userId: 'u-pin',
  tenantId: null,
  roles: ['member'],
  permissionSets: ['member'],
  objects: { [OBJECT]: bits as never },
  fields: named ? { [`${OBJECT}.note`]: { readable: true, editable: true } } : {},
});

beforeAll(() => {
  // useIsMobile() keys off window.innerWidth; pin a desktop width so the
  // read-mode desktop row (which carries the affordance) renders.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});
beforeEach(() => {
  // The record-level explain probe the record header asks (useRecordEditable),
  // served from a double that answers `visible: true`, so it moves nothing here.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Mount the overlay payload with a live `onFieldSave`, as the three hosts do. */
function mount(perms: MePermissionsResponse | null, objectSchema: Record<string, unknown> = { name: OBJECT, fields: FIELDS }) {
  const panel = (
    <RecordDetailPanel
      record={RECORD}
      objectName={OBJECT}
      recordId={RECORD.id}
      objectSchema={objectSchema as never}
      onFieldSave={vi.fn()}
    />
  );
  render(perms ? <MePermissionsProvider initialPermissions={perms}>{panel}</MePermissionsProvider> : panel);
}

/** Does a double-click on the field value open an editor for it? */
function inlineEditOffered(): boolean {
  fireEvent.doubleClick(screen.getByText(RECORD.note));
  return screen.queryByDisplayValue(RECORD.note) !== null;
}

describe.each(SHAPES)('the record overlay under a $shape grant (objectui#12082)', ({ bits, update }) => {
  it('inline edit is offered exactly when the update grant allows it', () => {
    mount(envelope(bits));
    expect(inlineEditOffered()).toBe(update);
  });
});

describe("the record overlay: the map's other layers and fail-open (objectui#12082)", () => {
  it('an effective operation set without update withholds inline edit under the full grant', () => {
    mount(envelope({ ...FULL, apiOperations: ['get', 'list', 'create', 'delete'] }));
    expect(inlineEditOffered()).toBe(false);
  });

  it("an object policy that closes edit withholds inline edit under the full grant", () => {
    mount(envelope(FULL), { name: OBJECT, fields: FIELDS, userActions: { edit: false } });
    expect(inlineEditOffered()).toBe(false);
  });

  it('CONTROL: the plain read-only shape (no field entry) was already closed by the field question', () => {
    mount(envelope(SHAPES[2].bits, false));
    expect(inlineEditOffered()).toBe(false);
  });

  it('CONTROL: the full grant with the full operation set offers inline edit', () => {
    mount(envelope({ ...FULL, apiOperations: ['get', 'list', 'create', 'update', 'delete'] }));
    expect(inlineEditOffered()).toBe(true);
  });

  it('fail-open: with no permission provider inline edit is offered, as before', () => {
    mount(null);
    expect(inlineEditOffered()).toBe(true);
  });
});
