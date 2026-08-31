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

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: any[] = [];
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
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return historyRows;
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {}));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                historyRows.push({ ...data, id: `h_${nextId}` });
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
