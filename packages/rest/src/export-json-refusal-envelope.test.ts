// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27682] `GET /data/:object/export?format=json` reads its first page before
 * it writes a byte, so a query the read refuses answers the `400` envelope the
 * csv export answers — not a `200` carrying a truncated stream.
 *
 * The defect: the json branch wrote its opening `[` before the first
 * `findData`. The first `res.write` commits the adapter to a streaming `200`,
 * so a refusal raised by that read (the card's repro: `searchFields` naming a
 * field that does not exist) reached the client as a `200` whose body was a
 * lone `[`, while `format=csv` answered `400 INVALID_FIELD`.
 *
 * Both halves are pinned through the real `HonoHttpServer` (the adapter
 * `os serve` mounts), because the `200` was decided by the adapter's streaming
 * switch, which a hand-rolled response double does not have:
 *
 *  - refusal: over a real `SqlDriver` (SQLite), the card's repro answers the
 *    same status and body for json as for csv;
 *  - preservation: a successful json export is byte-for-byte what it was —
 *    one page, several pages, and no rows at all.
 *
 * A refusal on a LATER page (after rows have been written) is out of this pin
 * (triage 6504427279). So is xlsx, whose workbook writer commits the stream
 * before the first read the same way; it is not pinned here.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'rest_export_json_27682';

const ITEMS = {
    name: OBJECT,
    label: 'Items 27682',
    fields: {
        label: { name: 'label', type: 'text' as const },
        note: { name: 'note', type: 'text' as const },
    },
};

/**
 * code · querystring: two refusals `findData` raises on the first read. The
 * first is the card's repro (a search over a field the object does not
 * have); the second is #27484's empty override.
 */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['INVALID_FIELD', '?search=x&searchFields=nope'],
    ['VALIDATION_ERROR', '?search=x&searchFields=,'],
];

describe('[#27682] export: a refused first read answers the envelope for json as for csv — sqlite', () => {
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
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_export_json' });
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

    it.each(REFUSED)('json answers the same 400 %s as csv for %s — no truncated 200', async (_code, query) => {
        const csv = await exportAs('csv', query);
        const json = await exportAs('json', query);
        expect(json.status, 'json must not commit a 200 before its first read').toBe(400);
        expect(json.body).toEqual(csv.body);
    });
});

describe('[#27682] export: a successful json export is byte-identical', () => {
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
        (rest as any).resolveExecCtx = async () => ({ userId: 'u_export_json' });
        rest.registerRoutes();
        return { app: server.getRawApp(), findData, expected: `[${all.map((r) => JSON.stringify(r)).join(',')}]` };
    }

    it.each([
        ['one page', 3, '', 1],
        ['several pages (three reads of 50, 50, 20)', 120, '&page=50', 3],
        ['no rows', 0, '', 1],
    ])('%s', async (_label, total, query, reads) => {
        const { app, findData, expected } = boot(total);
        const res: Response = await app.fetch(new Request(`http://local/api/v1/data/task/export?format=json${query}`));
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(await res.text()).toBe(total === 0 ? '[]' : expected);
        expect(findData).toHaveBeenCalledTimes(reads);
    });
});
