// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23455 — ruling C′ items 1 and 4] The install-local doors judge an API key
 * by the answer the shared key-admission seam gives for its OWNER.
 *
 * ## What was open
 *
 * `MarketplaceInstallLocalPlugin.resolveInstallPrincipal` called
 * `resolveAuthzContext` with no owner-posture source and asked the ADR-0069
 * gate about the session user alone. An API key admits its owner without a
 * session, so a key whose owner owes MFA enrolment carried no posture here and
 * all five doors served it, while REST and every face ruling C′ built refuse
 * the same key with `403 MFA_REQUIRED`.
 *
 * ## What is pinned, through the booted plugin's own doors
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → all five doors
 *    answer `403 MFA_REQUIRED` with the session's message, before any effect;
 *  - a key whose owner holds only `PASSWORD_RESET_REQUIRED` (scope
 *    `credential`) → served;
 *  - the refusal is not a revocation: the same key is served again once the
 *    posture clears, with nothing rewritten.
 *
 * The harness is `cloud-connection-auth-gate.pin.test.ts`'s install-local
 * half, with a data engine that knows the key and an auth service that answers
 * a per-user posture (`resolveUserAuthGates`, the computation plugin-auth's
 * `AuthManager` exposes).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashApiKey } from '@objectstack/core';

const seedCalls: unknown[] = [];
vi.mock('@objectstack/runtime', () => ({
    SeedLoaderService: class {
        async load(request: unknown) {
            seedCalls.push(request);
            return { summary: { totalInserted: 2, totalUpdated: 0, totalSkipped: 0 }, errors: [] };
        }
        async buildDependencyGraph(objectNames: string[]) {
            return {
                nodes: objectNames.map((object) => ({ object, dependsOn: [], references: [] })),
                insertOrder: objectNames,
                circularDependencies: [],
            };
        }
    },
    recordSeedOutcome: vi.fn(),
}));

import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { bindCatalogFromTables } from './__tests__/security-catalog.testkit.js';

const IL = '/api/v1/marketplace/install-local';
const KEY = 'osk_install_local_account_posture_pin';
const OWNER = 'u_key_owner';

const MFA_REQUIRED = {
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_RESET_REQUIRED = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

type Posture = { code: string; message: string };

const APP = {
    id: 'com.acme.keyheld',
    namespace: 'keyheld',
    version: '1.0.0',
    objects: [{ name: 'widget', fields: { code: { type: 'text' } } }],
    data: [{ object: 'widget', externalId: 'code', records: [{ code: 'a' }, { code: 'b' }] }],
};
const LEDGER_FILE = 'com.acme.keyheld.json';

/** Equality and `$in` — the two shapes the shared resolver issues — and nothing else, loudly. */
function matchesWhere(row: Record<string, unknown>, where: unknown): boolean {
    for (const [field, cond] of Object.entries((where ?? {}) as Record<string, unknown>)) {
        if (field.startsWith('$')) throw new Error(`fixture where-matcher: unsupported combinator '${field}'`);
        if (cond !== null && typeof cond === 'object') {
            const ops = Object.keys(cond as object);
            if (ops.length !== 1 || ops[0] !== '$in' || !Array.isArray((cond as { $in?: unknown }).$in)) {
                throw new Error(`fixture where-matcher: unsupported operator shape on '${field}'`);
            }
            if (!(cond as { $in: unknown[] }).$in.includes(row[field])) return false;
            continue;
        }
        if (row[field] !== cond) return false;
    }
    return true;
}

/**
 * The key's owner holds the authoring capability, so a refusal below is the gate's alone:
 * the `admin_full_access` grant owned by the Default Organization, which applies with no
 * active organization (a key carries none here).
 */
function grantRows(): Record<string, Array<Record<string, unknown>>> {
    return {
        sys_organization: [{ id: 'org_default', slug: 'default' }],
        sys_api_key: [{ id: 'key_1', key: hashApiKey(KEY), user_id: OWNER, revoked: false, scopes: '[]' }],
        sys_user: [{ id: OWNER, email: 'owner@acme.test' }],
        sys_member: [],
        sys_user_position: [],
        sys_position: [],
        sys_metadata_activation: [],
        sys_position_permission_set: [],
        sys_user_permission_set: [
            { id: 'ups1', user_id: OWNER, permission_set_id: 'ps1', permission_set: 'admin_full_access', organization_id: 'org_default' },
        ],
        sys_permission_set: [{ id: 'ps1', name: 'admin_full_access', system_permissions: ['manage_metadata', 'studio.access', 'setup.access'] }],
    };
}

type Handler = (c: any) => Promise<any>;

/**
 * Boot the plugin with an auth service whose per-user posture is read from
 * `postures` on every ask, so a test can move it while the doors are live.
 */
async function mountInstallLocal(storageDir: string, postures: Record<string, Posture[]>) {
    const register = vi.fn(async () => undefined);
    const syncSchemas = vi.fn(async () => undefined);
    const widgets = [{ id: 'w1', code: 'a' }, { id: 'w2', code: 'b' }];
    const engineDelete = vi.fn(async (object: string, options?: any) => {
        const dispatch = assertEngineDeleteDispatch(options);
        if (object !== 'widget' || dispatch.kind !== 'by-id') return false;
        const at = widgets.findIndex((w) => w.id === dispatch.id);
        if (at < 0) return false;
        widgets.splice(at, 1);
        return true;
    });
    const routes = new Map<string, Handler>();
    const rawApp = {
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
    const hooks = new Map<string, any>();
    const rows = grantRows();
    const keyRowBefore = JSON.stringify(rows.sys_api_key);
    const services: Record<string, any> = {
        manifest: { register },
        auth: {
            // No session: every caller below presents the key alone.
            api: { getSession: async () => null },
            resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
        },
        objectql: bindCatalogFromTables({
            syncSchemas,
            find: async (object: string, q: any = {}) => {
                if (object === 'widget') return widgets.map((w) => ({ ...w }));
                const matched = (rows[object] ?? []).filter((row) => matchesWhere(row, q?.where));
                return typeof q?.limit === 'number' ? matched.slice(0, q.limit) : matched;
            },
            delete: engineDelete,
        }, rows),
        metadata: { getObject: async () => ({ name: 'widget', fields: {} }) },
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
    await new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir }).start(ctx);
    await hooks.get('kernel:ready')?.();
    // `kernel:ready` rehydrates the ledger, so every counter starts AFTER it.
    register.mockClear();
    syncSchemas.mockClear();
    engineDelete.mockClear();
    seedCalls.length = 0;
    return {
        routes,
        effects: () => register.mock.calls.length + syncSchemas.mock.calls.length + seedCalls.length + engineDelete.mock.calls.length,
        keyRowUnchanged: () => JSON.stringify(rows.sys_api_key) === keyRowBefore,
    };
}

function withKey(body: unknown = {}, manifestId?: string) {
    const headers = new Headers({ 'x-api-key': KEY });
    const url = `http://localhost${IL}`;
    return {
        req: {
            url,
            raw: new Request(url, { headers }),
            header: (n: string) => headers.get(n) ?? undefined,
            json: async () => body,
            param: () => manifestId,
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

/** The five doors, addressed with what each needs to act. */
const IL_DOORS = [
    { route: `POST ${IL}`, body: { manifest: APP } },
    { route: `GET ${IL}`, body: {} },
    { route: `DELETE ${IL}/:manifestId`, body: {} },
    { route: `POST ${IL}/:manifestId/reseed-sample-data`, body: {} },
    { route: `POST ${IL}/:manifestId/purge-sample-data`, body: {} },
] as const;

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'il-key-posture-pin-'));
    seedCalls.length = 0;
});
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('install-local doors — a key answers as its owner\'s session does (#23455, ruling C′)', () => {
    it('REFUSES a key whose owner holds MFA_REQUIRED on all five doors, with the session\'s 403 code and message, before any effect', async () => {
        const postures: Record<string, Posture[]> = {};
        const m = await mountInstallLocal(dir, postures);
        // Installed by the same key while its owner is not held, so the
        // follow-on doors have a target.
        const seeded = await m.routes.get(`POST ${IL}`)!(withKey({ manifest: APP }));
        expect(seeded.status, JSON.stringify(seeded.payload)).toBe(200);
        expect(existsSync(join(dir, LEDGER_FILE))).toBe(true);
        const effectsBefore = m.effects();

        postures[OWNER] = [MFA_REQUIRED];
        for (const door of IL_DOORS) {
            const res = await m.routes.get(door.route)!(withKey(door.body, APP.id));
            expect(res.status, door.route).toBe(403);
            expect(res.payload, door.route).toEqual({ success: false, error: { code: MFA_REQUIRED.code, message: MFA_REQUIRED.message } });
        }
        expect(m.effects(), 'a held owner\'s key caused an effect').toBe(effectsBefore);
        expect(existsSync(join(dir, LEDGER_FILE)), 'a held owner\'s key reached the uninstall').toBe(true);
    });

    it('SERVES a key whose owner holds only a credential-scope posture', async () => {
        const m = await mountInstallLocal(dir, { [OWNER]: [PASSWORD_RESET_REQUIRED] });
        const installed = await m.routes.get(`POST ${IL}`)!(withKey({ manifest: APP }));
        expect(installed.status, JSON.stringify(installed.payload)).toBe(200);
        expect(installed.payload.success).toBe(true);
        expect(m.effects()).toBeGreaterThan(0);
        const listed = await m.routes.get(`GET ${IL}`)!(withKey());
        expect(listed.status).toBe(200);
        expect(listed.payload.success).toBe(true);
    });

    it('the refusal is not a revocation: the same key is served once the posture clears', async () => {
        const postures: Record<string, Posture[]> = { [OWNER]: [MFA_REQUIRED] };
        const m = await mountInstallLocal(dir, postures);
        const held = await m.routes.get(`POST ${IL}`)!(withKey({ manifest: APP }));
        expect(held.status).toBe(403);
        expect(held.payload?.error?.code).toBe('MFA_REQUIRED');
        expect(m.effects()).toBe(0);

        // The owner enrols; nothing about the key is rewritten or reissued.
        postures[OWNER] = [];
        const again = await m.routes.get(`POST ${IL}`)!(withKey({ manifest: APP }));
        expect(again.status, JSON.stringify(again.payload)).toBe(200);
        expect(again.payload.success).toBe(true);
        expect(existsSync(join(dir, LEDGER_FILE))).toBe(true);
        expect(m.keyRowUnchanged(), 'the hold wrote to the key row').toBe(true);
    });
});
