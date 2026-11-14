// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Setup's LANDING page, per audience: a member lands on an entry whose page
// they can read (#33224).
//
// ---------------------------------------------------------------------------
// What this pins
// ---------------------------------------------------------------------------
// The console opens the bare Setup URL on the FIRST entry the member is shown
// (ui/packages/app-shell/src/console/AppContent.tsx, `findFirstRoute` over the
// tree `useNavMemberGates` gates): `group` entries are walked, `url` entries
// skipped, the first `object` / `page` / `dashboard` / `report` / `component`
// entry wins; an entry whose `visible` is false is not shown, and an `object`
// entry is pruned when the member may not read its object (objectui#12109).
//
// Setup's first served entry is Packaged Actions (`nav_packaged_actions`, a
// `component`). Its page reads `/data/sys_metadata_activation`, and the
// object-read prune does not judge a `component` entry, so before #33224 every
// member landed there: a separation-of-duties officer whose ledger read
// answers 403 opened Setup on `activation ledger HTTP 403`. The entry now
// carries `visible: current_user.can('sys_metadata_activation', 'read')`, and:
//
//   - an officer who may not read the ledger, and may read users, lands on
//     People & Org › Users (`nav_users`);
//   - a member who may read the ledger lands on Packaged Actions, as before;
//   - the platform administrator still lands on System Overview, which is
//     served to them ahead of Packaged Actions, and is still shown the entry.
//
// The served `/meta/app/setup` tree is real (shell, contributions, registry
// fold, per-request filter); the landing walk below restates the console's two
// gates on it and asks `visible` with the real CEL engine and the member's
// effective object map, the way the console's `ExpressionProvider` binds
// `/auth/me/permissions`. The console side of `can` in a nav `visible` is
// pinned in ui/ by `UnifiedSidebar.navCanPermissions-12700.test.tsx`.
//
// ---------------------------------------------------------------------------
// Why it lives in `packages/cli/test/`
// ---------------------------------------------------------------------------
// The reason `console-page-nav-entries.pin.test.ts` beside it gives: a composed fact across the Setup
// shell (`@objectstack/platform-objects`), the audit plugin's contribution, the
// registry fold (`@objectstack/objectql`) and the per-request filter
// (`@objectstack/rest`); `packages/cli` is the one package that depends on all
// of them.

import { describe, expect, it, vi } from 'vitest';
import { celEngine, toEvalPermissions } from '@objectstack/formula';
import { SchemaRegistry } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { RestServer } from '@objectstack/rest';
import { ADMIN_FULL_ACCESS_CAPABILITIES } from '@objectstack/spec';

type AnyRec = Record<string, any>;

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

const LANDING_TYPES = new Set(['object', 'page', 'dashboard', 'report', 'component']);
const USER = { id: 'u1', positions: [], organizationId: 'org_1' };

/**
 * The console's landing walk over the served tree, for a member whose
 * effective object map is `objects`: the first landing-type entry that is
 * shown, in served order, groups walked.
 */
function landingFor(app: AnyRec, objects: Record<string, AnyRec>): string | undefined {
    const permissions = toEvalPermissions(objects);
    const shown = (item: AnyRec): boolean => {
        if (typeof item.visible === 'string') {
            const r = celEngine.evaluate<boolean>({ dialect: 'cel', source: item.visible }, { user: USER, permissions });
            // A predicate that cannot be answered is a defect here, not a `false`.
            expect(r.ok, `visible on ${item.id} must evaluate: ${JSON.stringify(r)}`).toBe(true);
            if (!r.ok || r.value !== true) return false;
        }
        if (item.type === 'object') {
            const grant = objects[String(item.objectName)] ?? {};
            if (!(grant.allowRead || grant.viewAllRecords || grant.modifyAllRecords)) return false;
        }
        return true;
    };
    const walk = (items: AnyRec[] = []): string | undefined => {
        for (const item of items) {
            if (!item || !shown(item)) continue;
            if (item.type === 'group') {
                const inner = walk(item.children);
                if (inner) return inner;
                continue;
            }
            if (LANDING_TYPES.has(item.type)) return String(item.id);
        }
        return undefined;
    };
    return walk(app?.navigation);
}

/** Every served entry, depth-first. */
function entries(items: AnyRec[] | undefined): AnyRec[] {
    return (items ?? []).flatMap((i) => [i, ...entries(i?.children)]);
}

const OFFICER = ['setup.access', 'view_all_audit_log'];

describe('Setup lands each member on an entry whose page they can read (#33224)', () => {
    it('Packaged Actions is served with the ledger-read audience its page needs', async () => {
        const setup = await servedSetup(OFFICER);
        const packaged = entries(setup.navigation).find((i) => i.id === 'nav_packaged_actions');
        expect(packaged).toMatchObject({
            type: 'component',
            componentRef: 'automation:packaged-actions',
            visible: "current_user.can('sys_metadata_activation', 'read')",
        });
        // Control: it is still the FIRST landing-type entry served, so the
        // predicate is what moves the officer's landing, not the order.
        const firstLanding = entries(setup.navigation).find((i) => LANDING_TYPES.has(i.type));
        expect(firstLanding?.id).toBe('nav_packaged_actions');
    });

    it('an officer who may not read the activation ledger lands on Users, not on a 403 page', async () => {
        const setup = await servedSetup(OFFICER);
        const officer = { sys_audit_log: { allowRead: true }, sys_user: { allowRead: true } };
        expect(landingFor(setup, officer)).toBe('nav_users');
    });

    it('a member who may read the activation ledger still lands on Packaged Actions', async () => {
        // Same served tree as the officer's; only the ledger read differs.
        const setup = await servedSetup(OFFICER);
        const reader = {
            sys_metadata_activation: { allowRead: true },
            sys_audit_log: { allowRead: true },
            sys_user: { allowRead: true },
        };
        expect(landingFor(setup, reader)).toBe('nav_packaged_actions');
    });

    it('the platform administrator lands where they did before, and is still shown Packaged Actions', async () => {
        const setup = await servedSetup(ADMIN_FULL_ACCESS_CAPABILITIES.systemPermissions ?? []);
        const admin = {
            sys_metadata_activation: { allowRead: true, viewAllRecords: true },
            sys_user: { allowRead: true, viewAllRecords: true },
        };
        // The administrator's first served entry is the System Overview, ahead
        // of Packaged Actions; the predicate does not move it.
        expect(landingFor(setup, admin)).toBe('nav_system_overview');
        const packaged = entries(setup.navigation).find((i) => i.id === 'nav_packaged_actions');
        expect(packaged).toBeDefined();
        expect(landingFor({ navigation: [packaged] }, admin)).toBe('nav_packaged_actions');
    });
});
