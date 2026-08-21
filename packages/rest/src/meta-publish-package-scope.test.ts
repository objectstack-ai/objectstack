// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10063 — the draft→active promotion door could not state the package its
// write belongs to, so #9612's package-closure narrowing never fired for the
// one door that needed it most.
//
// ── What was broken ───────────────────────────────────────────────────────
//
// #9612 taught the runtime publish gate to narrow `objects` to the written
// item's package closure, but only when the caller NAMES a package. Three
// write doors reach that gate:
//
//   `saveMetaItem`         (direct active save)     — states `request.packageId`
//   `publishPackageDrafts` (batch package publish)  — the batch names it
//   `publishMetaItem`      (single draft→active)    — named NOTHING
//
// The third is the hot one: Studio's designer saves `?mode=draft` and POSTs
// `/publish` on every edit, so the promotion door is the surface the gate
// exists to protect — and it kept handing the gate the whole tenant.
//
// The protocol half was already built and waiting. `promoteDraftForPublish`
// declares `packageId?: string | null` and threads it into BOTH the #9612 gate
// and `repo.promoteDraft`. Only the REST caller was mute: it built its
// `publishMetaItem` request from `type / name / organizationId / environmentId
// / actor / message` and stopped there.
//
// ── What these assertions are ABOUT, and why they are argument-level ───────
//
// The same reasoning the #8805 suite next door sets out for its own doors. The
// behavioural link — `request.packageId` → the gate's closure and
// `repo.promoteDraft`'s resolution — is owned by `@objectstack/metadata-protocol`
// and pinned in its own suites (`protocol-publish-drafts-package-scope.test.ts`
// drives the same `promoteDraftForPublish` helper through the batch door). The
// missing link, and the only one THIS package owns, is whether the REST door
// SUPPLIES the binding at all. That is an argument, so these are argument
// assertions.
//
// ── The trap this file exists to pin, which is NOT "the field arrives" ─────
//
// The two downstream branches read the request DIFFERENTLY, and only one of
// them looks at the value. Quoted from `promoteDraftForPublish`:
//
//   gate:          ...(request.packageId !== undefined ? { packageId: request.packageId } : {})
//   promoteDraft:  ...('packageId' in request ? { packageId: request.packageId ?? null } : {})
//
// The write branches on the KEY BEING PRESENT, because `null` is a meaningful
// scope there — it pins the lookup to the UNBOUND row — while an absent key
// means "match any package", the historical resolution.
//
// So a door that wrote `packageId: packageId` unconditionally would put a
// present-and-`undefined` key on every publish that names no package. That
// coerces to `null` downstream, pins the lookup to unbound rows, and a draft
// authored under a package stops being found — the door answers `no_draft`.
// A silent outage on the UNTOUCHED path, produced by a change that reads like
// it only adds an option. Hence the absent-direction cases below assert key
// ABSENCE (`not.toHaveProperty`), never merely `toBeUndefined()`: those two
// assertions pass on the same value and disagree on the only thing that
// matters here.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const PUBLISH = `${META}/:type/:name/publish`;
const ORG = 'org_alpha';
const PKG = 'app.projects';

/** `allowOrgOverride: true`, so the org limb is stable across these cases. */
const TYPE = 'views';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/**
 * @param execCtx what `resolveExecCtx` resolves to for the request under test.
 *   The publish door gates on `manage_metadata` (#8919) BEFORE it reaches any
 *   of this, so the capability is present in every case except the one that
 *   deliberately withholds it — without it each case would 403 and pass for
 *   the wrong reason.
 */
function boot(execCtx: any) {
    const calls = {
        publishMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
        saveMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
    };
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        ...calls,
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => execCtx;
    rest.registerRoutes();

    const drive = async (
        method: string,
        path: string,
        req: Record<string, unknown> = {},
    ) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler(
            { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
            res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return { ...calls, drive };
}

/** The request object the route handed to the protocol. */
const requestFrom = (fn: any) => fn.mock.calls[0][0];

const AUTHORIZED = { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: ORG };
const UNCAPABLE = { userId: 'u1', systemPermissions: [], tenantId: ORG };

/** Drive the publish door with the given query and return the protocol request. */
async function publishWith(query: Record<string, unknown>) {
    const b = boot(AUTHORIZED);
    const res = await b.drive('POST', PUBLISH, {
        params: { type: TYPE, name: 'shared_grid' },
        query,
    });
    return { request: b.publishMetaItem.mock.calls[0]?.[0], res, publish: b.publishMetaItem };
}

// The two branches `promoteDraftForPublish` actually takes, quoted from it.
// ⚠️ These are a RESTATEMENT of the downstream predicates, not an import of
// them (`promoteDraftForPublish` is private). They are here so the cases below
// read as consequences rather than as trivia about an object literal; the
// behaviour itself is pinned in `metadata-protocol`'s own suites.
const gateNarrowsOn = (request: any) =>
    request.packageId !== undefined ? { packageId: request.packageId } : {};
const promoteDraftReceives = (request: any) =>
    'packageId' in request ? { packageId: request.packageId ?? null } : {};

describe('#10063 POST /meta/:type/:name/publish states the package it is promoting', () => {
    describe('supplied — the narrowing becomes reachable', () => {
        it('forwards `?package=<id>` as `packageId` on the publish request', async () => {
            const { request } = await publishWith({ package: PKG });
            expect(request.packageId).toBe(PKG);
        });

        it('makes the #9612 gate narrow to that package closure', async () => {
            // The gate limb reads the VALUE. Before this card it was always
            // `undefined` here, so the closure derivation was skipped and the
            // gate received the whole tenant on every HTTP-driven promotion.
            const { request } = await publishWith({ package: PKG });
            expect(gateNarrowsOn(request)).toEqual({ packageId: PKG });
        });

        it('makes `repo.promoteDraft` resolve the draft under that same key', async () => {
            // Gate and write must resolve under ONE key, which is the whole
            // point of threading the caller's binding rather than re-deriving
            // it in two places.
            const { request } = await publishWith({ package: PKG });
            expect(promoteDraftReceives(request)).toEqual({ packageId: PKG });
        });
    });

    describe('absent — the untouched path stays exactly as it was', () => {
        it('⛔ OMITS the key entirely when no package is stated', async () => {
            // THE case that makes this fix safe rather than a trade. See the
            // header: a present-and-`undefined` key coerces to `null`
            // downstream and pins the lookup to unbound rows, so every publish
            // of a package-bound draft would answer `no_draft`.
            const { request } = await publishWith({});
            expect(request).not.toHaveProperty('packageId');
        });

        it('leaves `repo.promoteDraft` on the historical match-any-package resolution', async () => {
            const { request } = await publishWith({});
            expect(promoteDraftReceives(request)).toEqual({});
        });

        it('narrows nothing at the gate, which is the correct answer for an unstated package', async () => {
            const { request } = await publishWith({});
            expect(gateNarrowsOn(request)).toEqual({});
        });

        it('reads `?package=all` as the env-local overlay, not a package named "all"', async () => {
            // The same sentinel the `PUT` door normalises away. A door that
            // forwarded the literal string would narrow the gate to a package
            // that does not exist.
            const { request } = await publishWith({ package: 'all' });
            expect(request).not.toHaveProperty('packageId');
        });

        it('reads an empty `?package=` as stating nothing', async () => {
            const { request } = await publishWith({ package: '' });
            expect(request).not.toHaveProperty('packageId');
        });

        it('ignores a non-string `?package`, rather than forwarding it', async () => {
            const { request } = await publishWith({ package: 7 as unknown as string });
            expect(request).not.toHaveProperty('packageId');
        });
    });

    describe('refusals — the accept surface widened, the refusals did not', () => {
        it('refuses a repeated `?package=` with the nested VALIDATION_ERROR envelope', async () => {
            // #6877's lesson on the sibling door: without the multiplicity
            // rule, `['a','b']` falls through a `typeof` ternary and the door
            // silently picks one. ADR-0112 nested envelope, the same one every
            // other route adopting this rule answers.
            const { res, publish } = await publishWith({ package: [PKG, 'app.other'] });
            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(publish).not.toHaveBeenCalled();
        });

        it('accepts one occurrence encoded as a one-element array', async () => {
            // The multiplicity helper unwraps it, so the `typeof` read below
            // sees the string it was written for. Accepting without unwrapping
            // would be a hole, not a courtesy.
            const { request } = await publishWith({ package: [PKG] });
            expect(request.packageId).toBe(PKG);
        });

        it('⛔ gates capability FIRST — an uncapable caller repeating the param gets 403, not 400', async () => {
            // The door's documented invariant: gate before anything else, so a
            // caller who may not publish cannot use the answer to probe the
            // shape of the surface. A 400 here would mean the new parameter
            // read had been placed ahead of the capability gate.
            const b = boot(UNCAPABLE);
            const res = await b.drive('POST', PUBLISH, {
                params: { type: TYPE, name: 'shared_grid' },
                query: { package: [PKG, 'app.other'] },
            });
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
            expect(b.publishMetaItem).not.toHaveBeenCalled();
        });
    });

    describe('the rest of the publish request is untouched', () => {
        it('still carries type, name, organization, actor and message', async () => {
            // A widened accept surface must not move anything already on the
            // request — this is the preservation half of the pin sweep.
            const b = boot(AUTHORIZED);
            await b.drive('POST', PUBLISH, {
                params: { type: TYPE, name: 'shared_grid' },
                query: { package: PKG },
                body: { message: 'ship it' },
            });
            const request = requestFrom(b.publishMetaItem);
            expect(request.type).toBe(TYPE);
            expect(request.name).toBe('shared_grid');
            expect(request.organizationId).toBe(ORG);
            expect(request.actor).toBe('u1');
            expect(request.message).toBe('ship it');
            expect(request.packageId).toBe(PKG);
        });

    });

    describe('parity with the `PUT` door — one wire spelling for one value', () => {
        // The save→publish loop states the binding on BOTH steps. If the two
        // doors normalised `?package=` differently, a designer save and the
        // publish that seals it would disagree about which package the item
        // belongs to — the drift this parity case exists to catch. Driving the
        // real handlers rather than comparing source, so a change to either
        // door's normalisation moves this assertion.
        const CASES: Array<{ label: string; query: Record<string, unknown> }> = [
            { label: 'a stated package', query: { package: PKG } },
            { label: 'no package at all', query: {} },
            { label: 'the `all` sentinel', query: { package: 'all' } },
            { label: 'an empty value', query: { package: '' } },
            { label: 'one occurrence as a one-element array', query: { package: [PKG] } },
        ];

        for (const { label, query } of CASES) {
            it(`decides ${label} identically on both doors`, async () => {
                const b = boot(AUTHORIZED);
                await b.drive('PUT', `${META}/:type/:name`, {
                    params: { type: TYPE, name: 'shared_grid' },
                    query: { ...query },
                    body: { label: 'Shared grid' },
                });
                await b.drive('POST', PUBLISH, {
                    params: { type: TYPE, name: 'shared_grid' },
                    query: { ...query },
                });
                const saved = requestFrom(b.saveMetaItem);
                const published = requestFrom(b.publishMetaItem);
                expect('packageId' in published).toBe('packageId' in saved);
                expect(published.packageId).toBe(saved.packageId);
            });
        }
    });
});
