// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34163] `GET /data/:object/export?format=csv` opens its body with exactly
 * one UTF-8 byte-order mark (the bytes EF BB BF), so Excel reads the saved
 * file as UTF-8 instead of the system ANSI code page.
 *
 * The defect: the csv leg set `Content-Type: text/csv; charset=utf-8` and
 * streamed the header row straight away. The charset lives in the HTTP answer,
 * not in the saved file, and Excel (Windows and Mac) opens a csv with no
 * byte-order mark in the ANSI code page, so every Chinese (or any non-ASCII)
 * header and cell came out garbled while the xlsx export of the same list
 * opened correctly.
 *
 * Pinned through the real `HonoHttpServer` over a real `SqlDriver` (SQLite),
 * reading the body as BYTES (`arrayBuffer()`): `Response.text()` decodes
 * UTF-8 the WHATWG way, which drops a leading byte-order mark, so a pin
 * reading text could not tell the fix from the defect.
 *
 *  - csv: one mark, then the header row, for a Chinese header and value;
 *  - csv with zero rows (an explicit `fields=` makes the header
 *    authoritative): one mark, then the header row alone; with no
 *    authoritative header nothing is written, and the file stays zero bytes;
 *  - json and xlsx: no mark;
 *  - round trip: the exported bytes, mark included, parse through the csv
 *    import (`parseCsvToRows`) to the same header names and cells.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { parseCsvToRows } from './import-prepare.js';

/** The UTF-8 encoding of U+FEFF, spelled as numbers so no editor can eat it. */
const BOM_BYTES = [0xef, 0xbb, 0xbf] as const;
const BOM_CHAR = String.fromCharCode(0xfeff);

const ACCOUNTS = 'rest_export_bom_account';
const EMPTY = 'rest_export_bom_empty';

const FIELDS = {
    label: { name: 'label', type: 'text' as const, label: '名称' },
    note: { name: 'note', type: 'text' as const, label: '备注' },
};

/**
 * Decode the body as it lands on disk: every byte kept, a leading mark
 * included (`ignoreBOM: true` keeps it in the string as U+FEFF).
 */
function decodeKeepingMark(bytes: Uint8Array): string {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/** How many times the mark occurs anywhere in the body. */
function markCount(text: string): number {
    return text.split(BOM_CHAR).length - 1;
}

describe('[#34163] export: a csv body opens with one UTF-8 byte-order mark — sqlite, real Hono', () => {
    let engine: ObjectQL;
    let app: { fetch: (req: Request) => Promise<Response> };

    beforeAll(async () => {
        const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject({ name: ACCOUNTS, label: '客户', fields: FIELDS } as any);
        engine.registry.registerObject({ name: EMPTY, label: '空', fields: FIELDS } as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        await engine.insert(ACCOUNTS, { id: 'a1', label: '张三', note: '创建时间' } as any);
        await engine.insert(ACCOUNTS, { id: 'a2', label: '李四', note: 'plain' } as any);
        // The protocol reads the stored-metadata family for the object's
        // labels; registered after the DDL, as a boot does
        // (`export-integration.test.ts`). Without it the header falls back
        // to the API names and the Chinese labels are never exported.
        for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
            if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
        }

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const server = new HonoHttpServer(0);
        const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_export_bom' });
        rest.registerRoutes();
        app = server.getRawApp() as any;
    });

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    async function exportBytes(object: string, query: string) {
        const res = await app.fetch(new Request(`http://local/api/v1/data/${object}/export${query}`));
        const bytes = new Uint8Array(await res.arrayBuffer());
        return { status: res.status, headers: res.headers, bytes };
    }

    it('csv: exactly one mark, then the Chinese header row and cells', async () => {
        const { status, headers, bytes } = await exportBytes(ACCOUNTS, '?format=csv&fields=label,note&orderby=label');
        expect(status).toBe(200);
        expect(Array.from(bytes.slice(0, 3))).toEqual([...BOM_BYTES]);
        // The fourth byte starts the header: no second mark behind the first.
        expect(Array.from(bytes.slice(3, 6))).not.toEqual([...BOM_BYTES]);

        const text = decodeKeepingMark(bytes);
        expect(markCount(text)).toBe(1);
        const lines = text.slice(1).split(/\r?\n/).filter((l) => l.length > 0);
        expect(lines[0]).toBe('名称,备注');
        expect(lines.slice(1).sort()).toEqual(['张三,创建时间', '李四,plain'].sort());

        // The answer's headers are the ones the export always sent.
        expect(headers.get('content-type')).toBe('text/csv; charset=utf-8');
        expect(headers.get('x-export-format')).toBe('csv');
        expect(headers.get('content-disposition')).toMatch(/\.csv/);
    });

    it('csv, the default format (no ?format=): the same single mark', async () => {
        const { status, bytes } = await exportBytes(ACCOUNTS, '?fields=label,note');
        expect(status).toBe(200);
        expect(Array.from(bytes.slice(0, 3))).toEqual([...BOM_BYTES]);
        expect(markCount(decodeKeepingMark(bytes))).toBe(1);
    });

    it('csv with header=false: the mark opens the first data row', async () => {
        const { status, bytes } = await exportBytes(ACCOUNTS, '?format=csv&fields=label,note&header=false&orderby=label');
        expect(status).toBe(200);
        expect(Array.from(bytes.slice(0, 3))).toEqual([...BOM_BYTES]);
        const text = decodeKeepingMark(bytes);
        expect(markCount(text)).toBe(1);
        const lines = text.slice(1).split(/\r?\n/).filter((l) => l.length > 0);
        expect(lines).toHaveLength(2);
        expect(lines).not.toContain('名称,备注');
    });

    it('csv with zero rows: one mark, then the header row alone', async () => {
        const { status, bytes } = await exportBytes(EMPTY, '?format=csv&fields=label,note');
        expect(status).toBe(200);
        expect(Array.from(bytes.slice(0, 3))).toEqual([...BOM_BYTES]);
        const text = decodeKeepingMark(bytes);
        expect(markCount(text)).toBe(1);
        expect(text.slice(1).split(/\r?\n/).filter((l) => l.length > 0)).toEqual(['名称,备注']);
    });

    it('csv with zero rows and no authoritative header: still a zero-byte file, no lone mark', async () => {
        // Schema-derived header with no security projection stays unwritten
        // at zero rows (FLS-hidden names never leak): nothing is written, so
        // there is nothing for the mark to open.
        const { status, bytes } = await exportBytes(EMPTY, '?format=csv');
        expect(status).toBe(200);
        expect(bytes.length).toBe(0);
    });

    it('json carries no mark', async () => {
        const { status, headers, bytes } = await exportBytes(ACCOUNTS, '?format=json&fields=label,note');
        expect(status).toBe(200);
        expect(headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(bytes[0]).toBe(0x5b); // '['
        expect(markCount(decodeKeepingMark(bytes))).toBe(0);
    });

    it('xlsx carries no mark', async () => {
        const { status, headers, bytes } = await exportBytes(ACCOUNTS, '?format=xlsx&fields=label,note');
        expect(status).toBe(200);
        expect(headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        // A workbook is a zip: it opens with the local-file-header magic `PK`.
        expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    });

    it('round trip: the exported file, mark included, imports to the same header names and cells', async () => {
        const { bytes } = await exportBytes(ACCOUNTS, '?format=csv&fields=label,note&orderby=label');
        const onDisk = decodeKeepingMark(bytes);
        expect(onDisk.charCodeAt(0)).toBe(0xfeff);

        const rows = parseCsvToRows(onDisk);
        expect(rows).toHaveLength(2);
        for (const row of rows) expect(Object.keys(row)).toEqual(['名称', '备注']);
        expect(rows.map((r) => r['名称']).sort()).toEqual(['张三', '李四'].sort());
        // The same file without the mark parses identically: the mark is
        // read as the file's encoding, never as part of the first header.
        expect(rows).toEqual(parseCsvToRows(onDisk.slice(1)));
    });
});
