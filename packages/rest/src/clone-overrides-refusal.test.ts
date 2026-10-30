// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27489] `POST /data/:object/:id/clone` refuses an `overrides` that is not
 * an object, instead of dropping it.
 *
 * The defect: the door passed `overrides` on only when `typeof` said
 * `object`, so `{"overrides":"x"}` answered `201` with a plain copy and
 * nothing said the caller's value was ignored, while an array passed that
 * test and reached `cloneData`, which merged it index-wise. The same held for
 * a bare (un-nested) body.
 *
 * Both halves are pinned here, through the real `HonoHttpServer` (the adapter
 * `os serve` mounts), so the JSON body is parsed by the code that parses it in
 * production:
 *
 *  - refusal: a non-object `overrides` or bare body answers `400` with the
 *    nested ADR-0112 `VALIDATION_ERROR` naming `overrides`, and `cloneData` is
 *    never called;
 *  - preservation: the nested map, the bare map, `{}` and no body at all reach
 *    `cloneData` exactly as before.
 *
 * `null` is decided: a caller who wrote `"overrides": null` wrote a value, so
 * it is refused, not read as absent. A bare `null` body is the transport's
 * empty body and stays a plain copy.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';
import { RestServer } from './rest-server';

const ACCOUNT = { name: 'account', label: 'Account', fields: { name: { type: 'text', label: 'Name' } } };

function boot() {
    const cloneData = vi.fn().mockResolvedValue({ object: 'account', id: 'a2', sourceId: 'a1', record: { id: 'a2' } });
    const protocol: any = {
        getMetaItems: vi.fn().mockResolvedValue({ items: [ACCOUNT] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'account', item: ACCOUNT }),
        cloneData,
    };
    const server = new HonoHttpServer(0);
    const rest = new RestServer(server as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_clone_overrides' });
    rest.registerRoutes();
    return { app: server.getRawApp(), cloneData };
}

async function clone(body: string | undefined) {
    const { app, cloneData } = boot();
    const res: Response = await app.fetch(new Request('http://local/api/v1/data/account/a1/clone', {
        method: 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body }),
    }));
    return { status: res.status, body: (await res.json()) as any, cloneData };
}

describe('[#27489] clone — a non-object overrides is refused before cloneData', () => {
    it.each([
        ['a string', '{"overrides":"x"}'],
        ['a number', '{"overrides":1}'],
        ['true', '{"overrides":true}'],
        ['null', '{"overrides":null}'],
        ['an array', '{"overrides":[{"name":"Copy"}]}'],
        ['an empty array', '{"overrides":[]}'],
        ['a bare array body', '[{"name":"Copy"}]'],
        ['a bare string body', '"x"'],
        ['a bare number body', '7'],
    ])('overrides as %s → 400 VALIDATION_ERROR naming overrides, cloneData never called', async (_label, body) => {
        const out = await clone(body);

        expect(out.status).toBe(400);
        expect(out.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(out.body?.error?.message).toContain('"overrides"');
        expect(out.cloneData).not.toHaveBeenCalled();
    });
});

describe('[#27489] clone — object overrides and absent bodies keep their answers', () => {
    it.each([
        ['nested overrides', '{"overrides":{"name":"Copy"}}', { name: 'Copy' }],
        ['a bare field map', '{"name":"Bare"}', { name: 'Bare' }],
        ['an empty nested map', '{"overrides":{}}', {}],
        ['an empty body object', '{}', {}],
        ['a bare null body', 'null', {}],
    ])('%s → 201, cloneData receives %s', async (_label, body, expected) => {
        const out = await clone(body);

        expect(out.status).toBe(201);
        expect(out.cloneData).toHaveBeenCalledTimes(1);
        expect(out.cloneData.mock.calls[0][0]).toMatchObject({ object: 'account', id: 'a1', overrides: expected });
    });

    it('no body at all → 201, a plain copy', async () => {
        const out = await clone(undefined);

        expect(out.status).toBe(201);
        expect(out.cloneData).toHaveBeenCalledTimes(1);
        expect(out.cloneData.mock.calls[0][0]).toMatchObject({ object: 'account', id: 'a1' });
    });
});

/**
 * [#27669] A body that carries `overrides` beside other top-level keys is
 * refused, instead of reading `overrides` alone and dropping the rest with a
 * `201`. The refusal names the stray keys and both accepted shapes, and points
 * a record with a real field named `overrides` at the nested shape.
 */
describe('[#27669] clone — overrides beside other top-level keys is refused before cloneData', () => {
    it.each([
        ['one stray key', '{"overrides":{"name":"Copy"},"status":"draft"}', ['"status"']],
        ['two stray keys', '{"overrides":{"name":"Copy"},"status":"draft","owner":"u2"}', ['"status"', '"owner"']],
        ['an empty overrides with a stray key', '{"overrides":{},"status":"draft"}', ['"status"']],
    ])('%s → 400 VALIDATION_ERROR naming the stray keys and both shapes, cloneData never called', async (_label, body, strays) => {
        const out = await clone(body);

        expect(out.status).toBe(400);
        expect(out.body?.error?.code).toBe('VALIDATION_ERROR');
        const message: string = out.body?.error?.message ?? '';
        for (const key of strays) expect(message).toContain(key);
        expect(message).toContain('{ "overrides": {...} }');
        expect(message).toContain('a bare field map');
        expect(message).toContain('{ "overrides": { "overrides": ... } }');
        expect(out.cloneData).not.toHaveBeenCalled();
    });

    it('a field named overrides set through the nested shape → 201, cloneData receives it', async () => {
        const out = await clone('{"overrides":{"overrides":"x","name":"Copy"}}');

        expect(out.status).toBe(201);
        expect(out.cloneData.mock.calls[0][0]).toMatchObject({ overrides: { overrides: 'x', name: 'Copy' } });
    });
});
