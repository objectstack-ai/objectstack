// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11712] `?mode=draft` on the compound-name `PUT /api/v1/meta/:type/:section/:name`
 * — the FIFTH divergence closed on this door pair, and the first one whose
 * harmful direction is a silent WRITE rather than a silent refusal.
 *
 * ## ⚠️ #12194 reversed the compound door's WRITE outcome
 *
 * Stage 1 of #12176 (maintainer ruling 2026-08-25): the item-name grammar
 * refuses every slash-bearing name at `saveMetaItem`, so the compound door's
 * folded `crm/task` is now refused `400 INVALID_REQUEST` before the lifecycle
 * split this file was written about is reached — `?mode=draft` cannot stage a
 * slash-named draft any more. The route still folds and still threads `mode`
 * (the seam pins below stay true); the single-segment twin keeps the full
 * #11712 contract; the repeated-parameter guard still answers first. The
 * compound-door cases pin the refusal; the twins now DIVERGE BY DESIGN at the
 * write (the route retirement itself is D3, #12195).
 *
 * ## The defect, as measured
 *
 * ADR-0005's per-item lifecycle stages a write when the caller sends
 * `?mode=draft`; `POST /meta/:type/:name/publish` promotes it later. The
 * single-segment `PUT /meta/:type/:name` reads that parameter and threads it.
 * The compound-name twin built its `saveMetaItem` request field by field and
 * `mode` was not one of the fields, so it fell to `saveMetaItem`'s `'publish'`
 * default. Driven through the real registered handlers against one store:
 *
 * ```
 * COMPOUND  PUT /meta/object/crm/task?mode=draft  → 200 {"state":"active"}
 *   row_compound  name=crm/task   state=active  label=NEW_LABEL   ← LIVE, overwritten
 * SINGLE    PUT /meta/object/crm_task?mode=draft → 200
 *   row_single    name=crm_task   state=active  label=ACTIVE_LABEL ← LIVE, untouched
 *   r_2           name=crm_task   state=draft   label=NEW_LABEL    ← staged
 * ```
 *
 * One name, spelled two ways, and the parameter is not refused at either door —
 * it is honoured at one and dropped at the other, with a `200` both times. The
 * caller asked for a staging buffer and got a publish.
 *
 * ## Why threading, and not refusing the parameter here
 *
 * #7019's ruling, inherited with its reason for the fifth time: this route is
 * "word for word the same operation" as its twin — one generic `saveMetaItem`
 * reached by a name spelled in two segments — and every divergence found on the
 * pair has been closed on that finding (#6603/#7019's `manage_metadata` gate,
 * #8805's write-side organization, #7035's 501 envelope, #11095's `?force`).
 * #11095's carve-out is for the runtime DISPATCHER, which has no query string
 * at all; it does not describe this door, which has one and already reads two
 * parameters off it.
 *
 * The fork triage left open — "the draft door may have a real reason to stay
 * single-segment only" — was measured and is CLOSED in the negative:
 *
 *  • `saveMetaItem` keys the draft on `type`/`name`/organization/package and
 *    passes `state` to `repo.put`. Nothing in that path reads the name's
 *    SHAPE, so `crm/task` is a draft key exactly like `crm_task` is.
 *  • The ADR-0033 read half is already mounted in BOTH arities —
 *    `GET /:type/:section/:name/published` (#7526), whose own comment cites the
 *    SDK's `getPublished('lead', 'views/all_leads')` and calls a compound name
 *    "how every other read on this surface addresses a sub-resource".
 *
 * A compound draft is a shape this surface already serves on the read side.
 * Only the write door was missing.
 *
 * ## Why the REAL protocol and not a double
 *
 * The subject is a route's query-string handling, but the claim worth pinning
 * is what the write DID. A double that only recorded the request would pass
 * against a door that names `mode` and a store that ignores it; and a
 * status-only assertion passes against the UNFIXED door, which answers `200`
 * while publishing live — this card's defect exactly. So the gate is the real
 * `ObjectStackProtocolImplementation` over a `sys_metadata`-backed engine and
 * every case reads the STORE: which row is live, which row is staged, and which
 * body each of them carries.
 *
 * ⚠️ That import resolves through `exports` to `@objectstack/metadata-protocol`'s
 * **`dist/`** (registered in `check-test-source-alias.mjs`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS` for this package), so this suite is a verdict
 * about the BUILT protocol. Rebuild it before reading a result here after
 * touching `protocol.ts`.
 *
 * ## Body shapes
 *
 * Two, and they are the file's rather than a typo — the same split
 * `meta-compound-save-force-parity.test.ts` documents. The `200` save answer is
 * the protocol's own `{ success, version, seq, state, message }`. The `400`
 * from `refuseRepeatedQueryParams` is hand-built by the route and NESTED:
 * `{ error: { code, message } }`.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';
import { assertEngineUpdateDispatch, assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

const META = '/api/v1/meta';
const COMPOUND_PATH = `${META}/:type/:section/:name`;
const SINGLE_PATH = `${META}/:type/:name`;

/** The compound URL `section` + `name` spell, and the single-segment twin's. */
const COMPOUND_NAME = 'crm/task';
const SINGLE_NAME = 'crm_task';

/** What the seeded LIVE row carries, and what a published save would replace. */
const LIVE_LABEL = 'Live label';
/** What every case submits. A staged save must NOT make this the live label. */
const SUBMITTED_LABEL = 'Edited label';

/**
 * A spec-valid `object` body. `sharingModel` is not decoration: ADR-0090 D1's
 * author-time gate refuses an unset OWD (`security-owd-unset`), and without it
 * the save would fail a phase before the one under test — a red that reads
 * exactly like "the parameter did not work".
 *
 * The field set is IDENTICAL to the seeded row's on purpose: this card is about
 * draft-vs-live, so nothing here may trip `saveMetaItem`'s Phase 3a-destructive
 * gate (that is #11095's card, pinned next door). Only the label moves.
 */
const objectBody = (label: string) => ({
    name: SINGLE_NAME,
    label,
    sharingModel: 'private',
    fields: Object.fromEntries(['a', 'b'].map((f) => [f, { name: f, type: 'text', label: f }])),
});

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
    version: number;
}

/**
 * Boot both `PUT` doors over the REAL protocol against ONE store, seeded so
 * both names exist LIVE with the same body. The single-segment twin is a
 * control in every case rather than a separate suite, because "the two doors
 * agree" is the claim.
 */
function boot() {
    const rows = new Map<string, StoredRow>();
    const seed = (id: string, name: string) => rows.set(id, {
        id, type: 'object', name,
        organization_id: null, package_id: null, state: 'active',
        metadata: JSON.stringify(objectBody(LIVE_LABEL)),
        checksum: 'sha256_11712_fixture', version: 1,
    });
    seed('row_compound', COMPOUND_NAME);
    seed('row_single', SINGLE_NAME);

    /**
     * Scalar equality ONLY, and every combinator is REFUSED rather than
     * approximated — `pnpm check:where-matcher`
     * (`scripts/check-where-matcher-conformance.mjs`, #8494): "a discovered
     * matcher must answer every combinator probe CORRECTLY, or REFUSE it by
     * throwing". A `$and` silently falling through to `r['$and']` compares
     * `undefined` against an array, excludes the row and returns an empty
     * result set with nothing erroring — a suite can go green while asserting
     * about a DIFFERENT query than the one the protocol sent. `$`-prefixed keys
     * are never field names (`protocol.ts`'s `FILTER_LOGICAL_KEYS`), so the
     * guard is a prelude rather than an arm inside the loop: a preceding scalar
     * miss must not short-circuit `.every` past an operator we cannot answer.
     */
    const match = (r: any, where: Record<string, unknown>): boolean => {
        for (const k of Object.keys(where ?? {})) {
            if (k.startsWith('$')) {
                throw new Error(`fake engine: unsupported logical operator ${k}`);
            }
        }
        return Object.entries(where ?? {}).every(([k, v]) =>
            v === null || v === undefined
                ? r[k] === null || r[k] === undefined
                : r[k] === v,
        );
    };

    const engine: any = {
        async find(table: string, o?: { where?: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return [];
            return [...rows.values()].filter((r) => match(r, o?.where ?? {}));
        },
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            if (table !== 'sys_metadata') return null;
            for (const r of rows.values()) if (match(r, o?.where ?? {})) return r;
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata') {
                const r = { ...(data as any), id: String(data.id ?? `r_${rows.size}`) } as StoredRow;
                rows.set(r.id, r);
            }
            return { id: String(data.id ?? 'r_new') };
        },
        // ⛔ Routed through the producer-side predicates, never hand-mirrored:
        // a double looser than `ObjectQL` turns a green suite into no suite
        // (`check:engine-double-contract`, #4550 / #5480). This file NEEDS the
        // write verbs, because every assertion below is on the STORE — a draft
        // save INSERTS a second row and a published save UPDATES the first, and
        // telling those apart is the whole card.
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            const id = (opts as any)?.where?.id;
            const existing = id ? rows.get(String(id)) : undefined;
            if (existing) rows.set(String(id), { ...existing, ...(data as any) });
            return { id: id ?? null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());

    /**
     * Every request the doors hand the protocol, recorded at the seam. The
     * store answers "what did the write do"; this answers "with what" — and the
     * distinction is the defect: the pre-fix door reached `saveMetaItem` on
     * every one of these calls, it simply never named `mode` in the object.
     */
    const seen: any[] = [];
    const realSave = protocol.saveMetaItem.bind(protocol);
    protocol.saveMetaItem = async (request: any) => { seen.push(request); return realSave(request); };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // `manage_metadata` held — the #7019 capability gate is a different card and
    // must not be what answers here.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();

    const route = (method: string, path: string) => (rest as any).getRoutes().find(
        (r: any) => r.method === method && r.path === path,
    );

    const call = async (path: string, params: Record<string, string>, query: Record<string, unknown>) => {
        const res = mockRes();
        await route('PUT', path)!.handler({ params, query, headers: {}, body: objectBody(SUBMITTED_LABEL) }, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    /** Rows for one metadata name, by lifecycle state — read from the STORE. */
    const labelOf = (name: string, state: string): string | undefined => {
        for (const r of rows.values()) {
            if (r.name === name && r.state === state) return JSON.parse(r.metadata)?.label;
        }
        return undefined;
    };

    return {
        seen,
        /**
         * The pair this whole file turns on, for one name: what the LIVE row
         * carries and what (if anything) is STAGED beside it. Returned as a
         * tuple so a parity case can compare the two doors without either side
         * naming the outcome — see §5.
         */
        outcome: (name: string) => [labelOf(name, 'active'), labelOf(name, 'draft')] as const,
        compoundOutcome: () => [labelOf(COMPOUND_NAME, 'active'), labelOf(COMPOUND_NAME, 'draft')] as const,
        singleOutcome: () => [labelOf(SINGLE_NAME, 'active'), labelOf(SINGLE_NAME, 'draft')] as const,
        /** The door under test. */
        compoundPut: (query: Record<string, unknown> = {}) =>
            call(COMPOUND_PATH, { type: 'object', section: 'crm', name: 'task' }, query),
        /** Its single-segment twin — the control, already correct before this card. */
        singlePut: (query: Record<string, unknown> = {}) =>
            call(SINGLE_PATH, { type: 'object', name: SINGLE_NAME }, query),
    };
}

/** What the store looks like when a save was STAGED: live untouched, draft beside it. */
const STAGED = [LIVE_LABEL, SUBMITTED_LABEL];
/** What it looks like when a save went LIVE: live replaced, nothing staged. */
const PUBLISHED = [SUBMITTED_LABEL, undefined];

// ═══════════════════════════════════════════════════════════════════════════
// 1. ⭐ The compound door, `?mode=draft` — the case that fails without the fix
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #12194] compound-name PUT — `?mode=draft` is refused at the grammar gate', () => {
    it('⭐ refuses the folded slash name: live row untouched, NOTHING staged', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ mode: 'draft' });

        // The grammar gate answers before the lifecycle split is reached: a
        // slash-named DRAFT is as refused as a slash-named publish, or the
        // staging buffer would become the one channel that still mints slash
        // rows (they would surface at promote time instead).
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('⭐ the refusal names the grammar and the dotted prescription', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ mode: 'draft' });

        // `handleRouteError`'s body is FLAT — the message string is `error`.
        expect(answer.body?.error).toContain('is not a legal metadata item name');
        expect(answer.body?.error).toContain('crm_lead.pipeline');
    });

    it('threads `mode: \'draft\'` into the protocol request, and only when asked', async () => {
        const stack = boot();

        await stack.compoundPut();
        await stack.compoundPut({ mode: 'draft' });

        // The seam itself. The pre-fix door reached `saveMetaItem` on BOTH of
        // these calls — it simply never named `mode` in either request, which
        // is why a request-shape assertion localises the defect that a
        // status-only assertion cannot see at all.
        expect(stack.seen).toHaveLength(2);
        expect(stack.seen[0].mode).toBeUndefined();
        expect(stack.seen[1].mode).toBe('draft');
        // The rest of the request is untouched by this card — same face, same
        // compound name assembled from the two segments.
        expect(stack.seen[1].name).toBe(COMPOUND_NAME);
        expect(stack.seen[1].writeFace).toBe('meta-envelope');
    });

    it('the `DRAFT` spelling is refused the same way — case-folding buys no bypass', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ mode: 'DRAFT' });

        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The fence — publishing is still the default, and still what everything
//    that is not `draft` means. GREEN BOTH SIDES: a regression guard, not a
//    red-before case.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #12194] no `mode` spelling changes the compound refusal — the gate reads the name', () => {
    it.each([
        { label: 'no `mode` at all', query: {} },
        { label: 'an explicit `mode=publish`', query: { mode: 'publish' } },
        { label: 'an unrecognised `mode=staged`', query: { mode: 'staged' } },
        { label: 'an empty `mode=`', query: { mode: '' } },
    ])('$label is refused identically — 400, store untouched', async ({ query }) => {
        const stack = boot();

        const answer = await stack.compoundPut(query);

        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
        // The request REACHED the door (the refusal is the protocol's, not the
        // route's), and none of these spellings threaded a `mode`.
        expect(stack.seen[0].mode).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. [#6877] The repeated-parameter guard — the second limb of this card
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #6877] a REPEATED `?mode` is refused, never read as publish-anyway', () => {
    /**
     * #6877's mechanism, unchanged, aimed at the parameter this card threads: a
     * repeated `?mode=draft&mode=draft` arrives as an ARRAY, the
     * `typeof req.query?.mode === 'string'` test is FALSE for it, and the save
     * falls silently back to publishing live — the exact outcome this card
     * exists to stop, re-entered through the door the fix opens. The twin has
     * listed `mode` since #6877; this door listed two names because it read two
     * parameters. Threading the third without naming it here would have shipped
     * the guard gap on the same line as the repair.
     *
     * ⚠️ This narrows the accepted set: a repeated `mode` is answered 200 today
     * and 400 after this card. That is the Clause-② limb the changeset states.
     */
    it('⛔ `?mode=draft&mode=draft` is a 400 — NOT a silent publish', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ mode: ['draft', 'draft'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        // Stated as the assertion that would have caught the fall-back: the
        // save must not have happened at all, let alone gone live.
        expect(stack.seen).toHaveLength(0);
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('⛔ `?mode=draft&mode=publish` is refused too — multiplicity, not intent', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ mode: ['draft', 'publish'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('one occurrence encoded as an array still REACHES the door — the guard unwraps, it does not blanket-refuse', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ mode: ['draft'] });

        // The guard's own verdict would be the nested VALIDATION_ERROR with
        // `seen` empty (as the repeated cases above pin). A single
        // array-encoded occurrence unwraps and travels: the request reaches
        // `saveMetaItem` with `mode: 'draft'` threaded — recorded at the seam —
        // where the #12194 grammar gate is what answers now.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0].mode).toBe('draft');
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('the twin refuses a repeated `mode` the same way — it always did', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ mode: ['draft', 'draft'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The guard's existing entries must not have moved. GREEN BOTH SIDES —
//    this describe block passes before and after the fix, and is reported as a
//    regression guard rather than as evidence of the repair.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #11095] adding `mode` to the list did not disturb `force` or `package`', () => {
    it('⛔ a repeated `?force` is still a 400, and still writes nothing (#6877 inversion)', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ force: ['false', 'false'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('⛔ a repeated `?package` is still a 400 (#6877, where the guard started)', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ package: ['pkg_a', 'pkg_b'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('a single `?package` still binds the row, and composes with `?mode=draft`', async () => {
        const stack = boot();

        await stack.compoundPut({ package: 'pkg_a', mode: 'draft' });

        // Both parameters reached the protocol from the same query string: this
        // card added a reader beside the two that were already here, it did not
        // replace them.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0]).toMatchObject({ packageId: 'pkg_a', mode: 'draft', name: COMPOUND_NAME });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ⭐ [#7019] The twins agree — the ruling this card inherits, executable
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #7019 / #12194] the two `PUT` doors now DIVERGE by design at the write', () => {
    /**
     * #7019's "one operation, two spellings" premise is what #12176 retired:
     * the compound spelling is no longer a legal way to say the operation.
     * The single-segment twin keeps the FULL #11712 `?mode` contract (asserted
     * per spelling, never assumed), while every compound write is refused at
     * the grammar gate before `mode` matters. Both directions are pinned so
     * this fails if EITHER door moves. One agreement survives: a REPEATED
     * `mode` is the route guard's own 400 at both doors, because the guard
     * runs before either door's verdict.
     */
    it.each([
        { label: 'no `mode`', query: {}, singleOutcome: PUBLISHED },
        { label: '`mode=draft`', query: { mode: 'draft' }, singleOutcome: STAGED },
        { label: '`mode=DRAFT`', query: { mode: 'DRAFT' }, singleOutcome: STAGED },
        { label: '`mode=publish`', query: { mode: 'publish' }, singleOutcome: PUBLISHED },
        { label: '`mode=staged` (unrecognised)', query: { mode: 'staged' }, singleOutcome: PUBLISHED },
    ])('⭐ $label: single door keeps the #11712 contract, compound door refuses', async ({ query, singleOutcome }) => {
        const compoundStack = boot();
        const singleStack = boot();

        const compound = await compoundStack.compoundPut(query);
        const single = await singleStack.singlePut(query);

        expect(single.status).toBe(200);
        expect(singleStack.singleOutcome()).toEqual(singleOutcome);
        expect(compound.status).toBe(400);
        expect(compound.body?.code).toBe('INVALID_REQUEST');
        expect(compoundStack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('a REPEATED `mode` is still refused identically at both doors — the guard answers first', async () => {
        const compoundStack = boot();
        const singleStack = boot();

        const compound = await compoundStack.compoundPut({ mode: ['draft', 'draft'] });
        const single = await singleStack.singlePut({ mode: ['draft', 'draft'] });

        expect(compound.status).toBe(single.status);
        expect(compound.status).toBe(400);
        // The guard's NESTED body at both doors — neither request reached a door.
        expect(compound.body?.error?.code).toBe(single.body?.error?.code);
        expect(compound.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(compoundStack.seen).toHaveLength(0);
        expect(singleStack.seen).toHaveLength(0);
    });

    it('and the twin is UNTOUCHED — its request shape is what it always was', async () => {
        const stack = boot();

        await stack.singlePut({ mode: 'draft' });

        // The fence. This card threads a parameter on the compound door; it must
        // not have edited the door that was already right.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0]).toMatchObject({
            type: 'object', name: SINGLE_NAME, mode: 'draft', writeFace: 'meta-envelope',
        });
    });

    it('a refused compound write leaves the single door\'s staging untouched — one store, one refusal', async () => {
        const stack = boot();

        // Same fixture, both doors: the compound attempt is refused at the
        // grammar gate and must not disturb the twin's staging beside it in
        // the same store.
        await stack.compoundPut({ mode: 'draft' });
        await stack.singlePut({ mode: 'draft' });

        expect(stack.outcome(COMPOUND_NAME)).toEqual([LIVE_LABEL, undefined]);
        expect(stack.outcome(SINGLE_NAME)).toEqual(STAGED);
    });
});
