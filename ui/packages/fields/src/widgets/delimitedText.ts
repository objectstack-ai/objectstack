/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Reading delimited text (CSV/TSV) bytes: the encoding sniff and the
 * quote-aware row parser. One copy for every reader in the console: the grid's
 * import wizard (`@object-ui/plugin-grid`, which imports these from here) and
 * the file preview dialog's CSV view. React-free, so a parser test never pays
 * for a renderer.
 */

/**
 * Quote-aware parser for delimited text (CSV/TSV). Handles RFC-4180 style
 * doubled quotes and quoted fields containing the delimiter or newlines.
 * Trailing whitespace on each field is trimmed, and all-empty rows skipped.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === delimiter) { row.push(field.trim()); field = ''; }
    else if (ch === '\n' || (ch === '\r' && next === '\n')) {
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = []; field = '';
      if (ch === '\r') i++;
    } else { field += ch; }
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

/**
 * Decode a delimited-text import file's bytes into a string. Real-world
 * spreadsheet CSVs are not reliably UTF-8 — zh-CN Excel's "另存为 CSV" writes
 * GBK, which `file.text()` (always UTF-8) turns into mojibake headers that can
 * never be mapped — so the encoding is sniffed instead of assumed:
 *   1. An explicit BOM (UTF-8 / UTF-16 LE / UTF-16 BE) wins.
 *   2. Otherwise try strict UTF-8; its validation rejects GBK multi-byte runs.
 *   3. Fall back to GB18030 (a superset of GBK/GB2312), the dominant
 *      non-UTF-8 CSV encoding in practice.
 */
export function decodeSpreadsheetText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes);
    } catch {
      // Runtimes without the gb18030 decoder (e.g. small-ICU Node) — degrade
      // to lossy UTF-8 rather than failing the whole import.
      return new TextDecoder('utf-8').decode(bytes);
    }
  }
}
