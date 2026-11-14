// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup → Diagnostics, served per AUDIENCE: each entry reaches the members who
// hold its own gate, and no one else.
//
// ---------------------------------------------------------------------------
// What this pins
// ---------------------------------------------------------------------------
// A group's `requiredPermissions` prunes its whole subtree before any child is
// judged (`filterAppForUserWithReason`, `@objectstack/rest`). `group_diagnostics`
// used to carry `manage_platform_settings`, so the Audit Log entry
// (`nav_audit_logs`, contributed by `@objectstack/plugin-audit`) never reached
// an auditor who holds `view_all_audit_log` — the ledger's own read capability —
// and no platform-settings power: the separation-of-duties audit officer found
// no audit entry in Setup, while the page itself answered by URL.
//
// The gate moved off the group and onto the entries: Audit Log on
// `view_all_audit_log`, Sessions and Notification Events on the
// `manage_platform_settings` the group carried. Read over the wire, per caller:
//
//   - `view_all_audit_log` alone        → Diagnostics holds Audit Log, only;
//   - `manage_platform_settings` alone  → Sessions and Notification Events, and
//                                         NOT Audit Log (no entry reaches a
//                                         member who lacks its own gate);
//   - neither                           → no Diagnostics group at all;
//   - the platform administrator        → all three, as before.
//
// ---------------------------------------------------------------------------
// Why it lives in `packages/cli/test/`
// ---------------------------------------------------------------------------
// The reason `console-page-nav-entries.pin.test.ts` beside it gives: this is a
// composed fact across the Setup shell (`@objectstack/platform-objects`), the
// audit plugin's contribution, the registry fold (`@objectstack/objectql`) and
// the per-request filter (`@objectstack/rest`), and `packages/cli` is the one
// workspace package that depends on all of them. `@objectstack/plugin-audit`
// resolves to its source here (this package's `vitest.config.ts` aliases it).

import { describe, expect, it, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { RestServer } from '@objectstack/rest';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';

type AnyRec = Record<string, any>;

const GROUP = 'group_diagnostics';

/**
 * The manifests a plugin registers from `init()`, captured off a context that
 * serves exactly the `manifest` service, with inert stand-ins for the rest of
 * the interface (`packages/core/src/types.ts`).
 */
async function manifestsRegisteredBy(plugin: { init(ctx: any): Promise<void> | void }): Promise<AnyRec[]> {
    const manifests: AnyRec[] = [];
    const ctx = {
        getService: (name: string) => (name === 'manifest' ? { register: (m: AnyRec) => manifests.push(m) } : undefined),
        registerService: () => {},
        registerServiceFactory: () => {},
        replaceService: () => {},
        getServiceScoped: async () => undefined,
        getServices: () => new Map(),
        hook: () => {},
        trigger: async () => {},
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        getKernel: () => undefined,
    };
    await plugin.init(ctx);
    return manifests;
}

/**
 * The Setup shell, `@objectstack/platform-objects`' own contributions and the
 * audit plugin's, through the real registry fold. `structuredClone` because
 * `registerApp` writes the `_lock` envelope onto what it is handed.
 */
async function composedRegistry(): Promise<SchemaRegistry> {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as AnyRec).logLevel = 'silent';
    registry.registerApp(structuredClone(SETUP_APP), '@objectstack/platform-objects');
    for (const contribution of SETUP_NAV_CONTRIBUTIONS) {
        registry.registerAppNavContribution(structuredClone(contribution) as any, '@objectstack/platform-objects');
    }
    const audit = await manifestsRegisteredBy(new AuditPlugin());
    expect(audit).toHaveLength(1);
    for (const contribution of audit[0].navigationContributions ?? []) {
        registry.registerAppNavContribution(structuredClone(contribution), audit[0].id);
    }
    return registry;
}

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: AnyRec = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: unknown) => { res.body = b; return res; });
    res.header = vi.fn(); res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn();
    return res;
}

/** `GET /api/v1/meta/apps/setup` as a caller holding exactly `systemPermissions`. */
async function servedSetup(systemPermissions: readonly string[]): Promise<AnyRec> {
    const registry = await composedRegistry();
    const protocol: AnyRec = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: AnyRec) => {
            const t = String(type ?? '');
            return t === 'app' || t === 'apps' ? registry.getAllApps() : [];
        }),
        getMetaItem: vi.fn(async ({ name }: AnyRec) => {
            const item = registry.getApp(String(name));
            return item ? { type: 'app', name, item } : undefined;
        }),
        findData: vi.fn().mockResolvedValue([]),
    };
    const rest: AnyRec = new RestServer(
        createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    );
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [...systemPermissions] });
    rest.registerRoutes();
    const route = rest.getRoutes().find(
        (r: AnyRec) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name',
    );
    if (!route) throw new Error('meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler(
        { method: 'GET', params: { type: 'apps', name: 'setup' }, query: {}, body: {}, headers: {} }, res,
    );
    expect(res.statusCode).toBe(200);
    return res.body?.item;
}

/** The served children of `GROUP` by id, or `undefined` when the group is not served. */
function diagnostics(app: AnyRec): string[] | undefined {
    const found = ((app?.navigation ?? []) as AnyRec[]).find((g) => g?.id === GROUP);
    return found ? ((found.children ?? []) as AnyRec[]).map((c) => String(c?.id)) : undefined;
}

/** Every served entry id at any depth: an entry cannot be hiding in another group. */
function allIds(items: AnyRec[] | undefined): string[] {
    return (items ?? []).flatMap((i) => [String(i?.id), ...allIds(i?.children)]);
}

describe('Setup → Diagnostics: each entry is served to the holders of its own gate', () => {
    it('a member holding view_all_audit_log, and no platform-settings power, is served the Audit Log entry', async () => {
        const setup = await servedSetup(['setup.access', 'view_all_audit_log']);
        expect(diagnostics(setup)).toEqual(['nav_audit_logs']);
    });

    it('a member without view_all_audit_log is not served the Audit Log entry, anywhere in Setup', async () => {
        const settingsOnly = await servedSetup(['setup.access', 'manage_platform_settings']);
        expect(diagnostics(settingsOnly)?.sort()).toEqual(['nav_notifications', 'nav_sessions']);
        expect(allIds(settingsOnly.navigation)).not.toContain('nav_audit_logs');

        const neither = await servedSetup(['setup.access']);
        expect(diagnostics(neither)).toBeUndefined();
        expect(allIds(neither.navigation)).not.toContain('nav_audit_logs');
        // Control: the app itself is served to this member, so the absence above
        // is the entry's gate and not a withheld app.
        expect(allIds(neither.navigation).length).toBeGreaterThan(0);
    });

    it('the platform administrator is served all three entries, as before', async () => {
        const admin = await servedSetup(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []);
        expect(diagnostics(admin)?.sort()).toEqual(['nav_audit_logs', 'nav_notifications', 'nav_sessions']);
    });
});
