/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Coverage for the detail-page related list becoming interactive: the
 * `record:related_list` renderer must wire the host-provided CRUD + action
 * handlers (view / create / edit / delete / row actions) onto `RelatedList`,
 * scoped to the child object + parent relationship. With no host provider it
 * stays read-only (only the legacy `add`-based remove survives).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';
import {
  RecordContextProvider,
  RelatedRecordActionsProvider,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { RecordRelatedListRenderer } from '../renderers/record-related-list';

// Capture the props the renderer passes to RelatedList.
const h = vi.hoisted(() => ({ captured: null as any }));
vi.mock('../RelatedList', () => ({
  RelatedList: (props: any) => {
    h.captured = props;
    return null;
  },
}));

const ds = { find: vi.fn(async () => []), delete: vi.fn(async () => undefined) };

function renderWith(value: RelatedRecordActionsValue | null) {
  return render(
    <RecordContextProvider objectName="account" recordId="ACC-1" dataSource={ds as any}>
      {value ? (
        <RelatedRecordActionsProvider value={value}>
          <RecordRelatedListRenderer schema={{ objectName: 'contact', relationshipField: 'account_id' }} />
        </RelatedRecordActionsProvider>
      ) : (
        <RecordRelatedListRenderer schema={{ objectName: 'contact', relationshipField: 'account_id' }} />
      )}
    </RecordContextProvider>,
  );
}

beforeEach(() => {
  h.captured = null;
  ds.delete.mockClear();
});

describe('RecordRelatedListRenderer — host CRUD + action wiring', () => {
  it('wires view / create / edit / delete from the host, scoped to child + parent', () => {
    const onView = vi.fn();
    const onCreate = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const resolve = vi.fn(() => ({ onView, onCreate, onEdit, onDelete }));

    renderWith({ resolve });

    // resolve() is called with the child object + relationship + parent id.
    expect(resolve).toHaveBeenCalledWith({
      objectName: 'contact',
      relationshipField: 'account_id',
      parentId: 'ACC-1',
    });

    const p = h.captured;
    expect(typeof p.onNew).toBe('function');
    expect(typeof p.onRowClick).toBe('function');
    expect(typeof p.onRowEdit).toBe('function');
    expect(typeof p.onRowDelete).toBe('function');

    // Row click opens the child detail; edit/delete target the row's id.
    p.onRowClick({ id: 'c1', name: 'Alice' });
    expect(onView).toHaveBeenCalledWith('c1', { id: 'c1', name: 'Alice' });

    p.onNew();
    expect(onCreate).toHaveBeenCalledTimes(1);

    p.onRowEdit({ _id: 'c2' });
    expect(onEdit).toHaveBeenCalledWith('c2', { _id: 'c2' });

    p.onRowDelete({ id: 'c3' });
    expect(onDelete).toHaveBeenCalledWith('c3', { id: 'c3' });
  });

  it('passes the child object row actions through to RelatedList', () => {
    const onRowAction = vi.fn();
    const rowActions = [{ name: 'send_welcome', label: 'Send Welcome' }];
    renderWith({ resolve: () => ({ rowActions, onRowAction }) });

    expect(h.captured.rowActions).toEqual(rowActions);
    expect(h.captured.onRowAction).toBe(onRowAction);
  });

  it('omits an affordance the host does not grant (e.g. create denied)', () => {
    // Host grants only view (append-only child): no New / Edit button.
    renderWith({ resolve: () => ({ onView: vi.fn() }) });
    expect(h.captured.onNew).toBeUndefined();
    expect(h.captured.onRowEdit).toBeUndefined();
    expect(typeof h.captured.onRowClick).toBe('function');
  });

  it('stays read-only with no host provider (only add-based remove wiring applies)', () => {
    renderWith(null);
    expect(h.captured.onNew).toBeUndefined();
    expect(h.captured.onRowClick).toBeUndefined();
    expect(h.captured.onRowEdit).toBeUndefined();
    // No `add` config + no host → delete stays unwired.
    expect(h.captured.onRowDelete).toBeUndefined();
  });
});
