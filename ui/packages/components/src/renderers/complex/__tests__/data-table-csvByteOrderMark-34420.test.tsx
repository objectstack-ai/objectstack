/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The data table's CSV export starts with the UTF-8 byte-order mark
 * (objectstack#34420).
 *
 * Excel reads a CSV with no mark in the system code page, so a file holding
 * Chinese (or any non-ASCII) text opens garbled. The table builds its file in
 * the browser, so the mark is its to put there. The pin reads the downloaded
 * Blob's BYTES, not `text()`, because the mark is a byte-level fact a decoder
 * may hide.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

let createObjectURL: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:objectstack-34420');
  Object.defineProperty(window.URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(window.URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('data-table CSV export — UTF-8 byte-order mark (objectstack#34420)', () => {
  it('the downloaded file starts with EF BB BF, once, and the non-ASCII value follows intact', async () => {
    const DataTable = ComponentRegistry.get('data-table') as any;
    expect(DataTable, 'CONTROL: data-table is registered').toBeDefined();
    render(
      <DataTable
        schema={{
          type: 'data-table',
          data: [{ id: '1', name: '张三' }],
          columns: [{ header: 'Name', accessorKey: 'name' }],
          pagination: false,
          searchable: false,
          exportable: true,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }));
    expect(createObjectURL, 'CONTROL: the export produced a file').toHaveBeenCalledTimes(1);

    const bytes = new Uint8Array(await (createObjectURL.mock.calls[0]![0] as Blob).arrayBuffer());
    expect(Array.from(bytes.slice(0, 3)), 'the file opens with the bytes EF BB BF').toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(3));
    expect(body.charCodeAt(0), 'exactly one mark: no second one follows').not.toBe(0xfeff);
    expect(body, 'CONTROL: the header row and the record follow the mark').toBe('Name\n"张三"');
  });
});
