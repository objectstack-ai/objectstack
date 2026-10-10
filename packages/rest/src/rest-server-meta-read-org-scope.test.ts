// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D6, C5 stage S3] Every REST `/meta` read door serves what the write
// door persisted — and since the per-organization overlay axis retired, what it
// persists is the ENVIRONMENT row, served to every caller.
//
// History. #9454 found a runtime `PUT` of an org-overridable type persisting an
// org-scoped row no read door then served, and made the read doors name the
// caller's organization (gated by `organizationIdForMetaRead`). #13753 /
// #15622 did the same for the diagnostics and references sweeps. ADR-0131 D6
// retires the axis: the write doors name no organization, so the reads name
// none either, and flip in the SAME change — reads-first would hide the
// organization rows the doors still wrote, writes-first would let legacy
// organization rows shadow new environment saves.
//
// What is pinned here, over the REAL protocol on one boot:
//   • write-then-read agreement on both REST branches (`view` takes the cached
//     arm, `dashboard` the uncached one), for an org-active author;
//   • the row lands with `organization_id` NULL, and every caller — the
//     author's organization, another one, none — is served it;
//   • ⭐ a LEGACY organization-scoped row (written straight through the
//     protocol, which still accepts one until a later stage refuses it) is NOT
//     served by any read door, not even to its own organization: environment →
//     code. Until ADR-0131 C7 promotes such rows, a single-posture deployment
//     observes this too (stage 0's F10 of the retirement card).

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, SysMetadataRepository } from '@objectstack/metadata-protocol';
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

/** The label a planted LEGACY organization-scoped row carries. */
const LEGACY_MARKER = 'LEGACY_ORG_ROW';

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
            // [#19542] The live resolution universe the runtime publish gate
            // reads. It answered `[]` for every type, which was harmless while
            // no rule judged the types this file writes — since the report door
            // opened, `bodyFor('report')` binds `orders_ds` and
            // `validateChartBindings` resolves that binding, so an empty
            // universe refuses the fixture with `chart-dataset-unknown` before
            // the READ this file exists to exercise is ever reached.
            //
            // ⛔ Not a relaxation: a report binding a dataset nobody declares is
            // still refused. This gives the fixture a tenant to be valid in —
            // `ReportSchema` refines `dataset` to REQUIRED, so there is no
            // dataset-free report to fall back on. Its measure name is exactly
            // what `bodyFor` selects in `values`. Same shape as the landed
            // `protocol.dashboard-dataset-publish-gate.test.ts` double.
            listItems: (type: string) => (type === 'dataset'
                ? [{
                    name: 'orders_ds',
                    label: 'Orders',
                    object: 'task',
                    dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
                    measures: [{ name: 'order_count', label: 'Orders', aggregate: 'count' }],
                }]
                : []),
            getItem: () => undefined,
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
        /**
         * Plant a LEGACY organization-scoped row (and its change log) at rest,
         * as a door wrote it before ADR-0131 D6 — the protocol now refuses an
         * organization-scoped write (`403 NOT_OVERRIDABLE`).
         */
        plantLegacyOrgRow: async (type: string, name: string, label = LEGACY_MARKER, organizationId = ORG_A) => {
            const repo = new SysMetadataRepository({ engine, organizationId, orgLabel: organizationId });
            const ref = { org: organizationId, type, name } as Parameters<typeof repo.get>[0];
            const head = await repo.get(ref);
            return repo.put(ref, bodyFor(type, name, label), { parentVersion: head?.hash ?? null, actor: null });
        },
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


describe('#9454 · ADR-0131 D6 every REST /meta read door serves what the write door persisted', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    describe('write-then-read agreement on one boot, both branches', () => {
        it.each(ORG_OVERRIDABLE)(
            '%s: the 200 state:active receipt is answered by the direct GET',
            async (type) => {
                const written = await b.put(type, 'authored_at_runtime');
                expect(written.status, `PUT /${type} was not accepted`).toBe(200);
                expect(written.body?.state).toBe('active');

                const read = await b.get(type, 'authored_at_runtime');
                expect(read.thrown, `GET /${type} threw: ${read.thrown?.code}`).toBeUndefined();
                expect(read.status, `GET /${type} did not serve the item`).toBe(200);
                expect(servedDocument(read.body)?.label).toBe(MARKER);
            },
        );

        it.each(ORG_OVERRIDABLE)(
            '%s: the listing contains it too',
            async (type) => {
                await b.put(type, 'authored_at_runtime');
                const listed = await b.list(type);
                expect(listed.status).toBe(200);
                expect(listedNames(listed.body)).toContain('authored_at_runtime');
            },
        );

        it('covers BOTH REST branches, not one — the half-fix guard', async () => {
            await b.put(CACHED_ARM, 'both_arms');
            await b.put(UNCACHED_ARM, 'both_arms');

            const cached = await b.get(CACHED_ARM, 'both_arms');
            const uncached = await b.get(UNCACHED_ARM, 'both_arms');

            expect(servedDocument(cached.body)?.label, 'cached arm (view) lost the overlay').toBe(MARKER);
            expect(servedDocument(uncached.body)?.label, 'uncached arm (dashboard) lost the overlay').toBe(MARKER);
        });
    });

    describe('⭐ the row is environment-wide, and so is who it is served to', () => {
        it.each(ORG_OVERRIDABLE)('%s: an org-active author\'s write persists with organization_id NULL', async (type) => {
            const written = await b.put(type, 'partitioned');
            expect(written.status, `PUT answered ${written.status} ${JSON.stringify(written.body)}`).toBe(200);
            expect(storedRowsFor(b.rows, type, 'partitioned', null).length, 'nothing landed env-wide').toBe(1);
            expect(storedRowsFor(b.rows, type, 'partitioned', ORG_A).length, 'the write went org-scoped').toBe(0);
        });

        it('another organization is served it on the same boot', async () => {
            await b.put(UNCACHED_ARM, 'deployment_wide');
            b.as(ORG_B);
            expect(servedDocument((await b.get(UNCACHED_ARM, 'deployment_wide')).body)?.label).toBe(MARKER);
            expect(listedNames((await b.list(UNCACHED_ARM)).body)).toContain('deployment_wide');
        });

        it('a caller that names no organization is served it', async () => {
            await b.put(CACHED_ARM, 'deployment_wide');
            b.as(undefined);
            expect(servedDocument((await b.get(CACHED_ARM, 'deployment_wide')).body)?.label).toBe(MARKER);
            expect(listedNames((await b.list(CACHED_ARM)).body)).toContain('deployment_wide');
        });

        it('a NON-overridable type reads environment-wide, as before', async () => {
            await b.put(NON_OVERRIDABLE, 'accounts');
            expect(storedRowsFor(b.rows, NON_OVERRIDABLE, 'accounts', null).length).toBe(1);
            const read = await b.get(NON_OVERRIDABLE, 'accounts');
            expect(read.status).toBe(200);
            expect(servedDocument(read.body)?.label).toBe(MARKER);
        });
    });

    describe('⭐ a LEGACY organization-scoped row is served by no read door (environment → code)', () => {
        it.each([CACHED_ARM, UNCACHED_ARM])('%s: shadowed by nothing — its own organization is served the environment row', async (type) => {
            // Fixture proof first: the legacy row really is org-scoped.
            await b.put(type, 'legacy_item');
            await b.plantLegacyOrgRow(type, 'legacy_item');
            expect(storedRowsFor(b.rows, type, 'legacy_item', ORG_A).length, 'the legacy row was not planted').toBe(1);
            expect(storedRowsFor(b.rows, type, 'legacy_item', null).length).toBe(1);

            const read = await b.get(type, 'legacy_item');
            expect(read.status).toBe(200);
            expect(
                servedDocument(read.body)?.label,
                'a legacy org row shadowed the environment save — the writes-first hazard',
            ).toBe(MARKER);
        });

        it.each([CACHED_ARM, UNCACHED_ARM])('%s: alone, it is not served or listed to its own organization', async (type) => {
            await b.plantLegacyOrgRow(type, 'legacy_only');
            expect(storedRowsFor(b.rows, type, 'legacy_only', ORG_A).length, 'the legacy row was not planted').toBe(1);

            const read = await b.get(type, 'legacy_only');
            expect(servedDocument(read.body)?.label, 'a legacy org row was served').not.toBe(LEGACY_MARKER);
            expect(listedNames((await b.list(type)).body)).not.toContain('legacy_only');
        });
    });
});

// ── the history seams of this harness ─────────────────────────────────────
//
// [#13764] This file's stub used to DISCARD `opts.where` on both
// `sys_metadata_history` seams, which made any partition assertion a no-op.
// The stub filters now; ⭐ the legacy case below is what reddens if it is ever
// un-partitioned again (an unfiltered read would serve the org log). The door
// pins for `/history` and `/diff` live in
// `rest-server-meta-history-diff-org-scope.test.ts`.
describe('#13764 · ADR-0131 D6 the history seams serve the environment change log', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    it('serves an org-active author\'s change log, which is environment-wide, to every caller', async () => {
        const first = await b.put(CACHED_ARM, 'authored_at_runtime');
        expect(first.status, 'the fixture never wrote').toBe(200);
        await b.put(CACHED_ARM, 'authored_at_runtime', MARKER_2);
        expect(b.historyRowsFor(CACHED_ARM, 'authored_at_runtime', null).length).toBe(2);
        expect(b.historyRowsFor(CACHED_ARM, 'authored_at_runtime', ORG_A).length).toBe(0);

        for (const who of [ORG_A, ORG_B, undefined]) {
            b.as(who);
            const read = await b.history(CACHED_ARM, 'authored_at_runtime');
            expect(read.thrown, `GET /history threw: ${read.thrown?.message}`).toBeUndefined();
            expect(read.status).toBe(200);
            expect(read.body?.events?.length, `caller ${who ?? 'none'}`).toBe(2);
        }
    });

    it('⭐ does not serve a legacy organization-scoped change log, not even to its own organization', async () => {
        await b.plantLegacyOrgRow(UNCACHED_ARM, 'legacy_logged');
        expect(b.historyRowsFor(UNCACHED_ARM, 'legacy_logged', ORG_A).length, 'no legacy log was planted').toBe(1);

        const read = await b.history(UNCACHED_ARM, 'legacy_logged');
        expect(read.status).toBe(200);
        expect(read.body?.events ?? [], 'a legacy org change log was served').toEqual([]);
    });
});

// ── [#13753 · #15622] `GET /meta/diagnostics` ──────────────────────────────
//
// The cross-type spec-validation sweep behind the Studio governance directory.
// Since ADR-0131 D6 neither arm names an organization: the sweep reads every
// type environment → code — the partition every `/meta` write lands in — for
// every caller, and a legacy organization-scoped row is not swept.
describe('#13753 · ADR-0131 D6 GET /meta/diagnostics sweeps the environment partition', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    it.each(ORG_OVERRIDABLE)('%s: an org-active author\'s item is counted by the ?type= arm', async (type) => {
        const written = await b.put(type, 'authored_at_runtime');
        expect(written.status, `PUT /${type} was not accepted`).toBe(200);
        const swept = await b.diagnostics({ type });
        expect(swept.thrown, `GET /diagnostics threw: ${swept.thrown?.message}`).toBeUndefined();
        expect(swept.status).toBe(200);
        expect(swept.body?.scannedTypes, 'the ?type= arm swept more than the named type').toBe(1);
        expect(swept.body?.stats?.[type]?.count).toBe(1);
    });

    it('a plural URL spelling sweeps the same item', async () => {
        await b.put(CACHED_ARM, 'authored_at_runtime');
        const swept = await b.diagnostics({ type: 'views' });
        expect(swept.status).toBe(200);
        expect(swept.body?.stats?.views?.count).toBe(1);
    });

    it('every caller — another organization, none — is swept over it, on both arms', async () => {
        await b.put(UNCACHED_ARM, 'deployment_wide');
        for (const who of [ORG_B, undefined]) {
            b.as(who);
            expect((await b.diagnostics({ type: UNCACHED_ARM })).body?.stats?.[UNCACHED_ARM]?.count, `typed, ${who ?? 'none'}`).toBe(1);
            expect((await b.diagnostics()).body?.stats?.[UNCACHED_ARM]?.count, `untyped, ${who ?? 'none'}`).toBe(1);
        }
    });

    it('⭐ a legacy organization-scoped item is not swept, not even for its own organization, on either arm', async () => {
        await b.plantLegacyOrgRow(CACHED_ARM, 'legacy_only');
        expect(storedRowsFor(b.rows, CACHED_ARM, 'legacy_only', ORG_A).length, 'the legacy row was not planted').toBe(1);

        const typed = await b.diagnostics({ type: CACHED_ARM });
        expect(typed.status).toBe(200);
        expect(typed.body?.stats?.[CACHED_ARM]?.count ?? 0).toBe(0);
        const untyped = await b.diagnostics();
        expect(untyped.status).toBe(200);
        expect(untyped.body?.scannedTypes, 'the untyped arm did not sweep the registry').toBeGreaterThan(1);
        expect(untyped.body?.stats?.[CACHED_ARM]?.count ?? 0).toBe(0);
    });

    it('?type=object does not resurrect a pre-#6190 phantom org row either', async () => {
        const written = await b.put(NON_OVERRIDABLE, 'accounts');
        expect(written.status, 'the control never wrote').toBe(200);
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
        expect(storedRowsFor(b.rows, NON_OVERRIDABLE, 'phantom_orders', ORG_A).length).toBe(1);

        const swept = await b.diagnostics({ type: NON_OVERRIDABLE });
        expect(swept.status).toBe(200);
        expect(swept.body?.stats?.[NON_OVERRIDABLE]?.count).toBe(1);
    });

    it('the response is the SAME wire shape — no new key, and 200 either way', async () => {
        await b.put(CACHED_ARM, 'authored_at_runtime');
        const swept = await b.diagnostics();
        expect(swept.status).toBe(200);
        expect(Object.keys(swept.body ?? {}).sort()).toEqual(
            ['entries', 'scannedItems', 'scannedTypes', 'stats', 'total'],
        );
        expect(Object.keys(swept.body?.stats?.[CACHED_ARM] ?? {}).sort()).toEqual(
            ['count', 'locked', 'packages'],
        );
        expect(typeof swept.body?.total).toBe('number');
    });
});

// ── [#13753 · ADR-0131 D6] `GET /meta/:type/:name/references` ──────────────
//
// `findReferencesToMeta` backs the admin "Used by" panel an operator reads
// before a delete. Since ADR-0131 D6 it reads its SOURCES environment → code,
// the world the `/meta` doors serve: an environment `view` that references the
// object is found for every caller, and a legacy organization-scoped source is
// not swept (no door serves it until ADR-0131 C7 promotes it, and that
// ceremony re-judges what it carries).
describe('#13753 · ADR-0131 D6 GET /meta/:type/:name/references sweeps the environment sources', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    interface RefRow { type: string; name: string; label?: string; path: string; kind: string }
    const rowsOf = (body: any): RefRow[] => (body?.references ?? []) as RefRow[];
    const namesOf = (body: any, type: string) => rowsOf(body).filter((r) => r.type === type).map((r) => r.name);

    it('⭐ an org-active author\'s `view` that references the object is FOUND, for every caller', async () => {
        const written = await b.put(CACHED_ARM, 'task_list');
        expect(written.status, 'the view was never written').toBe(200);
        expect(storedRowsFor(b.rows, CACHED_ARM, 'task_list', null).length).toBe(1);

        for (const who of [ORG_A, ORG_B, undefined]) {
            b.as(who);
            const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
            expect(used.thrown, `the door threw: ${used.thrown?.message}`).toBeUndefined();
            expect(used.status).toBe(200);
            expect(namesOf(used.body, CACHED_ARM), `caller ${who ?? 'none'}`).toContain('task_list');
        }
    });

    it('a legacy organization-scoped source is not swept', async () => {
        await b.plantLegacyOrgRow(CACHED_ARM, 'legacy_task_list');
        expect(storedRowsFor(b.rows, CACHED_ARM, 'legacy_task_list', ORG_A).length, 'the legacy row was not planted').toBe(1);
        const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
        expect(used.status).toBe(200);
        expect(namesOf(used.body, CACHED_ARM)).not.toContain('legacy_task_list');
    });

    it('a non-overridable SOURCE stays env-wide — no phantom row is resurrected', async () => {
        const written = await b.put(NON_OVERRIDABLE, 'env_orders');
        expect(written.status, 'the control never wrote').toBe(200);
        const envRow = storedRowsFor(b.rows, NON_OVERRIDABLE, 'env_orders', null);
        expect(envRow.length).toBe(1);
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
        const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
        expect(used.status).toBe(200);
        expect(namesOf(used.body, NON_OVERRIDABLE), 'the env-wide source was not swept').toContain('env_orders');
        expect(namesOf(used.body, NON_OVERRIDABLE)).not.toContain('phantom_orders');
    });

    it('the response is the SAME wire shape — one `references` key, no new field', async () => {
        await b.put(CACHED_ARM, 'task_list');
        const used = await b.references(NON_OVERRIDABLE, TARGET_OBJECT);
        expect(used.status).toBe(200);
        expect(Object.keys(used.body ?? {})).toEqual(['references']);
        expect(rowsOf(used.body).find((r) => r.name === 'task_list')).toEqual({
            type: CACHED_ARM, name: 'task_list', label: MARKER, path: 'object', kind: 'view object',
        });
    });

    it('the #9327 unanswerable-target refusal keeps its code and status', async () => {
        // Read through both refusal dialects on purpose: the envelope itself is
        // pinned by `rest-server-meta-references-refusal-envelope.test.ts`; what
        // this pin measures is that a scope change moves neither code nor status.
        const refused = await b.references('field', 'account.owner');
        const body = refused.body as any;
        const observed = refused.thrown
            ? { status: refused.thrown.status, code: refused.thrown.code }
            : { status: refused.status, code: body?.error?.code ?? body?.code };
        expect(observed).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
    });
});
