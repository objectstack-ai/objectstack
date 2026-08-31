// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13406 — `GET /meta/:type/:name/history` and `GET /meta/:type/:name/diff`
// named no organization, so both read the ENV partition of a per-org table. An
// item whose overlay was authored org-scoped answered `{ events: [] }` and an
// all-empty diff while `sys_metadata_history` held its full log. Direction is
// fail-closed — the caller's OWN org data is under-served; there is no
// cross-org read, and the controls at the bottom of this file are what keep it
// that way.
//
// ── Why these two doors and not "the read path" ───────────────────────────
//
// Every OTHER `/meta` read door already states the scope: the single-item read
// and the listing (#9454), `/layers` (#9454), `/published`, `/_drafts`, and the
// audit twin (#8747). These two were the residue. `protocol.ts` is not at
// fault and is not touched: `request.organizationId ?? null` is the legitimate
// spelling of "env partition", and every correct caller depends on it.
//
// ── ⭐ Why `organizationIdForMetaRead` and NOT the audit twin's expression ──
//
// The audit door passes a RAW `ctx?.tenantId ?? null`, and copying that here
// looks like the obvious repair. It is wrong twice, and both halves are
// asserted below rather than argued:
//
//  1. `auditMetaItem` reads with `$or: [{organization_id: org}, {organization_id:
//     null}]` — a UNION, so naming an org there can only add rows. These two
//     doors read `sys_metadata_history` with strict equality
//     (`SysMetadataRepository.history()` and `diffMetaItem`'s own `find`, both
//     `organization_id: orgId`, no `$or`). Under strict equality a raw tenant id
//     asks the ORG partition for the history of the types whose rows land
//     ENV-WIDE — every `allowOrgOverride: false` type that is still
//     runtime-writable, because `organizationIdForMetaWrite` writes those
//     env-wide by the #6190 ruling. `object` is the measured specimen, and
//     `serves a NON-overridable type's env-wide history to an org session` is
//     the assertion that reddens under that ablation. Predicted before running
//     it, and it is the whole reason this file exists in this shape.
//  2. `HistoryMetaItemRequestSchema` declares `organizationId:
//     z.string().optional()` — optional plain string, NOT nullable, mirroring
//     the implementation's `organizationId?: string`. `?? null` on the history
//     door is a TS2353 compile error; on the diff door — reached through
//     `(p as any)` — it type-checks and is a silent RUNTIME no-op, since
//     `null ?? null` is `null`. Hence the omit-spread on both.
//
// ── Why the harness is the REAL protocol, not a spy ───────────────────────
//
// A spy asserting "the door passed `organizationId`" cannot tell a fix from a
// fix-shaped no-op. The claim is write-then-READ AGREEMENT, so the rows have to
// land in a partition and come back out of it. These drive real REST routes
// against a real `ObjectStackProtocolImplementation` over a stub engine whose
// `sys_metadata_history` table HONOURS the `where` — including
// `organization_id`. That is the load-bearing difference from
// `rest-server-meta-read-org-scope.test.ts`, whose stub returns every history
// row unfiltered: over that engine both doors pass with or without the fix,
// because there is no partition to miss.
//
// ⭐ Every read assertion is preceded by a FIXTURE PROOF that the org-scoped
// history row exists (`historyRowsFor`). "The read is org-scoped" is worthless
// if the fixture never created an org-scoped row, and the card's own repro bar
// was "confirm the pg rows exist before hitting the read door".

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';

/** The five types the registry declares `allowOrgOverride: true`. */
const ORG_OVERRIDABLE = ['view', 'dashboard', 'report', 'translation', 'email_template'] as const;

/**
 * `allowOrgOverride: false` **and** `allowRuntimeCreate: true` — the
 * combination that makes this the discriminating control rather than
 * decoration. Its writes land ENV-WIDE even for a session with an active org
 * (`organizationIdForMetaWrite`), so its history lives in the env partition and
 * an org-scoped read of it finds nothing. A type that could not be written at
 * runtime at all would have no history either way and would prove nothing.
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
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (k === 'context') continue;
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
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                // ⭐ THE POSITIVE CONTROL'S FOUNDATION. `history()` and
                // `diffMetaItem` both filter `organization_id` by strict
                // equality, so an unfiltered stub answers every read
                // identically and no org-scoping assertion here could ever
                // fail. Partitioning the stub is what makes the door's
                // behaviour observable at all.
                return historyRows.filter(
                    (h) => matchesWhere(h as unknown as Record<string, unknown>, opts?.where ?? {}),
                );
            }
            return Array.from(rows.values()).filter(
                (r) => matchesWhere(r as unknown as Record<string, unknown>, opts?.where ?? {}),
            );
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
            listItems: () => [], getItem: () => undefined,
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
        as(tenantId: string | undefined) {
            session = tenantId === undefined
                ? { userId: 'u1', systemPermissions: ['manage_metadata'] }
                : { userId: 'u1', systemPermissions: ['manage_metadata'], tenantId };
        },
        put: (type: string, name: string, label = MARKER) =>
            drive('PUT', `${META}/:type/:name`, { params: { type, name }, body: bodyFor(type, name, label) }),
        get: (type: string, name: string) =>
            drive('GET', `${META}/:type/:name`, { params: { type, name } }),
        history: (type: string, name: string) =>
            drive('GET', `${META}/:type/:name/history`, { params: { type, name } }),
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

describe('#13406 the /history and /diff read doors state the org partition', () => {
    let b: ReturnType<typeof boot>;
    beforeEach(() => { b = boot(); });

    describe('⭐ fixture first — the org-scoped rows exist before any door is read', () => {
        it.each(ORG_OVERRIDABLE)(
            '%s: a PUT under an active org appends an ORG-SCOPED history row, and none env-wide',
            async (type) => {
                const written = await b.put(type, 'authored_at_runtime');
                expect(written.status, `PUT /${type} was not accepted`).toBe(200);
                expect(written.body?.state).toBe('active');

                const orgRows = b.historyRowsFor(type, 'authored_at_runtime', ORG_A);
                const envRows = b.historyRowsFor(type, 'authored_at_runtime', null);
                expect(
                    orgRows.length,
                    'nothing landed in the org partition; every read assertion below would '
                    + 'then pass or fail for a reason that has nothing to do with org scoping',
                ).toBe(1);
                // The other half of the premise: the rows are NOT in the env
                // partition, which is exactly why an org-blind door missed them.
                expect(envRows.length, 'the write also landed env-wide — the partition is not real').toBe(0);
            },
        );
    });

    describe('/history serves the org-scoped change log', () => {
        it.each(ORG_OVERRIDABLE)('%s: the events the org authored come back', async (type) => {
            await b.put(type, 'authored_at_runtime');
            await b.put(type, 'authored_at_runtime', MARKER_2);
            expect(b.historyRowsFor(type, 'authored_at_runtime', ORG_A).length).toBe(2);

            const read = await b.history(type, 'authored_at_runtime');
            expect(read.thrown, `GET /${type}/history threw: ${read.thrown?.message}`).toBeUndefined();
            expect(read.status).toBe(200);
            expect(
                read.body?.events?.length,
                'the door answered an empty change log for an item whose org partition holds two events',
            ).toBe(2);
            expect(read.body.events.map((e: any) => e.version)).toEqual([1, 2]);
        });
    });

    describe('/diff resolves org-scoped versions', () => {
        it.each(ORG_OVERRIDABLE)('%s: ?from=1&to=2 compares the two org revisions', async (type) => {
            await b.put(type, 'two_revisions');
            await b.put(type, 'two_revisions', MARKER_2);
            expect(b.historyRowsFor(type, 'two_revisions', ORG_A).map((h) => h.version)).toEqual([1, 2]);

            const read = await b.diff(type, 'two_revisions', { from: '1', to: '2' });
            expect(read.thrown, `GET /${type}/diff threw: ${read.thrown?.message}`).toBeUndefined();
            expect(read.status).toBe(200);
            expect(read.body?.fromVersion).toBe(1);
            expect(read.body?.toVersion).toBe(2);
            // The card's shape: bounds echoed but every bucket empty, because
            // neither body could be resolved out of the env partition.
            expect(
                read.body?.changed,
                'the diff resolved no bodies — the card\'s all-empty answer',
            ).toContainEqual({ path: 'label', from: MARKER, to: MARKER_2 });
        });
    });

    describe('⛔ controls — the scope is STATED, never widened', () => {
        it('serves a NON-overridable type\'s env-wide history to an org session', async () => {
            // ⭐ THE ABLATION TARGET, and the reason this door uses
            // `organizationIdForMetaRead` rather than a raw `ctx?.tenantId`.
            // `object` is `allowOrgOverride: false` + `allowRuntimeCreate: true`,
            // so `organizationIdForMetaWrite` puts its history ENV-WIDE even
            // though ORG_A is active. A door that named the tenant
            // unconditionally would query the org partition and answer
            // `{ events: [] }` — reintroducing this very card one type family
            // over. PREDICTED DIRECTION: swap the predicate for
            // `ctx?.tenantId ?? null` and this test, and only this test, turns
            // red.
            const written = await b.put(NON_OVERRIDABLE, 'accounts');
            expect(written.status, 'the control never wrote').toBe(200);
            expect(
                b.historyRowsFor(NON_OVERRIDABLE, 'accounts', null).length,
                'a non-overridable write went org-scoped; the control no longer controls anything',
            ).toBe(1);
            expect(b.historyRowsFor(NON_OVERRIDABLE, 'accounts', ORG_A).length).toBe(0);

            const read = await b.history(NON_OVERRIDABLE, 'accounts');
            expect(read.status).toBe(200);
            expect(
                read.body?.events?.length,
                'the org session lost sight of an env-wide change log it could read before',
            ).toBe(1);
        });

        it('still serves env-scoped rows to an env-scoped caller', async () => {
            // The other direction of the same harness: nothing about naming the
            // org for org callers may disturb the org-less read that worked all
            // along.
            b.as(undefined);
            await b.put('view', 'env_authored');
            expect(b.historyRowsFor('view', 'env_authored', null).length).toBe(1);

            const read = await b.history('view', 'env_authored');
            expect(read.status).toBe(200);
            expect(read.body?.events?.length, 'an env-scoped caller lost its own history').toBe(1);
        });

        it('does not serve org A history to org B on the same boot', async () => {
            await b.put('dashboard', 'tenant_bound');
            await b.put('dashboard', 'tenant_bound', MARKER_2);
            expect(b.historyRowsFor('dashboard', 'tenant_bound', ORG_A).length).toBe(2);

            b.as(ORG_B);
            const read = await b.history('dashboard', 'tenant_bound');
            expect(read.status).toBe(200);
            expect(read.body?.events ?? [], 'org B was served org A\'s change log').toEqual([]);

            const diffed = await b.diff('dashboard', 'tenant_bound', { from: '1', to: '2' });
            expect(diffed.status).toBe(200);
            expect(diffed.body?.changed ?? [], 'org B was served a diff of org A\'s revisions').toEqual([]);
        });

        it('does not serve an org row to a caller that named no org', async () => {
            await b.put('view', 'org_a_only');
            expect(b.historyRowsFor('view', 'org_a_only', ORG_A).length).toBe(1);

            b.as(undefined);
            const read = await b.history('view', 'org_a_only');
            expect(read.status).toBe(200);
            expect(
                read.body?.events ?? [],
                'an org-less caller was served an org-scoped change log',
            ).toEqual([]);
        });
    });

    describe('the card\'s third symptom, RE-MEASURED on today\'s main', () => {
        it('single-item dashboard read ALREADY serves the org overlay — premise falsified', async () => {
            // #13406 symptom 3 claimed `GET /meta/dashboard/:name` ignores an
            // org-scoped overlay. That door was threaded by #9454/#9727 before
            // this card was filed; the uncached arm `dashboard` takes carries
            // `readOrganizationId` today. Pinned HERE, next to the two doors
            // that were genuinely open, so the falsification is auditable
            // rather than a claim in a report. (The behaviour itself is owned
            // by `rest-server-meta-read-org-scope.test.ts`; this asserts the
            // narrow fact the card disputes.)
            const written = await b.put('dashboard', 'system_overview');
            expect(written.status).toBe(200);
            const row = Array.from(b.rows.values()).find((r) => r.name === 'system_overview');
            expect(row?.organization_id, 'the overlay is not org-scoped; nothing is being measured').toBe(ORG_A);

            const read = await b.get('dashboard', 'system_overview');
            expect(read.status).toBe(200);
            expect(
                servedDocument(read.body)?.label,
                'the single-item dashboard read did NOT serve the org overlay — symptom 3 is live after all',
            ).toBe(MARKER);
        });
    });
});
