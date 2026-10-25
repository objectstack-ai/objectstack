/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * `recordFromHost` (objectui#12701): the host reads the record, so the view
 * never does.
 *
 * On a record page the page reads its record with every relation it expands,
 * and the `record:details` body used to read the same row again — narrower,
 * while the page's read was still on the wire — because the page's record had
 * not reached it yet. With the prop the body waits for `schema.data` instead.
 * The record page's side (one record read per open, counted on the wire) is
 * `RecordDetailView.recordOpenRequests-12701.test.tsx` in app-shell.
 */

const objectSchema = {
  name: 'deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    account: { type: 'lookup', label: 'Account', reference: 'account' },
  },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => ({ id: 'D1', name: 'Read by the view itself' })),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectSchema),
  };
}

const schemaFor = (data?: Record<string, unknown>, resourceId: string | null = 'D1'): DetailViewSchema => ({
  type: 'detail-view',
  objectName: 'deal',
  resourceId: resourceId ?? undefined,
  showHeader: false,
  data,
  sections: [{ title: 'Basics', fields: [{ name: 'name', label: 'Name' }, { name: 'account', label: 'Account' }] }],
});

describe('DetailView — recordFromHost: the host reads the record (objectui#12701)', () => {
  // The edit probe (`POST /security/explain`) rides the global fetch; answer it
  // from a double, as `DetailView.invalidation.test.tsx` does.
  beforeEach(() => {
    __clearRecordEditableCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('reads nothing while the host record is on its way, then renders the host record', async () => {
    const ds = makeDataSource();
    const { rerender } = render(<DetailView schema={schemaFor(undefined)} dataSource={ds as never} recordFromHost />);

    // Waiting: the loading state, not "not found", and no read of its own.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('Record not found')).not.toBeInTheDocument();
    expect(ds.findOne).not.toHaveBeenCalled();

    rerender(<DetailView schema={schemaFor({ id: 'D1', name: 'Handed over by the page' })} dataSource={ds as never} recordFromHost />);

    await waitFor(() => expect(screen.getByText('Handed over by the page')).toBeInTheDocument());
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('a host that names no record has none coming: the view draws exactly what it drew without the prop', async () => {
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const plainDs = makeDataSource();
    const plain = render(<DetailView schema={schemaFor(undefined, null)} dataSource={plainDs as never} />);
    await settle();
    const without = plain.container.innerHTML;
    plain.unmount();

    const hostDs = makeDataSource();
    const hosted = render(<DetailView schema={schemaFor(undefined, null)} dataSource={hostDs as never} recordFromHost />);
    await settle();

    expect(hosted.container.innerHTML).toBe(without);
    expect(plainDs.findOne).not.toHaveBeenCalled();
    expect(hostDs.findOne).not.toHaveBeenCalled();
  });

  it('CONTROL: without the prop the view reads its record itself, as before', async () => {
    const ds = makeDataSource();
    render(<DetailView schema={schemaFor(undefined)} dataSource={ds as never} />);

    await waitFor(() => expect(screen.getByText('Read by the view itself')).toBeInTheDocument());
    expect(ds.findOne).toHaveBeenCalledTimes(1);
    expect(ds.findOne).toHaveBeenCalledWith('deal', 'D1', { $expand: ['account'] });
  });
});
