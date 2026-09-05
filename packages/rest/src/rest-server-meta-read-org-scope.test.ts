// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #9454 — a runtime `PUT` of an org-overridable metadata type answered 200 with
// a `state:'active'` receipt, PERSISTED the row with its `organization_id`, and
// then no REST read door served it back. The author's work rendered as lost
// while the write path reported success: declared ≠ enforced, in the direction
// hardest for an author to notice.
//
// ── Where the defect was, and where it was NOT ────────────────────────────
//
// NOT in the overlay-resolution layer. `getMetaItem` resolves
// `(orgId ? findOverlay(orgId) : undefined) ?? findOverlay(null)` and
// `getMetaItems` unions both scopes under org-wins precedence — both correct
// and type-agnostic. The REST read doors simply never STATED the scope, so the
// reader looked in the env-wide partition for a row that had landed in an org
// one. The write door is correct as-is: the row is persisted, so its receipt is
// truthful. (Direction (a) — make the read door serve it — settled on-card.)
//
// ── The two-branch trap this file exists to pin ───────────────────────────
//
// `view` and `dashboard` share ONE mechanism but reach it through two DIFFERENT
// REST branches: `view` takes the cached arm (`getMetaItemCached`), `dashboard`
// bypasses the cache via `isDashboardType` and takes the uncached arm
// (`getMetaItem`). Both omitted the org, so a fix applied to one arm fixes
// exactly ONE type while the receipt keeps claiming success for the other. Both
// arms are driven below, on the same boot, for every org-overridable type.
//
// ── Why the harness is the REAL protocol, not a spy ───────────────────────
//
// A spy asserting "the door passed `organizationId`" cannot tell a fix from a
// fix-shaped no-op: the claim is write-then-READ AGREEMENT, so the row has to
// actually land in a partition and actually come back out of it. These drive
// real REST routes against a real `ObjectStackProtocolImplementation` over a
// stub engine, so the assertions are round trips on one boot.
//
// ⛔ THE CONTROL THAT MATTERS MOST is `does not serve another org's row`. The
// refused repair for this card was to make the overlay lookup fall back to
// matching ANY org row when the caller names none — `matchesWhere` skips
// `undefined` keys, so that matches an ARBITRARY org's row. It is a cross-tenant
// disclosure, not a fix, and it would pass every other assertion in this file.
// The original reproduction could not have caught it: its confound control was
// "one `sys_organization` row, and it is the session's active org". So a SECOND
// org exists here for no other purpose.

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/**
 * The five types the registry declares `allowOrgOverride: true`. Listed as
 * literals rather than derived, deliberately: the point of the card is that all
 * five must be SERVED, so a registry change that drops one should turn this red
 * and be looked at, not silently shrink the pin's coverage.
 */
const ORG_OVERRIDABLE = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;

/** The two whose REST branches differ — the trap, named. */
const CACHED_ARM = 'view';        // takes `getMetaItemCached`
const UNCACHED_ARM = 'dashboard'; // bypasses it via `isDashboardType`

/** `allowOrgOverride: false` — must keep reading env-wide, never org-scoped. */
const NON_OVERRIDABLE = 'object';

/** The value every read assertion looks for. */
const MARKER = 'AUTHORED_AT_RUNTIME';

/** The second revision's marker — two PUTs, two history events. */
const MARKER_2 = 'AUTHORED_AT_RUNTIME_REV2';

/**
 * A SPEC-VALID body per type, carrying `label` as the marker the reads assert
 * on. Real bodies, not `{ label }` stubs: the write door runs full spec
 * validation (`INVALID_METADATA`, 422), so a thin fixture never reaches the
 * store and every read assertion below would fail for a reason that has
 * nothing to do with org scoping. Each shape was measured against the real
 * validator, not guessed.
 */
function bodyFor(type: string, name: string, label = MARKER): Record<string, unknown> {
    const marker = { name, label };
    switch (type) {
        case 'view':
            // [#7741] the inline arm requires the object-binding pair.
            return { ...marker, object: 'task', viewKind: 'list', columns: [{ field: 'name', label: 'Name' }] };
        case 'dashboard':
            return { ...marker, widgets: [] };
        case 'report':
            return { ...marker, dataset: 'orders_ds', values: ['order_count'] };
        case 'translation':
            return { ...marker, locale: 'en-US' };
        case 'email_template':
            return { ...marker, subject: 'Hi', bodyHtml: '<p>Hello</p>' };
        case 'object':
            // [ADR-0090 D1] an authored `sharingModel` is required at the write
            // door; without it this control fails on the WRITE and never
            // reaches the read it exists to make.
            return {
                ...marker,
                sharingModel: 'private',
                fields: { title: { type: 'text', label: 'Title' } },
            };
        default:
            throw new Error(`no fixture body for type ${type}`);
    }
}


// ── stub engine (the `protocol.org-scoped-write-refused.test.ts` pattern) ──

interface Row {
    id: string; type: string; name: string;
    organization_id: string | null; package_id: string | null;
    state: string; metadata: string; checksum?: string; version?: number;
}

interface HistoryRow {
    id: string; type: string; name: string;
    organization_id: string | null;
    version: number; event_seq: number;
    operation_type: string; metadata: string | null;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Record<string, unknown>, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        // ⛔ REFUSE any other combinator rather than reading it as a field
        // name. `$or` is the only one the read paths under test emit, and a
        // double that answered `$and` by looking for a column literally called
        // `$and` would return a well-formed WRONG answer — the same silent
        // class as a double that drops the predicate entirely. Refusing loudly
        // is the convention the sibling harness already follows.
        if (k.startsWith('$')) {
            throw new Error(`stub engine: unsupported WHERE combinator \`${k}\``);
        }
        if (v === undefined) continue;
        if (r[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    let nextId = 0;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r as unknown as Record<string, unknown>, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') {
                // [#13764] Was `return null` UNCONDITIONALLY. Measured before
                // changing it: the unconditional null is NOT load-bearing for
                // the PUT path this fixture drives — production reaches this
                // seam only from `getByHash`, `restoreVersion` and
                // `resolveMetaItemOrgScope`, none of which a PUT calls; the
                // write path reads history through `find`
                // (`nextEventSeq` / `nextItemVersion`).
                return historyRows.find(
                    (h) => matchesWhere(h as unknown as Record<string, unknown>, opts.where),
                ) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // [#13764] Two silences repaired on one seam, for one reason.
            //
            // WHERE: this branch used to `return historyRows` UNFILTERED.
            // `SysMetadataRepository.history()` and `diffMetaItem` filter
            // `organization_id` by STRICT EQUALITY and post-filter nothing, so
            // an unfiltered answer made the org predicate a no-op: an
            // org-scoping assertion for `/history` was green whether or not the
            // door forwarded the organization. Measured, not argued — the
            // `#13764` block at the bottom of this file is green over the old
            // stub in BOTH states and reddens over this one when the org is
            // dropped.
            //
            // LIMIT: applied AFTER the filter and BY PRESENCE
            // (`typeof === 'number'`), so `limit: 0` returns nothing rather
            // than everything, and bounding never decides WHICH rows survive
            // the predicate — only how many of the survivors come back. Every
            // call this fixture makes passes no bound and is untouched.
            // `check:objectql-double-limit`. Applied on BOTH tables so the two
            // branches cannot disagree.
            if (table === 'sys_metadata_history') {
                const matched = historyRows.filter(
                    (h) => matchesWhere(h as unknown as Record<string, unknown>, opts?.where ?? {}),
                );
                return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
            }
            const matched = Array.from(rows.values()).filter(
                (r) => matchesWhere(r as unknown as Record<string, unknown>, opts?.where ?? {}),
            );
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                historyRows.push({ ...(data as unknown as HistoryRow), id: `h_${nextId}` });
                return { id: `h_${nextId}` };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        registry: {
            registerItem: () => {}, registerObject: () => {},
            listItems: () => [], getItem: () => undefined,
            getObject: () => undefined, getPackage: () => undefined,
            getArtifactItem: () => undefined,
            // The LIST door prunes items belonging to disabled packages; a
            // registry double without this answers 500, which would have read
            // as "the listing still does not serve org rows".
            isPackageDisabled: () => false,
        },
    };
    return { engine, rows, historyRows };
}

// ── REST harness: real protocol, real routes, one boot ────────────────────

function mockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => undefined, close: async () => undefined,
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        _body: undefined,
        json(body: any) { this._body = body; return this; },
        send() { return this; },
        setHeader() { return this; },
        status(code: number) { this.statusCode = code; return this; },
        header() { return this; },
    };
    return res;
}

/**
 * One boot, one backing store. `session` is what `resolveExecCtx` resolves to —
 * the SAME memoised seam the write doors read, which is why threading the read
 * doors through it adds no new org resolution. Reassignable so a second tenant
 * can read the same store on the same boot (the cross-tenant control).
 */
function boot() {
    const { engine, rows, historyRows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    protocol.getDiscovery = async () => ({
        version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
    });

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    let session: any = { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId: ORG_A };
    (rest as any).resolveExecCtx = async () => session;
    rest.registerRoutes();

    const drive = async (method: string, path: string, req: Record<string, unknown> = {}) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        let thrown: any;
        try {
            await found.handler(
                { method, path, params: {}, query: {}, headers: {}, body: {}, ...req } as any,
                res,
            );
        } catch (err) { thrown = err; }
        return { status: res.statusCode, body: res._body, thrown };
    };

    return {
        rows,
        historyRows,
        as(tenantId: string | undefined) {
            session = tenantId === undefined
                ? { userId: 'u1', systemPermissions: ['manage_metadata'] }
                : { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId };
        },
        put: (type: string, name: string, label = MARKER) =>
            drive('PUT', `${META}/:type/:name`, { params: { type, name }, body: bodyFor(type, name, label) }),
        get: (type: string, name: string) =>
            drive('GET', `${META}/:type/:name`, { params: { type, name } }),
        list: (type: string) =>
            drive('GET', `${META}/:type`, { params: { type } }),
        /** [#13753] The cross-type spec-validation sweep. */
        diagnostics: (query: Record<string, unknown> = {}) =>
            drive('GET', `${META}/diagnostics`, { query }),
        /** [#13753] The "Used by" sweep an operator reads before a delete. */
        references: (type: string, name: string) =>
            drive('GET', `${META}/:type/:name/references`, { params: { type, name } }),
        history: (type: string, name: string) =>
            drive('GET', `${META}/:type/:name/history`, { params: { type, name }, query: {} }),
        /** The fixture proof every history assertion below is gated on. */
        historyRowsFor: (type: string, name: string, org: string | null) =>
            historyRows.filter((h) => h.type === type && h.name === name
                && (h.organization_id ?? null) === org),
    };
}

/** The document a GET served, whichever envelope shape the arm answers in. */
function servedDocument(body: any): any {
    if (!body || typeof body !== 'object') return undefined;
    return body.item ?? body.data ?? body;
}

/** Names present in a list response, whichever shape it answers in. */
function listedNames(body: any): string[] {
    const items = Array.isArray(body) ? body
        : Array.isArray(body?.items) ? body.items
        : [];
    return items.map((i: any) => i?.name).filter(Boolean);
}

describe('#9454 every REST /meta read door serves what the write door persisted', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    describe('write-then-read agreement on one boot, both branches', () => {
        it.each(ORG_OVERRIDABLE)(
            '%s: the 200 state:active receipt is answered by the direct GET',
            async (type) => {
                const written = await b.put(type, 'authored_at_runtime');
                // The receipt half — unchanged by this card, asserted so a
                // harness that could not write at all cannot pass the read half
                // for the wrong reason.
                expect(written.status, `PUT /${type} was not accepted`).toBe(200);
                expect(written.body?.state).toBe('active');

                const read = await b.get(type, 'authored_at_runtime');
                expect(read.thrown, `GET /${type} threw: ${read.thrown?.code}`).toBeUndefined();
                expect(read.status, `GET /${type} did not serve the item`).toBe(200);
                expect(servedDocument(read.body)?.label).toBe(MARKER);
            },
        );

        it.each(ORG_OVERRIDABLE)(
            '%s: the scoped listing contains it too',
            async (type) => {
                await b.put(type, 'authored_at_runtime');
                const listed = await b.list(type);
                expect(listed.status).toBe(200);
                expect(listedNames(listed.body)).toContain('authored_at_runtime');
            },
        );

        it('covers BOTH REST branches, not one — the half-fix guard', async () => {
            // The assertion is about ROUTE MECHANICS, so it is stated
            // separately from the parametrised cases above: `view` and
            // `dashboard` agreeing here is what proves the cached arm and the
            // `isDashboardType` bypass were BOTH threaded. A fix to one arm
            // leaves exactly one of these two red.
            await b.put(CACHED_ARM, 'both_arms');
            await b.put(UNCACHED_ARM, 'both_arms');

            const cached = await b.get(CACHED_ARM, 'both_arms');
            const uncached = await b.get(UNCACHED_ARM, 'both_arms');

            expect(servedDocument(cached.body)?.label, 'cached arm (view) lost the overlay').toBe(MARKER);
            expect(servedDocument(uncached.body)?.label, 'uncached arm (dashboard) lost the overlay').toBe(MARKER);
        });
    });

    describe('⛔ the scope is STATED, not guessed — cross-tenant controls', () => {
        it('does not serve another org row to a caller that named no org', async () => {
            // The refused option C, pinned. An org-blind fallback matching ANY
            // org row passes every assertion above and fails only here.
            await b.put(CACHED_ARM, 'org_a_only');
            b.as(undefined);

            const read = await b.get(CACHED_ARM, 'org_a_only');
            expect(
                servedDocument(read.body)?.label,
                'an org-less caller was served an org-scoped row',
            ).not.toBe(MARKER);
            expect(listedNames((await b.list(CACHED_ARM)).body)).not.toContain('org_a_only');
        });

        it('does not serve org A row to org B on the same boot', async () => {
            // The control the original reproduction structurally could not run:
            // it had exactly one organization.
            await b.put(UNCACHED_ARM, 'tenant_bound');
            b.as(ORG_B);

            const read = await b.get(UNCACHED_ARM, 'tenant_bound');
            expect(
                servedDocument(read.body)?.label,
                'org B was served org A metadata',
            ).not.toBe(MARKER);
            expect(listedNames((await b.list(UNCACHED_ARM)).body)).not.toContain('tenant_bound');
        });

        it('leaves a NON-overridable type reading env-wide', async () => {
            // The registry gate, not decoration. Naming the org for every type
            // would resurrect #6190's phantom rows on the READ side — rows boot
            // hydration deliberately walks past, so serving them means serving a
            // document that vanishes at the next restart.
            await b.put(NON_OVERRIDABLE, 'accounts');
            const row = Array.from(b.rows.values()).find((r) => r.name === 'accounts');
            expect(row?.organization_id ?? null, 'a non-overridable write went org-scoped').toBe(null);

            const read = await b.get(NON_OVERRIDABLE, 'accounts');
            expect(read.status).toBe(200);
            expect(servedDocument(read.body)?.label).toBe(MARKER);
        });
    });

    describe('the row really is org-partitioned — the premise, re-measured', () => {
        it('persists with organization_id, which is why an env-wide read missed it', async () => {
            // Guards the card's own diagnosis: this is persisted-but-not-served,
            // never a silent write no-op. If this turns red the defect has
            // changed shape and the rest of this file is asserting the wrong
            // thing.
            const written = await b.put(CACHED_ARM, 'partitioned');
            const row = Array.from(b.rows.values()).find((r) => r.name === 'partitioned');
            expect(
                row,
                'nothing was persisted at all; PUT answered '
                + `${written.status} ${JSON.stringify(written.body)} thrown=${written.thrown?.message}`,
            ).toBeDefined();
            expect(row?.organization_id).toBe(ORG_A);
        });
    });
});

// ── #13764 — the instrument's own discriminating power, pinned ────────────
//
// This file's stub used to DISCARD `opts.where` on both `sys_metadata_history`
// seams: `findOne` answered `null` unconditionally and `find` handed back every
// history row unfiltered. `SysMetadataRepository.history()` and `diffMetaItem`
// filter `organization_id` by STRICT EQUALITY and post-filter nothing, so over
// that stub the org predicate was a NO-OP — an org-scoping assertion for
// `/history` was green whether or not the door forwarded the organization.
//
// ⭐ THE ASSERTION THAT HOLDS THE STUB RIGHT is `does not serve org A history to
// org B`. The positive case below cannot do that job: un-partition the stub
// again and it stays GREEN, because an unfiltered read still contains the rows
// it looks for. Only the cross-tenant case reddens, because only it asks for an
// answer the unfiltered stub cannot give. It is here for the stub, not for the
// door.
//
// ⛔ These are NOT this file's pins for the two doors' behaviour — those live in
// `rest-server-meta-history-diff-org-scope.test.ts` (#13406), whose partitioned
// stub is the positive control this repair was calibrated against, and which
// owns `?limit=`, `/diff`, and the non-overridable env-wide control. What is
// asserted here is the narrow fact that THIS harness can now tell a forwarded
// org from a dropped one.
describe('#13764 the history seams of this harness honour the org partition', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    it('serves the org-scoped change log of an item the active org authored', async () => {
        // The measurement that names the repair: with the door's org dropped
        // this reads the ENV partition and answers zero events. Over the old
        // unfiltered stub it answered two in BOTH states.
        const first = await b.put(CACHED_ARM, 'authored_at_runtime');
        expect(first.status, 'the fixture never wrote').toBe(200);
        await b.put(CACHED_ARM, 'authored_at_runtime', MARKER_2);

        // Fixture proof first — "the read is org-scoped" is worthless if the
        // fixture never created an org-scoped row.
        expect(
            b.historyRowsFor(CACHED_ARM, 'authored_at_runtime', ORG_A).length,
            'nothing landed in the org partition; the read below would then pass '
            + 'or fail for a reason unrelated to org scoping',
        ).toBe(2);
        expect(
            b.historyRowsFor(CACHED_ARM, 'authored_at_runtime', null).length,
            'the write also landed env-wide — the partition is not real',
        ).toBe(0);

        const read = await b.history(CACHED_ARM, 'authored_at_runtime');
        expect(read.thrown, `GET /history threw: ${read.thrown?.message}`).toBeUndefined();
        expect(read.status).toBe(200);
        expect(
            read.body?.events?.length,
            'the door answered an empty change log for an item whose org partition holds two events',
        ).toBe(2);
    });

    it('does not serve org A history to org B on the same boot', async () => {
        // ⭐ The one that reddens if the stub is ever un-partitioned again.
        await b.put(UNCACHED_ARM, 'tenant_bound');
        await b.put(UNCACHED_ARM, 'tenant_bound', MARKER_2);
        expect(b.historyRowsFor(UNCACHED_ARM, 'tenant_bound', ORG_A).length).toBe(2);

        b.as(ORG_B);
        const read = await b.history(UNCACHED_ARM, 'tenant_bound');
        expect(read.status).toBe(200);
        expect(
            read.body?.events ?? [],
            'org B was served org A\'s change log',
        ).toEqual([]);
    });

    it('does not serve an org-scoped change log to a caller that named no org', async () => {
        await b.put(CACHED_ARM, 'org_a_only');
        expect(b.historyRowsFor(CACHED_ARM, 'org_a_only', ORG_A).length).toBe(1);

        b.as(undefined);
        const read = await b.history(CACHED_ARM, 'org_a_only');
        expect(read.status).toBe(200);
        expect(
            read.body?.events ?? [],
            'an org-less caller was served an org-scoped change log',
        ).toEqual([]);
    });
});

// ── [#13753] `GET /meta/diagnostics` ──────────────────────────────────────
//
// The cross-type spec-validation sweep behind the Studio governance directory
// named no organization, so an org's own overlays were absent from it: clean
// tiles rendered over a partition the sweep never read.
//
// ⭐ WHY ONLY THE `?type=` ARM IS REPAIRED, and why the untyped sweep is
// PINNED AS-IS rather than left unmentioned. `getMetaDiagnostics` reads each
// swept type through `getMetaItems({ type: t, organizationId })`.
//
// ⚠️ [#14683, recorded by #15034] `getMetaItems` NOW APPLIES THE REGISTRY GATE
// ITSELF, after folding the request type. This header used to say it applied
// none and that the scope was therefore the caller's to decide per type; that
// sentence is FALSE on today's tree. What survives it is the arm split below,
// which is about how many types ONE `organizationId` is asked to cover:
//
//   • `?type=` ⇒ `targetTypes` is exactly that one type, so
//     `organizationIdForMetaRead` over it IS the request's whole scope. Correct
//     by construction, and repaired here.
//   • no `?type=` ⇒ `targetTypes` is the whole registry, five
//     `allowOrgOverride: true` types beside every other declared type. The arm
//     names no organization at all, so nothing is folded and nothing is
//     unioned. ⚠️ The reason it stays that way is no longer "one org id cannot
//     say org-scoped for those five, env-wide for the rest" — since #14683 the
//     inner gate folds each `t` separately inside the sweep's own loop, so it
//     could. It stays because closing it MOVES BEHAVIOUR and is somebody's
//     decision on a card. The gap is pinned below so it cannot widen by
//     accident in either direction.
//
// ── ⛔ WHAT THIS FILE NO LONGER DISCRIMINATES (#15034, MEASURED) ───────────
//
// This header used to end: "Swap `organizationIdForMetaRead` for a raw
// `ctx?.tenantId` at the call site and that assertion, and only it, turns red."
// MEASURED on the merged tree, that ablation now leaves this file 30/30 GREEN
// — `getMetaItems`' own gate re-folds the raw tenant id, phantom control
// included. Same fate as #14677's ablation B, and for the same reason.
//
// ⇒ What this file DOES still discriminate is the organization being DROPPED:
// remove the `organizationId` the `?type=` arm passes and the six repair cases
// above turn red (measured: 6 failed / 24 passed). Read the two apart before
// citing this file as a pin on the door-side predicate — it pins that the arm
// still FOLDS, never that the fold happens at the door.

/** Rows in the backing store for one `(type, name, org)` slot. */
function storedRowsFor<T extends { type: string; name: string; organization_id: string | null }>(
    rows: Map<string, T>,
    type: string,
    name: string,
    org: string | null,
): T[] {
    return Array.from(rows.values()).filter(
        (r) => r.type === type && r.name === name && (r.organization_id ?? null) === org,
    );
}

describe('#13753 GET /meta/diagnostics states the org partition on the ?type= arm', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    describe('the repair — a ?type= sweep sees what this organization authored', () => {
        it.each(ORG_OVERRIDABLE)('%s: the org-scoped item is counted', async (type) => {
            const written = await b.put(type, 'authored_at_runtime');
            expect(written.status, `PUT /${type} was not accepted`).toBe(200);

            // ⭐ Fixture proof first. "The sweep is org-scoped" is worthless if
            // the fixture never created an org-scoped row — the assertion below
            // would then pass or fail for a reason unrelated to org scoping.
            expect(
                storedRowsFor(b.rows, type, 'authored_at_runtime', ORG_A).length,
                'nothing landed in the org partition',
            ).toBe(1);
            expect(
                storedRowsFor(b.rows, type, 'authored_at_runtime', null).length,
                'the write also landed env-wide — the partition is not real',
            ).toBe(0);

            const swept = await b.diagnostics({ type });
            expect(swept.thrown, `GET /diagnostics threw: ${swept.thrown?.message}`).toBeUndefined();
            expect(swept.status).toBe(200);
            expect(swept.body?.scannedTypes, 'the ?type= arm swept more than the named type').toBe(1);
            expect(
                swept.body?.stats?.[type]?.count,
                'the sweep reported a clean tile over a partition it never read — the card',
            ).toBe(1);
            expect(swept.body?.scannedItems).toBe(1);
        });

        it('a plural URL spelling is folded before the scope decision, not after', async () => {
            // [#10340] The predicate is asked with `canonicalMetaUrlType(...)`,
            // never the raw segment: `declaresOrgOverride` answers `false` for
            // URL-only spellings, so an unfolded `views` would silently drop
            // back to env-wide and this case would report a clean tile again.
            await b.put(CACHED_ARM, 'authored_at_runtime');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'authored_at_runtime', ORG_A).length).toBe(1);

            const swept = await b.diagnostics({ type: 'views' });
            expect(swept.status).toBe(200);
            expect(
                swept.body?.stats?.views?.count,
                'the plural spelling was scoped env-wide — the fold happened after the decision',
            ).toBe(1);
        });
    });

    describe('⛔ controls — the scope is STATED, never widened', () => {
        it('?type=object stays env-wide and does NOT resurrect a phantom org row', async () => {
            // ⭐ THE ABLATION TARGET. `object` is `allowOrgOverride: false` +
            // `allowRuntimeCreate: true`, so its runtime writes land ENV-WIDE
            // even under an active org (`organizationIdForMetaWrite`, #6190) —
            // which is why the phantom below has to be planted directly rather
            // than written through the door. Rows like it exist in deployments
            // that ran before that ruling; boot hydration walks past them, so
            // they are dead, and a read door that named the org for every type
            // would serve them again. ⚠️ [#15034] PREDICTED DIRECTION,
            // CORRECTED: replacing the predicate with `ctx?.tenantId` at the
            // call site no longer moves this count — `getMetaItems`' own gate
            // (#14683) re-folds it. What still drives it to 2 is a read door
            // that reaches the store with the org unfolded, which is why the
            // control stays.
            const written = await b.put(NON_OVERRIDABLE, 'accounts');
            expect(written.status, 'the control never wrote').toBe(200);
            expect(
                storedRowsFor(b.rows, NON_OVERRIDABLE, 'accounts', null).length,
                'a non-overridable write went org-scoped; the control no longer controls anything',
            ).toBe(1);

            b.rows.set(
                keyOf({ type: NON_OVERRIDABLE, name: 'phantom_orders', organization_id: ORG_A, state: 'active' }),
                {
                    id: 'phantom_1',
                    type: NON_OVERRIDABLE,
                    name: 'phantom_orders',
                    organization_id: ORG_A,
                    package_id: null,
                    state: 'active',
                    metadata: JSON.stringify(bodyFor(NON_OVERRIDABLE, 'phantom_orders')),
                },
            );
            expect(
                storedRowsFor(b.rows, NON_OVERRIDABLE, 'phantom_orders', ORG_A).length,
                'the phantom was not planted; the control proves nothing',
            ).toBe(1);

            const swept = await b.diagnostics({ type: NON_OVERRIDABLE });
            expect(swept.status).toBe(200);
            expect(
                swept.body?.stats?.[NON_OVERRIDABLE]?.count,
                'the sweep read the org partition of a type with no per-org read channel — '
                + 'the phantom rows #6190 stopped minting, resurrected on the read side',
            ).toBe(1);
        });

        it('does not sweep org A\'s items for org B on the same boot', async () => {
            await b.put(UNCACHED_ARM, 'tenant_bound');
            expect(storedRowsFor(b.rows, UNCACHED_ARM, 'tenant_bound', ORG_A).length).toBe(1);

            b.as(ORG_B);
            const swept = await b.diagnostics({ type: UNCACHED_ARM });
            expect(swept.status).toBe(200);
            expect(
                swept.body?.stats?.[UNCACHED_ARM]?.count,
                'org B was swept over org A\'s items',
            ).toBe(0);
        });

        it('does not serve an org-scoped item to a caller that named no org', async () => {
            await b.put(CACHED_ARM, 'org_a_only');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'org_a_only', ORG_A).length).toBe(1);

            b.as(undefined);
            const swept = await b.diagnostics({ type: CACHED_ARM });
            expect(swept.status).toBe(200);
            expect(
                swept.body?.stats?.[CACHED_ARM]?.count,
                'an org-less caller was swept over an org-scoped item',
            ).toBe(0);
        });

        it('still sweeps env-wide items for an org-scoped caller', async () => {
            // The other direction of the same harness: naming the org for org
            // callers must not disturb the env-wide read that worked all along.
            b.as(undefined);
            await b.put(CACHED_ARM, 'env_authored');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'env_authored', null).length).toBe(1);

            b.as(ORG_A);
            const swept = await b.diagnostics({ type: CACHED_ARM });
            expect(swept.status).toBe(200);
            expect(
                swept.body?.stats?.[CACHED_ARM]?.count,
                'an org session lost sight of an env-wide item it could read before',
            ).toBe(1);
        });
    });

    describe('the RECORDED GAP — the untyped sweep is still env-wide', () => {
        it('an org-scoped item is absent from the whole-registry sweep', async () => {
            // ⚠️ This pins a KNOWN GAP, deliberately, so that closing it is a
            // decision somebody makes rather than a side effect: one
            // `organizationId` cannot express the per-type scope a
            // whole-registry sweep needs, and the shape is reported on the card
            // with a proposal. If this reddens, the untyped arm has started
            // naming an organization — read the card before making it green.
            await b.put(CACHED_ARM, 'authored_at_runtime');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'authored_at_runtime', ORG_A).length).toBe(1);

            const swept = await b.diagnostics();
            expect(swept.status).toBe(200);
            expect(
                swept.body?.scannedTypes,
                'the untyped arm did not sweep the registry; the assertion below would be vacuous',
            ).toBeGreaterThan(1);
            expect(swept.body?.stats?.[CACHED_ARM]?.count).toBe(0);
        });

        it('and still sees env-wide items — the zero above is scope, not a broken sweep', async () => {
            b.as(undefined);
            await b.put(CACHED_ARM, 'env_authored');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'env_authored', null).length).toBe(1);

            b.as(ORG_A);
            const swept = await b.diagnostics();
            expect(swept.status).toBe(200);
            expect(swept.body?.stats?.[CACHED_ARM]?.count).toBe(1);
        });
    });
});

// ── [#13753] `GET /meta/:type/:name/references` ───────────────────────────
//
// `findReferencesToMeta` backs the admin "Used by" panel, whose empty case
// reads — verbatim, objectui `metadata-admin/i18n.ts` — "Nothing in the
// metadata graph points at this item. Safe to delete.", shown to an operator
// about to delete something. The door named no organization, so the sweep read
// the env partition only: an org-scoped `view` pointing at the object being
// deleted was invisible and the panel issued a FALSE CLEARANCE. That is the
// ADR-0110 D3 harm this route's own 501 refusal (#9326) was added to prevent,
// answered by the door after the protocol had refused to answer it.
//
// ⭐ WHY THE DOOR PASSES THE TENANT **RAW** — and why the two cases below are a
// PAIR rather than a case and a decoration. `req.params.type` is the TARGET;
// the organization is spent on the SOURCES (`getMetaItems({ type:
// matcher.fromType, … })` per `matcher`). Pre-gating on the target the way the
// sibling `/meta` doors do would answer a question about the wrong type, and
// on a non-overridable target (`object`, `flow`, `app` — the most common
// delete there is) it would suppress the organization altogether and leave the
// false clearance exactly where it was. Raw is nevertheless not an
// unconditional tenant: since #14683 `getMetaItems` applies
// `organizationIdForMetaRead` to its OWN `request.type`, so the per-SOURCE
// decision is the callee's.
//
// ⇒ The first case pins that an OVERRIDABLE source is now found; the second
// that a NON-OVERRIDABLE source is still read env-wide, phantom row and all.
// One request, two source types, opposite scopes — which is the fact that
// makes "raw" correct and that no assertion on either case alone can state.

/** An `object`-typed SOURCE: a lookup field naming `target`. */
function objectReferencing(name: string, target: string): Record<string, unknown> {
    return {
        // [ADR-0090 D1] `sharingModel` is required at the write door; without
        // it this fixture fails on the WRITE and never reaches the read.
        name,
        label: MARKER,
        sharingModel: 'private',
        fields: { task_ref: { type: 'lookup', label: 'Task', reference: target } },
    };
}

/** The item an operator is about to delete — what `bodyFor('view', …)` binds to. */
const TARGET_OBJECT = 'task';

describe('#13753 GET /meta/:type/:name/references states the org partition', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    interface RefRow { type: string; name: string; label?: string; path: string; kind: string }
    const rowsOf = (body: any): RefRow[] => (body?.references ?? []) as RefRow[];
    const namesOf = (body: any, type: string) => rowsOf(body).filter((r) => r.type === type).map((r) => r.name);

    it('⭐ THE CARD: an org-scoped `view` that references the object is FOUND', async () => {
        // `view` is `allowOrgOverride: true`, so this PUT lands in the org
        // partition — the fixture proof below is what makes the read
        // assertion a statement about scope rather than about the store.
        const written = await b.put(CACHED_ARM, 'task_list');
        expect(written.status, 'the view was never written').toBe(200);
        expect(
            storedRowsFor(b.rows, CACHED_ARM, 'task_list', ORG_A).length,
            'nothing landed in the org partition',
        ).toBe(1);
        expect(
            storedRowsFor(b.rows, CACHED_ARM, 'task_list', null).length,
            'the write also landed env-wide — the partition is not real',
        ).toBe(0);

        const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
        expect(used.thrown, `the door threw: ${used.thrown?.message}`).toBeUndefined();
        expect(used.status).toBe(200);
        expect(
            namesOf(used.body, CACHED_ARM),
            'the sweep read a partition the caller does not live in, and the "Used by" panel '
            + 'rendered "Safe to delete." over an org-scoped view that points straight at this object',
        ).toContain('task_list');
    });

    it('⛔ NARROWNESS CONTROL: a non-overridable SOURCE stays env-wide — no phantom row is resurrected', async () => {
        // The other half of the pair. `object` is `allowOrgOverride: false`, so
        // its runtime writes land ENV-WIDE even under an active org
        // (`organizationIdForMetaWrite`, #6190) — which is why the phantom has
        // to be planted directly. Rows like it exist in deployments that ran
        // before that ruling; boot hydration walks past them, so they are dead,
        // and a door that named the org for EVERY source type would read them
        // back into a destructive-action clearance — worse than an omission,
        // because a resurrected row reads as evidence.
        const written = await b.put(NON_OVERRIDABLE, 'env_orders');
        expect(written.status, 'the control never wrote').toBe(200);
        // Rewrite the stored document so this object actually REFERENCES the
        // target; the write door validates, so the shape is a real one.
        const envRow = storedRowsFor(b.rows, NON_OVERRIDABLE, 'env_orders', null);
        expect(envRow.length, 'a non-overridable write went org-scoped; the control controls nothing').toBe(1);
        envRow[0].metadata = JSON.stringify(objectReferencing('env_orders', TARGET_OBJECT));

        b.rows.set(
            keyOf({ type: NON_OVERRIDABLE, name: 'phantom_orders', organization_id: ORG_A, state: 'active' }),
            {
                id: 'phantom_ref_1',
                type: NON_OVERRIDABLE,
                name: 'phantom_orders',
                organization_id: ORG_A,
                package_id: null,
                state: 'active',
                metadata: JSON.stringify(objectReferencing('phantom_orders', TARGET_OBJECT)),
            },
        );
        expect(
            storedRowsFor(b.rows, NON_OVERRIDABLE, 'phantom_orders', ORG_A).length,
            'the phantom was not planted; the control proves nothing',
        ).toBe(1);

        // ⭐ Same request, both source types — one org-scoped `view` beside the
        // two `object` rows, so the two scopes are read on ONE sweep.
        await b.put(CACHED_ARM, 'task_list');
        const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
        expect(used.status).toBe(200);

        expect(
            namesOf(used.body, NON_OVERRIDABLE),
            'the env-wide `object` source was not swept at all — the exclusion below would be vacuous',
        ).toContain('env_orders');
        expect(
            namesOf(used.body, NON_OVERRIDABLE),
            'the door named the organization for a type with no per-org read channel — the pre-#6190 '
            + 'phantoms, resurrected on the read side inside a delete clearance',
        ).not.toContain('phantom_orders');
        expect(
            namesOf(used.body, CACHED_ARM),
            'the overridable source lost its org scope on the same request — the gate is not per type',
        ).toContain('task_list');
    });

    describe('⛔ controls — the scope is STATED, and nothing else moves', () => {
        it('does not serve org A\'s source to org B on the same boot', async () => {
            await b.put(CACHED_ARM, 'task_list');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'task_list', ORG_A).length).toBe(1);

            b.as(ORG_B);
            const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
            expect(used.status).toBe(200);
            expect(namesOf(used.body, CACHED_ARM), 'org B was served org A\'s view').not.toContain('task_list');
        });

        it('an org-LESS caller reads exactly what it read before', async () => {
            await b.put(CACHED_ARM, 'task_list');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'task_list', ORG_A).length).toBe(1);

            b.as(undefined);
            const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
            expect(used.status).toBe(200);
            expect(
                namesOf(used.body, CACHED_ARM),
                'an anonymous / org-less read moved — this door must not change for a caller that names no org',
            ).not.toContain('task_list');
        });

        it('and still serves ENV-WIDE sources to an org-scoped caller', async () => {
            // The other direction: naming the org must not narrow the answer
            // an org caller could already see.
            b.as(undefined);
            await b.put(CACHED_ARM, 'env_task_list');
            expect(storedRowsFor(b.rows, CACHED_ARM, 'env_task_list', null).length).toBe(1);

            b.as(ORG_A);
            const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
            expect(used.status).toBe(200);
            expect(
                namesOf(used.body, CACHED_ARM),
                'an org session lost sight of an env-wide reference it could see before',
            ).toContain('env_task_list');
        });

        it('the response is the SAME wire shape — one `references` key, no new field', async () => {
            await b.put(CACHED_ARM, 'task_list');
            const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
            expect(used.status).toBe(200);
            expect(Object.keys(used.body ?? {})).toEqual(['references']);
            // The ROW shape too: a repair that added a scope discriminator per
            // row would satisfy every assertion above.
            expect(rowsOf(used.body).find((r) => r.name === 'task_list')).toEqual({
                type: CACHED_ARM, name: 'task_list', label: MARKER, path: 'object', kind: 'view object',
            });
        });

        it('the #9327 unanswerable-target refusal keeps its code and status', async () => {
            // Asserted as `code` + `status` (ADR-0112) rather than as "it
            // threw": this route's refusals are the one thing on it an operator
            // reads as "the question was never asked", so a scope repair that
            // moved either would be moving the destructive-action clearance.
            //
            // ⚠️ The code is read through BOTH refusal dialects on purpose.
            // Measured on this boot, the two 501s this route can answer do not
            // agree: the missing-method branch hand-builds the ADR-0112 NESTED
            // `{ error: { code, message } }`, while the protocol-raised
            // unanswerable-target refusal reaches the wire as the FLAT
            // `{ error: 'Internal server error', code }` — the prescriptive
            // "ask the owning object instead" message scrubbed. That is a
            // finding of its own, filed as #15685; it is NOT this card's
            // subject, and reading both keeps this pin measuring the thing it
            // is about.
            const refused = await b.references('field', 'account.owner');
            const body = refused.body as any;
            const observed = refused.thrown
                ? { status: refused.thrown.status, code: refused.thrown.code }
                : { status: refused.status, code: body?.error?.code ?? body?.code };
            expect(observed).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        });
    });
});
