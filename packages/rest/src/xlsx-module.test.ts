// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Runtime pins for `xlsx-module.ts` — the single typed, lazily-loaded exceljs
 * binding both production xlsx paths share.
 *
 * The TYPE half of that module (workbooks, worksheets, rows and cells are now
 * inside tsc's reach) is asserted by tsc itself and cannot be asserted from
 * here. What CAN rot at runtime is the part that is not a type:
 *
 *  - the CommonJS interop (`.default ?? namespace`) the accessor performs. A
 *    "simplification" that drops either half returns a namespace whose
 *    `Workbook` is `undefined`, and the failure surfaces only in a deployed
 *    import or export.
 *  - both arms of `parseXlsxToRows(buffer: Buffer | ArrayBuffer, …)`. Only the
 *    Node `Buffer` arm carries the type assertion; the `ArrayBuffer` arm is
 *    type-checked as it stands. Neither is allowed to change behaviour, so
 *    both are driven here against bytes the accessor itself produced.
 */

import { describe, it, expect } from 'vitest';
import { loadExcelJs } from './xlsx-module.js';
import { parseXlsxToRows } from './import-prepare.js';

/** A two-row sheet, written through the accessor's own namespace. */
async function writeFixture(): Promise<Buffer> {
    const ExcelJS = await loadExcelJs();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['id', 'title', 'score']);
    ws.addRow(['a1', 'first', 7]);
    ws.addRow(['a2', 'second', 9]);
    return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('loadExcelJs', () => {
    it('resolves the exceljs namespace with the interop the call sites used to do inline', async () => {
        const ExcelJS = await loadExcelJs();
        // `.default ?? namespace`: drop either half and one of these is undefined.
        expect(typeof ExcelJS.Workbook).toBe('function');
        expect(typeof ExcelJS.stream.xlsx.WorkbookWriter).toBe('function');
        expect(new ExcelJS.Workbook().worksheets).toEqual([]);
    });

    it('returns the same module record on repeat calls — the load stays cached, not re-fetched', async () => {
        expect(await loadExcelJs()).toBe(await loadExcelJs());
    });
});

describe('parseXlsxToRows keeps both arms of its Buffer | ArrayBuffer parameter', () => {
    it('reads the Node `Buffer` arm — the one arm the exceljs shim forces an assertion on', async () => {
        const rows = await parseXlsxToRows(await writeFixture());
        expect(rows).toEqual([
            { id: 'a1', title: 'first', score: '7' },
            { id: 'a2', title: 'second', score: '9' },
        ]);
    });

    it('reads the `ArrayBuffer` arm — the arm that stays type-checked, unasserted', async () => {
        const bytes = await writeFixture();
        const arrayBuffer = bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer;
        expect(arrayBuffer).toBeInstanceOf(ArrayBuffer);
        const rows = await parseXlsxToRows(arrayBuffer);
        expect(rows).toEqual([
            { id: 'a1', title: 'first', score: '7' },
            { id: 'a2', title: 'second', score: '9' },
        ]);
    });

    it('honours the sheet selector through the typed `getWorksheet` (its `as any` is gone)', async () => {
        const ExcelJS = await loadExcelJs();
        const wb = new ExcelJS.Workbook();
        wb.addWorksheet('Empty'); // decoy first sheet
        const ws = wb.addWorksheet('Data');
        ws.addRow(['id', 'title']);
        ws.addRow(['x1', 'from-named-sheet']);
        const bytes = Buffer.from(await wb.xlsx.writeBuffer());
        expect(await parseXlsxToRows(bytes, {}, 'Data')).toEqual([
            { id: 'x1', title: 'from-named-sheet' },
        ]);
    });
});
