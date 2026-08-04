// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { identityFreeEndpointGateFailure, ApiEndpointSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * Regression for #5206 step 2 (engine half) — `publishPackageDrafts` runs the
 * ADR-0121 / #5040 E7 endpoint publish gates on `api` drafts.
 *
 * ## What was open
 *
 * `protocol.publishPackageDrafts` is the REAL entry point behind Studio's
 * "publish everything" (ADR-0033 / ADR-0067 D2). Its only type-aware pre-flight
 * was the object namespace-prefix rule (`validateObjectNamespacePrefix`, gated
 * on `d.type === 'object'`), so an `api` draft was promoted draft→active having
 * met no gate at all — the same shape #5189 closed on
 * `MetadataManager.publishPackage`, one path over.
 *
 * The SECURITY consequence was already contained by PR #5203: the endpoint
 * matcher re-judges every stored item at index-build time with the same
 * `firstFailure`, so an anonymous zero-quota endpoint that skipped publish is
 * EXCLUDED from the index and named at `error` level. What was still broken is
 * WHEN the author is told: ADR-0121 says publish refuses, and the author is
 * owed a prescription naming the offending key at publish time — not a line in
 * a boot log. These tests pin the earlier door; the last one is asserted to
 * still be there (`identityFreeEndpointGateFailure`, bottom of the file).
 *
 * ## Failure granularity — mirrored, not invented
 *
 * The pre-existing posture for a namespace-prefix violation is a WHOLE-BATCH
 * refusal found before anything is promoted: `success: false`,
 * `publishedCount: 0`, `published: []`, every violation in `failed[]`. The
 * endpoint gate joins that same pre-flight and behaves identically (ADR-0067
 * D2's "a commit cannot half-land", and what #5189 does on the sibling path
 * with `itemsPublished: 0`). Tests below assert the healthy siblings of a bad
 * `api` draft stay drafts.
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
    updated_at?: string;
    created_at?: string;
}

interface HistoryRow {
    id: string;
    event_seq: number;
    name: string;
    type: string;
    version: number;
    operation_type: string;
    metadata: string | null;
    checksum: string | null;
    previous_checksum: string | null;
    change_note?: string | null;
    source?: string | null;
    organization_id: string | null;
    recorded_by?: string | null;
    recorded_at: string;
}

// Overlay rows are keyed by the ADR-0048 key (type, name, org, state, package).
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** Does row `r` satisfy `where` (top-level eq + `$or` + `organization_id IS NULL`)? */
function matchesMetadataWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesMetadataWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

/**
 * @param namespace the package's declared `manifest.namespace`, or `undefined`
 *   to model a package that declares none (`getPackage` → undefined).
 */
function makeStubEngine(namespace?: string) {
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
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesMetadataWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') {
                return historyRows.filter((h) => matchesHistory(h, opts.where));
            }
            return Array.from(rows.values()).filter((r) => matchesMetadataWhere(r, opts.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h: HistoryRow = { id: `h_${nextId}`, ...(data as any) };
                historyRows.push(h);
                return { id: h.id };
            }
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any) => Promise<T>): Promise<T> {
            return cb(undefined);
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () =>
                namespace === undefined ? undefined : { manifest: { id: 'app.showcase', namespace } },
        },
    };
    return { engine, rows };
}

const PKG = 'app.showcase';

/** A fully legal endpoint under the `showcase` carve-out (ADR-0121 D1). */
const validEndpoint = (over: Record<string, unknown> = {}) => ({
    name: 'list_things',
    path: '/api/v1/apps/showcase/things',
    method: 'GET',
    type: 'object_operation',
    target: 'showcase_thing',
    objectParams: { object: 'showcase_thing', operation: 'find' },
    ...over,
});

const objectBody = (name: string) => ({
    name,
    label: 'Thing',
    fields: { title: { type: 'text', label: 'Title' } },
});

/** Save one `api` draft the way the ungated Studio direct-write path does. */
async function saveApiDraft(
    protocol: ObjectStackProtocolImplementation,
    name: string,
    item: unknown,
): Promise<void> {
    await protocol.saveMetaItem({ type: 'api', name, item: item as any, packageId: PKG, mode: 'draft' });
}

const draftRows = (rows: Map<string, Row>) => Array.from(rows.values()).filter((r) => r.state === 'draft');
const activeRows = (rows: Map<string, Row>) => Array.from(rows.values()).filter((r) => r.state === 'active');

describe('publishPackageDrafts — the ADR-0121 endpoint publish gate (#5206 step 2)', () => {
    it('refuses an anonymous, unmetered `api` draft (D6) and NAMES the key to fix', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        // The exact shape ADR-0121 D6 exists to prevent, and the one the
        // runtime honours faithfully: anonymous + no armed budget.
        await saveApiDraft(protocol, 'open_things', validEndpoint({ name: 'open_things', authRequired: false }));

        // Before this fix: { success: true, publishedCount: 1 } — promoted
        // straight to active, ungated.
        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 1 });
        expect(res.published).toEqual([]);
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'api', name: 'open_things', code: 'ENDPOINT_GATE' });
        // The gate's OWN message — named endpoint, named key, prescription.
        expect(res.failed[0].error).toContain("Endpoint 'open_things'");
        expect(res.failed[0].error).toContain('`authRequired: false` without an ARMED rate limit');
        expect(res.failed[0].error).toContain('rateLimit: { enabled: true');

        // Nothing was promoted: the draft is still a draft.
        expect(activeRows(rows)).toHaveLength(0);
        expect(draftRows(rows).map((r) => r.name)).toEqual(['open_things']);
    });

    it('a `rateLimit` that is present but NOT armed is still refused (D6 is not a presence check)', async () => {
        const { engine } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await saveApiDraft(
            protocol,
            'open_things',
            validEndpoint({
                name: 'open_things',
                authRequired: false,
                // `enabled` defaults to false → a budget that meters nothing.
                rateLimit: { windowMs: 60000, maxRequests: 100 },
            }),
        );

        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 1 });
        expect(res.failed[0].error).toContain('`enabled` is not `true`');
    });

    it('publishes a valid `api` draft (the gate refuses shapes, not the type)', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await saveApiDraft(protocol, 'list_things', validEndpoint());

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.failed).toEqual([]);
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(res.published.map((p) => p.name)).toEqual(['list_things']);
        expect(draftRows(rows)).toHaveLength(0);
        expect(activeRows(rows).map((r) => r.name)).toEqual(['list_things']);
    });

    it('an anonymous endpoint WITH an armed budget publishes (D6 is satisfiable, not a ban)', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await saveApiDraft(
            protocol,
            'open_things',
            validEndpoint({
                name: 'open_things',
                authRequired: false,
                rateLimit: { enabled: true, windowMs: 60000, maxRequests: 100 },
            }),
        );

        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(activeRows(rows).map((r) => r.name)).toEqual(['open_things']);
    });

    it('refuses a path outside the stack carve-out, and a duplicate METHOD+path claim', async () => {
        const { engine } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await saveApiDraft(
            protocol,
            'stray',
            validEndpoint({ name: 'stray', path: '/api/v1/things' }),
        );
        const strayRes = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(strayRes).toMatchObject({ success: false, publishedCount: 0, failedCount: 1 });
        expect(strayRes.failed[0].error).toContain("not inside this stack's endpoint carve-out");
        expect(strayRes.failed[0].error).toContain('/api/v1/apps/showcase/');

        // Two drafts in ONE batch claiming the same METHOD + normalized path.
        const dup = makeStubEngine('showcase');
        const dupProtocol = new ObjectStackProtocolImplementation(dup.engine);
        await saveApiDraft(dupProtocol, 'a_things', validEndpoint({ name: 'a_things' }));
        await saveApiDraft(
            dupProtocol,
            'b_things',
            validEndpoint({ name: 'b_things', path: '/api/v1/apps/showcase/things/' }),
        );
        const dupRes = await dupProtocol.publishPackageDrafts({ packageId: PKG });
        expect(dupRes).toMatchObject({ success: false, publishedCount: 0 });
        expect(dupRes.failed.some((f) => /already claimed by endpoint/.test(f.error))).toBe(true);
        expect(dup.rows.size).toBe(2);
        expect(activeRows(dup.rows)).toHaveLength(0);
    });

    it('refuses an `api` draft whose body does not even satisfy ApiEndpointSchema', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        // `api` has no entry in BUILTIN_METADATA_TYPE_SCHEMAS (that half is
        // #5271, the spec lane), so the direct-write path stores arbitrary JSON
        // verbatim. Parsing is the gate's precondition: an unparseable
        // declaration cannot be judged and could never be served either.
        await saveApiDraft(protocol, 'garbage', { name: 'garbage', totally: 'not an endpoint' });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res).toMatchObject({ success: false, publishedCount: 0 });
        expect(res.failed[0]).toMatchObject({ type: 'api', name: 'garbage', code: 'ENDPOINT_SCHEMA' });
        expect(res.failed[0].error).toContain('does not satisfy ApiEndpointSchema');
        expect(activeRows(rows)).toHaveLength(0);
    });

    it('refuses when the package declares NO namespace — the D2 precondition, reported once', async () => {
        // `getPackage` → undefined: the object namespace-prefix rule
        // grandfathers this (a bare object name is a naming smell), but an
        // endpoint with no namespace is an UNOWNABLE URL, so the endpoint gate
        // runs unconditionally and its own precondition fires.
        const { engine, rows } = makeStubEngine(undefined);
        const protocol = new ObjectStackProtocolImplementation(engine);

        await saveApiDraft(protocol, 'list_things', validEndpoint());
        await saveApiDraft(protocol, 'other_things', validEndpoint({ name: 'other_things', path: '/api/v1/apps/showcase/others' }));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: false, publishedCount: 0 });
        // ONE report, not one per endpoint — the missing namespace is a
        // property of the package, so it is unattributed (`name: ''`).
        expect(res.failed).toHaveLength(1);
        expect(res.failed[0]).toMatchObject({ type: 'api', name: '', code: 'ENDPOINT_GATE' });
        expect(res.failed[0].error).toContain('MUST declare an explicit `manifest.namespace`');
        // …plus THIS path's remedy (where to set it from here).
        expect(res.failed[0].error).toContain('From `publishPackageDrafts` specifically');
        expect(activeRows(rows)).toHaveLength(0);
    });

    it('fails the WHOLE batch — healthy siblings of a bad `api` draft stay drafts', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'showcase_thing',
            item: objectBody('showcase_thing'),
            packageId: PKG,
            mode: 'draft',
        });
        await saveApiDraft(protocol, 'list_things', validEndpoint());
        await saveApiDraft(protocol, 'open_things', validEndpoint({ name: 'open_things', path: '/api/v1/apps/showcase/open', authRequired: false }));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        // Mirrors the namespace-prefix posture exactly: pre-flight refusal,
        // nothing promoted — NOT "publish the two good ones".
        expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 1 });
        expect(res.published).toEqual([]);
        expect(res.failed.map((f) => f.name)).toEqual(['open_things']);
        expect(draftRows(rows).map((r) => r.name).sort()).toEqual(['list_things', 'open_things', 'showcase_thing']);
        expect(activeRows(rows)).toHaveLength(0);
    });

    it('reports object namespace-prefix AND endpoint violations in ONE report', async () => {
        const { engine } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'thing', // missing the `showcase_` prefix
            item: objectBody('thing'),
            packageId: PKG,
            mode: 'draft',
        });
        await saveApiDraft(protocol, 'open_things', validEndpoint({ name: 'open_things', authRequired: false }));

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: false, publishedCount: 0, failedCount: 2 });
        expect(res.failed.map((f) => f.code).sort()).toEqual(['ENDPOINT_GATE', 'NAMESPACE_PREFIX']);
    });

    it('leaves non-`api` drafts alone — no endpoint gate, no behaviour change', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await protocol.saveMetaItem({
            type: 'object',
            name: 'showcase_thing',
            item: objectBody('showcase_thing'),
            packageId: PKG,
            mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });
        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(activeRows(rows).map((r) => r.name)).toEqual(['showcase_thing']);
    });
});

describe('the #5203 load-time backstop is still the LAST door, not a replaced one', () => {
    /**
     * The publish gate added by #5206 step 2 is the EARLIER door. This asserts
     * the pairing rather than the matcher's wiring (which
     * `packages/metadata`'s own suite owns): the very body publish now refuses
     * is the body `identityFreeEndpointGateFailure` — the function
     * `buildEndpointIndex` calls on every stored item — also refuses. If a
     * future change relaxed one side, exactly one of these two expectations
     * would flip, and a silently-served anonymous endpoint is what that would
     * mean.
     */
    it('the same D6 body publish refuses is the one the index-build backstop excludes', () => {
        const parsed = ApiEndpointSchema.parse(validEndpoint({ name: 'open_things', authRequired: false }));
        const failure = identityFreeEndpointGateFailure(parsed);
        expect(failure).toBeDefined();
        expect(failure!.message).toContain('`authRequired: false` without an ARMED rate limit');
    });

    it('and the body publish accepts is one the backstop lets into the index', () => {
        const parsed = ApiEndpointSchema.parse(validEndpoint());
        expect(identityFreeEndpointGateFailure(parsed)).toBeUndefined();
    });
});
