/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { csvBlob, UTF8_BYTE_ORDER_MARK } from '../csv-blob';

describe('csvBlob — a browser-built CSV file opens readably in Excel (objectstack#34420)', () => {
  it('starts with exactly one UTF-8 byte-order mark, then the text as UTF-8', async () => {
    const bytes = new Uint8Array(await csvBlob('名称\n张三').arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(Array.from(bytes.slice(3))).toEqual(Array.from(new TextEncoder().encode('名称\n张三')));
  });

  it('an empty text still yields the mark alone', async () => {
    expect(Array.from(new Uint8Array(await csvBlob('').arrayBuffer()))).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('is typed as UTF-8 CSV', () => {
    expect(csvBlob('a').type).toBe('text/csv;charset=utf-8');
  });

  it('the exported mark is the single code point U+FEFF', () => {
    expect(UTF8_BYTE_ORDER_MARK).toHaveLength(1);
    expect(UTF8_BYTE_ORDER_MARK.charCodeAt(0)).toBe(0xfeff);
  });
});
