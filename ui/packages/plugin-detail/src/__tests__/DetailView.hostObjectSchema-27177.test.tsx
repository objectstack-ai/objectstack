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
import { RecordContextProvider } from '@object-ui/react';
import { DetailView } from '../DetailView';
import { __clearRecordEditableCache } from '../useRecordEditable';
import type { DetailViewSchema } from '@object-ui/types';

/**
 * Under `recordFromHost`, field types come from the host's object schema until
 * a dataSource answers.
 *
 * A host that renders a record with no dataSource bound (the Studio page
 * designer) holds the object schema in its record context, and `DetailView`
 * only ever learned field types from `dataSource.getObjectSchema`. A bare-name
 * section entry then had no type: a `select` drew its stored code and a
 * `location` drew `[Object]`. The canvas end of this is
 * `PagePreview.authoredDetailsValues-27177.test.tsx` in app-shell.
 */

const fieldsWith = (amerLabel: string) => ({
  name: { type: 'text', label: 'Name' },
  sales_region: {
    type: 'select',
    label: 'Sales Region',
    options: [{ value: 'amer', label: amerLabel }, { value: 'emea', label: 'Europe' }],
  },
  headquarters: { type: 'location', label: 'Headquarters' },
});
const hostSchema = { name: 'account', fields: fieldsWith('Americas') };

const RECORD = {
  id: 'A1',
  name: 'Northwind',
  sales_region: 'amer',
  headquarters: { latitude: 37.7749, longitude: -122.4194 },
};

// Bare-name entries, as `record:details` hands an authored section over.
const schema: DetailViewSchema = {
  type: 'detail-view',
  objectName: 'account',
  resourceId: 'A1',
  showHeader: false,
  data: RECORD,
  sections: [{ title: 'Details', fields: [{ name: 'sales_region' }, { name: 'headquarters' }] }],
};

function makeDataSource(objectSchema: unknown) {
  return {
    find: vi.fn(async () => ({ data: [] })),
    findOne: vi.fn(async () => RECORD),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: vi.fn(async () => objectSchema),
  };
}

const withHost = (node: React.ReactNode, objectSchema: unknown = hostSchema) => (
  <RecordContextProvider objectName="account" recordId="A1" data={RECORD} objectSchema={objectSchema}>
    {node}
  </RecordContextProvider>
);

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('DetailView: recordFromHost takes field types from the host object schema', () => {
  // The edit probe (`POST /security/explain`) rides the global fetch.
  beforeEach(() => {
    __clearRecordEditableCache();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ record: { visible: true } }) })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('with no dataSource, draws a select by its option label and a location as coordinates', async () => {
    const { container } = render(withHost(<DetailView schema={schema} recordFromHost />));
    await waitFor(() => expect(screen.getByText('Americas')).toBeInTheDocument());
    expect(screen.getByText(/37\.7749, -122\.4194/)).toBeInTheDocument();
    expect(screen.queryByText('amer')).toBeNull();
    expect(container.textContent).not.toContain('[Object]');
  });

  it('CONTROL: a dataSource answer still wins over the host schema, and it is the one read', async () => {
    const ds = makeDataSource({ name: 'account', fields: fieldsWith('Americas (from the dataSource)') });
    render(withHost(<DetailView schema={schema} dataSource={ds as never} recordFromHost />));
    await waitFor(() => expect(screen.getByText('Americas (from the dataSource)')).toBeInTheDocument());
    expect(screen.queryByText('Americas')).toBeNull();
    expect(ds.getObjectSchema).toHaveBeenCalledTimes(1);
    expect(ds.findOne).not.toHaveBeenCalled();
  });

  it('CONTROL: with no record context, or without recordFromHost, it draws what it drew before', async () => {
    const bare = render(<DetailView schema={schema} recordFromHost />);
    await settle();
    expect(bare.getByText('amer')).toBeInTheDocument();
    expect(bare.queryByText('Americas')).toBeNull();
    bare.unmount();

    const notFromHost = render(withHost(<DetailView schema={schema} />));
    await settle();
    expect(notFromHost.getByText('amer')).toBeInTheDocument();
    expect(notFromHost.queryByText('Americas')).toBeNull();
  });
});
