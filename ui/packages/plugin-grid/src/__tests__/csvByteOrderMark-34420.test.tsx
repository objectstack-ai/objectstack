/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The CSV files plugin-grid builds in the browser start with the UTF-8
 * byte-order mark (objectstack#34420).
 *
 * Excel reads a CSV with no mark in the system code page, so a file holding
 * Chinese (or any non-ASCII) text opens garbled. Two writers here build their
 * file client-side: the grid's export fallback (taken when the data source has
 * no `exportDownload`) and the bulk-action dialog's error CSV. Each pin reads
 * the downloaded Blob's BYTES, not `text()`, because the mark is a byte-level
 * fact a decoder may hide.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { BulkActionDef } from '@object-ui/types';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';
import { BulkActionDialog } from '../components/BulkActionDialog';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

registerAllFields();

let blobs: Blob[];

beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
  blobs = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:objectstack-34420';
  });
  for (const target of new Set([globalThis.URL, window.URL])) {
    Object.defineProperty(target, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(target, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  }
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  cleanup();
});

/** The file body after exactly one UTF-8 byte-order mark. */
async function bodyAfterOneMark(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect(Array.from(bytes.slice(0, 3)), 'the file opens with the bytes EF BB BF').toEqual([0xef, 0xbb, 0xbf]);
  const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(3));
  expect(body.charCodeAt(0), 'exactly one mark: no second one follows').not.toBe(0xfeff);
  return body;
}

describe('ObjectGrid client CSV export — UTF-8 byte-order mark (objectstack#34420)', () => {
  it('the downloaded file starts with EF BB BF, once, and the non-ASCII value follows intact', async () => {
    const rows = [{ id: 'r1', name: '张三', notes: '备注' }];
    const ds = {
      // No `exportDownload`: that is what sends the export to the client fallback.
      find: vi.fn(async () => ({ data: rows, total: rows.length, hasMore: false, pageSize: 50 })),
      getObjectSchema: vi.fn(async (name: string) => ({
        name,
        fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' }, notes: { type: 'text', label: 'Notes' } },
      })),
    } as any;
    render(
      <ActionProvider>
        <SchemaRendererProvider dataSource={ds}>
          <ObjectGrid
            schema={{
              type: 'object-grid',
              objectName: 'bom_probe',
              pagination: { pageSize: 50 },
              columns: [{ field: 'name', label: 'Name' }, { field: 'notes', label: 'Notes' }],
              exportOptions: { formats: ['csv'] },
            } as any}
            dataSource={ds}
          />
        </SchemaRendererProvider>
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.queryByText('张三')).not.toBeNull());

    const toolbarExport = screen
      .getAllByRole('button', { name: /export/i })
      .find((el) => !/export as/i.test(el.textContent ?? ''));
    expect(toolbarExport, 'CONTROL: the export menu button rendered').toBeDefined();
    fireEvent.click(toolbarExport!);
    fireEvent.click(await screen.findByRole('button', { name: /export as csv/i }));
    await waitFor(() => expect(blobs.length, 'CONTROL: the export produced a file').toBe(1));

    const body = await bodyAfterOneMark(blobs[0]!);
    expect(body, 'CONTROL: the header row and the record follow the mark').toBe('Name,Notes\n张三,备注');
  });
});

describe('BulkActionDialog error CSV — UTF-8 byte-order mark (objectstack#34420)', () => {
  it('the downloaded file starts with EF BB BF, once, and the non-ASCII refusal follows intact', async () => {
    const def = { name: 'mark_done', label: 'Mark Done', operation: 'update', patch: { done: true } } as BulkActionDef;
    const update = vi.fn(async (_resource: string, id: string) => {
      if (id === 't2') throw new Error('记录已锁定');
      return {};
    });
    render(
      <BulkActionDialog
        def={def}
        rows={[{ id: 't1', title: 'One' }, { id: 't2', title: 'Two' }]}
        resource="task"
        dataSource={{ update } as any}
        objectDef={{ name: 'task', nameField: 'title', fields: { title: { type: 'text', label: 'Title' } } }}
        open
        onClose={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Download error CSV' }));
    expect(blobs.length, 'CONTROL: the download produced a file').toBe(1);

    const body = await bodyAfterOneMark(blobs[0]!);
    expect(body, 'CONTROL: the header row and the refusal follow the mark').toBe('record_id,error_message\nt2,"记录已锁定"');
  });
});
