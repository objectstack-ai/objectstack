// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20142 — the Integrations & APIs page, one of the console pages that lost
// their only in-app link when objectui#10520 retired the Developer Hub, read
// back OVER THE WIRE from the composed Studio app.
//
// ---------------------------------------------------------------------------
// What this pins
// ---------------------------------------------------------------------------
// The card's acceptance: "each entry resolves to its registered page (a
// `componentRef` that is registered)". For the entry
// `@objectstack/platform-objects` declares — `nav_integrations` →
// `developer:integrations`, last in Studio's `group_developer` — this file
// reads it from the served body of `GET /api/v1/meta/:type/:name`, after the
// real `SchemaRegistry` registration and the real per-request filter, so a
// regression anywhere between the declaration and the wire turns it red.
//
// The other two pages are pinned where they belong:
//  - `nav_audit_log_browser` → `audit:log` is contributed by
//    `@objectstack/plugin-audit`; its ref is pinned beside it in
//    `packages/plugins/plugin-audit/src/audit-nav-contribution.test.ts`.
//    Importing that plugin from this package's tests would resolve to its
//    `dist/`, which `check:test-source-alias` refuses for a new import.
//  - `ai:approvals` is not this repository's entry: ADR-0029 D7 has each
//    capability plugin contribute its own navigation, and the `ai`
//    capability's owner is `@objectstack/service-ai` in Cloud/Enterprise.
//
// "Registered" is judged against the keys MEASURED at the commit
// objectstack's `.objectui-sha` pins (dd3f7e1be3561d63267d7162f3fc0ac52e72834d):
// `registerDeveloperComponents.tsx` registers `developer:integrations` and
// `registerSystemComponents.tsx` registers `audit:log`. objectui pins its
// registration half in
// `apps/console/src/__tests__/orphanedPageComponentRefs-10520.test.tsx`.
//
// It lives in `packages/cli/test/` for the reason its sibling
// `connect-agent-both-halves-wire.pin.test.ts` states: `cli` is the one
// workspace package that depends on every piece at once — the app shells
// (`@objectstack/platform-objects`), the registry (`@objectstack/objectql`) and
// the per-request filter (`@objectstack/rest`).

import { describe, expect, it, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { STUDIO_APP } from '@objectstack/platform-objects/apps';
import { RestServer } from '@objectstack/rest';

type AnyRec = Record<string, any>;

/** The registry keys the pinned console registers for the pages this repo links. */
const MEASURED_CONSOLE_KEYS = ['audit:log', 'developer:integrations'];

/**
 * The real registration of the Studio shell. `structuredClone` because
 * `registerItem` writes the `_lock` envelope onto what it is handed
 * (ADR-0010 §3.7).
 */
function composedRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as AnyRec).logLevel = 'silent';
    registry.registerApp(structuredClone(STUDIO_APP), '@objectstack/platform-objects');
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

/** A `RestServer` serving the composed Studio app to a caller holding `studio.access`. */
function serve() {
    const registry = composedRegistry();
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
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['studio.access'] });
    rest.registerRoutes();
    return rest;
}

/** `GET /api/v1/meta/apps/:name`, answered as `{ statusCode, body }`. */
async function getApp(rest: AnyRec, name: string) {
    const route = rest.getRoutes().find(
        (r: AnyRec) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name',
    );
    if (!route) throw new Error('meta/:type/:name route not registered');
    const res = makeRes();
    await route.handler(
        { method: 'GET', params: { type: 'apps', name }, query: {}, body: {}, headers: {} }, res,
    );
    return res;
}

/** The served children of one nav group, or `undefined` when the group is not served. */
function group(app: AnyRec | undefined, groupId: string): AnyRec[] | undefined {
    const found = ((app?.navigation ?? []) as AnyRec[]).find((g) => g?.id === groupId);
    return found ? ((found.children ?? []) as AnyRec[]) : undefined;
}

const ids = (items: AnyRec[] | undefined) => (items ?? []).map((i) => String(i?.id));

describe('#20142 — the Integrations & APIs nav entry, served from the composed Studio app', () => {
    it('developer:integrations is served last in Studio\'s Developer group', async () => {
        const studio = await getApp(serve(), 'studio');
        expect(studio.statusCode).toBe(200);
        const developer = group(studio.body?.item, 'group_developer');
        expect(ids(developer)).toEqual([
            'nav_api_console', 'nav_flow_runs', 'nav_public_forms', 'nav_integrations',
        ]);
        expect(developer?.at(-1)).toMatchObject({ type: 'component', componentRef: 'developer:integrations' });
    });

    it('the served ref is a key the pinned console registers', async () => {
        const studio = await getApp(serve(), 'studio');
        const served = ((studio.body?.item?.navigation ?? []) as AnyRec[])
            .flatMap((g) => (g?.children ?? []) as AnyRec[])
            .filter((i) => i?.id === 'nav_integrations');
        expect(served).toHaveLength(1);
        expect(MEASURED_CONSOLE_KEYS).toContain(served[0].componentRef);
    });
});
