// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9011] `GET /api/v1/marketplace/install-local` — the read door's posture.
 *
 * ## THIS is the file that answers "is the installed-apps LISTING gated?"
 *
 * Its sibling `marketplace-install-local-capability-enumeration.test.ts` answers
 * the same question for the four MUTATING doors and says so; it deliberately
 * filters `GET ` out of its enumeration, because a read whose posture had not
 * been ruled on had no business being decided by an `it.each` over a list built
 * for writes. That ruling has since landed, and this file is where it lives. Two
 * further neighbours sound like they answer it and do not —
 * `marketplace-install-local-posture-gate.test.ts` (an ADR-0120 D5e data-shape
 * ceremony) and `marketplace-install-local-tenancy-posture.test.ts` (which
 * seeding path runs). "Posture" means three different things across those three
 * files; only this one means authorization on the listing.
 *
 * ## What was measured before this landed
 *
 * On `origin/main` at `23abe2782`, `handleList` opened on `this.readAll()`. No
 * identity resolution of any kind stood in front of it — not a weaker gate, the
 * absence of one — so a caller who could reach the port received `200` and the
 * full ledger:
 *
 *   per entry:  packageId, versionId, manifestId, version, installedAt,
 *               installedBy, withSampleData
 *   per response: items, total, storageDir
 *
 * `installedBy` is a platform user id, enumerated across every install;
 * `storageDir` is an absolute filesystem path on the host. The package
 * inventory itself is a version-level bill of materials for the deployment.
 *
 * ## The ruled posture (maintainer, 2026-08-16 — Option 3)
 *
 *   caller                                200/401  items  total  installedBy  storageDir
 *   anonymous                               401     ——     ——        ——           ——
 *   authenticated, no `manage_metadata`     200     ✔      ✔         ✘            ✘
 *   authenticated, `manage_metadata`        200     ✔      ✔         ✔            ✔
 *
 * All three rows are pinned below, and the middle row is pinned in BOTH
 * directions — the inventory is present AND the two fields are absent. Asserting
 * only the absence would keep passing if the handler started refusing the
 * non-operator outright, which is the option the ruling rejected for withdrawing
 * a shipped console page.
 *
 * ## Rejection asserts the ENVELOPE (ADR-0112), not "it failed"
 *
 * `code` AND `status`. These handlers answer by RETURNING a response, so a
 * throw-shaped assertion could not tell "refused with the wrong envelope" from
 * "did not refuse at all" — and the anonymous row is precisely the case where
 * the handler used to return a perfectly well-formed `200`.
 *
 * The refusal is also asserted to reach the caller BEFORE the ledger is read:
 * a 401 issued after `readAll()` still lets an anonymous caller probe what is
 * installed through timing or a storage error, so `ledgerReads` counts the
 * ledger accesses the request itself caused.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource } from './local-manifest-source.js';

const ROUTE_BASE = '/api/v1/marketplace/install-local';

type Handler = (c: any) => Promise<any>;

function makeRawApp() {
    const routes = new Map<string, Handler>();
    return {
        routes,
        get: (p: string, h: Handler) => routes.set(`GET ${p}`, h),
        post: (p: string, h: Handler) => routes.set(`POST ${p}`, h),
        delete: (p: string, h: Handler) => routes.set(`DELETE ${p}`, h),
    };
}

/** The three caller shapes the ruling names, as the shared resolver sees them. */
type Shape = 'anonymous' | 'member' | 'operator';

/**
 * Real `sys_*` grant rows, not a pre-baked capability list.
 *
 * `resolveAuthzContext` aggregates `systemPermissions` out of
 * `sys_user_permission_set` → `sys_permission_set`, and serving those rows
 * through the same `find` production calls is what keeps this file honest about
 * the resolution path: a gate rewired to some other aggregate would not see
 * these and would fail here rather than silently keep passing.
 */
function grantRows(shape: Shape): Record<string, any[]> {
    // `organization_admin` deliberately withholds `manage_metadata` — the
    // narrowed row is a REAL tenant administrator, not a permissionless account.
    const held: string[] = shape === 'operator'
        ? ['manage_metadata', 'studio.access', 'setup.access']
        : shape === 'member'
            ? ['setup.access', 'manage_org_users']
            : [];
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
            ? [{
                id: 'ps1',
                name: shape === 'operator' ? 'admin_full_access' : 'organization_admin',
                system_permissions: held,
            }]
            : [],
    };
}

const INSTALLED = {
    packageId: 'pkg_crm',
    versionId: 'pkgv_crm_1',
    manifestId: 'app.test.crm',
    version: '1.4.0',
    manifest: { id: 'app.test.crm', version: '1.4.0', objects: [{ name: 'crm_x', fields: { name: { type: 'text' } } }] },
    installedAt: '2026-01-01T00:00:00.000Z',
    installedBy: 'usr_operator',
    withSampleData: true,
};

let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mil-list-posture-'));
    // A real ledger file, written through the ledger's own writer — the listing
    // under test must have something to disclose, or every "no `installedBy`"
    // assertion would pass over an empty array.
    new LocalManifestSource(dir).write(INSTALLED as any);
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

/**
 * Compose the plugin the way the kernel does — `start()` + `kernel:ready` — and
 * hand back the mounted GET together with the ledger-read counter.
 */
async function mount(shape: Shape, storageDir: string) {
    const rawApp = makeRawApp();
    const hooks = new Map<string, any>();
    const rows = grantRows(shape);

    // The anonymous shape has NO session: `getSession` resolves nothing, which
    // is the whole of what an unauthenticated caller looks like here.
    const sessionUser = shape === 'anonymous' ? null : { id: `usr_${shape}` };

    const services: Record<string, any> = {
        manifest: { register: vi.fn() },
        auth: { api: { getSession: async () => (sessionUser ? { user: sessionUser, session: {} } : null) } },
        objectql: { syncSchemas: vi.fn(async () => undefined), find: async (object: string) => rows[object] ?? [] },
        metadata: {},
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

    // Counted from AFTER boot, deliberately: `kernel:ready` rehydrates the
    // ledger, so a spy installed earlier would attribute the BOOT's read to the
    // request under test and the "refused before any work" assertion would be
    // measuring the wrong thing.
    const ledgerReads = { count: 0 };
    const realList = LocalManifestSource.prototype.list;
    vi.spyOn(LocalManifestSource.prototype, 'list').mockImplementation(function (this: any) {
        ledgerReads.count += 1;
        return realList.call(this);
    });

    return { list: rawApp.routes.get(`GET ${ROUTE_BASE}`)!, ledgerReads, ctx };
}

/** A Hono-ish context. Anonymous means: real headers, and nothing in them. */
function makeC(headers: Record<string, string> = {}) {
    const h = new Headers(headers);
    return {
        req: {
            url: `http://localhost:3000${ROUTE_BASE}`,
            raw: new Request('http://localhost:3000/x', { headers: h }),
            header: (n: string) => h.get(n) ?? undefined,
            json: async () => ({}),
            param: () => undefined,
        },
        json: (payload: any, status?: number) => ({ payload, status: status ?? 200 }),
    };
}

describe('#9011 — anonymous is refused 401 and learns nothing', () => {
    it('answers the ADR-0112 UNAUTHENTICATED envelope, not the ledger', async () => {
        // THE regression this file exists for: this exact request used to
        // return 200 with every field below.
        const { list } = await mount('anonymous', dir);

        const res = await list(makeC());

        expect(res.status).toBe(401);
        expect(res.payload).toMatchObject({ success: false, error: { code: 'UNAUTHENTICATED' } });
        // Nothing of the ledger rides along in the refusal body.
        const serialized = JSON.stringify(res.payload);
        expect(serialized).not.toContain('app.test.crm');
        expect(serialized).not.toContain('usr_operator');
        expect(serialized).not.toContain(dir);
    });

    it('a bare `x-user-id` header is still anonymous', async () => {
        // #8976 removed the header fallback from the shared resolver; this pins
        // that the read door inherits that removal rather than re-growing its
        // own. A caller who could reach the port must not self-assert identity.
        const { list } = await mount('anonymous', dir);

        const res = await list(makeC({ 'x-user-id': 'attacker' }));

        expect(res.status).toBe(401);
        expect(res.payload.error.code).toBe('UNAUTHENTICATED');
    });

    it('is refused BEFORE the ledger is read', async () => {
        // A 401 issued after `readAll()` is still a probe: timing and storage
        // errors both leak whether anything is installed.
        const { list, ledgerReads } = await mount('anonymous', dir);

        const res = await list(makeC());

        expect(res.status).toBe(401);
        expect(ledgerReads.count).toBe(0);
    });
});

describe('#9011 — an authenticated non-operator gets the inventory WITHOUT the two operator fields', () => {
    it('serves items and total, and omits `installedBy` / `storageDir`', async () => {
        const { list } = await mount('member', dir);

        const res = await list(makeC());

        // ① The half the ruling PRESERVES. Asserting only the absences below
        //    would keep passing if this caller were refused outright — the
        //    option the ruling rejected for withdrawing a shipped console page.
        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.total).toBe(1);
        expect(res.payload.data.items).toHaveLength(1);
        const [item] = res.payload.data.items;
        expect(item).toMatchObject({
            packageId: 'pkg_crm',
            versionId: 'pkgv_crm_1',
            manifestId: 'app.test.crm',
            version: '1.4.0',
            installedAt: INSTALLED.installedAt,
            withSampleData: true,
        });

        // ② The half it NARROWS — absent keys, not null values. `null` would be
        //    a claim about the ledger ("installed by nobody") rather than a fact
        //    about the caller.
        expect(Object.keys(item).sort()).toEqual(
            ['installedAt', 'manifestId', 'packageId', 'version', 'versionId', 'withSampleData'],
        );
        expect('installedBy' in item).toBe(false);
        expect(Object.keys(res.payload.data).sort()).toEqual(['items', 'total']);
        expect('storageDir' in res.payload.data).toBe(false);

        // ③ And neither value reaches the wire by any other route.
        const serialized = JSON.stringify(res.payload);
        expect(serialized).not.toContain('usr_operator');
        expect(serialized).not.toContain(dir);
    });
});

describe('#9011 — a `manage_metadata` holder still gets the full payload', () => {
    it('serves `installedBy` and `storageDir` unchanged', async () => {
        // The control. Narrowing that also narrowed the operator would have
        // broken `os package install`'s reason for #6721 putting the resolved
        // directory on the wire at all.
        const { list } = await mount('operator', dir);

        const res = await list(makeC());

        expect(res.status).toBe(200);
        expect(res.payload.success).toBe(true);
        expect(res.payload.data.total).toBe(1);
        expect(res.payload.data.storageDir).toBe(new LocalManifestSource(dir).dir);
        const [item] = res.payload.data.items;
        expect(item.installedBy).toBe('usr_operator');
        // The pre-#9011 wire shape, intact for the caller who is entitled to it.
        expect(Object.keys(item).sort()).toEqual(
            ['installedAt', 'installedBy', 'manifestId', 'packageId', 'version', 'versionId', 'withSampleData'],
        );
        expect(Object.keys(res.payload.data).sort()).toEqual(['items', 'storageDir', 'total']);
    });
});
