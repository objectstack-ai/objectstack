// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8976] EVERY mutating `install-local` route demands the ADR-0066 D1
 * `manage_metadata` authoring capability — and no route can be added to this
 * family without answering the question.
 *
 * ## THIS is the file that answers "is install-local gated?"
 *
 * Two sibling files in this package have names that sound like they answer it
 * and do not — see the "not this file" docblocks now standing in
 * `marketplace-install-local-posture-gate.test.ts` (a data-shape ceremony the
 * CALLER satisfies from their own request body) and
 * `marketplace-install-local-tenancy-posture.test.ts` (which seeding path runs).
 * Both were green the entire time the door was open. If you are auditing
 * authorization on this surface, this file and the enumeration below are the
 * evidence; a green neighbour is not.
 *
 * ## What was measured before the gate landed
 *
 * Three principal shapes driven through the composed plugin to the point the
 * state actually changes — `manifest.register()` (shared registry),
 * `objectql.syncSchemas()` (DDL against the shared database), the ledger file on
 * disk, `SeedLoaderService.load()` (rows written), `driver.delete()` (rows
 * removed). All three were INDISTINGUISHABLE:
 *
 *   principal                              install  reseed  purge  uninstall
 *   bare `x-user-id` header, NO session      200      200    200      200
 *   authenticated, no capability             200      200    200      200
 *   authenticated, `manage_metadata`         200      200    200      200
 *
 * Every effect fired for every shape; nothing downstream refused. The first row
 * is the one worth restating: an UNAUTHENTICATED caller who could reach the port
 * completed a full schema-mutating install and had `installedBy` recorded as the
 * string they chose, because `requireAuthenticatedUser` ended in a bare
 * `x-user-id` header fallback.
 *
 * ## Why an enumeration and not four more assertions
 *
 * The same reason as the `/meta` precedent (#8919,
 * `meta-write-door-capability-enumeration.test.ts`): a gate held by repetition
 * drifts the moment someone adds a fifth route by copying whichever neighbour
 * was nearest. `derives every mutating route the plugin mounts` builds the door
 * list from the raw app's OWN route table, so a new mutating route fails here on
 * the day it is added — before anyone has to notice it lacks a gate.
 *
 * ⚠️ The `GET` listing is deliberately NOT in this family. It is a read, and
 * this card's ruling is about the four mutating doors; its own posture is a
 * separate question tracked separately, and silently folding it in here would
 * decide it by accident.
 *
 * ## Rejection cases assert the ENVELOPE (ADR-0112) AND the absence of effect
 *
 * `code` AND `status`, never a bare "it failed" — these handlers answer by
 * RETURNING a response, so a throw-shaped assertion could not tell "refused with
 * the wrong envelope" from "did not refuse at all". Each refusal also asserts
 * that no registry, schema, ledger, seed or delete effect fired: a gate that
 * answers 403 after `syncSchemas()` has already run is still the bug.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const seedCalls: unknown[] = [];
vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: unknown) {
            seedCalls.push(request);
            return { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        }
    },
    recordSeedOutcome: vi.fn(),
}));

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';

const ROUTE_BASE = '/api/v1/marketplace/install-local';

type Handler = (c: any) => Promise<any>;

/**
 * The raw Hono app the plugin mounts on — and the route table the anti-drift
 * assertion reads back. Keys are `"<METHOD> <path>"`, which is what makes
 * "everything the plugin registered" enumerable rather than recited.
 */
function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/** The three principal shapes the ruling names, as the resolver sees them. */
type Shape = 'header-only' | 'member' | 'org-admin' | 'capable';

/**
 * Rows the shared authz resolver (`resolveAuthzContext`) reads to aggregate
 * `systemPermissions`. Building the grant out of REAL `sys_user_permission_set`
 * + `sys_permission_set` rows rather than handing the plugin a pre-baked
 * capability list is what keeps this test honest about the resolution path: a
 * gate wired to a different aggregate would not see these.
 */
function grantRows(shape: Shape): Record<string, any[]> {
    const sets: Record<Shape, string[]> = {
        'header-only': [],
        member: [],
        // The tenant org-admin shape: real capabilities, none of them authoring.
        // `organization_admin` deliberately withholds `manage_metadata`.
        'org-admin': ['setup.access', 'setup.write', 'manage_org_users'],
        capable: ['manage_metadata', 'studio.access', 'setup.access'],
    };
    const held = sets[shape];
    return {
        sys_user: [{ id: `usr_${shape}`, email: `${shape}@acme.test` }],
        sys_member: [],
        sys_user_position: [],
        sys_position: [],
        sys_position_permission_set: [],
        sys_user_permission_set: held.length
            ? [{ id: 'ups1', user_id: `usr_${shape}`, permission_set_id: 'ps1', organization_id: null }]
            : [],
        sys_permission_set: held.length
            ? [{ id: 'ps1', name: shape === 'capable' ? 'admin_full_access' : 'organization_admin', system_permissions: held }]
            : [],
    };
}

const APP = {
    id: 'com.acme.gated',
    namespace: 'gated',
    version: '1.0.0',
    objects: [{ name: 'widget', fields: { code: { type: 'text' } } }],
    data: [{ object: 'widget', records: [{ id: 'w1', code: 'a' }, { id: 'w2', code: 'b' }] }],
};

const LEDGER_FILE = 'com.acme.gated.json';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-gate-')); seedCalls.length = 0; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/**
 * Compose the plugin the way the kernel does — `start()` + the `kernel:ready`
 * hook — over a real ledger directory, and hand back both the route table and
 * every effect observer the refusal cases need.
 */
async function mount(shape: Shape, storageDir: string) {
    const register = vi.fn(async () => undefined);
    const syncSchemas = vi.fn(async () => undefined);
    const driverDelete = vi.fn(async () => true);
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();

    // The header-only shape has NO session: `getSession` resolves nothing, which
    // is exactly the state the old `x-user-id` tail used to rescue.
    const sessionUser = shape === 'header-only' ? null : { id: `usr_${shape}` };
    const rows = grantRows(shape);

    const services: Record<string, any> = {
        manifest: { register },
        auth: { api: { getSession: async () => (sessionUser ? { user: sessionUser, session: {} } : null) } },
        objectql: { syncSchemas, find: async (object: string) => rows[object] ?? [] },
        metadata: { getObject: async () => ({ name: 'widget', fields: {} }) },
        driver: { delete: driverDelete },
    };
    const ctx: any = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        registerService: () => undefined,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const plugin = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir });
    await plugin.start(ctx);
    await hooks.get('kernel:ready')?.();
    // `kernel:ready` registers the plugin's own Setup nav bundle; the effect
    // counters must start from AFTER that so a refusal case cannot be fooled by
    // boot-time activity it never caused.
    register.mockClear();
    return { rawApp, register, syncSchemas, driverDelete };
}

function makeC(body: unknown, headers: Record<string, string>, manifestId?: string) {
    const h = new Headers(headers);
    return {
        req: {
            url: `http://localhost:3000${ROUTE_BASE}`,
            raw: new Request('http://localhost:3000/x', { headers: h }),
            header: (n: string) => h.get(n) ?? undefined,
            json: async () => body,
            param: () => manifestId,
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

/**
 * One mutating install-local door: how to address it, and what state changing
 * looks like once the gate lets it through. `effectsFired` is what makes the
 * "nothing was mutated" half of each refusal checkable — a status code alone
 * cannot tell a refusal from a refusal issued too late.
 */
interface Door {
    readonly label: string;
    readonly route: string;
    readonly body?: unknown;
    /** Does this door need an existing install to act on? */
    readonly needsInstalled: boolean;
    readonly effectsFired: (o: Awaited<ReturnType<typeof mount>>, storageDir: string) => number;
}

const DOORS: readonly Door[] = [
    {
        label: 'POST /install-local (inline manifest → registry + syncSchemas + ledger + seed)',
        route: `POST ${ROUTE_BASE}`,
        body: { manifest: APP },
        needsInstalled: false,
        effectsFired: (o, d) =>
            o.register.mock.calls.length
            + o.syncSchemas.mock.calls.length
            + seedCalls.length
            + (existsSync(join(d, LEDGER_FILE)) ? 1 : 0),
    },
    {
        label: 'DELETE /install-local/:manifestId (removes the ledger entry)',
        route: `DELETE ${ROUTE_BASE}/:manifestId`,
        needsInstalled: true,
        // The install this acts on is already on disk, so the effect is its
        // DISAPPEARANCE — inverted deliberately, because "0 effects" has to mean
        // "nothing changed" for every door or the shared assertion below is a lie.
        effectsFired: (_o, d) => (existsSync(join(d, LEDGER_FILE)) ? 0 : 1),
    },
    {
        label: 'POST /install-local/:manifestId/reseed-sample-data (writes rows)',
        route: `POST ${ROUTE_BASE}/:manifestId/reseed-sample-data`,
        body: {},
        needsInstalled: true,
        effectsFired: () => seedCalls.length,
    },
    {
        label: 'POST /install-local/:manifestId/purge-sample-data (deletes rows)',
        route: `POST ${ROUTE_BASE}/:manifestId/purge-sample-data`,
        body: {},
        needsInstalled: true,
        effectsFired: (o) => o.driverDelete.mock.calls.length,
    },
];

/** Pre-install as a capable operator so the three follow-on doors have a target. */
async function seedInstall(storageDir: string) {
    const setup = await mount('capable', storageDir);
    const install = setup.rawApp.routes.get(`POST ${ROUTE_BASE}`)!;
    const res = await install(makeC({ manifest: APP }, {}));
    expect(res.payload.success).toBe(true);
    expect(existsSync(join(storageDir, LEDGER_FILE))).toBe(true);
}

async function knock(shape: Shape, door: Door, storageDir: string) {
    if (door.needsInstalled) await seedInstall(storageDir);
    const mounted = await mount(shape, storageDir);
    // AFTER the mount, deliberately. `kernel:ready` rehydrates the ledger and
    // the rehydrate-time healer re-runs the bundled datasets, so a counter reset
    // before mounting attributes a BOOT-time seed to the request under test —
    // measured: it made the reseed refusal cases read as "the gate let a write
    // through" when the gate had refused correctly and the plugin had simply
    // booted. The observation window is the request, not the process.
    seedCalls.length = 0;
    const handler = mounted.rawApp.routes.get(door.route)!;
    const headers = shape === 'header-only' ? { 'x-user-id': 'attacker' } : {};
    const res = await handler(makeC(door.body ?? {}, headers, 'com.acme.gated'));
    return { res, effects: door.effectsFired(mounted, storageDir) };
}

describe('#8976 — the mutating install-local doors are enumerated, not recited', () => {
    it('derives every mutating route the plugin mounts (the anti-drift assertion)', async () => {
        // THE POINT OF THIS FILE. A new mutating install-local route fails here
        // until it is enumerated above — at which point its refusal cases below
        // run and the author learns whether it carries the gate. A door added
        // without one can no longer arrive silently.
        const { rawApp } = await mount('capable', dir);
        const mounted = Array.from(rawApp.routes.keys())
            .filter((k) => !k.startsWith('GET '))
            .sort();
        expect(mounted).toEqual(DOORS.map((d) => d.route).sort());
    });

    it('mounts the read listing too — so the filter above is a CHOICE, not an empty set', async () => {
        // Without this, a refactor that stopped mounting the GET would leave the
        // assertion above passing while silently proving less than it claims.
        const { rawApp } = await mount('capable', dir);
        expect(rawApp.routes.has(`GET ${ROUTE_BASE}`)).toBe(true);
    });
});

describe('#8976 — a header-only caller is refused 401 and changes nothing', () => {
    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s',
        async (_label, door) => {
            // The regression this pins: `requireAuthenticatedUser` used to end in
            // `c.req.header('x-user-id')`, so this exact request completed.
            const { res, effects } = await knock('header-only', door, dir);
            expect(res.status).toBe(401);
            expect(res.payload).toMatchObject({ error: { code: 'UNAUTHENTICATED' } });
            expect(effects).toBe(0);
        },
    );
});

describe('#8976 — an authenticated caller without the capability is refused 403', () => {
    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → plain member',
        async (_label, door) => {
            const { res, effects } = await knock('member', door, dir);
            expect(res.status).toBe(403);
            expect(res.payload).toMatchObject({ error: { code: 'FORBIDDEN' } });
            expect(res.payload.error.message).toContain('manage_metadata');
            expect(effects).toBe(0);
        },
    );

    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s → tenant org-admin (setup.access / setup.write / manage_org_users)',
        async (_label, door) => {
            // The cross-tenant edge, stated as a test. Metadata is
            // environment-scoped, so Layer 0's tenant wall does not reach these
            // writes; `organization_admin` deliberately withholds
            // `manage_metadata` precisely so a tenant administrator cannot mutate
            // the schema every other tenant runs on. Setup-app capabilities are
            // NOT authoring capabilities — the same separation #6603/#7020 pinned
            // on the `/meta` doors.
            const { res, effects } = await knock('org-admin', door, dir);
            expect(res.status).toBe(403);
            expect(res.payload).toMatchObject({ error: { code: 'FORBIDDEN' } });
            expect(effects).toBe(0);
        },
    );
});

describe('#8976 — the control: a `manage_metadata` holder still gets through', () => {
    it.each(DOORS.map((d) => [d.label, d] as const))(
        '%s',
        async (_label, door) => {
            const { res, effects } = await knock('capable', door, dir);
            expect(res.status).toBe(200);
            expect(res.payload.success).toBe(true);
            expect(effects).toBeGreaterThan(0);
        },
    );

    it('records the VERIFIED principal as `installedBy`, never a caller-supplied string', async () => {
        // The old header path wrote whatever the caller sent. The identity on the
        // ledger row is now the one the shared resolver verified.
        const { rawApp } = await mount('capable', dir);
        const install = rawApp.routes.get(`POST ${ROUTE_BASE}`)!;
        await install(makeC({ manifest: APP }, { 'x-user-id': 'attacker' }));
        const entry = JSON.parse(readFileSync(join(dir, LEDGER_FILE), 'utf8'));
        expect(entry.installedBy).toBe('usr_capable');
        expect(entry.installedBy).not.toBe('attacker');
    });
});
