// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment gate on the metadata HMR door (#12140).
 *
 * ## What was wrong, measured rather than inferred
 *
 * `GET`/`POST /api/v1/dev/metadata-events` mount through
 * `IHttpServer.getRawApp()`, which puts them outside REST's `enforceAuth` seam
 * BY CONSTRUCTION, and nothing else gated them: `MetadataPlugin` mounted them
 * whenever a raw-app-capable HTTP server was present, and the only `isDev` guard
 * in the tree sits on the CLI's SUPPLEMENTARY composition in `serve.ts`, which
 * never reaches this mount. The distributions were then enumerated, because
 * "a dev-only surface missing a gate that says so" and "an unauthenticated door
 * on a real deployment" want different fixes and only the enumeration separates
 * them:
 *
 *  - `docker/Dockerfile` runs `os start` with `NODE_ENV=production`;
 *  - `os start` / `os serve` reach `createStandaloneStack`, which composes
 *    `MetadataPlugin` UNCONDITIONALLY (only `artifactWatch` is NODE_ENV-gated);
 *  - the serve path registers `HonoServerPlugin` whenever `flags.server` is set,
 *    with no dev condition, and that adapter exposes `getRawApp()`.
 *
 * So a production-shaped boot mounted both routes and answered them. `POST`
 * re-reads the artifact from disk and broadcasts a reload to every connected
 * client — an unauthenticated write-shaped side effect plus a broadcast.
 *
 * ## What these pins hold, and why each direction is here
 *
 * A gate is only a gate if it REFUSES; a test that watches the open direction
 * alone passes just as well against no gate at all. So every case below comes in
 * pairs: the door opens under an explicit development posture and is closed —
 * zero routes registered, `null` returned — under every other reading of
 * `NODE_ENV`, including the unset one that the maintainer's 2026-08-06 ruling
 * settled as `production`.
 *
 * The last describe drives `MetadataPlugin.start()` end to end against a fake
 * `http.server`, because the unit above it pins the registrar and the plugin is
 * what CALLS the registrar. Without it, a future edit that resolves the raw app
 * and registers routes some other way would leave every assertion above green.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isDevMetadataEndpointEnabled, registerMetadataHmrRoutes } from './hmr-routes.js';
import { MetadataPlugin } from '../plugin.js';
import type { MetadataManager } from '../metadata-manager.js';

const ROUTE = '/api/v1/dev/metadata-events';

/** A stand-in for the Hono handle `getRawApp()` returns: records what is mounted. */
function fakeApp() {
    const mounted: Array<{ verb: string; path: string }> = [];
    const handlers = new Map<string, (c: any) => Promise<Response>>();
    const record = (verb: string) => (path: string, handler: (c: any) => Promise<Response>) => {
        mounted.push({ verb, path });
        handlers.set(`${verb} ${path}`, handler);
    };
    return { mounted, handlers, get: record('GET'), post: record('POST') };
}

/** Enough MetadataManager for the registrar: it only reads the type registry. */
function fakeManager(): MetadataManager {
    return {
        getRegisteredTypes: async () => ['object', 'view'],
    } as unknown as MetadataManager;
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe('[#12140] isDevMetadataEndpointEnabled — exactly one spelling opens the door', () => {
    // The closed cases are the point of the table. `test` is closed on purpose:
    // nothing about a vitest process makes an open reload door correct. The
    // unrecognised spellings (`staging`, `preview`, `qa`) are closed for the
    // reason a GATE differs from `resolveDiscoveryEnvironment`, which degrades
    // exactly those to `development` — safe for a discovery field, backwards for
    // a door.
    const cases: Array<[string | undefined, boolean]> = [
        ['development', true],
        ['Development', true],     // normalised, like the discovery mapper
        ['  development  ', true], // a stray space in a .env must not decide it
        ['production', false],
        ['test', false],
        ['staging', false],
        ['preview', false],
        ['qa', false],
        ['dev', false],            // NOT a synonym — one spelling, deliberately
        ['', false],
        [undefined, false],        // unset reads as production (2026-08-06 ruling)
    ];

    it.each(cases)('NODE_ENV=%o → enabled=%s', (value, expected) => {
        expect(isDevMetadataEndpointEnabled({ NODE_ENV: value })).toBe(expected);
    });

    it('reads the live process env when none is injected', () => {
        vi.stubEnv('NODE_ENV', 'development');
        expect(isDevMetadataEndpointEnabled()).toBe(true);
        vi.stubEnv('NODE_ENV', 'production');
        expect(isDevMetadataEndpointEnabled()).toBe(false);
    });
});

describe('[#12140] registerMetadataHmrRoutes — the refusal is at the door', () => {
    it('mounts both verbs and returns a hub under NODE_ENV=development', () => {
        vi.stubEnv('NODE_ENV', 'development');
        const app = fakeApp();

        const hub = registerMetadataHmrRoutes(app as any, fakeManager());

        expect(hub).not.toBeNull();
        expect(app.mounted).toEqual([
            { verb: 'GET', path: ROUTE },
            { verb: 'POST', path: ROUTE },
        ]);
    });

    it('mounts NOTHING and returns null under NODE_ENV=production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const app = fakeApp();

        const hub = registerMetadataHmrRoutes(app as any, fakeManager());

        expect(hub).toBeNull();
        expect(app.mounted).toEqual([]);
    });

    it('mounts NOTHING when NODE_ENV is unset — the fail-closed direction', () => {
        vi.stubEnv('NODE_ENV', undefined);
        const app = fakeApp();

        expect(registerMetadataHmrRoutes(app as any, fakeManager())).toBeNull();
        expect(app.mounted).toEqual([]);
    });

    // The transition, measured in the direction clause ② asks for: the caller
    // this door exists for — `os dev`'s watch-recompile loop — still gets its
    // 200 and its broadcast when the door is open. A gate that also broke the
    // permitted caller would pass every refusal assertion above.
    it('the permitted caller still works: POST answers 200 and broadcasts', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        const app = fakeApp();
        const hub = registerMetadataHmrRoutes(app as any, fakeManager());
        expect(hub).not.toBeNull();

        const seen: string[] = [];
        hub!.setOnPostReload(async (body) => { seen.push(body?.reason ?? '(none)'); });

        const handler = app.handlers.get(`POST ${ROUTE}`)!;
        const res = await handler({
            req: {
                header: () => 'application/json',
                json: async () => ({ reason: 'recompiled', changed: ['dist/objectstack.json'] }),
            },
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ ok: true, reason: 'recompiled' });
        expect(seen).toEqual(['recompiled']);
    });
});

describe('[#12140] MetadataPlugin.start() — the plugin honours the gate end to end', () => {
    function artifactFile(): string {
        const dir = mkdtempSync(join(tmpdir(), 'os-hmr-gate-'));
        const file = join(dir, 'objectstack.json');
        writeFileSync(file, JSON.stringify({
            manifest: {
                id: 'com.example.gate', name: 'gate', version: '0.0.0',
                type: 'app', namespace: 'gate', defaultDatasource: 'memory',
            },
            objects: [], views: [], apps: [], flows: [],
        }), 'utf8');
        return file;
    }

    /**
     * `getService` THROWS for an empty slot — that is the kernel's contract, and
     * the plugin's per-name `try` around each read depends on it. A fake that
     * returned `undefined` instead would exercise a path the real kernel never
     * produces.
     */
    function fakeCtx(app: ReturnType<typeof fakeApp>) {
        return {
            logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
            registerService: vi.fn(),
            trigger: vi.fn(async () => {}),
            getService: (name: string) => {
                if (name === 'http.server') return { getRawApp: () => app };
                throw new Error(`no service '${name}'`);
            },
        } as any;
    }

    async function startWith(nodeEnv: string | undefined) {
        vi.stubEnv('NODE_ENV', nodeEnv);
        const app = fakeApp();
        const plugin = new MetadataPlugin({
            watch: false,
            // `artifact-only` keeps the drive on the artifact path: no
            // filesystem scan, no FileSystemRepository, nothing but the mount
            // decision under test.
            config: { bootstrap: 'artifact-only' },
            // The artifact-file watcher is a separate decision and is left
            // alone by this card — turned off here so the drive owns no timers.
            artifactWatch: false,
            artifactSource: { mode: 'local-file', path: artifactFile() },
        });
        await plugin.start(fakeCtx(app));
        return app;
    }

    it('mounts both routes on a development boot', async () => {
        const app = await startWith('development');
        expect(app.mounted).toEqual([
            { verb: 'GET', path: ROUTE },
            { verb: 'POST', path: ROUTE },
        ]);
    });

    it('mounts NOTHING on a production boot — the docker `os start` shape', async () => {
        const app = await startWith('production');
        expect(app.mounted).toEqual([]);
    });

    it('mounts NOTHING when the operator never exported NODE_ENV', async () => {
        const app = await startWith(undefined);
        expect(app.mounted).toEqual([]);
    });
});
