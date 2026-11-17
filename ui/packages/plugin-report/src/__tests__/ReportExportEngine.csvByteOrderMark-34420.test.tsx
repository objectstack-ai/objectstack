/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The report engine's CSV export starts with the UTF-8 byte-order mark
 * (objectstack#34420).
 *
 * Excel reads a CSV with no mark in the system code page, so a file holding
 * Chinese (or any non-ASCII) text opens garbled. `exportAsCSV` builds its file
 * in the browser, so the mark is its to put there. The pin reads the
 * downloaded Blob's BYTES, not `text()`, because the mark is a byte-level fact
 * a decoder may hide.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReportComponentSchema } from '@object-ui/types';
import { exportAsCSV } from '../ReportExportEngine';

let blobs: Blob[];

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
});

describe('exportAsCSV — UTF-8 byte-order mark (objectstack#34420)', () => {
  it('the downloaded file starts with EF BB BF, once, and the non-ASCII value follows intact', async () => {
    const report = {
      type: 'report',
      title: 'Accounts',
      fields: [{ name: 'name', label: '名称' }],
    } as unknown as ReportComponentSchema;
    exportAsCSV(report, [{ name: '张三' }]);
    expect(blobs.length, 'CONTROL: the export produced a file').toBe(1);

    const bytes = new Uint8Array(await blobs[0]!.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3)), 'the file opens with the bytes EF BB BF').toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes.slice(3));
    expect(body.charCodeAt(0), 'exactly one mark: no second one follows').not.toBe(0xfeff);
    expect(body, 'CONTROL: the header row and the record follow the mark').toBe('名称\n张三');
  });
});
