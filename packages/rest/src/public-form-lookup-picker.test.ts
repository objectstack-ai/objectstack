// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7467] The public-lookup capability is REACHABLE end-to-end: a spec-valid
 * stored form carrying a `publicPicker` gets a real lookup answer.
 *
 * `GET /forms/:slug/lookup/:field` has always gated the anonymous picker on a
 * `publicPicker` block — and until #7467 that key was declared in no schema,
 * so `saveMetaItem` (which validates through `ViewMetadataSchema`) refused
 * every form carrying one with a 422 and the route's entire picker branch was
 * live code no authoring path could turn on. PR #7468's stored-row suite pins
 * that boundary from the other side ("STILL 403 — for a different reason");
 * THIS file is the flip's content: the same real write path now persists the
 * picker, and the same real route handler answers with data.
 *
 * ## What is real here and what is stubbed, exactly
 *
 * The form body fed to the routes is the body a REAL `saveMetaItem` persisted
 * into a stub repository's `sys_metadata` row, read back out of that row —
 * that write path validates through the REAL `ViewMetadataSchema` from
 * `@objectstack/spec`, which is precisely the door that refused the picker
 * before #7467. The route handlers are the real `RestServer` registrations.
 * The data engine under `findData` is stubbed (this suite pins the route's
 * request composition and response projection, not a driver), and the reader
 * is stubbed as in `public-form-routes.test.ts` — the ADR-0087 stored-row
 * conversion chain is a different seam, untouched by this card.
 */
import { describe, expect, it, vi } from 'vitest';
// The engine-double contract (#4434 / #5619): a fake engine's update/delete
// must be exactly as strict as ObjectQL's dispatch, or a dead route ships with
// its suite green. Both predicates live in metadata-core.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#13137] The instrument for the three-level control at the bottom of this
// file — the REAL `FieldSchema`, not a restatement of it.
import { FieldSchema } from '@objectstack/spec/data';
import { RestServer } from './rest-server.js';

// ─── the real save path (the seam that refused the picker before #7467) ─────

/** The slice of the engine the `sys_metadata` write path touches. */
function stubEngine() {
    const rows: Array<Record<string, any>> = [];
    let nextId = 0;
    return {
        rows,
        engine: {
            async findOne(object: string, query?: EngineFindOneQueryInput) {
                              assertEngineFindOnePredicate(object, query); return null; },
            async find() { return rows.slice(); },
            async insert(table: string, data: Record<string, any>) {
                if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
                nextId += 1;
                rows.push({ id: `r_${nextId}`, ...data });
                return { id: `r_${nextId}` };
            },
            async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
                assertEngineUpdateDispatch(data, opts);
                return { id: null };
            },
            async delete(_t: string, opts: { where: Record<string, unknown> }) {
                assertEngineDeleteDispatch(opts);
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
async function persistedBody(item: unknown): Promise<any> {
    const { engine, rows } = stubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    const result = await protocol.saveMetaItem({ type: 'view', name: 'lead.contact', item });
    expect(result.success, JSON.stringify(result)).toBe(true);
    const row = rows.find((r) => r.type === 'view');
    expect(row, 'the save persisted no view row').toBeDefined();
    return JSON.parse(row!.metadata);
}

// ─── the fixture an author writes ───────────────────────────────────────────

/**
 * The picker under test: every key is one the route reads, nothing more.
 * `object` is declared here to exercise the explicit override branch. It used
 * to be declared because it was the ONLY branch that worked — the route's
 * fallback read the legacy field-def spellings and not the canonical
 * `reference` (#7486, fixed). The omitted-`object` case now has its own suite
 * at the bottom of this file; leaving that path untested would leave the fix
 * unguarded at the level users actually hit.
 */
const PICKER = {
    displayFields: ['name', 'email'],
    maxResults: 10,
    filter: [{ field: 'is_active', operator: 'equals', value: true }],
    object: 'sys_user',
};

const studioForm = (fields: unknown[]) => ({
    name: 'lead.contact',
    object: 'lead',
    viewKind: 'form',
    label: 'Contact us',
    config: {
        type: 'simple',
        data: { provider: 'object', object: 'lead' },
        sharing: { allowAnonymous: true, publicLink: '/forms/contact' },
        sections: [{ label: 'About you', fields }],
    },
});

const leadObject = {
    name: 'lead',
    label: 'Lead',
    fields: {
        id: { type: 'text' },
        company: { type: 'text', label: 'Company' },
        owner: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
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

/**
 * Mount the real routes over a protocol that serves the STORED view body.
 * `objectDef` defaults to the canonical `leadObject`; the #7486 suite passes
 * variants to cover the legacy spellings the route's fallback chain still
 * reads — spellings `FieldSchema` REFUSES (#13137), so they can only ever have
 * been STORED, never authored through the spec.
 */
function routesOver(storedView: any, foundRows: any[], objectDef: any = leadObject) {
    const findData = vi.fn().mockResolvedValue({ data: foundRows });
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async ({ type }: { type: string }) => {
            if (type === 'view') return [storedView];
            if (type === 'object') return [objectDef];
            return [];
        }),
        createData: vi.fn().mockResolvedValue({ object: 'lead', id: 'rec_1', record: {} }),
        findData,
    };
    const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    const lookup = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path.endsWith('/forms/:slug/lookup/:field'))!;
    return { findData, lookup };
}

describe('#7467 a spec-valid stored form carrying a publicPicker reaches the lookup route', () => {
    it('the declaration survives the real save — a 422 here is the pre-#7467 gap reopening', async () => {
        // Before #7467 this exact save failed: `ViewMetadataSchema` reported
        // `unrecognized_keys` on `publicPicker` and no row was written. The
        // whole capability hangs on this assertion, which is why it stands
        // alone rather than as a side effect of the route cases below.
        const stored = await persistedBody(studioForm([{ field: 'owner', publicPicker: PICKER }]));
        expect(stored.config.sections[0].fields[0].publicPicker).toMatchObject({
            displayFields: ['name', 'email'],
            maxResults: 10,
            object: 'sys_user',
        });
    });

    it('…and the real lookup handler answers with projected data, not 403', async () => {
        const stored = await persistedBody(studioForm([{ field: 'owner', publicPicker: PICKER }]));
        const { findData, lookup } = routesOver(stored, [
            // The driver "returns" a column the projection must strip: never
            // trust that the engine respected `select` on an anonymous surface.
            { id: 'usr_1', name: 'Ada', email: 'ada@example.com', password_hash: 'LEAK' },
            { id: 'usr_2', name: 'Adele', email: 'adele@example.com' },
        ]);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: { q: 'ad' } } as any, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([
            { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
            { id: 'usr_2', name: 'Adele', email: 'adele@example.com' },
        ]);
        expect(res.body.displayFields).toEqual(['name', 'email']);

        // The query the route composed reads the STORED picker, key for key:
        // the declared object override, the declared cap, the declared filter
        // rows ahead of the visitor's search predicate, id + displayFields
        // projection, offset pinned to 0 (no anonymous pagination).
        expect(findData).toHaveBeenCalledTimes(1);
        const call = findData.mock.calls[0][0];
        expect(call.object).toBe('sys_user');
        expect(call.query.limit).toBe(10);
        expect(call.query.offset).toBe(0);
        expect(call.query.select).toEqual(['id', 'name', 'email']);
        // [#7485] Ordering is fixed, not authorable: first display field,
        // ascending. The route's `picker.sort ??` read is retired.
        expect(call.query.sort).toEqual([{ field: 'name', order: 'asc' }]);
        expect(call.query.filters).toEqual([
            { field: 'is_active', operator: 'equals', value: true },
            { field: 'name', operator: 'contains', value: 'ad' },
        ]);
        expect(call.context.anonymous).toBe(true);
    });

    it('GUARD: a stored form whose field declares NO picker still answers 403 LOOKUP_NOT_PUBLIC', async () => {
        // The opt-in stays an opt-in. Green before and after #7467 — declaring
        // the key must not have widened the default. (This is the surviving
        // half of PR #7468's "STILL 403" boundary pin: picker-less is now the
        // only reason left.)
        const stored = await persistedBody(studioForm(['company', { field: 'owner' }]));
        const { findData, lookup } = routesOver(stored, []);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('LOOKUP_NOT_PUBLIC');
        expect(findData).not.toHaveBeenCalled();
    });
});

// ─── [#7485] the retired fifth read ─────────────────────────────────────────

/**
 * Run a save and report a single verdict, however the door refuses: a
 * `{ success: false }` result and a thrown validation error are the same
 * answer here (the row is not written), and this suite pins the answer, not
 * which of the two spellings the protocol currently uses.
 */
async function saveVerdict(item: unknown): Promise<{ ok: boolean; detail: string }> {
    const { engine, rows } = stubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    try {
        const result = await protocol.saveMetaItem({ type: 'view', name: 'lead.contact', item });
        const wrote = rows.some((r) => r.type === 'view');
        return { ok: result?.success === true && wrote, detail: JSON.stringify(result) };
    } catch (error: any) {
        return { ok: false, detail: String(error?.message ?? error) };
    }
}

describe('#7485 publicPicker.sort is retired — not declarable, and not read', () => {
    it('the schema REFUSES a new form authoring publicPicker.sort — no row is written', async () => {
        // Half one of the pin, from the authoring side. `sort` was never in
        // `FormFieldPublicPickerSchema` (#7467), and #7485 chose to keep it
        // that way by removing the route's read rather than adding the key —
        // so the strict block (ADR-0089 D3a) is the enforcement, and it must
        // stay loud. `packages/spec/src/ui/view-public-picker.test.ts` pins the
        // same refusal at the schema; this pins it at the real write path.
        const withSort = await saveVerdict(studioForm([{
            field: 'owner',
            publicPicker: { ...PICKER, sort: [{ field: 'email', order: 'desc' }] },
        }]));
        expect(withSort.ok, `the save was expected to fail: ${withSort.detail}`).toBe(false);

        // The control, and the reason this pin does not match on the error
        // text: through `ViewMetadataSchema`'s union the failing ViewItem
        // branch loses to the container branch's diagnostic, so the reported
        // message names `viewKind`/`config` rather than `sort` (a pre-existing
        // union-diagnostic wart, filed separately — not caused by #7485). The
        // byte-identical form MINUS `sort` saving proves `sort` is the sole
        // cause, which is what this test is actually about.
        const withoutSort = await saveVerdict(studioForm([{ field: 'owner', publicPicker: PICKER }]));
        expect(withoutSort.ok, `the control save must succeed: ${withoutSort.detail}`).toBe(true);
    });

    it('a PRE-SCHEMA stored row still carrying sort is IGNORED, not an error — and the query keeps the fixed default', async () => {
        // Half two, from the stored-row side, and the reason this file rather
        // than the spec suite owns it: rows written before #7467 declared the
        // block never went through `ViewMetadataSchema`, so one can carry a
        // `sort` the schema would refuse today. The route must neither honor it
        // (that is the read #7485 retired) nor choke on it (a 500 on an
        // anonymous surface would be a regression the removal caused). It is
        // dead data: read past, answered 200, ordering unchanged.
        const stored = await persistedBody(studioForm([{ field: 'owner', publicPicker: PICKER }]));
        stored.config.sections[0].fields[0].publicPicker.sort = [{ field: 'email', order: 'desc' }];

        const { findData, lookup } = routesOver(stored, [{ id: 'usr_1', name: 'Ada', email: 'ada@example.com' }]);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([{ id: 'usr_1', name: 'Ada', email: 'ada@example.com' }]);
        // The stored `{ field: 'email', order: 'desc' }` reaches `findData`
        // nowhere: the fixed default is the only ordering the route composes.
        expect(findData).toHaveBeenCalledTimes(1);
        expect(findData.mock.calls[0][0].query.sort).toEqual([{ field: 'name', order: 'asc' }]);
    });

    it('…and the fixed sort tracks displayFields[0], including the no-displayFields default', async () => {
        // The ordering is not a constant — it is "first display field,
        // ascending". An empty block defaults displayFields to ['name'], so the
        // sort follows to `name`; a declared list sorts by its first entry.
        // Pinning both keeps a future refactor from freezing the field name.
        const stored = await persistedBody(studioForm([{ field: 'owner', publicPicker: { object: 'sys_user' } }]));
        const { findData, lookup } = routesOver(stored, []);
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, mockRes());
        expect(findData.mock.calls[0][0].query.sort).toEqual([{ field: 'name', order: 'asc' }]);

        const stored2 = await persistedBody(studioForm([{
            field: 'owner',
            publicPicker: { displayFields: ['email', 'name'], object: 'sys_user' },
        }]));
        const second = routesOver(stored2, []);
        await second.lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, mockRes());
        expect(second.findData.mock.calls[0][0].query.sort).toEqual([{ field: 'email', order: 'asc' }]);
    });
});

// ─── [#7486] the fallback resolution, against CANONICAL metadata ────────────

/**
 * The defect this suite pins: the route's fallback chain read only the LEGACY
 * field-def spellings (`referenceTo` / `target` / `options.objectName`), not
 * one of which `packages/spec/src/data/field.zod.ts` ACCEPTS. ⛔ [#13137] It
 * does not fold them onto `reference` either — an earlier version of this
 * paragraph claimed it did. `FieldSchema` is a `strictObject`, so
 * `referenceTo` / `target` are REFUSED by name; the `aliases` table only adds
 * *"Did you mean …"* to that refusal, because `strictObject` consults it solely
 * from the `unrecognized_keys` path. Pinned three ways at the bottom of this
 * file. A parsed object schema therefore carried NONE of the keys the route
 * read — the chain resolved `undefined` and a well-formed form got
 * `500 LOOKUP_TARGET_MISSING`, making `publicPicker.object` de-facto REQUIRED
 * while the schema and docs present it as optional.
 *
 * Every case below omits `object` deliberately: that is the axis under test.
 * The suite above covers the override branch and must stay that way — between
 * them the two branches of the resolution are both pinned.
 */
describe('#7486 the picker target resolves from the field definition when `object` is omitted', () => {
    /** The picker an author writes when they take the docs at their word. */
    const NO_OBJECT_PICKER = { displayFields: ['name', 'email'], maxResults: 10 };

    const savedWithoutObject = () => persistedBody(studioForm([{ field: 'owner', publicPicker: NO_OBJECT_PICKER }]));

    it('a CANONICAL `{ type: lookup, reference: sys_user }` field resolves with no `object` override', async () => {
        // The headline case, and the one the platform actually produces: this
        // exact request answered 500 LOOKUP_TARGET_MISSING before #7486.
        const stored = await savedWithoutObject();
        expect(stored.config.sections[0].fields[0].publicPicker.object).toBeUndefined();

        const { findData, lookup } = routesOver(stored, [{ id: 'usr_1', name: 'Ada', email: 'ada@example.com' }]);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: { q: 'ad' } } as any, res);

        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual([{ id: 'usr_1', name: 'Ada', email: 'ada@example.com' }]);
        // Resolved from `leadObject.fields.owner.reference` — not from the
        // picker, which declares no object at all.
        expect(findData).toHaveBeenCalledTimes(1);
        expect(findData.mock.calls[0][0].object).toBe('sys_user');
    });

    // ⛔ [#13137] These are spellings `FieldSchema` REFUSES. There is no fold,
    // so there is no "pre-fold row" for one of these to be — an earlier version
    // of this comment said there was, and #12920 cites that sentence as its
    // strongest surviving evidence that stored legacy rows exist. It carries
    // ZERO observational content about stored data, and neither do these cases.
    //
    // What is true and what these pin: a def spelling the target this way never
    // came through `FieldSchema`, and the serving read path replays ADR-0087
    // conversions (`applyConversionsToStoredItem`) without any schema
    // validation, so such a def would reach the route verbatim. These cases pin
    // what the route DOES with one. ⚠️ Whether any exists is #12920's open
    // production census — ⛔ assert nothing here in either direction.
    // The fix EXTENDS the chain; one that replaced it would turn these three
    // green cases into 500s.
    const LEGACY_DEFS: Array<[string, Record<string, unknown>]> = [
        ['referenceTo', { type: 'lookup', referenceTo: 'sys_user' }],
        ['target', { type: 'lookup', target: 'sys_user' }],
        ['options.objectName', { type: 'lookup', options: { objectName: 'sys_user' } }],
    ];
    for (const [spelling, ownerDef] of LEGACY_DEFS) {
        it(`a stored row spelling the target the LEGACY way (\`${spelling}\`) still resolves`, async () => {
            const stored = await savedWithoutObject();
            const legacyObject = { ...leadObject, fields: { ...leadObject.fields, owner: ownerDef } };
            const { findData, lookup } = routesOver(stored, [], legacyObject);
            const res = mockRes();
            await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);

            expect(res.statusCode).toBe(200);
            expect(findData.mock.calls[0][0].object).toBe('sys_user');
        });
    }

    it('the canonical `reference` WINS over a legacy spelling on the same def', async () => {
        // Head-of-chain, not merely present-in-chain: a row carrying both (a
        // partially-migrated def) must follow the canonical key. Appending
        // `reference` to the tail of the chain would pass every case above and
        // fail only this one.
        const stored = await savedWithoutObject();
        const bothObject = {
            ...leadObject,
            fields: { ...leadObject.fields, owner: { type: 'lookup', reference: 'sys_user', referenceTo: 'stale_legacy' } },
        };
        const { findData, lookup } = routesOver(stored, [], bothObject);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);

        expect(res.statusCode).toBe(200);
        expect(findData.mock.calls[0][0].object).toBe('sys_user');
    });

    it('GUARD: a field def carrying NO target at all still answers 500 LOOKUP_TARGET_MISSING', async () => {
        // The error did not become unreachable — it became RARE. Widening the
        // chain must not make an unresolvable picker silently search nothing.
        const stored = await savedWithoutObject();
        const targetless = { ...leadObject, fields: { ...leadObject.fields, owner: { type: 'lookup' } } };
        const { findData, lookup } = routesOver(stored, [], targetless);
        const res = mockRes();
        await lookup.handler({ params: { slug: 'contact', field: 'owner' }, query: {} } as any, res);

        expect(res.statusCode).toBe(500);
        expect(res.body.code).toBe('LOOKUP_TARGET_MISSING');
        expect(findData).not.toHaveBeenCalled();
    });
});

// ─── [#13137] the spec's alias table REFUSES, it does not fold ─────────────

/**
 * The three-level control, pinned so the prose above cannot rot back.
 *
 * Two levels cannot carry this. "`FieldSchema` rejects `referenceTo`" reads
 * equally well as *not measured*, and a blanket "everything is rejected" says
 * nothing about the alias table at all. Three levels separate the claims:
 * ACCEPT (the canonical key) · REFUSE **with** a rename hint (an alias-table
 * entry) · REFUSE **without** one (a key on no list). Only the third makes the
 * second mean something.
 *
 * The mechanism, if this ever reads surprising: `strictObject`'s `aliases`
 * table is consulted ONLY from the `unrecognized_keys` path
 * (`packages/spec/src/shared/strict-object.ts`), so an entry can only ever
 * decorate a REFUSAL. ⛔ It is not a normaliser, on this surface or any other —
 * three separate seats read the name `aliases` as "fold" on two different
 * schemas in one day, which is what this file's prose used to say too.
 *
 * ⛔ SCOPE: this pins the SPEC's behaviour and nothing else. It asserts
 * nothing about whether any stored row spells a target the legacy way — that
 * is #12920's open production census, unanswerable from here, and ⛔ no
 * assertion below may be cited as evidence in either direction.
 */
describe('#13137 `FieldSchema` REFUSES the legacy target spellings, it does not fold them', () => {
    /** `type` is the only required key on `FieldSchema`; everything else is the axis under test. */
    const parseField = (extra: Record<string, unknown>) => FieldSchema.safeParse({ type: 'lookup', ...extra });
    const messagesOf = (result: { success: boolean; error?: { issues: Array<{ code: string; message: string }> } }) =>
        (result.error?.issues ?? []).map((i) => i.message).join('\n');
    const codesOf = (result: { success: boolean; error?: { issues: Array<{ code: string }> } }) =>
        (result.error?.issues ?? []).map((i) => i.code);

    it('LEVEL 1 — POSITIVE CONTROL: the canonical `reference` is ACCEPTED', () => {
        // Without this the two refusals below are indistinguishable from a
        // schema that refuses its own canonical key, i.e. a broken instrument.
        const result = parseField({ reference: 'sys_user' });
        expect(result.success).toBe(true);
        expect(result.success && result.data.reference).toBe('sys_user');
    });

    it('LEVEL 2 — NEGATIVE CONTROL: a key on no list is refused `unrecognized_keys` with NO rename hint', () => {
        const result = parseField({ zzz_not_a_key: 'sys_user' });
        expect(result.success).toBe(false);
        expect(codesOf(result)).toContain('unrecognized_keys');
        expect(messagesOf(result)).toContain('`zzz_not_a_key`');
        expect(messagesOf(result)).not.toContain('Did you mean');
    });

    // LEVEL 3 — all five spellings the alias table files under `reference`.
    // ⛔ `success` is `false` for every one of them: that is the whole card.
    for (const alias of ['relatedTo', 'referenceTo', 'target', 'targetObject', 'lookupObject']) {
        it(`LEVEL 3 — \`${alias}\` is REFUSED with a rename hint onto \`reference\` — NOT folded onto it`, () => {
            const result = parseField({ [alias]: 'sys_user' });
            // Refused, not rewritten. If this ever flips to `true`, the alias
            // table has become a normaliser and every "does not fold" sentence
            // in this file and in `rest-server.ts` needs rewriting again.
            expect(result.success).toBe(false);
            expect(codesOf(result)).toContain('unrecognized_keys');
            // The hint is what separates level 3 from level 2 — it names the
            // canonical key the author should have written instead.
            expect(messagesOf(result)).toContain(`Did you mean \`${alias}\` → \`reference\`?`);
        });
    }
});
