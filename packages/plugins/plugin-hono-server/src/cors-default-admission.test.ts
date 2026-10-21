// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What the transport's CORS answer ADMITS — driven through the real adapter and
 * the real `hono/cors` middleware (`app.request`), never a captured config.
 *
 * The governing text is `docs/HARDENING.md` § CORS: "Do **not** use
 * `origin: '*'` with `credentials: true`", and the go-live checklist's "CORS
 * origin list is explicit, not `*`". Four pins, one per input class whose
 * answer the plugin decides:
 *
 *  1. no origin list configured (neither `cors.origins` nor `OS_CORS_ORIGIN`):
 *     no cross-origin caller is admitted. A same-origin request needs no CORS
 *     answer at all, so nothing here has to know the host's own origin;
 *  2. a configured origin is admitted, with credentials, and nothing else is;
 *  3. a loopback origin is admitted by the default on a development boot only;
 *  4. `'*'` together with credentials is refused at init (and so at boot),
 *     wherever the `'*'` comes from; `'*'` without credentials still boots;
 *  5. a configured list admits a loopback origin beside it on a development
 *     boot only — the list itself, and nothing more, everywhere else;
 *  6. a pattern whose host part is the bare `*` (`https://*`, `*://*`) admits
 *     every host, so it is refused with credentials exactly as `'*'` is.
 *
 * The rule itself is `resolveCorsAdmission` (`cors-admission.ts`), which
 * `@objectstack/hono`'s `createHonoApp` reads too; the pin that holds every
 * door to the same answer lives in `@objectstack/http-conformance`.
 *
 * "Admitted" is read off `Access-Control-Allow-Origin` — the one header a
 * browser checks before handing a cross-origin response to the page.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LiteKernel, type Plugin, type PluginContext } from '@objectstack/core';

import { HonoServerPlugin, type HonoPluginOptions } from './hono-plugin';

const FOREIGN = 'https://other.example';
const CONFIGURED = 'https://app.example.com';
const LOOPBACK = 'http://localhost:5173';

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
    // Not a development boot unless a case says so.
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

interface RawApp {
    get(path: string, handler: (c: { text(body: string): Response }) => Response): unknown;
    request(path: string, init?: RequestInit): Promise<Response>;
}

/** Run the real `init()`, then mount one probe route behind its middleware. */
async function boot(options: HonoPluginOptions = {}): Promise<RawApp> {
    const plugin = new HonoServerPlugin({ port: 0, serverTiming: false, ...options });
    await plugin.init(fakeCtx());
    const rawApp = (plugin as unknown as { server: { getRawApp(): RawApp } }).server.getRawApp();
    rawApp.get('/probe', (c) => c.text('ok'));
    return rawApp;
}

/** The `Access-Control-Allow-Origin` a credentialed GET from `origin` is answered with. */
async function allowedOnGet(app: RawApp, origin: string): Promise<string | null> {
    const res = await app.request('/probe', { headers: { Origin: origin, Cookie: 'session=1' } });
    expect(res.status).toBe(200);
    return res.headers.get('access-control-allow-origin');
}

/** The same, for the preflight a browser sends ahead of a non-simple request. */
async function allowedOnPreflight(app: RawApp, origin: string): Promise<string | null> {
    const res = await app.request('/probe', {
        method: 'OPTIONS',
        headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'content-type',
        },
    });
    return res.headers.get('access-control-allow-origin');
}

describe('1. with no origin list configured, no cross-origin caller is admitted', () => {
    it('answers a foreign origin with no Access-Control-Allow-Origin, on a request and on a preflight', async () => {
        const app = await boot();
        expect(await allowedOnGet(app, FOREIGN)).toBeNull();
        expect(await allowedOnPreflight(app, FOREIGN)).toBeNull();
    });

    it('does not admit a loopback origin either, outside a development boot', async () => {
        const app = await boot();
        expect(await allowedOnGet(app, LOOPBACK)).toBeNull();
        expect(await allowedOnPreflight(app, LOOPBACK)).toBeNull();
    });

    it('still answers the request itself: the CORS answer withholds admission, never the response', async () => {
        const app = await boot();
        const res = await app.request('/probe', { headers: { Origin: FOREIGN } });
        expect(res.status).toBe(200);
        expect(await res.text()).toBe('ok');
    });
});

describe('2. a configured origin is admitted with credentials, and nothing else is', () => {
    it('via the `cors.origins` option', async () => {
        const app = await boot({ cors: { origins: [CONFIGURED] } });
        const res = await app.request('/probe', { headers: { Origin: CONFIGURED } });
        expect(res.headers.get('access-control-allow-origin')).toBe(CONFIGURED);
        expect(res.headers.get('access-control-allow-credentials')).toBe('true');
        expect(await allowedOnPreflight(app, CONFIGURED)).toBe(CONFIGURED);
        expect(await allowedOnGet(app, FOREIGN)).toBeNull();
    });

    it('via OS_CORS_ORIGIN, comma-separated', async () => {
        process.env.OS_CORS_ORIGIN = `${CONFIGURED}, https://*.example.net`;
        const app = await boot();
        expect(await allowedOnGet(app, CONFIGURED)).toBe(CONFIGURED);
        expect(await allowedOnGet(app, 'https://tenant.example.net')).toBe('https://tenant.example.net');
        expect(await allowedOnGet(app, FOREIGN)).toBeNull();
    });
});

describe('3. the default admits a loopback origin on a development boot only', () => {
    it('admits a loopback origin when NODE_ENV is development, and still no foreign origin', async () => {
        process.env.NODE_ENV = 'development';
        const app = await boot();
        expect(await allowedOnGet(app, LOOPBACK)).toBe(LOOPBACK);
        expect(await allowedOnGet(app, 'http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001');
        expect(await allowedOnPreflight(app, LOOPBACK)).toBe(LOOPBACK);
        expect(await allowedOnGet(app, FOREIGN)).toBeNull();
        expect(await allowedOnPreflight(app, FOREIGN)).toBeNull();
    });

    it('treats an unset or `test` NODE_ENV as not development', async () => {
        for (const value of [undefined, 'test']) {
            if (value === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = value;
            const app = await boot();
            expect(await allowedOnGet(app, LOOPBACK)).toBeNull();
        }
    });
});

/** Run the real `init()` and return what it threw; a resolved init fails the case. */
async function refusal(options: HonoPluginOptions): Promise<Error> {
    const plugin = new HonoServerPlugin({ port: 0, serverTiming: false, ...options });
    const outcome = await plugin.init(fakeCtx()).then(() => null, (e: unknown) => e);
    expect(outcome).toBeInstanceOf(Error);
    return outcome as Error;
}

describe("4. '*' together with credentials is refused at init", () => {
    it('from the `cors.origins` option, with credentials left at their default', async () => {
        const err = await refusal({ cors: { origins: '*' } });
        // The named subjects: both variables an operator can set to resolve it.
        expect(err.message).toContain('OS_CORS_ORIGIN');
        expect(err.message).toContain('OS_CORS_CREDENTIALS');
    });

    it('from OS_CORS_ORIGIN, alone or inside a list', async () => {
        for (const value of ['*', ` * `, `${CONFIGURED},*`]) {
            process.env.OS_CORS_ORIGIN = value;
            await refusal({});
        }
    });

    it('with credentials named explicitly, by option or by OS_CORS_CREDENTIALS', async () => {
        await refusal({ cors: { origins: ['*'], credentials: true } });
        process.env.OS_CORS_ORIGIN = '*';
        process.env.OS_CORS_CREDENTIALS = 'true';
        await refusal({});
    });

    it('fails the boot: the kernel rethrows the init refusal', async () => {
        const kernel = new LiteKernel({ logger: { level: 'silent' } });
        kernel.use(new HonoServerPlugin({ port: 0, serverTiming: false, cors: { origins: '*' } }) as unknown as Plugin);
        const outcome = await kernel.bootstrap().then(() => null, (e: unknown) => e);
        expect(outcome).toBeInstanceOf(Error);
        expect((outcome as Error).message).toContain('OS_CORS_ORIGIN');
    });

    it("boots '*' without credentials, admitting any origin with no credentials header", async () => {
        process.env.OS_CORS_ORIGIN = '*';
        process.env.OS_CORS_CREDENTIALS = 'false';
        const app = await boot();
        const res = await app.request('/probe', { headers: { Origin: FOREIGN } });
        expect(res.headers.get('access-control-allow-origin')).toBe(FOREIGN);
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });
});

describe('5. a configured list admits a loopback origin beside it on a development boot only', () => {
    it('outside development, a loopback origin the list does not name is not admitted', async () => {
        const app = await boot({ cors: { origins: [CONFIGURED] } });
        expect(await allowedOnGet(app, CONFIGURED)).toBe(CONFIGURED);
        expect(await allowedOnGet(app, LOOPBACK)).toBeNull();
        expect(await allowedOnPreflight(app, LOOPBACK)).toBeNull();
        expect(await allowedOnGet(app, 'http://127.0.0.1:3001')).toBeNull();
        expect(await allowedOnGet(app, 'http://[::1]:3000')).toBeNull();
    });

    it('the same for a list read from OS_CORS_ORIGIN, patterns included, and for an unset or `test` NODE_ENV', async () => {
        process.env.OS_CORS_ORIGIN = `${CONFIGURED},https://*.example.net`;
        for (const value of ['production', undefined, 'test']) {
            if (value === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = value;
            const app = await boot();
            expect(await allowedOnGet(app, 'https://tenant.example.net')).toBe('https://tenant.example.net');
            expect(await allowedOnGet(app, LOOPBACK)).toBeNull();
        }
    });

    it('on a development boot, a loopback origin is admitted beside the list, and still no foreign origin', async () => {
        process.env.NODE_ENV = 'development';
        const app = await boot({ cors: { origins: [CONFIGURED] } });
        expect(await allowedOnGet(app, CONFIGURED)).toBe(CONFIGURED);
        expect(await allowedOnGet(app, LOOPBACK)).toBe(LOOPBACK);
        expect(await allowedOnPreflight(app, LOOPBACK)).toBe(LOOPBACK);
        expect(await allowedOnGet(app, FOREIGN)).toBeNull();
    });

    it('a list that names a loopback pattern admits it in every mode, and only what it names', async () => {
        const app = await boot({ cors: { origins: 'http://localhost:*' } });
        expect(await allowedOnGet(app, LOOPBACK)).toBe(LOOPBACK);
        expect(await allowedOnGet(app, 'http://127.0.0.1:3001')).toBeNull();
    });
});

describe("6. a pattern whose host part is the bare `*` is refused with credentials, as '*' is", () => {
    const ALL_HOST = ['https://*', 'http://*', '*://*', 'http://*:*', 'https://*:8443'];

    it('from the `cors.origins` option, alone or inside a list, naming the entry', async () => {
        for (const entry of ALL_HOST) {
            const alone = await refusal({ cors: { origins: entry } });
            expect(alone.message).toContain(`'${entry}'`);
            expect(alone.message).toContain('OS_CORS_ORIGIN');
            expect(alone.message).toContain('OS_CORS_CREDENTIALS');
            await refusal({ cors: { origins: [CONFIGURED, entry] } });
        }
    });

    it('from OS_CORS_ORIGIN, alone or inside a list', async () => {
        for (const entry of ALL_HOST) {
            process.env.OS_CORS_ORIGIN = entry;
            await refusal({});
            process.env.OS_CORS_ORIGIN = `${CONFIGURED}, ${entry}`;
            const err = await refusal({});
            expect(err.message).toContain(`'${entry}'`);
        }
    });

    it('boots without credentials, admitting what the pattern matches with no credentials header', async () => {
        process.env.OS_CORS_ORIGIN = 'https://*';
        process.env.OS_CORS_CREDENTIALS = 'false';
        const app = await boot();
        const res = await app.request('/probe', { headers: { Origin: FOREIGN } });
        expect(res.headers.get('access-control-allow-origin')).toBe(FOREIGN);
        expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('a pattern that names part of the host is not one: it boots with credentials', async () => {
        const app = await boot({ cors: { origins: ['https://*.example.com', 'http://localhost:*'] } });
        expect(await allowedOnGet(app, 'https://tenant.example.com')).toBe('https://tenant.example.com');
        expect(await allowedOnGet(app, FOREIGN)).toBeNull();
    });
});
