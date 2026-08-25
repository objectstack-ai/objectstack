// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11095] `?force=true` on the compound-name `PUT /api/v1/meta/:type/:section/:name`
 * — the third row of the destructive-409 face inventory, closed by threading
 * the parameter rather than by rewording the sentence.
 *
 * ## ⚠️ #12194 reversed the compound door's WRITE outcome
 *
 * Stage 1 of #12176 (maintainer ruling 2026-08-25): the item-name grammar
 * refuses every slash-bearing name at `saveMetaItem`, BEFORE the destructive
 * gate this file was written about. The compound door still folds
 * `:section/:name` into `crm/task` and still threads `force` (the seam pins
 * below stay true), but the fold's output is now refused `400 INVALID_REQUEST`
 * with the dotted prescription — no `?force` spelling can acknowledge a
 * grammar violation. The compound-door cases below pin that refusal; the
 * single-segment twin keeps the full #11095 contract, and the twins now
 * DIVERGE BY DESIGN at the write (the route retirement itself is D3, #12195).
 *
 * ## The defect
 *
 * `saveMetaItem`'s Phase 3a-destructive gate raises ONE `409
 * DESTRUCTIVE_CHANGE`, and its remedy clause ends `— re-submit with
 * ?force=true to proceed.` That clause was true of the single-segment
 * `PUT /meta/:type/:name`, which reads `?force` and threads it. It was FALSE
 * here: this route built its `saveMetaItem` request field by field and `force`
 * was not one of the fields, so a caller refused at this door, doing exactly
 * what the refusal told them to do, got the identical refusal back — and
 * nothing in the second answer said the parameter had been ignored.
 *
 * ## Why threading, and not a face of its own
 *
 * The maintainer ruled a SPLIT (2026-08-23) over the two doors #11015 left
 * open, and this is the half that gains the parameter. The argument is #7019's,
 * inherited with its reason rather than re-derived: the compound route is
 * "word for word the same operation" as its single-segment twin — one generic
 * `saveMetaItem`, reached by a name spelled in two segments instead of one —
 * and gating only the twin was MEASURED to leave this door a bypass of the
 * gate, not a narrower version of it. Every divergence found between the pair
 * since has been closed on that same finding: #6603/#7019's `manage_metadata`
 * gate, #8805's write-side organization, #7035's 501 envelope. A pair that
 * disagrees about which risks a caller may acknowledge is that shape once more.
 *
 * ⛔ The other half of the ruling went the other way, and this file is not a
 * precedent for it: `@objectstack/runtime`'s dispatcher `PUT /meta` does NOT
 * gain `force` — it is reached with a path, a method and a body, so there is no
 * query string for an acknowledgement to arrive on, and it states its own
 * `writeFace` so the clause stops naming a parameter it does not have. See
 * `packages/runtime/src/domains/meta-save-destructive-remedy.test.ts`.
 *
 * ## Why the REAL protocol and not a double
 *
 * The subject is a ROUTE's query-string handling, but the assertion worth
 * making is end-to-end: does the sentence the caller is handed become TRUE.
 * A double that refuses unless it sees `force` would pass whatever the route
 * did with the parameter as long as the two agreed — it would be pinning this
 * file's own idea of the gate. So the gate is the real
 * `ObjectStackProtocolImplementation` over a `sys_metadata`-backed engine, and
 * the acceptance cases assert the STORE, not just a 200: "refused, then
 * accepted" and "refused, then accepted but wrote nothing" are different
 * outcomes and only one of them is the fix.
 *
 * ⚠️ That import resolves through `exports` to `@objectstack/metadata-protocol`'s
 * **`dist/`** (registered in `check-test-source-alias.mjs`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS` for this package), so this suite is a verdict
 * about the BUILT protocol. Rebuild it before reading a result here after
 * touching `protocol.ts` — a `dist/` merely behind reports the pre-fix clause
 * with nothing in the output saying so.
 *
 * ## What the cases assert
 *
 * `status` AND `code` (the ADR-0112 envelope) on every refusal, in BOTH
 * directions, on BOTH doors. These handlers *send* rather than throw, so a
 * `toThrow`-shaped assertion could not separate "refused with the wrong
 * envelope" from "did not refuse at all" — and on the unfixed code the second
 * answer is a 409 that looks exactly like the first.
 *
 * ⚠️ TWO body shapes appear below, and they are the file's, not a typo. The
 * refusals this card is about come out of `handleRouteError`, whose body is
 * FLAT — `{ error: <message string>, code, issues }`, with the `code` at top
 * level and `issues` beside it (row 2 of the face inventory calls that "a
 * top-level `issues`", and this is what it means). The `400` from
 * `refuseRepeatedQueryParams` is hand-built by the route and NESTED —
 * `{ error: { code, message } }` — as are this file's sibling `403`/`501`
 * refusals. Reading `body.error.code` off a `handleRouteError` answer yields
 * `undefined`, and next to a status-only assertion that reads as a pass.
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

/**
 * A spec-valid `object` body. `sharingModel` is not decoration: ADR-0090 D1's
 * author-time gate refuses an unset OWD (`security-owd-unset`), and without it
 * the FORCED save would fail one phase past the one under test — a red that
 * reads exactly like "force did not work".
 */
const objectBody = (name: string, fields: readonly string[]) => ({
    name,
    label: name,
    sharingModel: 'private',
    fields: Object.fromEntries(fields.map((f) => [f, { name: f, type: 'text', label: f }])),
});

/** What the fixture starts with, and what a destructive save would drop. */
const STORED_FIELDS = ['a', 'b', 'c', 'd'];
/** The body every case submits: three of the four columns, gone. */
const SHRUNK_FIELDS = ['a'];

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
 * Boot both `PUT` doors over the REAL protocol, seeded so BOTH names exist with
 * the same four columns — the single-segment twin is a control in every case,
 * not a separate suite, because "the two doors agree" is the claim.
 */
function boot() {
    const rows = new Map<string, StoredRow>();
    const seed = (id: string, name: string) => rows.set(id, {
        id, type: 'object', name,
        organization_id: null, package_id: null, state: 'active',
        metadata: JSON.stringify(objectBody(SINGLE_NAME, STORED_FIELDS)),
        checksum: 'sha256_11095_fixture', version: 1,
    });
    seed('row_compound', COMPOUND_NAME);
    seed('row_single', SINGLE_NAME);

    /**
     * Scalar equality ONLY, and every combinator is REFUSED rather than
     * approximated — `pnpm check:where-matcher`
     * (`scripts/check-where-matcher-conformance.mjs`, #8494): "a discovered
     * matcher must answer every combinator probe CORRECTLY, or REFUSE it by
     * throwing".
     *
     * The refusal is MEASURED, not assumed. Instrumenting this `match` to log
     * every `where` it receives across all 17 cases recorded 35 calls — every
     * one of them a flat scalar object over `type` / `name` / `state` /
     * `organization_id` / `package_id` — zero `$or`, zero `$and`. The `$or` arm
     * this replaces was therefore dead code, and it was also HALF a surface:
     * `$and` fell straight through to `r['$and']`, compared `undefined` against
     * an array, excluded the row and returned an empty result set with nothing
     * erroring. A suite can go green on that while asserting about a DIFFERENT
     * query than the one the protocol sent — the exact "declared ≠ enforced"
     * shape this card is about, one layer down in its own fixture.
     *
     * A `throw` cannot do that. The protocol does build `$or` against
     * `sys_metadata` elsewhere (org-scoped reads); if one is ever routed through
     * this door, this suite goes RED and asks for a real implementation instead
     * of quietly asserting on nothing. `$`-prefixed keys are never field names —
     * `protocol.ts`'s own `FILTER_LOGICAL_KEYS` rule — so the guard is a prelude
     * rather than an arm inside the loop: a preceding scalar miss must not be
     * able to short-circuit `.every` past an operator we cannot answer.
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
        // write verbs — unlike the refusal-only inventory suites — because the
        // acceptance half of every case is asserted against the STORE.
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
     * store answers "did the write land"; this answers "with what" — and the
     * distinction is the whole defect: the pre-fix door reached `saveMetaItem`
     * on every one of these calls, it just never named `force` in the object.
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
        await route('PUT', path)!.handler({ params, query, headers: {}, body: objectBody(SINGLE_NAME, SHRUNK_FIELDS) }, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return {
        seen,
        /** Field names of a stored row, read from the STORE not from a response. */
        fieldsOf: (id: string) => Object.keys(JSON.parse(rows.get(id)!.metadata).fields ?? {}).sort(),
        compoundFields: () => Object.keys(JSON.parse(rows.get('row_compound')!.metadata).fields ?? {}).sort(),
        singleFields: () => Object.keys(JSON.parse(rows.get('row_single')!.metadata).fields ?? {}).sort(),
        /** The door under test. */
        compoundPut: (query: Record<string, unknown> = {}) =>
            call(COMPOUND_PATH, { type: 'object', section: 'crm', name: 'task' }, query),
        /** Its single-segment twin — the control, already correct before this card. */
        singlePut: (query: Record<string, unknown> = {}) =>
            call(SINGLE_PATH, { type: 'object', name: SINGLE_NAME }, query),
    };
}

/** The sentence the 409 ends with, and the thing this card had to make true. */
const PUT_REMEDY = 're-submit with ?force=true to proceed.';

// ═══════════════════════════════════════════════════════════════════════════
// 1. The compound door, REFUSED — and the refusal tells the truth now
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095 / #12194] compound-name PUT — refused at the item-name grammar gate', () => {
    it('refuses the folded slash name with the ADR-0112 envelope, and writes NOTHING', async () => {
        const stack = boot();

        const answer = await stack.compoundPut();

        // The grammar gate answers BEFORE the destructive gate ever computes a
        // diff: 400 (the caller's addressing mistake), not the 409 this file
        // used to pin. `handleRouteError`'s body is FLAT — `code` at top level.
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        // THE POINT of a refusal case: "refused after writing" satisfies both
        // assertions above and is still the bug.
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('names the grammar and the dotted prescription — guidance, not a bare no', async () => {
        const stack = boot();

        const answer = await stack.compoundPut();

        expect(answer.body?.error).toContain('is not a legal metadata item name');
        expect(answer.body?.error).toContain('crm_lead.pipeline');
    });

    it('and does NOT prescribe `?force=true` — force cannot acknowledge a grammar violation', async () => {
        const stack = boot();

        const answer = await stack.compoundPut();

        // The destructive 409's remedy clause must not ride on this refusal:
        // re-submitting with the parameter changes nothing (pinned below), so
        // prescribing it here would be the #11095 defect resurrected — a
        // sentence the door cannot make true.
        expect(answer.body?.error).not.toContain(PUT_REMEDY);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ⭐ The compound door, ACCEPTED — the case that fails without the fix
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095 / #12194] compound-name PUT — no `?force` spelling bypasses the grammar gate', () => {
    it('⭐ re-submitting with `?force=true` changes NOTHING — same refusal, store untouched', async () => {
        const stack = boot();

        // 1. Refused at the grammar gate.
        const refused = await stack.compoundPut();
        expect(refused.status).toBe(400);
        expect(refused.body?.code).toBe('INVALID_REQUEST');

        // 2. `force` acknowledges a DESTRUCTIVE diff; it is not a bypass of the
        //    name grammar. The pre-#12194 direction here was 200 + the shrunk
        //    store — the acceptance this pin replaces.
        const forced = await stack.compoundPut({ force: 'true' });

        expect(forced.status).toBe(400);
        expect(forced.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('threads `force: true` into the protocol request, and only when asked', async () => {
        const stack = boot();

        await stack.compoundPut();
        await stack.compoundPut({ force: 'true' });

        // The seam itself. The pre-fix door reached `saveMetaItem` on BOTH of
        // these calls — it simply never named `force` in either request, which
        // is why a store-only assertion could not localise the defect.
        expect(stack.seen).toHaveLength(2);
        expect(stack.seen[0].force).toBeUndefined();
        expect(stack.seen[1].force).toBe(true);
        // The rest of the request is untouched by this card — same face, same
        // compound name assembled from the two segments.
        expect(stack.seen[1].name).toBe(COMPOUND_NAME);
        expect(stack.seen[1].writeFace).toBe('meta-envelope');
    });

    it.each([
        { spelling: 'true' }, { spelling: '1' }, { spelling: 'yes' }, { spelling: 'on' }, { spelling: 'TRUE' },
    ])('the `$spelling` spelling is refused the same way — the truthy table buys no bypass', async ({ spelling }) => {
        const stack = boot();

        const answer = await stack.compoundPut({ force: spelling });

        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('`?force=false` earns the SAME grammar refusal — the gate reads the name, never the flag', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ force: 'false' });

        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. [#6877] ⛔ The inversion this card had to avoid re-opening on a new door
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095 / #6877] a REPEATED `?force` is refused, never read as force-ON', () => {
    /**
     * #6877's sharpest measured case is on this exact parameter one route over:
     * `?force=false&force=false` arrives as an ARRAY, the `typeof` ternary falls
     * through to `!!forceRaw`, and a non-empty array is truthy — so a caller
     * repeating an explicit opt-OUT turned the destructive guard ON, on a
     * destructive verb, answered 200.
     *
     * Threading `force` here without adding it to this door's
     * `refuseRepeatedQueryParams` list would have re-opened that inversion on a
     * door that never had it. The parameter and the guard landed in one stroke;
     * this is the case that says so.
     */
    it('⛔ `?force=false&force=false` is a 400 — NOT a silent force-ON', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ force: ['false', 'false'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        // The inversion, stated as the assertion that would have caught it: the
        // save must not have happened at all, let alone succeeded.
        expect(stack.seen).toHaveLength(0);
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('⛔ `?force=true&force=true` is refused too — multiplicity, not intent', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ force: ['true', 'true'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('one occurrence encoded as an array still REACHES the door — the guard unwraps, it does not blanket-refuse', async () => {
        const stack = boot();

        const answer = await stack.compoundPut({ force: ['true'] });

        // The guard's own verdict would be the nested VALIDATION_ERROR before
        // the protocol is called (`seen` empty, as the repeated cases above
        // pin). A single array-encoded occurrence unwraps and travels: the
        // request reaches `saveMetaItem` — recorded at the seam — where the
        // #12194 grammar gate is what answers now.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0].force).toBe(true);
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ⭐ [#7019] The twins agree — the ruling this card inherits, executable
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095 / #7019 / #12194] the two `PUT` doors now DIVERGE by design at the write', () => {
    /**
     * #7019's "one operation, two spellings" premise is what #12176 retired:
     * the compound spelling is no longer a legal way to say the operation. The
     * single-segment door keeps the FULL #11095 contract — destructive 409
     * with the remedy, honoured `?force=true` — and the compound door refuses
     * before the destructive gate runs. Both directions are pinned so this
     * fails if EITHER door moves.
     */
    it('single door: destructive 409 with the remedy — compound door: grammar 400', async () => {
        const stack = boot();

        const compound = await stack.compoundPut();
        const single = await stack.singlePut();

        expect(single.status).toBe(409);
        expect(single.body?.code).toBe('DESTRUCTIVE_CHANGE');
        expect(single.body?.error).toContain(PUT_REMEDY);
        expect(compound.status).toBe(400);
        expect(compound.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
        expect(stack.singleFields()).toEqual(STORED_FIELDS);
    });

    it('⭐ `?force=true` is honoured ONLY where the name is legal', async () => {
        const stack = boot();

        const compound = await stack.compoundPut({ force: 'true' });
        const single = await stack.singlePut({ force: 'true' });

        // The single door's #11095 fix stands: acknowledged, 200, landed.
        expect(single.status).toBe(200);
        expect(stack.singleFields()).toEqual(SHRUNK_FIELDS);
        // The compound door refuses the NAME before reading the flag.
        expect(compound.status).toBe(400);
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('and the twin is UNTOUCHED — its request shape is what it always was', async () => {
        const stack = boot();

        await stack.singlePut({ force: 'true' });

        // The fence. This card threads a parameter on the compound door; it must
        // not have edited the door that was already right.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0]).toMatchObject({
            type: 'object', name: SINGLE_NAME, force: true, writeFace: 'meta-envelope',
        });
    });
});
