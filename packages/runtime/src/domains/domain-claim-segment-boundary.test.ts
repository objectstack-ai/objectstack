// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16263] Every dispatcher domain claims its prefix and the paths UNDER it —
 * and NOT every path that merely starts with the prefix's characters.
 *
 * ## The defect this pins
 *
 * `DomainRoute.match` defaulted to `'prefix'`, a bare
 * `path.startsWith(route.prefix)` with no segment boundary, and ten shipped
 * routes carried that implicit default. `/auth` was the eleventh and was
 * repaired on its own in #16026; this file is the same repair applied to the
 * rest of the table, delivered at the seam: the registry's DEFAULT is
 * `'segment'` now, so a route claims a sibling namespace only by asking for
 * `match: 'prefix'` in writing.
 *
 * ## Measured per domain, before the fix — NOT inferred from `/auth`
 *
 * Each of the ten hands its sub-path to a different handler with a different
 * parse, so what a lexical extension ANSWERS had to be measured domain by
 * domain. Taken through `HttpDispatcher.dispatch()` on the fixture below
 * (`origin/main` 7f96e1417e), `GET` unless noted:
 *
 *     /actionsx          401 UNAUTHENTICATED     claimed by /actions
 *     /aixx              401 UNAUTHENTICATED     claimed by /ai
 *     /analyticsx        handled=false           claimed by /analytics
 *     /automationx       401 UNAUTHENTICATED     claimed by /automation
 *     /datax             200 SUCCESS             claimed by /data      <- worst
 *     /datax/foo         THREW "Record foo not found in x"             <- worst
 *     /i18nxx            501 NOT_IMPLEMENTED     claimed by /i18n
 *     /metaxyz           401 UNAUTHENTICATED     claimed by /meta
 *     /notificationsx    501 NOT_IMPLEMENTED     claimed by /notifications
 *     /packagesomething  401 UNAUTHENTICATED     claimed by /packages
 *     /uifoo             handled=false           claimed by /ui
 *
 * ⚠️ The two `/data` rows are why "one of them may already be harmless;
 * another may be worse" was worth measuring. `/data`'s handler reads
 * `req.path.substring(5)` as an OBJECT NAME, so the stray characters became
 * the name of an object nobody declared: `GET /datax` answered a SUCCESS
 * envelope for a fabricated object, and `GET /datax/foo` threw
 * `Record foo not found in x` — an unattributable 500 naming a record and an
 * object that were manufactured by the missing boundary. Nothing here is a
 * capability being removed; it is a wrong answer being stopped.
 *
 * ⛔ No live dependent was found for any row: no in-repo caller builds a
 * dispatch path by concatenating a domain prefix without a separator (every
 * `dispatcher.dispatch(...)` call site in `dispatcher-plugin.ts` writes the
 * literal prefix plus a `/`-led sub-path), no `route-ledger.ts` row names a
 * shape of this kind, and no SDK method addresses one.
 *
 * ## ⭐ Why the STILL-CLAIMED rows carry the same weight as the defect rows
 *
 * A pin asserting only that `/datax` 404s cannot fail in the direction that
 * matters most: a "repair" that stopped claiming `/data` ALTOGETHER would pass
 * every defect row while deleting the domain. The overshoot controls are the
 * only thing that proves the narrowing is a narrowing — each canonical prefix
 * and one sub-path under it must still reach its own handler, with the SAME
 * answer it gave before the change (the statuses above are unchanged for every
 * one of them).
 *
 * The `?`-suffixed routes are the third class and the one a default flip could
 * silently have broken: `/keys?`, `/mcp?` and `/mcp/skill?` have no `/` after
 * the `'?'`, so a segment match cannot express them at all. They declare
 * `match: 'prefix'` now and are pinned here for exactly that reason.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

function makeDispatcher() {
    const objectql = {
        find: vi.fn().mockResolvedValue([]),
        getObjects: vi.fn().mockReturnValue({}),
        executeAction: vi.fn().mockResolvedValue({}),
        registry: {
            getObject: vi.fn().mockReturnValue(null),
            getRegisteredTypes: vi.fn().mockReturnValue([]),
        },
    };
    const services: Record<string, any> = { objectql };
    const kernel: any = {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
    return new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
}

const dispatch = (method: string, path: string) =>
    makeDispatcher().dispatch(method, path, {}, {}, { request: new Request(`http://localhost${path}`) } as any);

/** The registry's own answer for a path — which route, if any, claims it. */
const claimant = (path: string, method = 'GET'): string | undefined =>
    (makeDispatcher() as any).domainRegistry.resolve(path, method)?.prefix;

/** The ten routes that carried the implicit `'prefix'` default, and a lexical extension of each. */
const SIBLING_NAMESPACES: ReadonlyArray<readonly [string, string]> = [
    ['/actions', '/actionsx'],
    ['/ai', '/aixx'],
    ['/analytics', '/analyticsx'],
    ['/automation', '/automationx'],
    ['/data', '/datax'],
    ['/i18n', '/i18nxx'],
    ['/meta', '/metaxyz'],
    ['/notifications', '/notificationsx'],
    ['/packages', '/packagesomething'],
    ['/ui', '/uifoo'],
];

/** Paths every domain MUST keep claiming — the overshoot controls. */
const STILL_CLAIMED: ReadonlyArray<readonly [string, string]> = [
    ['/actions', '/actions/obj/act'],
    ['/ai', '/ai/chat'],
    ['/analytics', '/analytics/query'],
    ['/automation', '/automation/flows'],
    ['/data', '/data/contacts'],
    ['/i18n', '/i18n/locales'],
    ['/meta', '/meta/objects'],
    ['/notifications', '/notifications/read'],
    ['/packages', '/packages/pkg-1'],
    ['/ui', '/ui/layouts'],
];

describe('#16263: a domain claim stops at a segment boundary', () => {
    describe('lexical extensions are NOT claimed — they fall through to ROUTE_NOT_FOUND', () => {
        for (const [prefix, sibling] of SIBLING_NAMESPACES) {
            it(`${sibling} is not claimed by ${prefix} and answers the ROUTE_NOT_FOUND envelope`, async () => {
                // Stated about the REGISTRY, which is where the shadowing lives:
                // a package mounting `${sibling}` later must be reachable.
                expect(claimant(sibling)).toBeUndefined();

                // Refusal asserts the ENVELOPE (code + status + route), never a
                // bare "it did not succeed" — an unrelated 404 from any other
                // layer would otherwise read as this fix working.
                const result = await dispatch('GET', sibling);
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(404);
                expect(result.response?.body?.success).toBe(false);
                expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
                expect(result.response?.body?.error?.httpStatus).toBe(404);
                expect(result.response?.body?.error?.route).toBe(sibling);
            });

            it(`${sibling}/foo — a sub-path of the sibling namespace — is not claimed by ${prefix} either`, async () => {
                expect(claimant(`${sibling}/foo`)).toBeUndefined();
                const result = await dispatch('GET', `${sibling}/foo`);
                expect(result.response?.status).toBe(404);
                expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
            });
        }
    });

    describe('⭐ the overshoot controls — every domain still claims itself and its sub-paths', () => {
        for (const [prefix, subPath] of STILL_CLAIMED) {
            it(`${prefix} and ${subPath} still resolve to the ${prefix} route`, () => {
                expect(claimant(prefix)).toBe(prefix);
                expect(claimant(subPath)).toBe(prefix);
            });

            it(`${prefix} does NOT answer the terminal ROUTE_NOT_FOUND`, async () => {
                const result = await dispatch('GET', prefix);
                // The domain answered (or declined to handle and fell through to
                // the legacy chain) — what it must never be is the dispatcher's
                // terminal refusal for an unclaimed path.
                expect(result.response?.body?.error?.code).not.toBe('ROUTE_NOT_FOUND');
            });
        }
    });

    describe("the `?`-suffixed routes keep the legacy shape — they declare match: 'prefix'", () => {
        for (const [path, expected] of [
            ['/keys?scope=x', '/keys?'],
            ['/mcp?x=1', '/mcp?'],
            ['/mcp/skill?x=1', '/mcp/skill?'],
        ] as const) {
            it(`${path} is still claimed by the ${expected} route`, () => {
                expect(claimant(path)).toBe(expected);
                expect(claimant(path, 'POST')).toBe(expected);
            });
        }

        it('the canonical `?`-free forms still resolve to their own segment routes', () => {
            expect(claimant('/keys')).toBe('/keys');
            expect(claimant('/mcp')).toBe('/mcp');
            expect(claimant('/mcp/skill')).toBe('/mcp/skill');
        });
    });

    describe('the domains that already declared match: segment are unchanged', () => {
        it('/security and /share-links still refuse their lexical extensions and still claim themselves', () => {
            expect(claimant('/security')).toBe('/security');
            expect(claimant('/share-links')).toBe('/share-links');
            expect(claimant('/securityx')).toBeUndefined();
            expect(claimant('/share-linksx')).toBeUndefined();
        });

        it("the card's own clean rows are untouched — the harness can tell the classes apart", async () => {
            for (const path of ['/zzz/foo', '/aut/foo']) {
                expect(claimant(path)).toBeUndefined();
                const result = await dispatch('GET', path);
                expect(result.response?.status).toBe(404);
                expect(result.response?.body?.error?.code).toBe('ROUTE_NOT_FOUND');
            }
        });
    });

    /**
     * ⭐ The case the 404 rows above are blind to.
     *
     * Every row above concludes "not claimed" from a `ROUTE_NOT_FOUND`. That
     * observation cannot tell this fix apart from one that KEEPS the wide claim
     * and refuses inside each handler: the envelope would be the same and the
     * namespace would still be SHADOWED, so a package mounting `/datax` would
     * never run. Shadowing is the harm the card names, so it needs an
     * observation of its own.
     *
     * `registerDomainHandler` appends to a first-match-wins table, so a probe
     * registered AFTER construction sits BEHIND every builtin domain — exactly
     * where a package mounting `/datax` later would sit. It is reachable only
     * if the `/data` route declines the path, and the evidence is the probe's
     * OWN response coming back out of `dispatch()`, not the absence of a call.
     */
    it('⭐ a domain registered at a sibling namespace AFTER construction is REACHED — the claim was released, not merely silenced', async () => {
        for (const [, sibling] of SIBLING_NAMESPACES) {
            const dispatcher = makeDispatcher();
            const probe = vi.fn(async (req: any) => ({
                handled: true as const,
                response: { status: 200, body: { success: true, data: { probe: sibling, path: req.path } } },
            }));
            dispatcher.registerDomainHandler({ prefix: sibling, handler: probe });

            for (const path of [sibling, `${sibling}/foo`]) {
                const result = await dispatcher.dispatch('GET', path, {}, {}, { request: new Request(`http://localhost${path}`) } as any);
                expect(result.handled).toBe(true);
                expect(result.response?.status).toBe(200);
                expect(result.response?.body?.data?.probe).toBe(sibling);
                expect(result.response?.body?.data?.path).toBe(path);
                expect(result.response?.body?.error?.code).toBeUndefined();
            }
            expect(probe).toHaveBeenCalledTimes(2);
        }
    });

    /**
     * The seam itself: a route that ASKS for the legacy shape still gets it.
     * Without this, a later "simplification" could delete `'prefix'` entirely
     * and every `?`-suffixed route would go dark with no test to say so.
     */
    it("match: 'prefix' still means bare startsWith — the legacy shape is reachable, by declaration only", async () => {
        const dispatcher = makeDispatcher();
        const wide = vi.fn(async () => ({ handled: true as const, response: { status: 200, body: { success: true, data: { wide: true } } } }));
        dispatcher.registerDomainHandler({ prefix: '/widedomain', match: 'prefix', handler: wide });

        const result = await dispatcher.dispatch('GET', '/widedomainxx', {}, {}, { request: new Request('http://localhost/widedomainxx') } as any);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.wide).toBe(true);
    });
});
