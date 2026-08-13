// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7912] `filterAppForUser` prunes a `type: 'object'` nav entry whose
 * destination object cannot serve a `list`.
 *
 * The gap this closes, measured on #7544: nav filtering gated `_unpublished`,
 * `requiredPermissions`, `requiresService` and empty groups, and consulted
 * `enable.apiEnabled` NOWHERE. So an entry pointing at an API-disabled object
 * shipped in the `/meta` payload for every persona — and because the denial is
 * a pure function of the object's `enable` block (no user, no permissions, no
 * context), no gate authorable on the ENTRY could prune it. The maintainer
 * ruling of 2026-08-12 chose to DERIVE the fact rather than mint a key.
 *
 * ⚠️ The control is as load-bearing as the prune: `nav_api_keys` →
 * `sys_api_key` rides the same machinery with a whitelist that DOES grant
 * `list`, and must survive. A derivation that pruned both would be over-reach,
 * and must fail here.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestServer } from './rest-server';

const ANON_API = { api: { requireAuth: false } };

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

/**
 * The object metadata the gate reads. Deliberately the REAL shapes from
 * `@objectstack/platform-objects`, not invented ones — the whole point of the
 * control is that it is the platform's own pair.
 */
const OBJECTS = [
    // The #7544 shape: API-disabled outright → every operation answers 404.
    { name: 'sys_jwks', enable: { apiEnabled: false, apiMethods: [] } },
    // ⭐ THE CONTROL — `sys_api_key`'s real whitelist. Grants `list`.
    { name: 'sys_api_key', enable: { apiEnabled: true, apiMethods: ['get', 'list', 'update'] } },
    // Exposed, but the whitelist omits `list` → the list answers 405 while
    // `GET /:id` works. A second, independent condition (`sys_verification`'s
    // real shape).
    { name: 'sys_verification', enable: { apiEnabled: true, apiMethods: ['get'] } },
    // No `enable` block at all → declares nothing, restricts nothing.
    { name: 'sys_inbox_message' },
    // `enable` present but silent about the API → unrestricted.
    { name: 'crm_lead', enable: { searchable: true } },
];

function createMockProtocol(items: unknown[] = OBJECTS) {
    return {
        getMetaItems: vi.fn().mockResolvedValue({ items }),
        getMetaItem: vi.fn().mockResolvedValue({}),
    };
}

const make = (items?: unknown[]) =>
    new RestServer(createMockServer() as any, createMockProtocol(items) as any, ANON_API as any) as any;

const ids = (a: any): string[] => (a?.navigation ?? []).map((e: any) => e.id);
const areaIds = (a: any, i: number): string[] => (a?.areas?.[i]?.navigation ?? []).map((e: any) => e.id);

/** Resolve the gate the way the `/meta` routes do. */
async function gateOf(rest: any, items?: unknown[]) {
    const p = createMockProtocol(items);
    return rest.resolveNavServability(p, undefined);
}

describe('[#7912] nav servability — the prune', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    const app = () => ({
        name: 'setup',
        navigation: [
            { id: 'nav_jwks', type: 'object', label: 'Signing Keys', objectName: 'sys_jwks' },
            { id: 'nav_api_keys', type: 'object', label: 'API Keys', objectName: 'sys_api_key' },
            { id: 'nav_verification', type: 'object', label: 'Verification', objectName: 'sys_verification' },
            { id: 'nav_inbox', type: 'object', label: 'Inbox', objectName: 'sys_inbox_message' },
            { id: 'nav_leads', type: 'object', label: 'Leads', objectName: 'crm_lead' },
        ],
    });

    it('drops an entry whose object is `apiEnabled: false` (404 OBJECT_API_DISABLED)', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        expect(ids(rest.filterAppForUser(app(), new Set<string>(), undefined, gate))).not.toContain('nav_jwks');
    });

    it('drops an entry whose `apiMethods` whitelist omits `list` (405), a SEPARATE condition', async () => {
        // The two conditions are independent — this object is fully API-enabled
        // and still cannot answer the list its nav entry navigates to.
        const rest = make();
        const gate = await gateOf(rest);
        expect(ids(rest.filterAppForUser(app(), new Set<string>(), undefined, gate))).not.toContain('nav_verification');
    });

    it('⭐ CONTROL: `nav_api_keys` → `sys_api_key` SURVIVES — the prune must not over-reach', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        const out = ids(rest.filterAppForUser(app(), new Set<string>(), undefined, gate));
        expect(out).toContain('nav_api_keys');
        // The card's own control, stated as the whole surviving set so an
        // over-pruning derivation cannot pass by keeping one entry alive.
        expect(out).toEqual(['nav_api_keys', 'nav_inbox', 'nav_leads']);
    });

    it('an object that declares no `enable` block is served (default-open)', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        expect(ids(rest.filterAppForUser(app(), new Set<string>(), undefined, gate))).toContain('nav_inbox');
    });

    it('an `enable` block silent about the API is served (unrestricted)', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        expect(ids(rest.filterAppForUser(app(), new Set<string>(), undefined, gate))).toContain('nav_leads');
    });
});

describe('[#7912] nav servability — what it deliberately does NOT judge', () => {
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('an object absent from metadata is SERVED — `requiresObject` keeps its client-only pin', async () => {
        // The 2026-08-12 ruling rejected re-meaning `requiresObject`
        // server-side. "Is this object registered?" is that key's question and
        // this gate does not answer it: an unknown name has no declared
        // exposure policy to enforce (#3770), so it passes through.
        const rest = make();
        const gate = await gateOf(rest);
        const app = {
            name: 'setup',
            navigation: [
                { id: 'nav_ghost', type: 'object', objectName: 'not_registered_anywhere' },
                { id: 'nav_gated_ghost', type: 'object', objectName: 'also_absent', requiresObject: 'also_absent' },
            ],
        };
        expect(ids(rest.filterAppForUser(app, new Set<string>(), undefined, gate)))
            .toEqual(['nav_ghost', 'nav_gated_ghost']);
    });

    it('non-`object` entries are untouched, even when an object of that name is dead', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        const app = {
            name: 'account',
            navigation: [
                { id: 'nav_component', type: 'component', componentRef: 'x:y', objectName: 'sys_jwks' },
                { id: 'nav_page', type: 'page', pageName: 'p', objectName: 'sys_jwks' },
                { id: 'nav_url', type: 'url', url: 'https://example.com' },
            ],
        };
        expect(ids(rest.filterAppForUser(app, new Set<string>(), undefined, gate)))
            .toEqual(['nav_component', 'nav_page', 'nav_url']);
    });

    it('fail-open: with no gate resolved, nothing is pruned (prior behaviour)', async () => {
        const rest = make();
        const app = { name: 'setup', navigation: [{ id: 'nav_jwks', type: 'object', objectName: 'sys_jwks' }] };
        expect(ids(rest.filterAppForUser(app, new Set<string>()))).toEqual(['nav_jwks']);
    });

    it('fail-open: unreadable/empty object metadata resolves NO gate at all', async () => {
        // A cold start or a metadata outage must not empty the sidebar of a
        // healthy deployment — the #3545 trade, which binds harder here.
        const rest = make();
        expect(await gateOf(rest, [])).toBeNull();
    });
});

describe('[#7912] nav servability — reaches every tree the other gates reach', () => {
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('prunes inside `children` and inside `areas[]` — one `filterNav`, not three', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        const app = {
            name: 'setup',
            navigation: [{
                id: 'grp_advanced', type: 'group', label: 'Advanced',
                children: [
                    { id: 'nav_jwks', type: 'object', objectName: 'sys_jwks' },
                    { id: 'nav_api_keys', type: 'object', objectName: 'sys_api_key' },
                ],
            }],
            areas: [{
                id: 'area_admin', label: 'Admin',
                navigation: [
                    { id: 'nav_jwks_area', type: 'object', objectName: 'sys_jwks' },
                    { id: 'nav_api_keys_area', type: 'object', objectName: 'sys_api_key' },
                ],
            }],
        };
        const out = rest.filterAppForUser(app, new Set<string>(), undefined, gate);
        expect(out.navigation[0].children.map((c: any) => c.id)).toEqual(['nav_api_keys']);
        expect(areaIds(out, 0)).toEqual(['nav_api_keys_area']);
    });

    it('[#7380] a group left childless BY this prune collapses, like any other gate', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        const app = {
            name: 'setup',
            navigation: [{
                id: 'grp_dead', type: 'group', label: 'Dead',
                children: [{ id: 'nav_jwks', type: 'object', objectName: 'sys_jwks' }],
            }],
        };
        expect(ids(rest.filterAppForUser(app, new Set<string>(), undefined, gate))).toEqual([]);
    });

    it('does not mutate the app it filters', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        const app = {
            name: 'setup',
            navigation: [
                { id: 'nav_jwks', type: 'object', objectName: 'sys_jwks' },
                { id: 'nav_api_keys', type: 'object', objectName: 'sys_api_key' },
            ],
        };
        const before = JSON.stringify(app);
        rest.filterAppForUser(app, new Set<string>(), undefined, gate);
        expect(JSON.stringify(app)).toBe(before);
    });
});

describe('[#7912] the prune is never silent — the serving-side diagnostic', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    const lines = (w: ReturnType<typeof vi.spyOn>): string[] =>
        (w.mock.calls as unknown[][]).map((c) => String(c[0]));

    it('names the app, the entry AND the condition that pruned it (apiEnabled)', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        rest.filterAppForUser(
            { name: 'setup', navigation: [{ id: 'nav_jwks', type: 'object', objectName: 'sys_jwks' }] },
            new Set<string>(), undefined, gate,
        );
        const line = lines(warn).find((l) => l.includes('nav_jwks'));
        expect(line).toBeDefined();
        // The ruling's requirement is BOTH halves: which row died, and why.
        expect(line).toContain("app 'setup'");
        expect(line).toContain('sys_jwks');
        expect(line).toContain('enable.apiEnabled: false');
        expect(line).toContain('OBJECT_API_DISABLED');
    });

    it('names the OTHER condition distinctly (apiMethods without `list`)', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        rest.filterAppForUser(
            { name: 'setup', navigation: [{ id: 'nav_verification', type: 'object', objectName: 'sys_verification' }] },
            new Set<string>(), undefined, gate,
        );
        const line = lines(warn).find((l) => l.includes('nav_verification'));
        expect(line).toBeDefined();
        expect(line).toContain('enable.apiMethods');
        expect(line).toContain('OBJECT_API_METHOD_NOT_ALLOWED');
        // ⛔ Must NOT describe the wrong condition — a diagnostic that names a
        // key the author did not write is worse than none.
        expect(line).not.toContain('enable.apiEnabled: false');
    });

    it('logs once per app|entry|object|reason — a console re-fetches `/meta` constantly', async () => {
        const rest = make();
        const gate = await gateOf(rest);
        const app = { name: 'setup', navigation: [{ id: 'nav_jwks', type: 'object', objectName: 'sys_jwks' }] };
        for (let i = 0; i < 5; i++) rest.filterAppForUser(app, new Set<string>(), undefined, gate);
        expect(lines(warn).filter((l) => l.includes('nav_jwks'))).toHaveLength(1);
    });
});

describe('[#7912] the served Account app is unaffected — the QA-sweep sibling', () => {
    beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { vi.restoreAllMocks(); });

    it('every Account-app object destination survives the prune', async () => {
        // #7555 (same QA run #7514) was the Account-app sibling, and its cause
        // was permission COMPOSITION — closed by #7605, not by servability.
        // What this card owes it is proof of no regression: all six object
        // destinations declare an `enable` that grants `list`, so the derived
        // gate leaves the app exactly as it found it.
        const rest = make([
            { name: 'sys_inbox_message' },
            { name: 'sys_member', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
            { name: 'sys_account', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
            { name: 'sys_session', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
            { name: 'sys_api_key', enable: { apiEnabled: true, apiMethods: ['get', 'list', 'update'] } },
            { name: 'sys_oauth_application', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
        ]);
        const gate = await gateOf(rest, [
            { name: 'sys_inbox_message' },
            { name: 'sys_member', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
            { name: 'sys_account', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
            { name: 'sys_session', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
            { name: 'sys_api_key', enable: { apiEnabled: true, apiMethods: ['get', 'list', 'update'] } },
            { name: 'sys_oauth_application', enable: { apiEnabled: true, apiMethods: ['get', 'list'] } },
        ]);
        const app = {
            name: 'account',
            navigation: [
                { id: 'nav_account_notifications', type: 'object', objectName: 'sys_inbox_message', requiresObject: 'sys_inbox_message' },
                { id: 'nav_account_orgs', type: 'object', objectName: 'sys_member' },
                { id: 'nav_account_linked', type: 'object', objectName: 'sys_account', requiresObject: 'sys_account' },
                { id: 'nav_account_sessions', type: 'object', objectName: 'sys_session', requiresObject: 'sys_session' },
                { id: 'nav_account_api_keys', type: 'object', objectName: 'sys_api_key', requiresObject: 'sys_api_key' },
                { id: 'nav_account_oauth_apps', type: 'object', objectName: 'sys_oauth_application', requiresObject: 'sys_oauth_application' },
            ],
        };
        expect(ids(rest.filterAppForUser(app, new Set<string>(), undefined, gate))).toEqual([
            'nav_account_notifications',
            'nav_account_orgs',
            'nav_account_linked',
            'nav_account_sessions',
            'nav_account_api_keys',
            'nav_account_oauth_apps',
        ]);
    });
});
