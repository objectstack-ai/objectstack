// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27500] `GET /data/:object/export?format=` is READ, not coerced.
 *
 * The defect: any `format` other than `json` or `xlsx` fell through to csv, so
 * `format=pdf`, `format=xml` and `format=` (empty) answered `200` with a csv
 * attachment and `X-Export-Format: csv`. A caller that branches on the status,
 * or saves the file under the extension it asked for, could not tell its
 * request was not honoured.
 *
 * Both halves are pinned here, through the real `HonoHttpServer` (the adapter
 * `os serve` mounts), so the query string is parsed by the code that parses it
 * in production:
 *
 *  - refusal: an unserved value answers `400` with the nested ADR-0112
 *    `VALIDATION_ERROR`, and `findData` is never called, so no row is read;
 *  - preservation: an absent `format` is still csv, and each served value
 *    (any case, surrounding blanks trimmed) answers its own format.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RestServer } from './rest-server';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { type: 'text', label: 'ID' },
        title: { type: 'text', label: 'Title' },
    },
};

function boot() {
    const findData = vi.fn().mockResolvedValue({ object: 'task', records: [{ id: '1', title: 'write code' }] });
    const protocol: any = {
        getMetaItems: vi.fn().mockResolvedValue({ items: [TASK] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'task', item: TASK }),
        findData,
    };
    const server = new HonoHttpServer(0);
    const rest = new RestServer(server as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_export_format' });
    rest.registerRoutes();
    return { app: server.getRawApp(), findData };
}

async function exportWith(query: string) {
    const { app, findData } = boot();
    const res: Response = await app.fetch(new Request(`http://local/api/v1/data/task/export${query}`));
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = undefined; }
    return { status: res.status, format: res.headers.get('x-export-format'), body, text, findData };
}

describe('[#27500] export ?format= — an unserved value is refused, not answered as csv', () => {
    it.each([
        ['pdf', '?format=pdf'],
        ['xml', '?format=xml'],
        ['empty', '?format='],
        ['blank', '?format=%20'],
        ['jsonl (in the spec enum, never served by this route)', '?format=jsonl'],
    ])('format %s → 400 VALIDATION_ERROR, and no row is read', async (_label, query) => {
        const out = await exportWith(query);

        expect(out.status).toBe(400);
        expect(out.body?.error?.code).toBe('VALIDATION_ERROR');
        // The refusal names the parameter and the served set.
        expect(out.body?.error?.message).toContain('"format"');
        expect(out.body?.error?.message).toContain('csv, json, xlsx');
        expect(out.format).toBeNull();
        expect(out.findData).not.toHaveBeenCalled();
    });
});

describe('[#27500] export ?format= — absent and served values keep their answers', () => {
    it('an absent format is csv', async () => {
        const out = await exportWith('');
        expect(out.status).toBe(200);
        expect(out.format).toBe('csv');
        expect(out.text).toContain('write code');
        expect(out.findData).toHaveBeenCalled();
    });

    it.each([
        ['?format=csv', 'csv'],
        ['?format=CSV', 'csv'],
        ['?format=json', 'json'],
        ['?format=JSON', 'json'],
        ['?format=%20json%20', 'json'],
        ['?format=xlsx', 'xlsx'],
        ['?format=Xlsx', 'xlsx'],
    ])('%s answers %s', async (query, expected) => {
        const out = await exportWith(query);
        expect(out.status).toBe(200);
        expect(out.format).toBe(expected);
        expect(out.findData).toHaveBeenCalled();
    });
});
