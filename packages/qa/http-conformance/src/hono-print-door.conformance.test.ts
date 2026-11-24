// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36840] The print door on the hosted shape: `createHonoApp` over a kernel
 * with NO `http.server` (a hosted tenant kernel owns no socket), the REAL
 * `AuthPlugin` composed with `registerRoutes: false` and the REAL
 * `PrintServicePlugin`, with no print engine configured, over a real store.
 * Every credential is a real better-auth session, signed in through the same
 * transport.
 *
 * Before the `/print` dispatcher domain existed, every request below answered
 * the dispatcher's `404 ROUTE_NOT_FOUND` on this shape: a hosted HotCRM's
 * 「打印报价」 showed its user `Route Not Found: /print/records`.
 *
 * What this pins:
 *  1. on the hosted shape the door answers: anonymous `401`, and a signed-in
 *     member on a deployment with no print engine gets the door's own
 *     `503 SERVICE_UNAVAILABLE`, never a route miss;
 *  2. those answers are byte-identical to the self-hosted mount's, because the
 *     member runs the very registration the mount runs;
 *  3. a hosted kernel without `@objectstack/service-print` answers a typed
 *     `501 NOT_IMPLEMENTED` naming the package, never a route miss.
 *
 * The domain's own claim, gates and faults are pinned on the real dispatcher
 * in `packages/runtime/src/domains/own-door-bridge.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { AuthManager, AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { PrintServicePlugin } from '@objectstack/service-print';
import { AppPlugin, DefaultDatasourcePlugin } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer } from '@objectstack/spec/contracts';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const SECRET = 'print-door-conformance-secret-00001';
const NOTE = 'pd_note';
const ALICE = { email: 'alice@print-door.test', password: 'alice-print-door-password-36840', name: 'Alice' };
const PRINT_ENV_KEYS = ['OS_PRINT_CHROMIUM_PATH', 'OS_PRINT_BROWSER_ENDPOINT', 'OS_PRINT_CONSOLE_URL'];

const APP: any = {
    manifest: { id: 'com.conformance.printdoor', name: 'Print door conformance', version: '1.0.0' },
    objects: [{ name: NOTE, label: 'Note', enable: { files: true }, fields: { title: { type: 'text', label: 'Title' } } }],
};

interface Door {
    kernel: any;
    send: (path: string, init?: RequestInit) => Promise<Response>;
    aliceToken: string;
}

/** One kernel: `hosted` is the tenant kernel's shape; `print: false` leaves the `print` slot empty. */
async function boot(opts: { hosted: boolean; print?: boolean }): Promise<Door> {
    const kernel: any = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
    if (!opts.hosted) await kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    await kernel.use(new AppPlugin(APP));
    await kernel.use(new PlatformObjectsPlugin());
    await kernel.use(new AuthPlugin({ secret: SECRET, ...(opts.hosted ? { registerRoutes: false } : {}) } as never));
    await kernel.use(new SecurityPlugin(appSecurityPluginOptions(APP)));
    if (opts.print !== false) await kernel.use(new PrintServicePlugin());
    await kernel.bootstrap();

    let send: Door['send'];
    if (opts.hosted) {
        let server: unknown;
        try { server = kernel.getService('http.server'); } catch { server = undefined; }
        expect(server, 'the hosted shape owns no socket').toBeUndefined();
        const app = createHonoApp({ kernel, prefix: API, cors: false });
        send = async (path, init) => app.request(`${ORIGIN}${path}`, init);
    } else {
        const server = kernel.getService('http.server') as IHttpServer;
        const base = `http://127.0.0.1:${server.getPort!()}`;
        send = (path, init) => fetch(`${base}${path}`, init);
    }

    const door: Door = { kernel, send, aliceToken: '' };
    door.aliceToken = await provision(door, await kernel.getServiceAsync('auth'));
    return door;
}

async function stop(door: Door | undefined): Promise<void> {
    if (!door) return;
    await Promise.race([door.kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
}

/** Alice, provisioned through the operator door, then signed in, both through the composition's own door. */
async function provision(door: Door, auth: any): Promise<string> {
    const ticket = auth.stageOperatorProvisioning(ALICE.email);
    let signUp: Response;
    try {
        signUp = await door.send(`${API}/auth/sign-up/email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', origin: ORIGIN },
            body: JSON.stringify({ ...ALICE, [AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD]: ticket }),
        });
    } finally {
        auth.clearOperatorProvisioning(ALICE.email);
    }
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const signIn = await door.send(`${API}/auth/sign-in/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: ALICE.email, password: ALICE.password }),
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    return ((await signIn.json()) as { token: string }).token;
}

const PRINT_BODY = JSON.stringify({ app: 'conformance', object: NOTE, recordId: 'pd_1', page: 'pd_note_print' });
const print = (token: string | undefined): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: PRINT_BODY,
});

/** Headers a transport adds or drops on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'content-encoding', 'vary']);
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
        body: await res.text(),
    };
}

// The print engine stays unconfigured here, whatever the environment running
// the suite says: the door's 503 for that is the answer under test.
const savedEnv: Record<string, string | undefined> = {};
beforeAll(() => {
    for (const k of PRINT_ENV_KEYS) {
        savedEnv[k] = process.env[k];
        delete process.env[k];
    }
});
afterAll(() => {
    for (const k of PRINT_ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
});

describe('[#36840] the print door answers on the hosted shape (createHonoApp, no http.server)', () => {
    let hosted: Door;
    let selfHosted: Door;
    beforeAll(async () => {
        hosted = await boot({ hosted: true });
        selfHosted = await boot({ hosted: false });
    }, BOOT_TIMEOUT);
    afterAll(async () => { await stop(hosted); await stop(selfHosted); });

    it('anonymous: 401 UNAUTHENTICATED, never a route miss', async () => {
        const res = await hosted.send(`${API}/print/records`, print(undefined));
        const body = await res.text();
        expect(body).not.toContain('ROUTE_NOT_FOUND');
        expect(body).not.toContain('ENDPOINT_NOT_FOUND');
        expect(res.status, body).toBe(401);
        expect(JSON.parse(body).error.code).toBe('UNAUTHENTICATED');
    });

    it('a signed-in member on a deployment with no print engine: the door\'s own 503 SERVICE_UNAVAILABLE', async () => {
        const res = await hosted.send(`${API}/print/records`, print(hosted.aliceToken));
        const body = await res.text();
        expect(res.status, body).toBe(503);
        expect(JSON.parse(body).error.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('both answers are byte-identical at the self-hosted mount and at the hosted door', async () => {
        for (const [label, init] of [
            ['anonymous', (_d: Door) => print(undefined)],
            ['signed in, no engine', (d: Door) => print(d.aliceToken)],
        ] as const) {
            const viaHosted = await snapshot(await hosted.send(`${API}/print/records`, init(hosted)));
            const viaMount = await snapshot(await selfHosted.send(`${API}/print/records`, init(selfHosted)));
            expect(viaHosted.status, label).not.toBe(404);
            expect(viaHosted, label).toEqual(viaMount);
        }
    });
});

describe('[#36840] a hosted kernel without @objectstack/service-print answers a typed 501, never a route miss', () => {
    let door: Door;
    beforeAll(async () => { door = await boot({ hosted: true, print: false }); }, BOOT_TIMEOUT);
    afterAll(async () => { await stop(door); });

    it('POST /print/records: 501 NOT_IMPLEMENTED naming the package', async () => {
        const res = await door.send(`${API}/print/records`, print(door.aliceToken));
        const body = (await res.json()) as any;
        expect(res.status).toBe(501);
        expect(body.error.code).toBe('NOT_IMPLEMENTED');
        expect(body.error.message).toContain('@objectstack/service-print');
    });
});
