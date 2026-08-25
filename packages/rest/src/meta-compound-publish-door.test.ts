// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11932] `POST /api/v1/meta/:type/:section/:name/publish` — the compound-name
 * PROMOTION door, the last missing arity in the compound-name lifecycle.
 *
 * ## The defect, as measured on `origin/main` at `1e79aa4f8`
 *
 * Read off the REAL registered server (`new RestServer(...).registerRoutes()`,
 * then every `/meta` route from `getRoutes()`), the arities did not line up:
 *
 * ```
 * PUT    /api/v1/meta/:type/:name                   mounted
 * PUT    /api/v1/meta/:type/:section/:name          mounted   ← stages, since #11933
 * GET    /api/v1/meta/:type/:name/published         mounted
 * GET    /api/v1/meta/:type/:section/:name/published mounted  ← #7526
 * POST   /api/v1/meta/:type/:name/publish           mounted
 * POST   /api/v1/meta/:type/:section/:name/publish  NOT MOUNTED
 * ```
 *
 * So a compound-named draft could be STAGED (`?mode=draft`, #11712 / PR #11933)
 * and READ BACK (`/published`, #7526) and had no per-item REST door to PROMOTE.
 * Writable, readable, not publishable — same caller, same transport. #11933's
 * own changeset says so to consumers in as many words: *"Until that route
 * exists, promote through `POST /packages/:id/publish-drafts` … Tracked in
 * #11932."*
 *
 * ## It was the ROUTE that was missing, never the capability
 *
 * Measured before this route existed, driving the real
 * `ObjectStackProtocolImplementation` against a seeded `crm/task` draft:
 *
 * ```
 * STORE before: r_draft name=crm/task state=draft
 * PROMOTE      -> {"success":true,"version":"sha256:382ea457…","seq":1,
 *                  "message":"Published draft — type=object, name=crm/task [seq=1]"}
 * ```
 *
 * `publishMetaItem` keys the draft on type/name/organization/package and reads
 * the name's SPELLING nowhere, so `crm/task` is a draft key exactly like
 * `crm_task` is. That is the same finding #11933 recorded for the save door.
 *
 * ## Why the REAL protocol and not a double
 *
 * #11712's defect was a door that ACCEPTED a parameter and answered `200` while
 * doing the wrong thing, so a status-only assertion cannot see this class. Every
 * ⭐ case below reads the STORE: which row is live, which is staged, and what
 * body each carries. The gate is the real `ObjectStackProtocolImplementation`
 * over a `sys_metadata`-backed fake engine, exactly as
 * `meta-compound-save-mode-parity.test.ts` next door.
 *
 * ⚠️ That import resolves through `exports` to `@objectstack/metadata-protocol`'s
 * **`dist/`** (registered in `check-test-source-alias.mjs`'s
 * `KNOWN_UNALIASED_TEST_IMPORTS` for this package), so this suite is a verdict
 * about the BUILT protocol. Rebuild it before reading a result here after
 * touching `protocol.ts`. Nothing in THIS card's diff is in that package — the
 * change is one `for` loop in `rest-server.ts`, which vitest compiles from
 * source — so the ablation below measures the source it edits.
 *
 * ## Where the ORDER is pinned
 *
 * In `meta-route-registration-order.test.ts`, with the rest of the `/meta`
 * family's first-match-wins constraints and the measurement that a same-arity
 * sibling registered ahead of this pattern really does shadow it.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';
import { assertEngineUpdateDispatch, assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

const META = '/api/v1/meta';
const COMPOUND_PUBLISH = `${META}/:type/:section/:name/publish`;
const SINGLE_PUBLISH = `${META}/:type/:name/publish`;
const COMPOUND_PUT = `${META}/:type/:section/:name`;

/** The compound URL `section` + `name` spell, and its single-segment twin. */
const COMPOUND_NAME = 'crm/task';
const SINGLE_NAME = 'crm_task';

/** What the seeded LIVE row carries before anything is promoted. */
const LIVE_LABEL = 'Live label';
/** What the seeded DRAFT row carries — a promotion must make THIS live. */
const DRAFT_LABEL = 'Staged label';

/**
 * A spec-valid `object` body. `sharingModel` is not decoration: ADR-0090 D1's
 * author-time gate refuses an unset OWD (`security-owd-unset`), and without it
 * the publish would fail a phase before the one under test — a red that reads
 * exactly like "the route did not work". The field set never moves between the
 * live and draft bodies, so nothing here trips a destructive-change gate.
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
 * Boot both promotion doors over the REAL protocol against ONE store, seeded so
 * both names carry a LIVE row and a DRAFT row. The single-segment twin is a
 * control in every case rather than a separate suite, because "the two doors
 * agree" is the claim (#7019).
 */
function boot(opts?: { capabilities?: string[]; seedDrafts?: boolean }) {
    const rows = new Map<string, StoredRow>();
    let nextId = 0;
    const seed = (id: string, name: string, state: string, label: string) => rows.set(id, {
        id, type: 'object', name,
        organization_id: null, package_id: null, state,
        metadata: JSON.stringify(objectBody(label)),
        checksum: `sha256_11932_${state}`, version: 1,
    });
    seed('live_compound', COMPOUND_NAME, 'active', LIVE_LABEL);
    seed('live_single', SINGLE_NAME, 'active', LIVE_LABEL);
    if (opts?.seedDrafts !== false) {
        seed('draft_compound', COMPOUND_NAME, 'draft', DRAFT_LABEL);
        seed('draft_single', SINGLE_NAME, 'draft', DRAFT_LABEL);
    }

    /**
     * Scalar equality ONLY, every combinator REFUSED rather than approximated —
     * `pnpm check:where-matcher` (`scripts/check-where-matcher-conformance.mjs`,
     * #8494): a `$and` silently falling through to `r['$and']` compares
     * `undefined` against an array, excludes the row, and returns an empty
     * result set with nothing erroring — a suite can go green while asserting
     * about a DIFFERENT query than the one the protocol sent.
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
            const id = String(data.id ?? `ins_${nextId++}`);
            if (table === 'sys_metadata') rows.set(id, { ...(data as any), id } as StoredRow);
            return { id };
        },
        // ⛔ Routed through the producer-side predicates, never hand-mirrored: a
        // double looser than `ObjectQL` turns a green suite into no suite
        // (`check:engine-double-contract`, #4550 / #5480).
        async update(_t: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            const id = (o as any)?.where?.id;
            const existing = id ? rows.get(String(id)) : undefined;
            if (existing) rows.set(String(id), { ...existing, ...(data as any) });
            return { id: id ?? null };
        },
        // ⚠️ This one REALLY deletes, unlike the sibling suite's no-op. A
        // promotion retires the draft row it promoted, and "no draft is left
        // behind" is half of what `outcome()` below reports — a double that
        // acknowledges the delete without performing it would report every
        // promotion as "published AND still staged", which is nothing that ever
        // happens and would make the parity tuple unreadable.
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            const where = (o as any)?.where ?? {};
            let deleted = 0;
            for (const [id, r] of [...rows.entries()]) {
                if (match(r, where)) { rows.delete(id); deleted += 1; }
            }
            return { deleted };
        },
        registry: {
            registerItem: () => {}, registerObject: () => {}, listItems: () => [],
            getItem: () => undefined, getArtifactItem: () => undefined,
            removeRuntimeShadow: () => false, removeOverlayEntry: () => {}, uninstallPackage: () => {},
        },
    };

    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());

    /**
     * Every request the doors hand the protocol, recorded at the seam. The store
     * answers "what did the promotion DO"; this answers "under what key" — and
     * for this card the key is the point: the compound door must hand
     * `publishMetaItem` ONE opaque `crm/task`, not two fields.
     */
    const seen: any[] = [];
    const realPublish = protocol.publishMetaItem.bind(protocol);
    protocol.publishMetaItem = async (request: any) => { seen.push(request); return realPublish(request); };
    const realSave = protocol.saveMetaItem.bind(protocol);
    protocol.saveMetaItem = async (request: any) => realSave(request);

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // `manage_metadata` held by default — the #8919 capability gate is pinned
    // explicitly in §3 and must not be what silently answers everywhere else.
    (rest as any).resolveExecCtx = async () => ({
        userId: 'u_author',
        systemPermissions: opts?.capabilities ?? ['manage_metadata'],
    });
    rest.registerRoutes();

    const route = (method: string, path: string) => (rest as any).getRoutes().find(
        (r: any) => r.method === method && r.path === path,
    );

    const call = async (
        method: string, path: string,
        params: Record<string, string>,
        query: Record<string, unknown> = {},
        body: unknown = {},
    ) => {
        const found = route(method, path);
        expect(found, `${method} ${path} is not registered at all — the door cannot serve`).toBeTruthy();
        const res = mockRes();
        await found!.handler({ params, query, headers: {}, body }, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    /** The body a row of one lifecycle state carries — read from the STORE. */
    const labelOf = (name: string, state: string): string | undefined => {
        for (const r of rows.values()) {
            if (r.name === name && r.state === state) return JSON.parse(r.metadata)?.label;
        }
        return undefined;
    };

    return {
        seen,
        /** Every `POST …/publish` pattern the composed server really registered. */
        mountedPublishDoors: () => (rest as any).getRoutes()
            .filter((r: any) => r.method === 'POST' && String(r.path).endsWith('/publish'))
            .map((r: any) => String(r.path)),
        /**
         * The pair this file turns on, for one name: what the LIVE row carries
         * and what (if anything) is still STAGED beside it. A tuple so §5 can
         * compare the two doors without either side naming an outcome.
         */
        outcome: (name: string) => [labelOf(name, 'active'), labelOf(name, 'draft')] as const,
        compoundOutcome: () => [labelOf(COMPOUND_NAME, 'active'), labelOf(COMPOUND_NAME, 'draft')] as const,
        singleOutcome: () => [labelOf(SINGLE_NAME, 'active'), labelOf(SINGLE_NAME, 'draft')] as const,
        /** ⭐ The door this card mounts. */
        compoundPublish: (query: Record<string, unknown> = {}, body: unknown = {}) =>
            call('POST', COMPOUND_PUBLISH, { type: 'object', section: 'crm', name: 'task' }, query, body),
        /** Its single-segment twin — mounted since long before this card. */
        singlePublish: (query: Record<string, unknown> = {}, body: unknown = {}) =>
            call('POST', SINGLE_PUBLISH, { type: 'object', name: SINGLE_NAME }, query, body),
        /** The compound SAVE door (#11933), for the end-to-end lifecycle in §6. */
        compoundPut: (query: Record<string, unknown> = {}, label = 'Edited through PUT') =>
            call('PUT', COMPOUND_PUT, { type: 'object', section: 'crm', name: 'task' }, query, objectBody(label)),
        rows,
    };
}

/** What the store looks like once a draft was PROMOTED: live replaced, nothing staged. */
const PROMOTED = [DRAFT_LABEL, undefined];
/** What it looks like when nothing happened: live untouched, draft still staged. */
const UNTOUCHED = [LIVE_LABEL, DRAFT_LABEL];

// ═══════════════════════════════════════════════════════════════════════════
// 1. ⭐ The door exists, and it PROMOTES — the case that cannot even run
//    without the route
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11932] POST /meta/:type/:section/:name/publish — the compound promotion door', () => {
    it('⭐ is registered at all — BOTH arities, read off the real mount table', () => {
        const stack = boot();

        // ⛔ Not `typeof compoundPublish === 'function'` — that is true of the
        // helper whether or not the route exists, and it passed the ablation.
        // The claim is about the SERVER's table: both spellings, single-segment
        // first, and nothing else answering `…/publish`.
        expect(stack.mountedPublishDoors()).toEqual([SINGLE_PUBLISH, COMPOUND_PUBLISH]);
        // Registration is necessary and NOT sufficient — everything below is
        // about what the door then does, and `meta-route-registration-order`
        // carries the reachability half. (#7526's lesson: a mounted-but-shadowed
        // or stubbed route answers a plausible 200.)
    });

    it('⭐ makes the staged compound body LIVE — read from the store, not from the status', async () => {
        const stack = boot();

        expect(stack.compoundOutcome()).toEqual(UNTOUCHED);

        const answer = await stack.compoundPublish();

        expect(answer.status).toBe(200);
        // ⛔ The status is NOT the pin. #11712's whole defect was a door that
        // answered 200 while doing the wrong thing. THIS is the claim: the body
        // that was staged is now the live body, and nothing is left staged.
        expect(stack.compoundOutcome()).toEqual(PROMOTED);
    });

    it('⭐ hands the protocol ONE opaque compound key assembled from the two segments', async () => {
        const stack = boot();

        await stack.compoundPublish();

        // The seam. `<section>/<name>` is one protocol key — the same assembly
        // the `/published` READ twin and the compound `getItem`/`saveItem` doors
        // perform. A door that forwarded `name: 'task'` would promote a
        // DIFFERENT item, or nothing, and could still answer 200.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0].name).toBe(COMPOUND_NAME);
        expect(stack.seen[0].type).toBe('object');
    });

    it('⭐ does not touch the single-segment twin\'s rows — one name, not both', async () => {
        const stack = boot();

        await stack.compoundPublish();

        // Same fixture, two names, one store: promoting `crm/task` must leave
        // `crm_task` exactly as it was. A door that dropped the `section`
        // segment would promote the twin instead and still answer 200.
        expect(stack.compoundOutcome()).toEqual(PROMOTED);
        expect(stack.singleOutcome()).toEqual(UNTOUCHED);
    });

    it('reports the promotion in its answer body too', async () => {
        const stack = boot();

        const answer = await stack.compoundPublish();

        expect(answer.body?.success).toBe(true);
        // The ADR-0008 optimistic-concurrency token the SDK's `publishItem`
        // documents as its return value — present, so a caller can echo it as
        // `If-Match` on the next write to the compound-named item.
        expect(typeof answer.body?.version).toBe('string');
        // The receipt names the item under the key it was promoted by, which is
        // what an audit query on this type will later match.
        expect(String(answer.body?.message)).toContain(COMPOUND_NAME);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ⛔ It is a real door, not a stub — the #7526 disguise, refused
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11932 / #7526] the compound door can FAIL, which a stub could not', () => {
    it('⛔ 404s when the compound name has no draft staged', async () => {
        const stack = boot({ seedDrafts: false });

        const answer = await stack.compoundPublish();

        // #7526's two defects were routes that answered a plausible 200 for a
        // name that does not exist. A door that can never refuse is a door that
        // proves nothing when it succeeds.
        expect(answer.status).toBe(404);
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, undefined]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ⛔ [#7019 / #8919] The new arity is NOT a bypass of the capability gate
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11932 / #8919] the compound door demands `manage_metadata` too', () => {
    it('⛔ 403s an authenticated principal holding no authoring capability, and promotes nothing', async () => {
        const stack = boot({ capabilities: [] });

        const answer = await stack.compoundPublish();

        // #7019's finding, inherited: gating only the single-segment door leaves
        // the compound one as a bypass of it. Mounting a new arity is exactly
        // the moment that can be reintroduced, so it is pinned rather than
        // assumed from "it is the same handler".
        expect(answer.status).toBe(403);
        expect(answer.body?.error?.code).toBe('FORBIDDEN');
        // The gate runs BEFORE the protocol is resolved, so nothing was promoted
        // and nothing was even asked of the protocol.
        expect(stack.seen).toHaveLength(0);
        expect(stack.compoundOutcome()).toEqual(UNTOUCHED);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. [#6877] The repeated-parameter guard reaches the new arity
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11932 / #6877] a repeated `?package` is refused at the compound door', () => {
    it('⛔ `?package=a&package=b` is a 400 and promotes nothing', async () => {
        const stack = boot();

        const answer = await stack.compoundPublish({ package: ['pkg_a', 'pkg_b'] });

        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(stack.seen).toHaveLength(0);
        expect(stack.compoundOutcome()).toEqual(UNTOUCHED);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ⭐ [#7019] The twins agree — literal-free on BOTH sides
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11932 / #7019] the two publish doors answer the same way', () => {
    /**
     * ⛔ Deliberately literal-free on both sides: these cases assert that the
     * two doors AGREE, never what they agree on. §1–§4 name the outcomes; this
     * section names only the equality, so a future move on EITHER door reddens
     * here independently of whichever literal the sections above happen to pin.
     * (#11731 §4 / #11933 §5 are the precedent.)
     *
     * The single-segment door is untouched by this card and is the control: its
     * behaviour is asserted rather than assumed, which is the only shape in
     * which "the twins agree" is a pin instead of a comment.
     */
    it.each([
        { label: 'a plain promotion', query: {}, capabilities: undefined as string[] | undefined, seedDrafts: true },
        { label: 'a promotion carrying `?package`', query: { package: 'pkg_a' }, capabilities: undefined, seedDrafts: true },
        { label: 'a repeated `?package`', query: { package: ['a', 'b'] }, capabilities: undefined, seedDrafts: true },
        { label: 'nothing staged to promote', query: {}, capabilities: undefined, seedDrafts: false },
        { label: 'no authoring capability held', query: {}, capabilities: [] as string[], seedDrafts: true },
    ])('⭐ $label: same status, same error code, same store outcome at both doors', async ({ query, capabilities, seedDrafts }) => {
        const compoundStack = boot({ capabilities, seedDrafts });
        const singleStack = boot({ capabilities, seedDrafts });

        const compound = await compoundStack.compoundPublish(query);
        const single = await singleStack.singlePublish(query);

        // 1. The answer, read off the other door rather than written down.
        expect(compound.status).toBe(single.status);
        expect(compound.body?.success).toBe(single.body?.success);
        expect(compound.body?.error?.code).toBe(single.body?.error?.code);
        // 2. What the promotion actually DID, as `[live label, staged label]`.
        expect(compoundStack.compoundOutcome()).toEqual(singleStack.singleOutcome());
    });

    it('and the twin is UNTOUCHED — its protocol request is what it always was', async () => {
        const stack = boot();

        await stack.singlePublish();

        // The fence. This card mounts a second arity; it must not have edited
        // the door that was already right.
        expect(stack.seen).toHaveLength(1);
        expect(stack.seen[0]).toMatchObject({ type: 'object', name: SINGLE_NAME });
        expect(stack.singleOutcome()).toEqual(PROMOTED);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ⭐ The lifecycle #11933's changeset says is impossible today
// ═══════════════════════════════════════════════════════════════════════════

describe('[#11932 + #11712] stage a compound draft over REST, then promote it over REST', () => {
    it('⭐ PUT ?mode=draft → POST /publish leaves the edited body LIVE', async () => {
        const stack = boot({ seedDrafts: false });
        const EDITED = 'Edited through PUT';

        const staged = await stack.compoundPut({ mode: 'draft' }, EDITED);
        expect(staged.status).toBe(200);
        // Staged, not published — #11933's guarantee, restated as this card's
        // precondition rather than trusted.
        expect(stack.compoundOutcome()).toEqual([LIVE_LABEL, EDITED]);

        const promoted = await stack.compoundPublish();
        expect(promoted.status).toBe(200);

        // The whole point of the card, in one line: the draft a caller staged
        // over REST is now the live body, promoted over REST, per item. Before
        // this route the second call had no door and the only way out was
        // `POST /packages/:id/publish-drafts` (whole-package) or the runtime
        // dispatcher's own `meta.publish` verb.
        expect(stack.compoundOutcome()).toEqual([EDITED, undefined]);
    });
});
