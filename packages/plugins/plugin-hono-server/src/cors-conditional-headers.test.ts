// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The conditional-request headers the server's own doors speak must pass the
 * default CORS policy — driven through the real adapter and the real
 * `hono/cors` middleware (`app.request`), never a captured config.
 *
 * The doors: the `/meta` draft save reads `If-Match` and `If-None-Match: *`
 * (`@objectstack/rest`'s `metaSaveRequestOptions`), and the metadata reads
 * answer `ETag` and a bodiless `304` to an `If-None-Match` that names it
 * (`@objectstack/client`'s cached reads send it back). A cross-origin browser
 * client the policy admits must be able to send both conditional headers and
 * read the `ETag`: a preflight that does not allow `If-None-Match` fails the
 * request in the browser with a bare "Failed to fetch" before anything reaches
 * the server, and an `ETag` the policy does not expose reads as `null` in JS.
 *
 * The defaults are {@link DEFAULT_CORS_ALLOW_HEADERS} and
 * {@link DEFAULT_CORS_EXPOSE_HEADERS}; `@objectstack/hono`'s `createHonoApp`
 * applies the same two constants and carries its own pin.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PluginContext } from '@objectstack/core';

import type { HonoCorsOptions } from './adapter';
import { HonoServerPlugin } from './hono-plugin';

const ALLOWED = 'https://app.example.com';
const FOREIGN = 'https://other.example';

/** Every variable the CORS block reads, canonical and legacy spellings. */
const CORS_ENV = [
    'OS_CORS_ENABLED', 'CORS_ENABLED',
    'OS_CORS_ORIGIN', 'CORS_ORIGIN',
    'OS_CORS_CREDENTIALS', 'CORS_CREDENTIALS',
    'OS_CORS_MAX_AGE', 'CORS_MAX_AGE',
    'NODE_ENV',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
    saved = {};
    for (const name of CORS_ENV) {
        saved[name] = process.env[name];
        delete process.env[name];
    }
    process.env.NODE_ENV = 'production';
});

afterEach(() => {
    for (const name of CORS_ENV) {
        if (saved[name] === undefined) delete process.env[name];
        else process.env[name] = saved[name];
    }
});

function fakeCtx(): PluginContext {
    const services = new Map<string, unknown>();
    return {
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        registerService: (name: string, svc: unknown) => services.set(name, svc),
        getService: (name: string) => services.get(name),
        hook: () => {},
        getKernel: () => ({}),
    } as unknown as PluginContext;
}

interface ProbeContext {
    header(name: string, value: string): void;
    json(body: unknown): Response;
}

interface RawApp {
    get(path: string, handler: (c: ProbeContext) => Response): unknown;
    put(path: string, handler: (c: ProbeContext) => Response): unknown;
    request(path: string, init?: RequestInit): Promise<Response>;
}

const META_ITEM = '/api/v1/meta/page/zz_cors_probe';

/**
 * Run the real `init()` with one admitted origin, then mount a stand-in for
 * the metadata item door behind its middleware: the read answers an `ETag`,
 * the draft save answers `200`.
 */
async function boot(cors: HonoCorsOptions = {}): Promise<RawApp> {
    const plugin = new HonoServerPlugin({
        port: 0,
        serverTiming: false,
        cors: { origins: [ALLOWED], ...cors },
    });
    await plugin.init(fakeCtx());
    const rawApp = (plugin as unknown as { server: { getRawApp(): RawApp } }).server.getRawApp();
    rawApp.get(META_ITEM, (c) => {
        c.header('ETag', '"v1"');
        return c.json({ name: 'zz_cors_probe' });
    });
    rawApp.put(META_ITEM, (c) => c.json({ ok: true }));
    return rawApp;
}

/** The browser's preflight ahead of the first-draft save `PUT …?mode=draft` + `If-None-Match: *`. */
function draftPreflight(app: RawApp, origin: string, requested: string): Promise<Response> {
    return app.request(`${META_ITEM}?mode=draft`, {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': requested,
        },
    });
}

/** A comma-separated header value as a lower-cased list. */
function listOf(res: Response, name: string): string[] {
    return (res.headers.get(name) ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
}

describe('the default CORS policy admits the conditional headers the metadata doors speak', () => {
    it('answers a preflight asking If-None-Match with it in Access-Control-Allow-Headers', async () => {
        const app = await boot();
        const res = await draftPreflight(app, ALLOWED, 'content-type,if-none-match,authorization');
        expect(res.status).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
        expect(listOf(res, 'access-control-allow-headers')).toContain('if-none-match');
    });

    it('exposes ETag on a cross-origin metadata read, so cross-origin JS can read the version', async () => {
        const app = await boot();
        const res = await app.request(META_ITEM, { headers: { Origin: ALLOWED } });
        expect(res.status).toBe(200);
        expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
        expect(res.headers.get('etag')).toBe('"v1"');
        expect(listOf(res, 'access-control-expose-headers')).toContain('etag');
    });
});

describe('controls: what the two entries leave unchanged', () => {
    it('still answers a disallowed origin with no Access-Control-Allow-Origin, on the preflight and on the read', async () => {
        const app = await boot();
        const preflight = await draftPreflight(app, FOREIGN, 'content-type,if-none-match');
        expect(preflight.headers.get('access-control-allow-origin')).toBeNull();
        const read = await app.request(META_ITEM, { headers: { Origin: FOREIGN } });
        expect(read.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('keeps If-Match in the allow list and the existing exposed headers in the expose list', async () => {
        const app = await boot();
        const preflight = await draftPreflight(app, ALLOWED, 'content-type,if-match');
        expect(listOf(preflight, 'access-control-allow-headers')).toContain('if-match');
        const read = await app.request(META_ITEM, { headers: { Origin: ALLOWED } });
        const exposed = listOf(read, 'access-control-expose-headers');
        expect(exposed).toContain('set-auth-token');
        expect(exposed).toContain('x-objectstack-dropped-fields');
    });

    it('lets a custom allowHeaders still replace the default (If-None-Match then only if listed)', async () => {
        const app = await boot({ allowHeaders: ['Content-Type', 'Authorization'] });
        const res = await draftPreflight(app, ALLOWED, 'content-type,if-none-match');
        expect(listOf(res, 'access-control-allow-headers')).toEqual(['content-type', 'authorization']);
    });
});
