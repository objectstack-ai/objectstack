// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D6, C5 stage S3] `GET /meta/:type/:name/history` and
// `GET /meta/:type/:name/diff` read the ENVIRONMENT partition of
// `sys_metadata_history`, for every caller.
//
// History. #13406 found both doors naming no organization while the write
// doors threaded one for the five `allowOrgOverride` types, so an org-scoped
// overlay's log answered `{ events: [] }`; the doors then named the caller's
// organization (gated by `organizationIdForMetaRead`). ADR-0131 D6 retires the
// per-organization overlay axis: no `/meta` write names an organization, so
// every log lives in the environment partition, and these doors read it — for
// the author's organization, another one, or none. A LEGACY organization-scoped
// log (planted straight through the protocol) is served by neither door, not
// even to its own organization, until ADR-0131 C7 promotes it.
//
// Both doors read the table by STRICT equality on `organization_id`
// (`SysMetadataRepository.history()`, `diffMetaItem`'s own `find`), and this
// harness's stub HONOURS that `where`, so the legacy cases below are the ones
// that redden if a door starts naming an organization again.

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, SysMetadataRepository } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/** The five types the registry declares `allowOrgOverride: true`. */
const ORG_OVERRIDABLE = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;

/**
 * `allowOrgOverride: false` **and** `allowRuntimeCreate: true` — the
 * combination that makes this the discriminating control rather than
 * decoration. Its writes have always landed ENV-WIDE, even for a session with
 * an active org, so its history lives in the env partition. A type that could
 * not be written at runtime at all would have no history either way.
 */
const NON_OVERRIDABLE = 'object';

const MARKER = 'AUTHORED_AT_RUNTIME';
const MARKER_2 = 'AUTHORED_AT_RUNTIME_REV2';

/**
 * A SPEC-VALID body per type, carrying `label` as the marker. Real bodies, not
 * `{ label }` stubs: the write door runs full spec validation
 * (`INVALID_METADATA`, 422), so a thin fixture never reaches the store and
 * every assertion below would fail for a reason unrelated to org scoping.
 */
function bodyFor(type: string, name: string, label = MARKER): Record<string, unknown> {
    const marker = { name, label };
    switch (type) {
        case 'view':
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

// ── stub engine — `sys_metadata_history` IS PARTITIONED ───────────────────

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
            // Conjoined with its siblings, not early-returned: the loop
            // CONTINUES, so the remaining keys still have to match.
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        // ⛔ REFUSE any other combinator rather than reading it as a field
        // name. `$or` is the only one the read paths under test emit
        // (`auditMetaItem`'s union, and the repository's draft lookup), and a
        // double that answered `$and` by looking for a column literally called
        // `$and` would return a well-formed WRONG answer — the silent class
        // `check:where-matcher` exists to catch. Refusing loudly is the
        // convention most doubles in this repo already follow.
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
                // ⭐ Honours the `where` — `organization_id` included. The
                // sibling read-scope harness returns `null` unconditionally
                // here, which is why it cannot see this card's defect.
                return historyRows.find(
                    (h) => matchesWhere(h as unknown as Record<string, unknown>, opts.where),
                ) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            // ⛔ THE CALLER'S BOUND IS HELD, and applied AFTER the filter.
            // `/history` accepts `?limit=` and threads it all the way down, so
            // `limit` is a contract member of the very door this file pins — a
            // double that silently ignored it would sit GREEN through a
            // regression that dropped the bound on the way to
            // `historyMetaItem`. That is the identical argument to refusing an
            // unknown `$` combinator above: a parameter the door really
            // carries, answered wrongly but well-formedly, is the failure this
            // whole file exists to make impossible. Applied on BOTH tables so
            // the two branches cannot disagree.
            //
            // AFTER the filter, never before: bounding first would decide which
            // rows survive the predicate rather than how many of the survivors
            // are returned. By PRESENCE (`typeof === 'number'`), so the calls
            // that pass no bound — every call the repository makes today, since
            // `SysMetadataRepository.history()` applies `limit` itself while
            // iterating rather than pushing it into the engine — are untouched
            // and every existing assertion keeps its meaning.
            // `check:objectql-double-limit`.
            if (table === 'sys_metadata_history') {
                // ⭐ THE POSITIVE CONTROL'S FOUNDATION. `history()` and
                // `diffMetaItem` both filter `organization_id` by strict
                // equality, so an unfiltered stub answers every read
                // identically and no org-scoping assertion here could ever
                // fail. Partitioning the stub is what makes the door's
                // behaviour observable at all.
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
            rows.set(keyOf(merged as unknown as Record<string, unknown>), merged);
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
         * A LEGACY organization-scoped write, as a door made one before ADR-0131 D6,
         * planted at rest — the protocol now refuses it (`403 NOT_OVERRIDABLE`).
         */
        plantLegacyOrgRow: async (type: string, name: string, label = MARKER, organizationId = ORG_A) => {
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
        history: (type: string, name: string, query: Record<string, unknown> = {}) =>
            drive('GET', `${META}/:type/:name/history`, { params: { type, name }, query }),
        diff: (type: string, name: string, query: Record<string, unknown> = {}) =>
            drive('GET', `${META}/:type/:name/diff`, { params: { type, name }, query }),
        /** ⭐ The fixture proof every read assertion below is gated on. */
        historyRowsFor: (type: string, name: string, org: string | null) =>
            historyRows.filter((h) => h.type === type && h.name === name
                && (h.organization_id ?? null) === org),
    };
}

function servedDocument(body: any): any {
    if (!body || typeof body !== 'object') return undefined;
    return body.item ?? body.data ?? body;
}

describe('#13406 · ADR-0131 D6 the /history and /diff read doors read the environment partition', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    describe('⭐ fixture first — an org-active author\'s PUT logs environment-wide', () => {
        it.each(ORG_OVERRIDABLE)(
            '%s: a PUT under an active org appends an ENV history row, and none org-scoped',
            async (type) => {
                const written = await b.put(type, 'authored_at_runtime');
                expect(written.status, `PUT /${type} was not accepted`).toBe(200);
                expect(written.body?.state).toBe('active');
                expect(b.historyRowsFor(type, 'authored_at_runtime', null).length, 'nothing logged env-wide').toBe(1);
                expect(b.historyRowsFor(type, 'authored_at_runtime', ORG_A).length, 'the write logged org-scoped').toBe(0);
            },
        );
    });

    describe('/history serves the environment change log to every caller', () => {
        it.each(ORG_OVERRIDABLE)('%s: the events come back for the author\'s org, another org and none', async (type) => {
            await b.put(type, 'authored_at_runtime');
            await b.put(type, 'authored_at_runtime', MARKER_2);
            expect(b.historyRowsFor(type, 'authored_at_runtime', null).length).toBe(2);

            for (const who of [ORG_A, ORG_B, undefined]) {
                b.as(who);
                const read = await b.history(type, 'authored_at_runtime');
                expect(read.thrown, `GET /${type}/history threw: ${read.thrown?.message}`).toBeUndefined();
                expect(read.status).toBe(200);
                expect(read.body?.events?.map((ev: any) => ev.version), `caller ${who ?? 'none'}`).toEqual([1, 2]);
            }
        });
    });

    describe('/history honours the caller\'s bound', () => {
        it('?limit=1 over a two-revision log returns exactly the first event', async () => {
            await b.put('view', 'bounded');
            await b.put('view', 'bounded', MARKER_2);
            expect(b.historyRowsFor('view', 'bounded', null).map((h) => h.version)).toEqual([1, 2]);

            // The CONTROL, without which "1 event came back" proves nothing.
            const all = await b.history('view', 'bounded');
            expect(all.body?.events?.length, 'the unbounded control did not see both revisions').toBe(2);

            const bounded = await b.history('view', 'bounded', { limit: '1' });
            expect(bounded.thrown, `bounded read threw: ${bounded.thrown?.message}`).toBeUndefined();
            expect(bounded.status).toBe(200);
            expect(bounded.body?.events?.length, 'the caller\'s ?limit= was dropped').toBe(1);
            // Oldest-first, so a bound of 1 keeps revision 1.
            expect(bounded.body.events[0].version).toBe(1);
        });
    });

    describe('/diff resolves the environment revisions', () => {
        it.each(ORG_OVERRIDABLE)('%s: ?from=1&to=2 compares the two revisions, for every caller', async (type) => {
            await b.put(type, 'two_revisions');
            await b.put(type, 'two_revisions', MARKER_2);
            expect(b.historyRowsFor(type, 'two_revisions', null).map((h) => h.version)).toEqual([1, 2]);

            for (const who of [ORG_A, ORG_B, undefined]) {
                b.as(who);
                const read = await b.diff(type, 'two_revisions', { from: '1', to: '2' });
                expect(read.thrown, `GET /${type}/diff threw: ${read.thrown?.message}`).toBeUndefined();
                expect(read.status).toBe(200);
                expect(read.body?.fromVersion).toBe(1);
                expect(read.body?.toVersion).toBe(2);
                expect(read.body?.changed, `caller ${who ?? 'none'}`).toContainEqual({ path: 'label', from: MARKER, to: MARKER_2 });
            }
        });
    });

    describe('⛔ controls', () => {
        it('serves a NON-overridable type\'s env-wide history to an org session, as before', async () => {
            const written = await b.put(NON_OVERRIDABLE, 'accounts');
            expect(written.status, 'the control never wrote').toBe(200);
            expect(b.historyRowsFor(NON_OVERRIDABLE, 'accounts', null).length).toBe(1);

            const read = await b.history(NON_OVERRIDABLE, 'accounts');
            expect(read.status).toBe(200);
            expect(read.body?.events?.length).toBe(1);
        });

        it('⭐ a LEGACY organization-scoped log is served by neither door, not even to its own organization', async () => {
            await b.plantLegacyOrgRow('dashboard', 'legacy_logged');
            await b.plantLegacyOrgRow('dashboard', 'legacy_logged', MARKER_2);
            expect(
                b.historyRowsFor('dashboard', 'legacy_logged', ORG_A).length,
                'the legacy log was not planted; the case proves nothing',
            ).toBe(2);

            const read = await b.history('dashboard', 'legacy_logged');
            expect(read.status).toBe(200);
            expect(read.body?.events ?? [], 'a legacy org change log was served').toEqual([]);

            const diffed = await b.diff('dashboard', 'legacy_logged', { from: '1', to: '2' });
            expect(diffed.status).toBe(200);
            expect(diffed.body?.changed ?? [], 'a diff of legacy org revisions was served').toEqual([]);
        });
    });

    describe('the single-item read beside them', () => {
        it('the dashboard read serves the environment overlay an org-active author saved', async () => {
            const written = await b.put('dashboard', 'system_overview');
            expect(written.status).toBe(200);
            const row = Array.from(b.rows.values()).find((r) => r.name === 'system_overview');
            expect(row?.organization_id ?? null, 'the overlay went org-scoped').toBe(null);

            const read = await b.get('dashboard', 'system_overview');
            expect(read.status).toBe(200);
            expect(servedDocument(read.body)?.label).toBe(MARKER);
        });
    });
});
