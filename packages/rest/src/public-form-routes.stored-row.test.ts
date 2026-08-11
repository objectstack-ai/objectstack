// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7134] The acceptance surface for the `groups` save-path fold: the three
 * public-form routes, on the STORED-ROW path.
 *
 * #6926 / PR #7128 folded `FormViewSchema.groups` onto `sections` at the
 * producer, which fixed every consumer of a CODE-authored form. It did not
 * reach a form authored in Studio: `saveMetaItem` parses through the same
 * schema and then discards `parsed.data`, so the row kept the authored `groups`
 * and the three routes here — which walk `sections` only — degraded exactly as
 * #6926 described:
 *
 *   - `GET  /forms/:slug`               published an EMPTY field schema (#6601)
 *   - `POST /forms/:slug/submit`        computed an empty `allowedFields` and
 *                                       refused the submit outright (#6920)
 *   - `GET  /forms/:slug/lookup/:field` answered 403 for every field (#3022)
 *
 * The first two clear on the stored-row path and are pinned below. The THIRD
 * cleared later, in two steps: the fold reached its `sections` walk on this
 * card, and #7467 made the route's `publicPicker` opt-in spec-declarable (it
 * used to be refused 422 at `saveMetaItem`, so no stored row could carry one).
 * What was pinned here as a `BOUNDARY: STILL 403` case is now the flipped
 * pin below: a stored form carrying a picker gets a real lookup answer.
 *
 * ⛔ The fix is NOT `?? match.form?.groups` here. The #6926 guardrail stands: a
 * lenient consumer is where AI-authored metadata errors hide, and it leaves the
 * next consumer blind. `packages/rest` is untouched by this card — these tests
 * assert that the routes ALREADY work once the producer's fold survives the
 * save, which is the whole claim.
 *
 * ## What is real here and what is stubbed, exactly
 *
 * The form body fed to the routes is not a fixture: it is the body a REAL
 * `saveMetaItem` persisted into the stub repository's `sys_metadata` row, read
 * back out of that row. That is the seam this card changed, and it is genuine.
 *
 * The READER is stubbed, as in `public-form-routes.test.ts` — `getMetaItems`
 * hands the routes the stored body directly rather than replaying the ADR-0087
 * stored-row conversion chain. That chain is a different seam, and this card
 * did not touch it; stubbing it keeps the pin pointed at the save.
 *
 * ⚠️ Rows persisted BEFORE this change still carry `groups` and are not healed
 * by it — they heal on the author's next save, exactly as #4542's flow rows do.
 * That is a deliberate scope line, not an oversight.
 */
import { describe, expect, it, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions (#4550 delete / #5480
// update), so this fake cannot accept a call ObjectQL itself refuses — a double
// LOOSER than the real engine is a defect generator, which is how #4434 shipped
// a dead REST route with a green suite. That failure mode is this very card's
// subject, so the gate is defending the thing being fixed here.
//
// From `@objectstack/metadata-core` and NOT `@objectstack/objectql`: objectql
// depends in this direction, and that reverse edge is a cycle turbo refuses.
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// `.js` extension required under `moduleResolution: nodenext`. Without it the
// import does not resolve, `RestServer` becomes `any`, and every callback over
// it reports TS7006 — one broken extension reading as two type errors in this
// package's TEST_DEBT re-measure.
import { RestServer } from './rest-server.js';

// ─── the real save path ──────────────────────────────────────────────────────

/** The slice of the engine the `sys_metadata` write path touches. */
function stubEngine() {
    const rows: Array<Record<string, any>> = [];
    let nextId = 0;
    return {
        rows,
        engine: {
            async findOne() { return null; },
            async find() { return rows.slice(); },
            async insert(table: string, data: Record<string, any>) {
                if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
                nextId += 1;
                rows.push({ id: `r_${nextId}`, ...data });
                return { id: `r_${nextId}` };
            },
            async update(_table: string, data: Record<string, any>, options: Record<string, any>) {
                assertEngineUpdateDispatch(data, options);
                return { id: null };
            },
            async delete(_table: string, options: Record<string, any>) {
                assertEngineDeleteDispatch(options);
                return { deleted: 0 };
            },
            registry: { registerItem: () => {}, registerObject: () => {}, listItems: () => [] },
        } as any,
    };
}

/**
 * Save a view through the real `saveMetaItem` and return the body the
 * `sys_metadata` row holds — what a consumer of that row will read.
 */
async function persistedBody(name: string, item: unknown): Promise<any> {
    const { engine, rows } = stubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    const result = await protocol.saveMetaItem({ type: 'view', name, item });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const row = rows.find((r) => r.type === 'view');
    expect(row, 'the save persisted no view row').toBeDefined();
    return JSON.parse(row!.metadata);
}

// ─── the fixtures an author writes in Studio ────────────────────────────────

const SHARING = { allowAnonymous: true, publicLink: '/forms/contact' };
const DATA = { provider: 'object', object: 'lead' };

/**
 * The section every case declares.
 *
 * It carries NO `publicPicker`, which — since #7467 declared that key — is a
 * choice rather than a necessity (when this file was written the schema
 * refused the key outright, so no stored row could carry one). A picker-less
 * field keeps the lookup route at 403, which the flipped case below contrasts
 * against its own picker-carrying fixture.
 */
const SECTION = {
    label: 'About you',
    fields: ['company', { field: 'owner' }],
};

/**
 * A public form saved from Studio as a `ViewItem` — `viewKind: 'form'` with the
 * form config under `config`. This is the shape `findPublicFormView` resolves
 * a stored public form through (its third branch), which is why the acceptance
 * surface is spelled here rather than on the flattened overlay.
 */
const studioForm = (sectionKey: 'groups' | 'sections') => ({
    name: 'lead.contact',
    object: 'lead',
    viewKind: 'form',
    label: 'Contact us',
    config: { type: 'simple', data: DATA, sharing: SHARING, [sectionKey]: [SECTION] },
});

const leadObject = {
    name: 'lead',
    label: 'Lead',
    fields: {
        id: { type: 'text' },
        company: { type: 'text', label: 'Company' },
        owner: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
        internal_score: { type: 'formula', label: 'Score', formula: '(a - b) / a' },
        owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner Id' },
    },
};

// ─── the real routes ────────────────────────────────────────────────────────

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.end = vi.fn(() => res);
    return res;
}

/** Mount the real routes over a protocol that serves the STORED view body. */
function routesOver(storedView: any) {
    const createData = vi.fn().mockResolvedValue({ object: 'lead', id: 'rec_1', record: {} });
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: { type: string }) => {
            if (type === 'view') return [storedView];
            if (type === 'object') return [leadObject];
            return [];
        }),
        createData,
        // The lookup route's search, once it gets past the 403. The route reads
        // `result.data` (or `result.items`) — the flipped #7467 case below
        // asserts the projected rows, so the stub answers in that shape.
        queryData: vi.fn().mockResolvedValue({ data: [{ id: 'usr_1', name: 'Ada' }] }),
        findData: vi.fn().mockResolvedValue({ data: [{ id: 'usr_1', name: 'Ada' }] }),
    };
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const find = (method: string, suffix: string) =>
        rest.getRoutes().find((r) => r.method === method && r.path.endsWith(suffix))!;
    return {
        createData,
        resolve: find('GET', '/forms/:slug'),
        submit: find('POST', '/forms/:slug/submit'),
        lookup: find('GET', '/forms/:slug/lookup/:field'),
    };
}

describe('#7134 a Studio-saved form authored with `groups` no longer degrades on the public routes', () => {
    // Each case saves through the REAL write path first, so what the routes
    // read is what an author's save actually leaves in the row.

    it('GET /forms/:slug publishes the declared field schema, not an empty one', async () => {
        const { resolve } = routesOver(await persistedBody('lead.contact', studioForm('groups')));
        const res = mockRes();
        await resolve.handler({ params: { slug: 'contact' }, headers: {} } as any, res);
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.body.objectSchema.fields).sort()).toEqual(['company', 'owner']);
        // …and still publishes ONLY the declared set — #6601's narrowing is not
        // loosened by the fold, it is finally reached by it.
        expect(res.body.objectSchema.fields.internal_score).toBeUndefined();
    });

    it('POST /forms/:slug/submit accepts the declared fields instead of refusing', async () => {
        const { submit, createData } = routesOver(await persistedBody('lead.contact', studioForm('groups')));
        const res = mockRes();
        await submit.handler(
            { params: { slug: 'contact' }, body: { company: 'Acme', owner: 'usr_1', owner_id: 'usr_victim' } } as any,
            res,
        );
        expect(res.statusCode).toBe(201);
        expect(createData).toHaveBeenCalledTimes(1);
        // The #3022 anchor boundary is untouched — a wider `allowedFields` must
        // not become a wider forgeable set.
        expect(createData.mock.calls[0][0].data).toEqual({ company: 'Acme', owner: 'usr_1' });
    });

    it('FLIPPED [#7467]: the lookup route answers — a stored form carrying a publicPicker gets real data', async () => {
        // This case was born as `BOUNDARY: the lookup route is STILL 403 — for
        // a different reason`: #7134 listed the lookup route's blanket 403 as
        // the third degradation, the fold reached its `sections` walk (the two
        // routes above are the same walk, and they changed), but the route's
        // `publicPicker` opt-in was declared in NO schema — `ViewMetadataSchema`
        // is strict, so a form carrying one was refused 422 by `saveMetaItem`
        // and could never reach a row. The original assertion said so and was
        // annotated to be revisited the day a spec-side home landed.
        //
        // #7467 landed it (maintainer ruling: declare — `FormFieldSchema.
        // publicPicker`, mirroring exactly what this route reads), so this is
        // the revisit: the SAME real write path now persists the picker, the
        // SAME real route handler gets past the 403, and the third degradation
        // clears end-to-end. `object` is declared on the picker because the
        // route's field-def fallback reads only legacy spellings — #7486.
        //
        // The picker-less half of the old pin is not lost: a stored form whose
        // field declares no picker still answers 403, pinned in
        // `public-form-lookup-picker.test.ts` (the opt-in stays an opt-in).
        const withPicker = {
            ...studioForm('groups'),
            config: {
                type: 'simple', data: DATA, sharing: SHARING,
                groups: [{
                    label: 'About you',
                    fields: ['company', { field: 'owner', publicPicker: { displayFields: ['name'], object: 'sys_user' } }],
                }],
            },
        };
        const { lookup } = routesOver(await persistedBody('lead.contact', withPicker));
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([{ id: 'usr_1', name: 'Ada' }]);
        expect(res.body.displayFields).toEqual(['name']);
    });

    it('the stored row itself is the canonical spelling — nothing here reads `groups`', async () => {
        // The claim under all three routes above, stated directly: the fix is
        // that the ROW changed, not that `rest-server.ts` learned a second key.
        const stored = await persistedBody('lead.contact', studioForm('groups'));
        expect(stored.config).not.toHaveProperty('groups');
        expect(stored.config.sections).toEqual([SECTION]);
    });

    it('an EMPTY `groups` folds to an empty `sections` — a declaration, still empty', async () => {
        // The row half of the empty-declaration guard below. Evidence: on revert
        // the row carries `groups: []` and no `sections` at all.
        const stored = await persistedBody('lead.contact', {
            ...studioForm('groups'),
            config: { type: 'simple', data: DATA, sharing: SHARING, groups: [] },
        });
        expect(stored.config.sections).toEqual([]);
        expect(stored.config).not.toHaveProperty('groups');
    });
});

describe('#7134 GUARD — a form authored with canonical `sections` is unaffected', () => {
    // Green in BOTH directions: these forms never carried the alias, so they
    // never degraded and the graft has nothing to do. Here to prove the change
    // did not disturb the path that already worked.

    it('GUARD: the published schema is the declared set, as it always was', async () => {
        const { resolve } = routesOver(await persistedBody('lead.contact', studioForm('sections')));
        const res = mockRes();
        await resolve.handler({ params: { slug: 'contact' }, headers: {} } as any, res);
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.body.objectSchema.fields).sort()).toEqual(['company', 'owner']);
    });

    it('GUARD: submit still accepts exactly the declared fields', async () => {
        const { submit, createData } = routesOver(await persistedBody('lead.contact', studioForm('sections')));
        const res = mockRes();
        await submit.handler(
            { params: { slug: 'contact' }, body: { company: 'Acme', owner_id: 'usr_victim' } } as any,
            res,
        );
        expect(res.statusCode).toBe(201);
        expect(createData.mock.calls[0][0].data).toEqual({ company: 'Acme' });
    });

    it('GUARD: a form that declares NOTHING still publishes and accepts nothing', async () => {
        // GUARD, green in BOTH directions: #6601 / #6920's refusal must survive
        // the fold. An empty `groups` folds to an empty `sections`, and an empty
        // declaration is an empty declaration either way — so this asserts ROUTE
        // behaviour only. (An `expect(stored.config.sections).toEqual([])` here
        // would be fix-evidence under a guard's label; it lives in the evidence
        // block above, where reverse verification can read it correctly.)
        const stored = await persistedBody('lead.contact', {
            ...studioForm('groups'),
            config: { type: 'simple', data: DATA, sharing: SHARING, groups: [] },
        });
        const { resolve, submit, createData } = routesOver(stored);

        const readRes = mockRes();
        await resolve.handler({ params: { slug: 'contact' }, headers: {} } as any, readRes);
        expect(Object.keys(readRes.body.objectSchema.fields)).toEqual([]);

        const writeRes = mockRes();
        await submit.handler({ params: { slug: 'contact' }, body: { company: 'Acme' } } as any, writeRes);
        expect(writeRes.statusCode).toBe(400);
        expect(writeRes.body.code).toBe('VALIDATION_ERROR');
        expect(createData).toHaveBeenCalledTimes(0);
    });
});
