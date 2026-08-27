// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11712 → #12195] `?mode=draft` on the `/meta` save doors — a two-door parity
 * suite whose SECOND DOOR NO LONGER EXISTS.
 *
 * ## What this file is now, and why it was not deleted
 *
 * #11712 measured the fifth and worst divergence between
 * `PUT /meta/:type/:name` and its compound-name twin
 * `PUT /meta/:type/:section/:name`: the twin built its `saveMetaItem` request
 * field by field, `mode` was not one of the fields, and it fell to the
 * `'publish'` default. One name, spelled two ways:
 *
 * ```
 * COMPOUND  PUT /meta/object/crm/task?mode=draft  → 200 {"state":"active"}
 *   row_compound  name=crm/task   state=active  label=NEW_LABEL   ← LIVE, overwritten
 * SINGLE    PUT /meta/object/crm_task?mode=draft → 200
 *   row_single    name=crm_task   state=active  label=ACTIVE_LABEL ← LIVE, untouched
 *   r_2           name=crm_task   state=draft   label=NEW_LABEL    ← staged
 * ```
 *
 * The caller asked for a staging buffer and got a publish, with a `200` and no
 * signal at the call site.
 *
 * #12176's maintainer ruling (2026-08-25) retired compound metadata item names
 * outright. Stage 1 (#12194) declared the item-name grammar and refuses every
 * slash-bearing name at the publish door; stage 3 (#12195) un-mounts the arity.
 * So the divergence is not fixed — the door it needed is GONE.
 *
 * ⛔ The file is REWORKED rather than deleted, deliberately. "The divergence is
 * gone" and "the door is gone" are different facts, and only the second is
 * true; a deleted file would take with it the guard against the arity being
 * mounted again, which is precisely how the silent-live-publish returns. So:
 *
 *  1. the compound arity is pinned ABSENT (§1) — the removal's own pin;
 *  2. the surviving door keeps the FULL #11712 `?mode` contract, asserted per
 *     spelling (§2) — these were the CONTROL half of the old parity cases and
 *     are unchanged;
 *  3. #6877's repeated-parameter guard is re-pinned on the surviving door (§3);
 *  4. the slash-bearing name a caller would once have spelled compound is
 *     pinned answering #12194's `400 INVALID_REQUEST` at the surviving door
 *     (§4) — the capability that REPLACED the compound arity, and the case that
 *     answered `200` + published-live before this retirement.
 *
 * ## Why the REAL protocol and not a double
 *
 * The subject is a route's query-string handling, but the claim worth pinning
 * is what the write DID. A double that only recorded the request would pass
 * against a door that names `mode` and a store that ignores it; and a
 * status-only assertion passes against the UNFIXED door, which answers `200`
 * while publishing live — the original defect exactly. So the gate is the real
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
 * `{ error: { code, message } }`. #12194's grammar refusal is the ADR-0112
 * envelope with a TOP-LEVEL `code` (`INVALID_REQUEST`).
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';
import { assertEngineUpdateDispatch, assertEngineDeleteDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
            assertEngineFindOnePredicate(table, o);
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
        singleOutcome: () => [labelOf(SINGLE_NAME, 'active'), labelOf(SINGLE_NAME, 'draft')] as const,
        /**
         * [#12195] The compound door's REGISTRATION, not a call to it. This
         * used to be `compoundPut()`, driving `PUT COMPOUND_PATH`; the arity is
         * retired, so what is assertable now is that nothing is mounted there.
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
         * shape a caller now uses for a slash-bearing one. Hono decodes `%2F`
         * before the handler runs, so the handler sees the raw name and this
         * helper hands it over directly, which is the same value.
         */
        singlePutNamed: (name: string, query: Record<string, unknown> = {}) =>
            call(SINGLE_PATH, { type: 'object', name }, query),
    };
}

/** What the store looks like when a save was STAGED: live untouched, draft beside it. */
const STAGED = [LIVE_LABEL, SUBMITTED_LABEL];
/** What it looks like when a save went LIVE: live replaced, nothing staged. */
const PUBLISHED = [SUBMITTED_LABEL, undefined];

// ═══════════════════════════════════════════════════════════════════════════
// 1. ⭐ [#12195] The compound door is GONE — the pin the removal owes
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #12195] the compound-name `PUT` arity is retired', () => {
    /**
     * ⛔ This file's original subject — "`?mode=draft` is honoured at one door
     * and dropped at the other" — is DISSOLVED, not fixed. #12176 retired
     * compound metadata item names; #12194 refuses every slash-bearing name at
     * the publish door; this stage un-mounts the arity that used to serve them.
     *
     * The pins are REWORKED rather than deleted, because "the divergence is
     * gone" and "the door is gone" are different facts and only the second one
     * is true. A deleted file would also delete the guard against the arity
     * being mounted again — which is exactly how the #11712 defect (a silent
     * live publish where the caller asked for a draft) would return.
     */
    it('⭐ mounts no `PUT /meta/:type/:section/:name` at all', () => {
        expect(
            boot().compoundRoute(),
            'the compound PUT arity is mounted again — it cannot read `?mode`, so a '
            + '`{ mode: "draft" }` save through it publishes LIVE and answers 200 (#11712)',
        ).toBeUndefined();
    });

    it('⭐ mounts no compound `:section` arity of any method', () => {
        expect(boot().metaRouteKeys().filter((k: string) => k.includes(':section'))).toEqual([]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The surviving door keeps the FULL #11712 contract — asserted per
//    spelling, never assumed. These cases were the CONTROL half of the old
//    parity suite and are unchanged.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712] the single-segment `PUT` honours every `?mode` spelling', () => {
    it.each([
        { label: 'no `mode`', query: {}, expected: PUBLISHED },
        { label: '`mode=draft`', query: { mode: 'draft' }, expected: STAGED },
        { label: '`mode=DRAFT`', query: { mode: 'DRAFT' }, expected: STAGED },
        { label: '`mode=publish`', query: { mode: 'publish' }, expected: PUBLISHED },
        { label: '`mode=staged` (unrecognised)', query: { mode: 'staged' }, expected: PUBLISHED },
    ])('⭐ $label', async ({ query, expected }) => {
        const stack = boot();

        const answer = await stack.singlePut(query);

        expect(answer.status).toBe(200);
        expect(stack.singleOutcome()).toEqual(expected);
    });

    it('threads `mode: \'draft\'` into the protocol request, and only when asked', async () => {
        const staged = boot();
        const published = boot();

        await staged.singlePut({ mode: 'draft' });
        await published.singlePut({});

        expect(staged.seen).toHaveLength(1);
        expect(staged.seen[0]).toMatchObject({
            type: 'object', name: SINGLE_NAME, mode: 'draft', writeFace: 'meta-envelope',
        });
        // The default is the ABSENCE of the key, not `mode: 'publish'` — a save
        // without the option must hand the protocol what it always did.
        expect(published.seen).toHaveLength(1);
        expect(published.seen[0].mode).toBeUndefined();
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. [#6877] The repeated-parameter guard on the surviving door. GREEN BOTH
//    SIDES of this card — a regression guard, not evidence of the removal.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11712 / #6877] a REPEATED query parameter is refused, never read as publish-anyway', () => {
    /**
     * #6877's mechanism: a repeated `?mode=draft&mode=draft` arrives as an
     * ARRAY, `typeof req.query?.mode === 'string'` is FALSE for it, and the
     * save would fall silently back to publishing live. The guard answers 400
     * BEFORE the door, so nothing reaches `saveMetaItem`.
     */
    it('⛔ `?mode=draft&mode=draft` is a 400 — NOT a silent publish', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ mode: ['draft', 'draft'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.singleOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('⛔ `?mode=draft&mode=publish` is refused too — multiplicity, not intent', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ mode: ['draft', 'publish'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.singleOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('one occurrence encoded as an array still REACHES the door — the guard unwraps, it does not blanket-refuse', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ mode: ['draft'] });

        expect(answer.status).toBe(200);
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0].mode).toBe('draft');
        expect(stack.singleOutcome()).toEqual(STAGED);
    });

    it('⛔ a repeated `?force` is still a 400, and still writes nothing (#6877 inversion)', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ force: ['false', 'false'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.singleOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('⛔ a repeated `?package` is still a 400 (#6877, where the guard started)', async () => {
        const stack = boot();

        const answer = await stack.singlePut({ package: ['pkg_a', 'pkg_b'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.singleOutcome()).toEqual([LIVE_LABEL, undefined]);
    });

    it('a single `?package` still binds the row, and composes with `?mode=draft`', async () => {
        const stack = boot();

        await stack.singlePut({ package: 'pkg_a', mode: 'draft' });

        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0]).toMatchObject({ packageId: 'pkg_a', mode: 'draft', name: SINGLE_NAME });
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. ⭐ [#12194] A slash-bearing name is refused at the GRAMMAR gate — the
//    capability that replaced the compound door, pinned where callers meet it.
// ═══════════════════════════════════════════════════════════════════════════

describe('[#12194 / #12195] a slash-bearing name is refused at the surviving door', () => {
    /**
     * With the compound arity gone, `crm/task` reaches the single-segment door
     * percent-encoded (`%2F`) — the spelling the SDK now sends for every name,
     * and the one Hono decodes back to `crm/task` before the handler sees it.
     * What answers is #12194's grammar refusal, with the ADR-0112 envelope.
     *
     * This is the pin that makes the removal safe to read: the old compound
     * door answered `200` and published live for this exact input.
     */
    it('⭐ answers 400 INVALID_REQUEST and stores NOTHING', async () => {
        const stack = boot();

        const answer = await stack.singlePutNamed(COMPOUND_NAME, { mode: 'draft' });

        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('INVALID_REQUEST');
        // The seeded compound row is untouched: refused before any write.
        expect(stack.outcome(COMPOUND_NAME)).toEqual([LIVE_LABEL, undefined]);
    });

    it('and the twin\'s staging beside it is untouched — one store, one refusal', async () => {
        const stack = boot();

        await stack.singlePutNamed(COMPOUND_NAME, { mode: 'draft' });
        await stack.singlePut({ mode: 'draft' });

        expect(stack.outcome(COMPOUND_NAME)).toEqual([LIVE_LABEL, undefined]);
        expect(stack.outcome(SINGLE_NAME)).toEqual(STAGED);
    });
});
