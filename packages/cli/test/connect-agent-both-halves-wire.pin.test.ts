// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17647 — the BOTH-HALVES WIRE pin for Connect-an-Agent visibility.
//
// ---------------------------------------------------------------------------
// What this pins, and why one half of it would be worthless
// ---------------------------------------------------------------------------
// #16746's ruling (option A) promises two facts at once, and they are only a
// promise TOGETHER:
//
//   1. a PERMISSIONLESS principal gets `200` on `GET /api/v1/meta/apps/account`
//      with `nav_connect_agent` present in `grp_account_developer`; and
//   2. that SAME principal still gets `403` / `PERMISSION_DENIED` on
//      `GET /api/v1/meta/apps/setup`, with `connect_agent` absent from the body.
//
// A test asserting only (1) would stay green if someone ungated Setup — which
// is not hypothetical: #16746's own history produced exactly that once, and
// dropping Setup's two gates was measured to expose 14+ unrelated Setup
// surfaces (Packages, Users, Organization, Business Units, Teams, Invitations,
// Localization, Company, Branding, Feature Flags and their groups) to every
// signed-in user. The PAIRING is the pin.
//
// ---------------------------------------------------------------------------
// Why the positive control is not optional
// ---------------------------------------------------------------------------
// A `403` with no LIT control proves the harness ran exactly as much as it
// proves the gate held — which is to say, neither. So the permitted principal's
// reading sits in the same `it()` as the refusal: if the fold or the fixture
// ever stops reaching the Connect-an-Agent card at all, the control goes red
// instead of the refusal going quietly vacuous.
//
// ---------------------------------------------------------------------------
// It lives in `packages/cli/test/` on purpose
// ---------------------------------------------------------------------------
// This is a COMPOSED fact: the real `SETUP_APP` / `ACCOUNT_APP` /
// `SETUP_NAV_CONTRIBUTIONS` (`@objectstack/platform-objects`), the real
// `CONNECT_AGENT_UI_BUNDLE` (`@objectstack/mcp`), the real `SchemaRegistry`
// fold (`@objectstack/objectql`) and the real per-request RBAC-by-route filter
// (`@objectstack/rest`). Read from `package.json`, `packages/cli` is the only
// workspace package that depends on all four at once — the same argument
// `packages/cli/scripts/check-app-nav-i18n.mjs` already makes in its own
// header for living here ("`cli` is the composition root … a gate in
// `platform-objects` could not import the plugins").
//
// ⛔ It is NOT beside the change in `packages/mcp`: that package declares no
// dependency on `@objectstack/rest`, `@objectstack/objectql` or
// `@objectstack/platform-objects`, and reimplementing the fold or the RBAC
// filter there to keep the test local is precisely the divergence
// `packages/cli/src/utils/nav-contribution-groups.ts` exists to refuse.
//
// ---------------------------------------------------------------------------
// The harness is the established one
// ---------------------------------------------------------------------------
// Stub-the-exec-context, from `packages/rest/src/meta-app-publish-gate.test.ts`
// and `meta-app-area-nav-gate.test.ts`: a real `RestServer` over a stubbed
// protocol, `resolveExecCtx` replaced by a caller carrying a given
// `systemPermissions` set, driven through the registered
// `GET /api/v1/meta/:type/:name` route. Nothing about the gate is re-expressed
// here — the assertions read the RESPONSE BODY, which is the only surface the
// console and an AI client ever see.
//
// ⚠️ The two `requiresService` / `requiresObject` gates are deliberately NOT
// exercised: the stubbed context carries no `__kernel` and no service provider,
// so ADR-0057 D10's capability probe fails OPEN exactly as it does in the two
// sibling harnesses. Permission gating is what is under test.

import { describe, expect, it, vi } from 'vitest';
import { CONNECT_AGENT_UI_BUNDLE } from '@objectstack/mcp';
import { SchemaRegistry } from '@objectstack/objectql';
import { ACCOUNT_APP, SETUP_APP, SETUP_NAV_CONTRIBUTIONS } from '@objectstack/platform-objects/apps';
import { RestServer } from '@objectstack/rest';

type AnyRec = Record<string, any>;

/** The two nav-contribution halves the MCP bundle ships, read by target app. */
const bundleContributions = (): AnyRec[] =>
    (CONNECT_AGENT_UI_BUNDLE as AnyRec).navigationContributions as AnyRec[];

/**
 * Build the real composition.
 *
 * `structuredClone` on the two apps is deliberate and changes no content:
 * `registerItem` runs `applyProtection` on what it is handed, which WRITES the
 * `_lock` envelope onto the object (ADR-0010 §3.7). Handing it the imported
 * module constants would mutate them for every other file in this suite.
 *
 * @param includeAccountHalf when false, only the MCP bundle's `app: 'setup'`
 *   contribution is folded — the counterfactual M4 reads Setup against.
 */
function composedRegistry(includeAccountHalf = true): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    // The fold's own diagnostics are not under test here; keep the run quiet.
    (registry as AnyRec).logLevel = 'silent';

    registry.registerApp(structuredClone(SETUP_APP), '@objectstack/platform-objects');
    registry.registerApp(structuredClone(ACCOUNT_APP), '@objectstack/platform-objects');

    for (const contribution of SETUP_NAV_CONTRIBUTIONS) {
        registry.registerAppNavContribution(contribution as AnyRec, '@objectstack/platform-objects');
    }
    for (const contribution of bundleContributions()) {
        if (!includeAccountHalf && contribution.app !== 'setup') continue;
        registry.registerAppNavContribution(contribution, '@objectstack/mcp');
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
 * A `RestServer` serving the composed apps to a caller holding `perms`.
 *
 * The protocol answers `getMetaItem` out of the registry, so the bytes under
 * test have gone through `applyNavContributions` — the real fold — exactly as
 * the serving path does (ADR-0029 D7: "the REST app endpoints read through the
 * protocol, not these helpers, so the merge must be reachable from there too").
 */
function setup(perms: string[], includeAccountHalf = true) {
    const registry = composedRegistry(includeAccountHalf);
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
        createMockServer() as AnyRec, protocol as AnyRec, { api: { requireAuth: false } } as AnyRec,
    );
    // The RBAC filter only runs for a RESOLVED caller; stubbing the exec
    // context is this repo's established pattern for exercising it by route.
    rest.resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: perms });
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

/** Every nav id in the served document, groups included, depth-first. */
function navIds(app: AnyRec | undefined): string[] {
    const out: string[] = [];
    const walk = (items: AnyRec[] | undefined) => {
        for (const item of items ?? []) {
            if (item?.id) out.push(String(item.id));
            if (Array.isArray(item?.children)) walk(item.children);
        }
    };
    walk(app?.navigation);
    for (const area of app?.areas ?? []) walk(area?.navigation);
    return out;
}

/** The children of one nav group, by id. */
function groupChildren(app: AnyRec | undefined, groupId: string): string[] {
    let found: AnyRec | undefined;
    const walk = (items: AnyRec[] | undefined) => {
        for (const item of items ?? []) {
            if (item?.id === groupId) { found = item; return; }
            if (Array.isArray(item?.children)) walk(item.children);
            if (found) return;
        }
    };
    walk(app?.navigation);
    return (found?.children ?? []).map((c: AnyRec) => String(c?.id));
}

/** The declared ADR-0112 refusal envelope, as the console reads it. */
const refusal = (body: AnyRec | undefined) => ({
    code: body?.error?.code, message: body?.error?.message,
});

describe('#17647 — Connect-an-Agent visibility: BOTH halves, over the wire', () => {
    it('a permissionless principal sees the Account entry AND is still refused Setup', async () => {
        // ONE principal, two routes — the pairing is the pin, so both readings
        // and the lit control are asserted here rather than in three `it()`s
        // that could pass one at a time.
        const rest = setup([]);

        // ── M1 — permissionless on `GET /api/v1/meta/apps/account` ─────────
        const account = await getApp(rest, 'account');
        expect(account.statusCode).toBe(200);
        expect(account.body).toMatchObject({ type: 'app', name: 'account' });

        // `ACCOUNT_APP` declares no `requiredPermissions` — deliberately, so
        // every authenticated user reaches their own security surface — and the
        // fold puts the contributed entry inside the group that already carries
        // `nav_account_api_keys`.
        expect(groupChildren(account.body?.item, 'grp_account_developer'))
            .toEqual(['nav_account_api_keys', 'nav_account_oauth_apps', 'nav_connect_agent']);
        // The whole served tree, counted: 11 authored ids + the one contributed.
        expect(navIds(account.body?.item)).toHaveLength(12);
        // …and the entry's TARGET rode along, so the menu item resolves.
        expect(JSON.stringify(account.body)).toContain('connect_agent');

        // ── M2 — the SAME principal on `GET /api/v1/meta/apps/setup` ───────
        const setupDenied = await getApp(rest, 'setup');
        expect(setupDenied.statusCode).toBe(403);
        // ⛔ The status alone is not the assertion: a bare 403 cannot tell a
        // permission refusal from a route that was never reached. ADR-0112's
        // STANDARD catalog member for an authorization refusal, nested inside
        // `error` per `BaseResponseSchema`, is what objectui branches on.
        expect(refusal(setupDenied.body).code).toBe('PERMISSION_DENIED');
        expect(setupDenied.body?.success).toBe(false);
        expect(typeof refusal(setupDenied.body).message).toBe('string');

        // Refused means refused, judged on the WIRE BYTES rather than on "not
        // in the nav group": neither the page name nor the nav id leaked.
        const deniedWire = JSON.stringify(setupDenied.body ?? {});
        expect(deniedWire).not.toContain('connect_agent');
        expect(setupDenied.body?.item).toBeUndefined();

        // ── M3 — the LIT positive control, same composition ────────────────
        // Without this, M2's 403 proves the gate held exactly as much as it
        // proves the harness never reached the card.
        const permitted = setup(['setup.access', 'manage_platform_settings']);
        const setupAllowed = await getApp(permitted, 'setup');
        expect(setupAllowed.statusCode).toBe(200);
        expect(setupAllowed.body?.error).toBeUndefined();
        const allowedIds = navIds(setupAllowed.body?.item);
        expect(allowedIds).toContain('nav_connect_agent');
        expect(groupChildren(setupAllowed.body?.item, 'group_integrations'))
            .toContain('nav_connect_agent');
        // The Setup tree the platform admin is served: 9 authored groups less
        // `group_approvals`, which nothing contributes into and the filter
        // collapses, plus 25 contributed entries plus the MCP one.
        expect(allowedIds).toHaveLength(34);
    });

    it('the Account half widened NOTHING on Setup — the admin tree is unchanged', async () => {
        // ── M4 — anti-widening control ─────────────────────────────────────
        // `SETUP_APP.requiredPermissions = ['setup.access']` has no pin of its
        // own anywhere in `packages/platform-objects`; this reading covers that
        // the gate is still DECLARED, and that adding the per-user half moved
        // nothing on the admin side. The counterfactual folds only the bundle's
        // `app: 'setup'` contribution.
        const withAccountHalf = await getApp(setup(['setup.access', 'manage_platform_settings']), 'setup');
        const withoutAccountHalf = await getApp(
            setup(['setup.access', 'manage_platform_settings'], false), 'setup',
        );

        expect(withAccountHalf.statusCode).toBe(200);
        expect(withoutAccountHalf.statusCode).toBe(200);
        expect(navIds(withAccountHalf.body?.item)).toEqual(navIds(withoutAccountHalf.body?.item));
        expect(navIds(withAccountHalf.body?.item)).toHaveLength(34);

        // The mechanism behind the invariance, asserted rather than assumed:
        // the bundle aims exactly one contribution at `setup` and one at
        // `account`, and the registry keys contributions by TARGET APP.
        expect(bundleContributions().map((c) => c.app)).toEqual(['setup', 'account']);
    });
});
