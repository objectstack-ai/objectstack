// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] Under the existing gate, every timed response carries the three
 * marks a reading needs to split origin time: `total`, `db` and `meta`. A
 * request that ran no SQL or read no metadata says so with a zero member, so
 * "nothing spent there" no longer reads like "not instrumented" — measured on
 * `main`, 0 of 58 routes carried `meta`, and `db` was absent on every request
 * that ran no query.
 *
 * The gate itself is unchanged: no header without global mode or an admin's
 * `X-OS-Debug-Timing`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HonoServerPlugin } from './hono-plugin';
import { allowPerfDisclosure, countServerTiming } from '@objectstack/observability';
import type { PluginContext } from '@objectstack/core';

function fakeCtx(): PluginContext {
    const services = new Map<string, unknown>();
    return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        registerService: (name: string, svc: unknown) => services.set(name, svc),
        getService: (name: string) => services.get(name),
    } as unknown as PluginContext;
}

async function setup(opts: { serverTiming?: boolean } = {}) {
    const plugin = new HonoServerPlugin({ ...opts, cors: false });
    await (plugin as any).init(fakeCtx());
    const server = (plugin as any).server;
    server.get('/idle', (_req: any, res: any) => res.json({ ok: true }));
    server.get('/admin-idle', (_req: any, res: any) => {
        allowPerfDisclosure();
        return res.json({ ok: true });
    });
    server.get('/reads', (_req: any, res: any) => {
        countServerTiming('db', 3, 'queries');
        countServerTiming('meta', 5, 'reads');
        countServerTiming('meta', 2, 'reads');
        return res.json({ ok: true });
    });
    return server.getRawApp();
}

/** `name -> { dur, desc }` for each member of a Server-Timing header. */
function members(header: string | null): Record<string, { dur: number; desc?: string }> {
    const out: Record<string, { dur: number; desc?: string }> = {};
    for (const part of (header ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
        const [name, ...params] = part.split(';');
        const dur = Number(params.find((p) => p.startsWith('dur='))?.slice(4));
        const desc = params.find((p) => p.startsWith('desc='))?.slice(6, -1);
        out[name] = { dur, desc };
    }
    return out;
}

describe('[#27627] db, meta and total on every timed response', () => {
    const prev = process.env.OS_SERVER_TIMING;
    beforeEach(() => { delete process.env.OS_SERVER_TIMING; });
    afterEach(() => { if (prev === undefined) delete process.env.OS_SERVER_TIMING; else process.env.OS_SERVER_TIMING = prev; });

    it('global mode: a request that read nothing carries db and meta as zero members', async () => {
        const app = await setup({ serverTiming: true });
        const m = members((await app.request('/idle')).headers.get('server-timing'));
        expect(m.db).toEqual({ dur: 0, desc: '0 queries' });
        expect(m.meta).toEqual({ dur: 0, desc: '0 reads' });
        expect(m.total.dur).toBeGreaterThanOrEqual(0);
    });

    it('a request that did read keeps its measured members, never a zero beside them', async () => {
        const app = await setup({ serverTiming: true });
        const header = (await app.request('/reads')).headers.get('server-timing')!;
        const m = members(header);
        expect(m.db).toEqual({ dur: 3, desc: '1 queries' });
        expect(m.meta).toEqual({ dur: 7, desc: '2 reads' });
        expect(header.match(/(^|, )meta;/g)).toHaveLength(1);
    });

    it('per-request mode: an admin gets all three; the same header from an unproven caller gets none', async () => {
        const app = await setup();
        const admin = members((await app.request('/admin-idle', { headers: { 'X-OS-Debug-Timing': '1' } })).headers.get('server-timing'));
        expect(Object.keys(admin).sort()).toEqual(expect.arrayContaining(['db', 'meta', 'total']));
        expect((await app.request('/idle', { headers: { 'X-OS-Debug-Timing': '1' } })).headers.get('server-timing')).toBeNull();
    });

    it('without the gate there is no header at all', async () => {
        const app = await setup();
        expect((await app.request('/idle')).headers.get('server-timing')).toBeNull();
    });
});
