// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20142 — the three console pages that lost their only in-app link when
// objectui#10520 retired the System Hub card wall and the Developer Hub, read
// back OVER THE WIRE from the composed Setup and Studio apps.
//
// ---------------------------------------------------------------------------
// What this pins
// ---------------------------------------------------------------------------
// The card's acceptance, in its own words: "each entry resolves to its
// registered page (a `componentRef` that is registered), and the
// `ai:approvals` entry is absent when the `ai` service is not." Three facts:
//
//   1. `nav_audit_log_browser` → `audit:log`, contributed by the REAL
//      `AuditPlugin` into `group_diagnostics` beside `nav_audit_logs`;
//   2. `nav_integrations` → `developer:integrations`, in Studio's
//      `group_developer`;
//   3. `nav_ai_approvals` → `ai:approvals`, in `group_approvals` — ABSENT from
//      the served body on a Community Edition composition, PRESENT once an
//      `ai` service is registered. Both readings sit in one `it()`: a gated-off
//      entry with no lit counterpart proves the gate held exactly as much as
//      it proves the fold never reached the entry.
//
// "Registered" is judged against the keys MEASURED at the commit
// objectstack's `.objectui-sha` pins (dd3f7e1be3561d63267d7162f3fc0ac52e72834d):
// `registerSystemComponents.tsx` registers `audit:log` and `ai:approvals`,
// `registerDeveloperComponents.tsx` registers `developer:integrations`.
// objectui pins its registration half in
// `apps/console/src/__tests__/orphanedPageComponentRefs-10520.test.tsx`.
//
// ---------------------------------------------------------------------------
// The Community Edition composition, and why the service gate is WIRED here
// ---------------------------------------------------------------------------
// The sibling `connect-agent-both-halves-wire.pin.test.ts` deliberately leaves
// the ADR-0057 D10 capability probe unwired, so every `requiresService` gate
// there fails OPEN. This file is the opposite case: the probe is the subject.
// `serviceExistsProvider` answers the way the most generous Community Edition
// boot would — every service slot some open-framework package can fill is
// registered — derived from `CORE_SERVICE_PROVIDER`, the discovery table that
// names each core slot's installable provider. It records none for `ai`
// (`@objectstack/service-ai` is Cloud/Enterprise only), so `ai` is the one name
// this composition cannot answer for. The probe also records what it was
// asked, so a gate that never ran cannot pass as a gate that held.
//
// It lives in `packages/cli/test/` for the reason its sibling states: `cli` is
// the one workspace package that depends on every piece at once — the shells
// and contributions (`@objectstack/platform-objects`), the contributing plugins
// (`@objectstack/plugin-audit`, `@objectstack/plugin-approvals`), the fold
// (`@objectstack/objectql`) and the per-request filter (`@objectstack/rest`).

import { describe, expect, it, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { SETUP_APP, SETUP_NAV_CONTRIBUTIONS, STUDIO_APP } from '@objectstack/platform-objects/apps';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { ApprovalsServicePlugin } from '@objectstack/plugin-approvals';
import { RestServer } from '@objectstack/rest';
import { CORE_SERVICE_PROVIDER } from '@objectstack/spec/system';

type AnyRec = Record<string, any>;

/** The registry keys the pinned console registers for the three pages. */
const MEASURED_CONSOLE_KEYS = ['audit:log', 'ai:approvals', 'developer:integrations'];

/** A plugin's `init()` against a manifest sink — the nav contributions it registers. */
async function contributionsOf(plugin: { init(ctx: any): Promise<void> | void }): Promise<AnyRec[]> {
    const manifests: AnyRec[] = [];
    const ctx: AnyRec = {
        logger: { info() {}, warn() {}, error() {}, debug() {}, child() { return ctx.logger; } },
        getService: (name: string) =>
            name === 'manifest' ? { register: (m: AnyRec) => manifests.push(m) } : undefined,
        registerService() {},
        hook() {},
    };
    await plugin.init(ctx);
    return manifests.flatMap((m) => (m.navigationContributions ?? []) as AnyRec[]);
}

/**
 * The real composition: the Setup and Studio shells, this package's own Setup
 * contributions, and the two plugins that contribute into the slots under test.
 * `structuredClone` because `registerItem` writes the `_lock` envelope onto
 * what it is handed (ADR-0010 §3.7).
 */
async function composedRegistry(): Promise<SchemaRegistry> {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as AnyRec).logLevel = 'silent';
    registry.registerApp(structuredClone(SETUP_APP), '@objectstack/platform-objects');
    registry.registerApp(structuredClone(STUDIO_APP), '@objectstack/platform-objects');
    for (const c of SETUP_NAV_CONTRIBUTIONS) {
        registry.registerAppNavContribution(c as any, '@objectstack/platform-objects');
    }
    for (const c of await contributionsOf(new AuditPlugin())) {
        registry.registerAppNavContribution(c as any, '@objectstack/plugin-audit');
    }
    for (const c of await contributionsOf(new ApprovalsServicePlugin({ disableService: true }))) {
        registry.registerAppNavContribution(c as any, '@objectstack/plugin-approvals');
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

/**
 * A `RestServer` serving the composed apps to a platform admin, with the
 * capability probe answering from `serviceExists` and recording every name
 * it was asked about.
 */
async function serve(serviceExists: (name: string) => boolean) {
    const registry = await composedRegistry();
    const probed: string[] = [];
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
    rest.resolveExecCtx = async () => ({
        userId: 'u1',
        systemPermissions: ['setup.access', 'studio.access', 'manage_platform_settings'],
    });
    rest.serviceExistsProvider = (name: string) => { probed.push(name); return serviceExists(name); };
    rest.registerRoutes();
    return { rest, probed };
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

/** The most generous Community Edition: every slot an open package can fill is filled. */
const communityEdition = (name: string) => CORE_SERVICE_PROVIDER[name] !== null;

describe('#20142 — the console pages\' nav entries, served from the composed apps', () => {
    it('ai:approvals is absent on a Community Edition composition and present once `ai` is registered', async () => {
        // The premise the CE probe is built on, asserted rather than assumed.
        expect(CORE_SERVICE_PROVIDER.ai).toBeNull();

        // ── Community Edition: no `ai` service ─────────────────────────────
        const ce = await serve(communityEdition);
        const ceSetup = await getApp(ce.rest, 'setup');
        expect(ceSetup.statusCode).toBe(200);
        // The gate RAN: the probe was asked about `ai`. Without this, an
        // unwired probe (fail-open) and a held gate read the same way below.
        expect(ce.probed).toContain('ai');
        // Absent from the served tree AND from the wire bytes.
        expect(ids(group(ceSetup.body?.item, 'group_approvals'))).toEqual([
            'nav_approvals_inbox',
            'nav_approval_requests',
            'nav_approval_actions',
            'nav_approval_delegations',
        ]);
        expect(JSON.stringify(ceSetup.body)).not.toContain('ai:approvals');

        // ── Cloud / Enterprise: `ai` registered — the lit counterpart ──────
        const cloud = await serve(() => true);
        const cloudSetup = await getApp(cloud.rest, 'setup');
        expect(cloudSetup.statusCode).toBe(200);
        const approvals = group(cloudSetup.body?.item, 'group_approvals');
        // Last in the slot: plugin-approvals' inbox stays the first entry.
        expect(ids(approvals)).toEqual([
            'nav_approvals_inbox',
            'nav_approval_requests',
            'nav_approval_actions',
            'nav_approval_delegations',
            'nav_ai_approvals',
        ]);
        expect(approvals?.at(-1)).toMatchObject({ type: 'component', componentRef: 'ai:approvals' });
    });

    it('audit:log is served beside the Audit Logs object view, with no gate', async () => {
        const { rest } = await serve(communityEdition);
        const setup = await getApp(rest, 'setup');
        expect(setup.statusCode).toBe(200);
        const diagnostics = group(setup.body?.item, 'group_diagnostics');
        const at = ids(diagnostics).indexOf('nav_audit_logs');
        expect(at, 'nav_audit_logs is served in group_diagnostics').toBeGreaterThanOrEqual(0);
        expect(diagnostics?.[at + 1]).toMatchObject({
            id: 'nav_audit_log_browser',
            type: 'component',
            componentRef: 'audit:log',
        });
    });

    it('developer:integrations is served last in Studio\'s Developer group', async () => {
        const { rest } = await serve(communityEdition);
        const studio = await getApp(rest, 'studio');
        expect(studio.statusCode).toBe(200);
        const developer = group(studio.body?.item, 'group_developer');
        expect(ids(developer)).toEqual([
            'nav_api_console', 'nav_flow_runs', 'nav_public_forms', 'nav_integrations',
        ]);
        expect(developer?.at(-1)).toMatchObject({ type: 'component', componentRef: 'developer:integrations' });
    });

    it('every served ref of the three entries is a key the pinned console registers', async () => {
        const { rest } = await serve(() => true);
        const served = [
            ...((await getApp(rest, 'setup')).body?.item?.navigation ?? []),
            ...((await getApp(rest, 'studio')).body?.item?.navigation ?? []),
        ].flatMap((g: AnyRec) => (g?.children ?? []) as AnyRec[]);
        const refs = served
            .filter((i) => ['nav_audit_log_browser', 'nav_ai_approvals', 'nav_integrations'].includes(i?.id))
            .map((i) => i.componentRef);
        expect(refs.sort()).toEqual([...MEASURED_CONSOLE_KEYS].sort());
    });
});
