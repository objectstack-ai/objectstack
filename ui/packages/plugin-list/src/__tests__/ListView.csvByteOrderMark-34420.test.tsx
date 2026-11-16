/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list view's client-side CSV export starts with the UTF-8 byte-order
 * mark (objectstack#34420).
 *
 * Excel reads a CSV with no mark in the system code page, so a file holding
 * Chinese (or any non-ASCII) text opens garbled. The fallback path — taken
 * when the data source has no `exportDownload` — builds the file in the
 * browser, so the mark is this writer's to put there. The pin reads the
 * downloaded Blob's BYTES, not `text()`, because the mark is a byte-level
 * fact a decoder may hide.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, cleanup, waitFor } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import { SchemaRendererProvider } from '@object-ui/react';
import type { ListViewSchema } from '@object-ui/types';
import { ListView } from '../ListView';

const ROWS = [{ id: '1', name: '张三', industry: 'tech' }];
const OBJECT_DEF = {
  name: 'account',
  fields: {
    name: { type: 'text', label: 'Name' },
    industry: { type: 'text', label: 'Industry' },
  },
};

let blobs: Blob[] = [];
let prevObjectGrid: unknown;

function makeDataSource() {
  // No `exportDownload`: that is what sends the export to the client fallback.
  return {
    find: vi.fn().mockResolvedValue({ data: ROWS, total: ROWS.length }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue(OBJECT_DEF),
  };
}

/** The file body after exactly one UTF-8 byte-order mark. */
async function bodyAfterOneMark(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(Array.from(bytes.slice(0, 3)), 'the file opens with the bytes EF BB BF').toEqual([0xef, 0xbb, 0xbf]);
  const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(3));
  expect(body.charCodeAt(0), 'exactly one mark: no second one follows').not.toBe(0xfeff);
  return body;
}

beforeAll(() => {
  // plugin-grid is not a dependency of plugin-list, so the child view is a stub.
  prevObjectGrid = ComponentRegistry.get('object-grid');
  ComponentRegistry.register('object-grid', () => <div data-testid="grid-stub" />);
});
afterAll(() => {
  if (prevObjectGrid) ComponentRegistry.register('object-grid', prevObjectGrid as never);
  else ComponentRegistry.unregister('object-grid');
});
beforeEach(() => {
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
    blobs.push(blob as Blob);
    return 'blob:objectstack-34420';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('ListView client CSV export — UTF-8 byte-order mark (objectstack#34420)', () => {
  it('the downloaded file starts with EF BB BF, once, and the non-ASCII value follows intact', async () => {
    const dataSource = makeDataSource();
    const schema = {
      type: 'list-view',
      compactToolbar: false,
      objectName: 'account',
      viewType: 'grid',
      columns: ['name', 'industry'],
      exportOptions: { formats: ['csv'] },
    } as unknown as ListViewSchema;
    render(
      <SchemaRendererProvider dataSource={dataSource as never}>
        <ListView schema={schema} dataSource={dataSource as never} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /export/i }));
    fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
    await waitFor(() => expect(blobs.length, 'CONTROL: the export produced a file').toBe(1));

    const body = await bodyAfterOneMark(blobs[0]!);
    expect(body.split('\n')[0], 'CONTROL: the header row follows the mark').toBe('name,industry');
    expect(body).toContain('张三,tech');
  });
});
