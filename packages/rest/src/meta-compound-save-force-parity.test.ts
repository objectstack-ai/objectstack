// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11095 → #12195] `?force=true` on the `/meta` save doors — a two-door parity
 * suite whose SECOND DOOR NO LONGER EXISTS.
 *
 * ## What this file is now, and why it was not deleted
 *
 * `saveMetaItem`'s Phase 3a-destructive gate raises ONE `409
 * DESTRUCTIVE_CHANGE`, and its remedy clause ends `— re-submit with
 * ?force=true to proceed.` That clause was true of the single-segment
 * `PUT /meta/:type/:name`, which reads `?force` and threads it. It was FALSE
 * at the compound-name twin `PUT /meta/:type/:section/:name`, which built its
 * `saveMetaItem` request field by field with `force` not among the fields — so
 * a caller refused at that door, doing exactly what the refusal told them to
 * do, got the identical refusal back, with nothing saying the parameter had
 * been ignored. #11095 closed it by threading the parameter.
 *
 * #12176's maintainer ruling (2026-08-25) then retired compound metadata item
 * names outright. Stage 1 (#12194) declared the item-name grammar and refuses
 * every slash-bearing name at the publish door — BEFORE the destructive gate
 * this file was written about — and stage 3 (#12195) un-mounts the arity.
 *
 * ⛔ REWORKED rather than deleted. The guard worth keeping is against the arity
 * coming BACK: a re-mounted compound door is a door that reads neither `?force`
 * nor `?mode` until someone re-threads them, which is the whole divergence
 * family this file and its `mode` sibling document (#6603/#7019's
 * `manage_metadata` gate, #8805's write-side organization, #7035's 501
 * envelope, #11095's `?force`, #11712's `?mode`). So:
 *
 *  1. the compound arity is pinned ABSENT (§1) — the removal's own pin;
 *  2. the surviving door keeps the FULL #11095 contract — destructive 409 with
 *     the remedy, honoured `?force=true`, the truthy table (§2);
 *  3. #6877's repeated-parameter guard is re-pinned on the surviving door (§3);
 *  4. the slash-bearing name a caller would once have spelled compound is
 *     pinned answering #12194's `400 INVALID_REQUEST` at the surviving door,
 *     with `?force` unable to acknowledge past it (§4).
 *
 * ⛔ Still not a precedent for the dispatcher: `@objectstack/runtime`'s
 * `PUT /meta` does NOT gain `force` — it is reached with a path, a method and a
 * body, so there is no query string for an acknowledgement to arrive on, and it
 * states its own `writeFace` so the clause stops naming a parameter it does not
 * have. See `packages/runtime/src/domains/meta-save-destructive-remedy.test.ts`.
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
 * `status` AND `code` (the ADR-0112 envelope) on every refusal. These handlers
 * *send* rather than throw, so a `toThrow`-shaped assertion could not separate
 * "refused with the wrong envelope" from "did not refuse at all" — and on the
 * unfixed code the second answer is a 409 that looks exactly like the first.
 *
 * ⚠️ TWO body shapes appear below, and they are the file's, not a typo. The
 * destructive and grammar refusals come out of `handleRouteError`, whose body
 * is FLAT — `{ error: <message string>, code, issues }`, with the `code` at top
 * level. The `400` from `refuseRepeatedQueryParams` is hand-built by the route
 * and NESTED — `{ error: { code, message } }`. Reading `body.error.code` off a
 * `handleRouteError` answer yields `undefined`, and next to a status-only
 * assertion that reads as a pass.
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
        /**
         * [#12195] The compound door's REGISTRATION, not a call to it. This
         * used to be `compoundPut()`; the arity is retired, so what is
         * assertable now is that nothing is mounted there.
         */
        compoundRoute: () => route('PUT', COMPOUND_PATH),
        /** Every `/meta` route key this server mounted, for absence sweeps. */
        metaRouteKeys: () => (rest as any).getRoutes()
            .map((r: any) => `${String(r.method).toUpperCase()} ${r.path}`)
            .filter((k: string) => k.includes(META)),
        /** The surviving door. */
        singlePut: (query: Record<string, unknown> = {}) =>
            call(SINGLE_PATH, { type: 'object', name: SINGLE_NAME }, query),
        /**
         * [#12195] The surviving door addressed with an ARBITRARY name — the
         * shape a caller now uses for a slash-bearing one (percent-encoded on
         * the wire, decoded by Hono before the handler runs).
         */
        singlePutNamed: (name: string, query: Record<string, unknown> = {}) =>
            call(SINGLE_PATH, { type: 'object', name }, query),
    };
}

/** The sentence the 409 ends with, and the thing #11095 had to make true. */
const PUT_REMEDY = 're-submit with ?force=true to proceed.';

// ═══════════════════════════════════════════════════════════════════════════
// 1. ⭐ [#12195] The compound door is GONE — the pin the removal owes
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095 / #12195] the compound-name `PUT` arity is retired', () => {
    /**
     * ⛔ REWORKED, not deleted — same reasoning as the `mode` suite next door.
     * #11095 threaded `?force` onto the compound door to close the fourth
     * divergence on the pair; #12176 then retired the pair itself. The guard
     * worth keeping is against the arity coming BACK, because a re-mounted
     * compound door is a door that reads neither `?force` nor `?mode` unless
     * someone re-threads them — the divergence family this file documents.
     */
    it('⭐ mounts no `PUT /meta/:type/:section/:name` at all', () => {
        expect(
            boot().compoundRoute(),
            'the compound PUT arity is mounted again — #12176 retired compound '
            + 'metadata item names and #12194 refuses every slash-bearing name at the '
            + 'publish door, so it can only be reached by a name that cannot be created',
        ).toBeUndefined();
    });

    it('⭐ mounts no compound `:section` arity of any method', () => {
        expect(boot().metaRouteKeys().filter((k: string) => k.includes(':section'))).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The surviving door keeps the FULL #11095 contract
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095] the single-segment `PUT` — destructive refusal and its remedy', () => {
    it('⭐ refuses a destructive change 409 with the remedy, and writes NOTHING', async () => {
        const stack = boot();

        const answer = await stack.singlePut();

        expect(answer.status).toBe(409);
        expect(answer.body?.code).toBe('DESTRUCTIVE_CHANGE');
        expect(answer.body?.error).toContain(PUT_REMEDY);
        expect(stack.singleFields()).toEqual(STORED_FIELDS);
    });

    it('⭐ honours `?force=true` — acknowledged, 200, landed', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ force: 'true' });

        expect(answer.status).toBe(200);
        expect(stack.singleFields()).toEqual(SHRUNK_FIELDS);
    });

    it('threads `force: true` into the protocol request, and only when asked', async () => {
        const forced = boot();
        const plain = boot();

        await forced.singlePut({ force: 'true' });
        await plain.singlePut();

        expect(forced.seen).toHaveLength(1);
        expect(forced.seen[0]).toMatchObject({
            type: 'object', name: SINGLE_NAME, force: true, writeFace: 'meta-envelope',
        });
        // The default is the ABSENCE of the flag, never `force: false`.
        expect(plain.seen).toHaveLength(1);
        expect(plain.seen[0].force).toBeFalsy();
    });

    it.each(['true', '1', 'yes', 'on', 'TRUE'])(
        'the `%s` spelling acknowledges the same way — the truthy table is unchanged',
        async (spelling) => {
            const stack = boot();

            const answer = await stack.singlePut({ force: spelling });

            expect(answer.status).toBe(200);
            expect(stack.singleFields()).toEqual(SHRUNK_FIELDS);
        },
    );

    it('`?force=false` does NOT acknowledge — the destructive refusal stands', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ force: 'false' });

        expect(answer.status).toBe(409);
        expect(answer.body?.code).toBe('DESTRUCTIVE_CHANGE');
        expect(stack.singleFields()).toEqual(STORED_FIELDS);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. [#6877] The repeated-parameter guard. GREEN BOTH SIDES of this card.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11095 / #6877] a REPEATED `?force` is refused, never read as force-ON', () => {
    /**
     * #6877's inversion: a repeated `?force=false&force=false` arrives as an
     * ARRAY, and a non-empty array is truthy — so a spelled-out opt-OUT would
     * turn the guard ON. The route refuses multiplicity before reading intent.
     */
    it('⛔ `?force=false&force=false` is a 400 — NOT a silent force-ON', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ force: ['false', 'false'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.singleFields()).toEqual(STORED_FIELDS);
    });

    it('⛔ `?force=true&force=true` is refused too — multiplicity, not intent', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ force: ['true', 'true'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.singleFields()).toEqual(STORED_FIELDS);
    });

    it('one occurrence encoded as an array still REACHES the door — the guard unwraps, it does not blanket-refuse', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ force: ['true'] });

        expect(answer.status).toBe(200);
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0].force).toBe(true);
        expect(stack.singleFields()).toEqual(SHRUNK_FIELDS);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ⭐ [#12194] A slash-bearing name is refused at the GRAMMAR gate, before
//    the destructive gate — and `?force` cannot acknowledge past it.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#12194 / #12195] a slash-bearing name is refused at the surviving door', () => {
    it('⭐ answers 400 INVALID_REQUEST and stores NOTHING', async () => {
        const stack = boot();

        const answer = await stack.singlePutNamed(COMPOUND_NAME);

        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('⭐ `?force=true` changes NOTHING — force cannot acknowledge a grammar violation', async () => {
        const stack = boot();

        const refused = await stack.singlePutNamed(COMPOUND_NAME);
        const forced = await stack.singlePutNamed(COMPOUND_NAME, { force: 'true' });

        expect(refused.status).toBe(400);
        expect(forced.status).toBe(400);
        expect(forced.body?.code).toBe('INVALID_REQUEST');
        expect(stack.compoundFields()).toEqual(STORED_FIELDS);
    });

    it('and does NOT prescribe `?force=true` — the remedy belongs to the destructive gate alone', async () => {
        const stack = boot();

        const answer = await stack.singlePutNamed(COMPOUND_NAME);

        expect(String(answer.body?.error ?? answer.body?.message ?? '')).not.toContain(PUT_REMEDY);
    });
});
