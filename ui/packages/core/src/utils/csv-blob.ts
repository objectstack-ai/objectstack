/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The UTF-8 byte-order mark (U+FEFF, encoded as the bytes EF BB BF).
 *
 * Excel reads a CSV that does not start with it in the system code page, so a
 * file holding Chinese (or any non-ASCII) text opens garbled. The CSV import
 * strips one leading mark, so a file that carries it still round-trips.
 */
export const UTF8_BYTE_ORDER_MARK = '\uFEFF';

/**
 * A CSV file built in the browser, ready to hand to a download: the text after
 * exactly one UTF-8 byte-order mark, typed `text/csv;charset=utf-8`.
 *
 * Every Console writer that downloads a CSV it built itself goes through here,
 * so whether the file opens readably in Excel is decided once. The text must
 * not carry a mark of its own; none of the writers produces one.
 */
export function csvBlob(text: string): Blob {
  return new Blob([UTF8_BYTE_ORDER_MARK, text], { type: 'text/csv;charset=utf-8' });
}
