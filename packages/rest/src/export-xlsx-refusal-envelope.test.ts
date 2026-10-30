// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27755] `GET /data/:object/export?format=xlsx` reads its first page before
 * it opens the workbook writer, so a query the read refuses answers the `400`
 * envelope the csv and json exports answer — not a `200` carrying a workbook
 * stream. The xlsx half of #27682.
 *
 * The defect: the xlsx branch opened `createXlsxStream(res, …)` before the
 * first `findData`. Opening the writer commits the adapter to a streaming
 * `200`, so a refusal raised by that read (`searchFields` naming a field that
 * does not exist) reached the client as a `200`, while `format=csv` answered
 * `400 INVALID_FIELD`.
 *
 * Both halves are pinned through the real `HonoHttpServer` (the adapter
 * `os serve` mounts), because the `200` was decided by the adapter's streaming
 * switch, which a hand-rolled response double does not have:
 *
 *  - refusal: over a real `SqlDriver` (SQLite), the refused query answers the
 *    same status and body for xlsx as for csv;
 *  - preservation: a successful xlsx export still answers `200`, the workbook
 *    content type and a readable workbook with the same cells — one page,
 *    several pages, and no rows at all.
 *
 * A refusal on a LATER page (after rows have been written) is out of this pin,
 * as it is in #27682's (triage 6510461172).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

const OBJECT = 'rest_export_xlsx_27755';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const ITEMS = {
    name: OBJECT,
    label: 'Items 27755',
    fields: {
        label: { name: 'label', type: 'text' as const },
        note: { name: 'note', type: 'text' as const },
    },
};

/**
 * code · querystring: two refusals `findData` raises on the first read — a
 * search over a field the object does not have, and #27484's empty override.
 */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['INVALID_FIELD', '?search=x&searchFields=nope'],
    ['VALIDATION_ERROR', '?search=x&searchFields=,'],
];

describe('[#27755] export: a refused first read answers the envelope for xlsx as for csv — sqlite', () => {
    let engine: ObjectQL;
    let app: { fetch: (req: Request) => Promise<Response> };

    beforeAll(async () => {
        const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(ITEMS as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        for (const label of ['a', 'b', 'c']) await engine.insert(OBJECT, { id: `r${label}`, label, note: `n-${label}` } as any);

        const protocol = new ObjectStackProtocolImplementation(engine as any);
        const server = new HonoHttpServer(0);
        const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_export_xlsx' });
        rest.registerRoutes();
        app = server.getRawApp() as any;
    });

    afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    async function exportAs(format: string, query: string) {
        const res = await app.fetch(new Request(`http://local/api/v1/data/${OBJECT}/export${query}&format=${format}`));
        // The status is read before the body: a committed `200` stream is the
        // defect, and its body need not ever finish.
        const status = res.status;
        if (status !== 400) {
            try { await res.body?.cancel(); } catch { /* noop */ }
            return { status, body: undefined as any };
        }
        return { status, body: JSON.parse(await res.text()) };
    }

    it.each(REFUSED)('the control: csv answers 400 %s for %s', async (code, query) => {
        const csv = await exportAs('csv', query);
        expect(csv.status).toBe(400);
        expect(csv.body?.code).toBe(code);
    });

    it.each(REFUSED)('xlsx answers the same 400 %s as csv for %s — no workbook 200', async (_code, query) => {
        const csv = await exportAs('csv', query);
        const xlsx = await exportAs('xlsx', query);
        expect(xlsx.status, 'xlsx must not commit a 200 before its first read').toBe(400);
        expect(xlsx.body).toEqual(csv.body);
    });
});

describe('[#27755] export: a successful xlsx export is unchanged', () => {
    const TASK = {
        name: 'task',
        label: 'Task',
        fields: {
            id: { type: 'text', label: 'ID' },
            title: { type: 'text', label: 'Title' },
        },
    };

    function boot(total: number) {
        const all = Array.from({ length: total }, (_, i) => ({ id: String(i + 1), title: `t${i + 1}` }));
        const findData = vi.fn(async (req: any) => {
            const { offset = 0, limit = all.length } = req.query ?? {};
            return { object: 'task', records: all.slice(offset, offset + limit) };
        });
        const protocol: any = {
            getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
            getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: TASK }),
            findData,
        };
        const server = new HonoHttpServer(0);
        const rest = new RestServer(server as any, protocol, { api: { requireAuth: false } } as any);
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_export_xlsx' });
        rest.registerRoutes();
        return { app: server.getRawApp(), findData, all };
    }

    it.each([
        ['one page', 3, '', 1],
        ['several pages (three reads of 50, 50, 20)', 120, '&page=50', 3],
        ['no rows', 0, '', 1],
    ])('%s', async (_label, total, query, reads) => {
        const { app, findData, all } = boot(total);
        const res: Response = await app.fetch(new Request(`http://local/api/v1/data/task/export?format=xlsx${query}`));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe(XLSX_TYPE);
        expect(res.headers.get('x-export-styles')).toBe('applied');

        const ws = (await loadXlsxWorkbook(Buffer.from(await res.arrayBuffer()))).worksheets[0];
        const cells: unknown[][] = [];
        ws.eachRow((row) => { cells.push((row.values as unknown[]).slice(1)); });
        // No rows: the schema-derived header is not authoritative without a
        // security projection (#3391), so the workbook is empty but readable.
        expect(cells).toEqual(total === 0 ? [] : [['ID', 'Title'], ...all.map((r) => [r.id, r.title])]);
        expect(findData).toHaveBeenCalledTimes(reads);
    });
});
