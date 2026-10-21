// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every door in this repository that mounts CORS or reads `OS_CORS_ORIGIN`,
 * held to ONE answer for one configuration.
 *
 * The governing text is `docs/HARDENING.md` § CORS: "Do **not** use
 * `origin: '*'` with `credentials: true`", and the go-live checklist's "CORS
 * origin list is explicit, not `*`". A door that keeps an older default is a
 * hole in that rule however well the other doors keep it, so this file lists
 * the doors and asks each of them the same questions.
 *
 * ## The doors
 *
 * Measured with a repository grep for every non-test reader of
 * `OS_CORS_ORIGIN` and every importer of `hono/cors` under `packages/`:
 *
 *  - `HonoServerPlugin` (`@objectstack/plugin-hono-server`) — the server
 *    `os serve`, `os dev` and `os start` mount;
 *  - `createHonoApp` (`@objectstack/hono`) — the app a host composes itself;
 *  - `AuthManager`'s trusted-origin merge (`@objectstack/plugin-auth`) —
 *    better-auth trusts the origins `OS_CORS_ORIGIN` lists.
 *
 * The two transport doors read ONE rule (`resolveCorsAdmission`), so for
 * them the answer is the same by construction and this file proves it stays
 * so. The auth door answers a narrower question — which listed entries it
 * trusts — and is held to the same judgement of each entry: an entry that
 * admits every host (`'*'`, or a pattern whose host part is the bare `*`) is
 * refused with credentials at the transport and never trusted by auth.
 *
 * ⛔ A NEW door — another adapter that mounts `hono/cors`, another reader of
 * `OS_CORS_ORIGIN` — is added to `DOORS` below in the PR that creates it, and
 * must answer every row the way the doors already here do.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';
import { HonoServerPlugin, normalizeOriginPatterns } from '@objectstack/plugin-hono-server';
import { createHonoApp } from '@objectstack/hono';
import { AuthManager } from '@objectstack/plugin-auth';
import type { AuthManagerOptions } from '@objectstack/plugin-auth';

const CONFIGURED = 'https://app.example.com';
const FOREIGN = 'https://other.example';
const LOOPBACK = 'http://localhost:5173';
const SUBDOMAIN = 'https://tenant.example.net';

/** The request origins every transport door is asked about, on every row. */
const PROBES = [CONFIGURED, FOREIGN, LOOPBACK, SUBDOMAIN] as const;

/** Every variable a door reads, canonical and legacy spellings. */
const ENV_KEYS = [
    'OS_CORS_ENABLED', 'CORS_ENABLED',
    'OS_CORS_ORIGIN', 'CORS_ORIGIN',
    'OS_CORS_CREDENTIALS', 'CORS_CREDENTIALS',
    'OS_CORS_MAX_AGE', 'CORS_MAX_AGE',
    'OS_SSO_ENABLED',
    'NODE_ENV',
] as const;

/**
 * A transport door's answer: refused when it is mounted, or which probe
 * origins it echoes in `Access-Control-Allow-Origin` and whether it sends
 * `Access-Control-Allow-Credentials`.
 */
type TransportAnswer = 'refused' | { readonly admits: readonly string[]; readonly credentials: boolean };

interface ProbeTarget {
    request(path: string, init?: RequestInit): Response | Promise<Response>;
}

async function observe(target: ProbeTarget): Promise<TransportAnswer> {
    const admits: string[] = [];
    let credentials = false;
    for (const origin of PROBES) {
        const res = await target.request('/probe', { headers: { Origin: origin, Cookie: 'session=1' } });
        expect(res.status).toBe(200);
        if (res.headers.get('access-control-allow-origin') === origin) admits.push(origin);
        if (res.headers.get('access-control-allow-credentials') === 'true') credentials = true;
    }
    return { admits, credentials };
}

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

interface RawApp extends ProbeTarget {
    get(path: string, handler: (c: { text(body: string): Response }) => Response): unknown;
}

const DOORS = {
    transport: {
        /** The server `os serve` / `os dev` / `os start` mount — its real `init()`. */
        HonoServerPlugin: async (): Promise<TransportAnswer> => {
            const plugin = new HonoServerPlugin({ port: 0, serverTiming: false });
            const refused = await plugin.init(fakeCtx()).then(() => false, () => true);
            if (refused) return 'refused';
            const rawApp = (plugin as unknown as { server: { getRawApp(): RawApp } }).server.getRawApp();
            rawApp.get('/probe', (c) => c.text('ok'));
            return observe(rawApp);
        },
        /** The app a host composes itself — the real `createHonoApp`. */
        createHonoApp: async (): Promise<TransportAnswer> => {
            let app: ReturnType<typeof createHonoApp>;
            try {
                app = createHonoApp({ kernel: new LiteKernel() as never, prefix: '/api/v1' });
            } catch {
                return 'refused';
            }
            app.get('/probe', (c) => c.text('ok'));
            return observe(app);
        },
    },
    /** better-auth's trusted origins, read off a REAL instance: the entries taken from `OS_CORS_ORIGIN`. */
    trust: async (): Promise<string[]> => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const manager = new AuthManager({ secret: 'x'.repeat(40), baseUrl: CONFIGURED } as unknown as AuthManagerOptions);
            const trusted = ((await manager.getAuthInstance()).options.trustedOrigins ?? []) as string[];
            const listed = normalizeOriginPatterns(process.env.OS_CORS_ORIGIN ?? '');
            return trusted.filter((origin) => listed.includes(origin));
        } finally {
            warn.mockRestore();
        }
    },
};

interface Row {
    readonly name: string;
    readonly env: Partial<Record<(typeof ENV_KEYS)[number], string>>;
    /** What BOTH transport doors answer. */
    readonly transport: TransportAnswer;
    /** The `OS_CORS_ORIGIN` entries auth trusts. */
    readonly trusted: readonly string[];
}

/** The entries the rows below use that admit every host — never trusted by auth at any row. */
const ADMITS_EVERY_HOST = ['*', 'https://*'] as const;

const PRODUCTION = { NODE_ENV: 'production' } as const;
const DEVELOPMENT = { NODE_ENV: 'development' } as const;

const ROWS: readonly Row[] = [
    {
        name: 'no list, not a development boot',
        env: { ...PRODUCTION },
        transport: { admits: [], credentials: true },
        trusted: [],
    },
    {
        name: 'no list, development boot',
        env: { ...DEVELOPMENT },
        transport: { admits: [LOOPBACK], credentials: true },
        trusted: [],
    },
    {
        name: 'an exact origin, not a development boot',
        env: { ...PRODUCTION, OS_CORS_ORIGIN: CONFIGURED },
        transport: { admits: [CONFIGURED], credentials: true },
        trusted: [CONFIGURED],
    },
    {
        name: 'an exact origin, development boot',
        env: { ...DEVELOPMENT, OS_CORS_ORIGIN: CONFIGURED },
        transport: { admits: [CONFIGURED, LOOPBACK], credentials: true },
        trusted: [CONFIGURED],
    },
    {
        name: 'a pattern that names part of the host',
        env: { ...PRODUCTION, OS_CORS_ORIGIN: 'https://*.example.net' },
        transport: { admits: [SUBDOMAIN], credentials: true },
        trusted: ['https://*.example.net'],
    },
    {
        name: "'*' among real origins, credentials on",
        env: { ...PRODUCTION, OS_CORS_ORIGIN: `${CONFIGURED},*` },
        transport: 'refused',
        trusted: [CONFIGURED],
    },
    {
        name: 'a pattern whose host part is the bare `*`, credentials on',
        env: { ...PRODUCTION, OS_CORS_ORIGIN: `${CONFIGURED}, https://*` },
        transport: 'refused',
        trusted: [CONFIGURED],
    },
    {
        name: "'*' with credentials off",
        env: { ...PRODUCTION, OS_CORS_ORIGIN: '*', OS_CORS_CREDENTIALS: 'false' },
        transport: { admits: [...PROBES], credentials: false },
        trusted: [],
    },
    {
        name: 'a pattern whose host part is the bare `*`, among real origins, credentials off',
        env: { ...PRODUCTION, OS_CORS_ORIGIN: `${CONFIGURED},https://*`, OS_CORS_CREDENTIALS: 'false' },
        transport: { admits: [CONFIGURED, FOREIGN, SUBDOMAIN], credentials: false },
        trusted: [CONFIGURED],
    },
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('every CORS door gives one configuration one answer', () => {
    for (const row of ROWS) {
        describe(row.name, () => {
            beforeEach(() => {
                for (const [k, v] of Object.entries(row.env)) process.env[k] = v;
            });

            it('both transport doors answer it, and answer it the same', async () => {
                const answers = Object.fromEntries(
                    await Promise.all(
                        Object.entries(DOORS.transport).map(async ([door, ask]) => [door, await ask()] as const),
                    ),
                );
                expect(answers).toEqual({ HonoServerPlugin: row.transport, createHonoApp: row.transport });
            });

            it("auth trusts the listed entries the transport honours, and no entry that admits every host", async () => {
                const trusted = await DOORS.trust();
                expect(trusted).toEqual(row.trusted);
                for (const entry of ADMITS_EVERY_HOST) expect(trusted).not.toContain(entry);
            });
        });
    }
});
