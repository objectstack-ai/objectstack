// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #10340 — the `/meta` doors decided ORGANIZATION SCOPE from the RAW url
// spelling while storage folded it through the COMPLETE map.
//
// ── What was broken ───────────────────────────────────────────────────────
//
// Two maps that must agree did not. Storage folds `/meta/:type` through
// `META_URL_TO_SINGULAR` (every manifest spelling AND every registry-derived
// one), while the doors' scope predicate — `declaresOrgOverride` — tolerates
// only the manifest-collection spellings. For the two registry-derived
// spellings, `translations` and `email_templates`, the doors therefore read
// and wrote ENV-WIDE where the singular twin was org-scoped:
//
//   PUT /meta/translation/:name   → org-scoped row      (correct)
//   PUT /meta/translations/:name  → env-wide row        (the defect)
//
// One item, two partitions, addressed by spelling — #4432 / #7894's defect
// one layer down from where #7894 closed it. The fix is the direction those
// rulings settled: the doors fold the segment through `canonicalMetaUrlType`
// BEFORE the scope decision, so scope and storage answer one question.
// ⛔ NOT taken: widening `declaresOrgOverride`'s map — a predicate below the
// boundary consuming the URL spelling contract is the repair
// `metadata-url-spelling.ts`'s own header forbids.
//
// ── What these assertions are ABOUT, and why they are argument-level ───────
//
// Same reasoning as the #8805 suite next door: the link from
// `request.organizationId` to the `sys_metadata` partition is owned and
// pinned by `@objectstack/metadata-protocol`. The link THIS package owns is
// which organizationId the door SUPPLIES for a given raw spelling. That is an
// argument, so these are argument assertions against the request each door
// hands the protocol.
//
// ── Deliberately NOT swept in ─────────────────────────────────────────────
//
// `GET /meta/_drafts` applies NO fold, by design — it matches the draft
// row's STORED `type`, and stored types are canonical because the protocol
// folds on save. A preservation case below pins the raw pass-through so this
// suite cannot be read as licensing a fold there.

import { describe, it, expect, vi } from 'vitest';
import { organizationIdForMetaWrite } from '@objectstack/metadata-core';
import { META_URL_TO_SINGULAR } from '@objectstack/spec/meta-spelling';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG = 'org_alpha';

// The two measured members of the disagreement set (#10340's table,
// re-derived at head by execution): URL-only spellings of
// `allowOrgOverride: true` types, invisible to the manifest map.
const MEMBERS = [
    { plural: 'translations', singular: 'translation' },
    { plural: 'email_templates', singular: 'email_template' },
] as const;

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
 * @param execCtx what `resolveExecCtx` resolves to. Every door below gates on
 *   `manage_metadata` (or an authoring capability) before the scope decision,
 *   so the capability is present throughout — without it each case would 403
 *   and pass for the wrong reason.
 */
function boot(execCtx: any) {
    const calls = {
        saveMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
        deleteMetaItem: vi.fn().mockResolvedValue({ success: true }),
        publishMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
        rollbackMetaItem: vi.fn().mockResolvedValue({
            success: true, version: 'v1', seq: 1, restoredFromVersion: 1,
        }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'x', name: 'x', item: { name: 'x' } }),
        getMetaItems: vi.fn().mockResolvedValue({ type: 'x', items: [] }),
        getMetaItemLayered: vi.fn().mockResolvedValue({ code: null, overlay: null, effective: null }),
        listDrafts: vi.fn().mockResolvedValue({ drafts: [] }),
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
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0], rest };
    };

    return { ...calls, drive, rest };
}

/** The request object the route handed to the protocol. */
const requestFrom = (fn: any) => fn.mock.calls[0][0];

const AUTHORIZED = { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: ORG };

async function writeWith(type: string) {
    const b = boot(AUTHORIZED);
    await b.drive('PUT', `${META}/:type/:name`, {
        params: { type, name: 'greeting' },
        body: { label: 'Greeting' },
    });
    return requestFrom(b.saveMetaItem);
}

async function readWith(type: string) {
    const b = boot(AUTHORIZED);
    await b.drive('GET', `${META}/:type/:name`, {
        params: { type, name: 'greeting' },
    });
    return requestFrom(b.getMetaItem);
}

describe('#10340 the /meta doors decide org scope on the FOLDED type, not the raw spelling', () => {
    describe('the two measured members — spelling twins are ONE namespace again', () => {
        for (const { plural, singular } of MEMBERS) {
            it(`PUT /meta/${plural}/:name lands where PUT /meta/${singular}/:name lands`, async () => {
                // Before the fold this was the defect limb: the plural door
                // supplied NO organization, so an org-active author's write
                // landed an env-wide row their own org-scoped read then
                // shadowed — persisted, receipted as live, served by nothing.
                const viaPlural = await writeWith(plural);
                const viaSingular = await writeWith(singular);
                expect(viaPlural.organizationId).toBe(ORG);
                expect(viaPlural.organizationId).toBe(viaSingular.organizationId);
            });

            it(`GET /meta/${plural}/:name resolves the same partition as the singular`, async () => {
                const viaPlural = await readWith(plural);
                const viaSingular = await readWith(singular);
                expect(viaPlural.organizationId).toBe(ORG);
                expect(viaPlural.organizationId).toBe(viaSingular.organizationId);
            });

            it(`scopes every remaining door for /meta/${plural} — list, layers, compound, delete, publish, rollback`, async () => {
                const b = boot(AUTHORIZED);
                await b.drive('GET', `${META}/:type`, { params: { type: plural } });
                expect(requestFrom(b.getMetaItems).organizationId).toBe(ORG);

                const b2 = boot(AUTHORIZED);
                await b2.drive('GET', `${META}/:type/:name/layers`, {
                    params: { type: plural, name: 'greeting' },
                });
                expect(requestFrom(b2.getMetaItemLayered).organizationId).toBe(ORG);

                const b3 = boot(AUTHORIZED);
                await b3.drive('GET', `${META}/:type/:section/:name`, {
                    params: { type: plural, section: 'core', name: 'greeting' },
                });
                expect(requestFrom(b3.getMetaItem).organizationId).toBe(ORG);

                const b4 = boot(AUTHORIZED);
                await b4.drive('DELETE', `${META}/:type/:name`, {
                    params: { type: plural, name: 'greeting' },
                });
                expect(requestFrom(b4.deleteMetaItem).organizationId).toBe(ORG);

                const b5 = boot(AUTHORIZED);
                await b5.drive('POST', `${META}/:type/:name/publish`, {
                    params: { type: plural, name: 'greeting' },
                });
                expect(requestFrom(b5.publishMetaItem).organizationId).toBe(ORG);

                const b6 = boot(AUTHORIZED);
                await b6.drive('POST', `${META}/:type/:name/rollback`, {
                    params: { type: plural, name: 'greeting' },
                    body: { toVersion: 1 },
                });
                expect(requestFrom(b6.rollbackMetaItem).organizationId).toBe(ORG);

                const b7 = boot(AUTHORIZED);
                await b7.drive('PUT', `${META}/:type/:section/:name`, {
                    params: { type: plural, section: 'core', name: 'greeting' },
                    body: { label: 'Greeting' },
                });
                expect(requestFrom(b7.saveMetaItem).organizationId).toBe(ORG);
            });
        }
    });

    describe('the whole contract, not the two specimens — every spelling in the URL map', () => {
        it('decides scope for every URL spelling exactly as for its folded type', async () => {
            // The class-closing sweep. For EVERY key of `META_URL_TO_SINGULAR`
            // the door's decision must equal the predicate's decision on the
            // FOLDED type — the property the two maps' disagreement broke. A
            // future spelling limb (a new registry type's derived plural, a
            // new camelCase form) arrives inside this quantifier with nothing
            // to update by hand (Prime Directive #8).
            for (const [spelling, folded] of Object.entries(META_URL_TO_SINGULAR)) {
                const request = await writeWith(spelling);
                expect(
                    request.organizationId,
                    `PUT door scope for '${spelling}' disagreed with its fold '${folded}'`,
                ).toBe(organizationIdForMetaWrite(folded, ORG));
            }
        });

        it('⛔ still leaves a non-overridable type env-wide under every spelling', async () => {
            // The guard against over-folding: the fold must change WHICH type
            // is judged, never the judgement itself. `object` is
            // `allowOrgOverride: false`, and an org-scoped write of it is the
            // phantom row #6190 stopped minting.
            for (const spelling of ['object', 'objects']) {
                const request = await writeWith(spelling);
                expect(request.organizationId).toBeUndefined();
            }
        });
    });

    describe('the adjacent measured behaviours the card names', () => {
        it('folds the /published code-store fallback — 404-by-spelling ends', async () => {
            // The smaller second site of the same class: after the layered
            // consult misses, the fallback reads the code/package registry,
            // which stores CANONICAL types. Handed the raw segment it
            // answered 404 for a recognised plural of a code-published item.
            const b = boot(AUTHORIZED);
            const getPublished = vi.fn().mockResolvedValue({ name: 'greeting' });
            (b.rest as any).resolveMetadataService = async () => ({ getPublished });
            await b.drive('GET', `${META}/:type/:name/published`, {
                params: { type: 'translations', name: 'greeting' },
            });
            expect(getPublished).toHaveBeenCalledWith('translation', 'greeting');
        });

        it('⛔ leaves GET /meta/_drafts unfolded — it matches the draft row STORED type, by design', async () => {
            // Deliberately NOT a site (#10340 records why): stored types are
            // canonical because the protocol folds on save, so `?type=` is a
            // filter against stored rows, not a URL segment. Folding it would
            // be a behaviour change, not a repair.
            const b = boot(AUTHORIZED);
            await b.drive('GET', `${META}/_drafts`, {
                query: { type: 'translations' },
            });
            expect(requestFrom(b.listDrafts).type).toBe('translations');
        });
    });

    describe('what the fold deliberately does NOT touch', () => {
        it('hands the protocol the RAW segment as the request type — the protocol owns its own fold', async () => {
            // The scope ARGUMENT is folded; the request `type` stays the raw
            // segment exactly as before, because the protocol boundary folds
            // it itself (`canonicalizeMetaRequestType`) and two pre-folds
            // would hide a drift between them from the protocol's own tests.
            const request = await writeWith('translations');
            expect(request.type).toBe('translations');
            expect(request.organizationId).toBe(ORG);
        });
    });
});
