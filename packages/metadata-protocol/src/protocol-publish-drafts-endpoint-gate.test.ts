// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions (#4550 delete /
// #5480 update), so the fake engine below cannot accept a call ObjectQL
// refuses. Imported from `@objectstack/metadata-core` and not from
// `@objectstack/objectql`: objectql DEPENDS ON this package, so that import
// would close a dependency cycle turbo rejects outright — which is why all 26
// of this package's (file, verb) pairs sat in the gate's DEBT ledger until
// #5619 sank the two predicates into a package both sides already depend on.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { identityFreeEndpointGateFailure, ApiEndpointSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

/**
 * RETIREMENT PINS (#5488) — this file used to pin `gateApiDraftsForPublish`,
 * the ADR-0121 / #5040 E7 endpoint publish gate that #5206 step 2 (PR #5279)
 * added to `publishPackageDrafts`. That gate is GONE, deliberately, and these
 * tests now pin the reason it can never be needed again.
 *
 * ## What the retired gate did, and why it went
 *
 * It judged whether an `api` draft was fit to be promoted draft→active in
 * `sys_metadata`. The measurement that ended it (#5488, real showcase boot) is
 * that **no such row is ever served**: the serving criterion belongs to
 * `IMetadataService.matchEndpoint` → `EndpointMatcher` →
 * `MetadataManager.listForIndex('api')`, which reads the manager's registry
 * plus its filesystem/memory loaders. A runtime write lands in `sys_metadata`,
 * which is in neither — so `PUT /api/v1/meta/api/:name` answered 200 "Saved"
 * and the declared route then 404'd forever, with no `[EndpointMatcher] …
 * EXCLUDED` line, because the endpoint was never in the index to be excluded
 * from. The gate was a correct verdict about a state with no consumer.
 *
 * The maintainer ruled on 2026-08-07T16:59Z (Option B): flip the `api` registry
 * entry to `allowRuntimeCreate: false` and let the existing #5086 inlet refuse
 * loudly — ADR-0049's remove side, since a capability that is declared and not
 * honoured is false compliance. The flip makes `api` code-only, and the #5086
 * inlet runs BEFORE persistence and BEFORE the draft/publish branch (it does
 * not read `mode`), so no `api` draft can be authored at all. A gate for a row
 * that cannot exist is a phantom check, so it was removed with the door.
 *
 * ## What these tests pin instead
 *
 * 1. The refusal, in the ADR-0112 envelope — `code` AND `status`, not merely
 *    "it threw" (#6142): a bare throw would stay green on a driver that throws
 *    the wrong error, which is the whole defect class here.
 * 2. That the refusal covers the DRAFT door too, not just direct-active — that
 *    is the specific prediction the #5271 tripwire comments made, and it is now
 *    the intended behaviour rather than a warning.
 * 3. That nothing is persisted by the refused write.
 * 4. That `publishPackageDrafts` is otherwise untouched: non-`api` drafts
 *    publish exactly as before.
 *
 * ## What still judges endpoints (unchanged, and asserted at the bottom)
 *
 * `validateApiEndpointDeclarations` / `identityFreeEndpointGateFailure`
 * (`spec/api/endpoint-publish-gate`) on the route that actually serves — the
 * stack schema, `publishPackage` (#5189), and again at load in
 * `buildEndpointIndex` (PR #5203). ADR-0121's "publish REJECTS" ruling is
 * intact on that route; only the runtime-authored-draft door it also used to
 * cover is gone, because that door opened onto nothing.
 *
 * Re-entry, as the ruling recorded it: if #2657 Part B promotes `apis` to a
 * registered type WITH A REAL CONSUMPTION PATH, the flag and this gate come
 * back together — implementation first, declaration second.
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
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
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
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
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

/**
 * Attempt one `api` write the way Studio's direct-write path does, and return
 * the thrown error. `mode` is the point of the parameter: the #5086 inlet runs
 * before the draft/publish branch and never reads it, so BOTH doors must refuse.
 */
async function attemptApiWrite(
    protocol: ObjectStackProtocolImplementation,
    name: string,
    item: unknown,
    opts: { mode?: 'draft' | 'publish'; organizationId?: string } = {},
): Promise<any> {
    try {
        await protocol.saveMetaItem({
            type: 'api',
            name,
            item: item as any,
            packageId: PKG,
            ...(opts.mode ? { mode: opts.mode } : {}),
            ...(opts.organizationId ? { organizationId: opts.organizationId } : {}),
        } as any);
    } catch (err) {
        return err;
    }
    throw new Error(`expected the #5086 inlet to refuse the api write '${name}', but it resolved`);
}

/**
 * The ADR-0112 envelope a code-only refusal must carry. Asserted as `code` AND
 * `status` — never `rejects.toThrow()` alone (#6142): the unfixed shape here
 * ALSO throws (or, on the pre-#5488 build, resolves with a 200 receipt), so a
 * throw-only assertion carries one bit where the defect has two.
 */
function expectCodeOnlyRefusal(err: any, expectedCode: 'NOT_CREATABLE' | 'NOT_OVERRIDABLE') {
    expect(err.code).toBe(expectedCode);
    expect(err.status).toBe(403);
    // The prescription must point at the route that DOES serve endpoints — the
    // stack artifact compiled and shipped through `publishPackage`. It is
    // derived from the registry entry's own `filePatterns[0]`, so it cannot
    // drift from the declaration that produced the refusal.
    expect(err.message).toContain('**/*.api.ts');
    expect(err.message).toContain('allowRuntimeCreate=false');
}

const draftRows = (rows: Map<string, Row>) => Array.from(rows.values()).filter((r) => r.state === 'draft');
const activeRows = (rows: Map<string, Row>) => Array.from(rows.values()).filter((r) => r.state === 'active');

describe('`api` runtime writes are refused at the inlet — the retired gate’s replacement (#5488)', () => {
    it('refuses a DIRECT-ACTIVE `api` write with the ADR-0112 envelope, and persists nothing', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        // A body that is perfectly schema-valid and perfectly servable-looking.
        // That matters: only a body nothing else would reject proves the
        // refusal came from the registry consult (#5086), not from a 422.
        const err = await attemptApiWrite(protocol, 'list_things', validEndpoint());

        expectCodeOnlyRefusal(err, 'NOT_CREATABLE');
        // #5264 — a refused write asks the engine for nothing at all.
        expect(rows.size).toBe(0);
        expect(activeRows(rows)).toHaveLength(0);
    });

    it('refuses a DRAFT `api` write too — the inlet runs before the draft/publish branch', async () => {
        // THE pin of this file. The #5271 tripwire comments predicted exactly
        // this consequence of flipping the flag ("`api` DRAFTS would become
        // impossible, and #5206 step 2's endpoint gate would have nothing left
        // to gate"), and it is now intended: `saveMetaItem` consults
        // `isRuntimeCreateAllowed` before it ever looks at `request.mode`.
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await attemptApiWrite(protocol, 'list_things', validEndpoint(), { mode: 'draft' });

        expectCodeOnlyRefusal(err, 'NOT_CREATABLE');
        expect(draftRows(rows)).toHaveLength(0);
        expect(rows.size).toBe(0);
    });

    it('refuses on an ORG-SCOPED kernel as well — #5086 is not a topology carve-out', async () => {
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test');

        const err = await attemptApiWrite(protocol, 'list_things', validEndpoint(), {
            mode: 'draft',
            organizationId: 'org_1',
        });

        expectCodeOnlyRefusal(err, 'NOT_CREATABLE');
        expect(rows.size).toBe(0);
    });

    it('refuses the D6 shape the retired gate used to catch — now one door earlier', async () => {
        // The anonymous, unmetered endpoint ADR-0121 D6 exists to prevent. The
        // retired gate refused it at PUBLISH with `code: 'ENDPOINT_GATE'`;
        // it is now refused at AUTHORING with `code: 'NOT_CREATABLE'`, because
        // the row it would have been promoted into is unreachable either way.
        // The D6 criterion itself is untouched and still asserted at the bottom
        // of this file on the route that serves.
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        const err = await attemptApiWrite(
            protocol,
            'open_things',
            validEndpoint({ name: 'open_things', authRequired: false }),
            { mode: 'draft' },
        );

        expectCodeOnlyRefusal(err, 'NOT_CREATABLE');
        expect(rows.size).toBe(0);
    });

    it('publishPackageDrafts can no longer receive an `api` draft to gate', async () => {
        // The structural claim behind retiring `gateApiDraftsForPublish`: with
        // the inlet closed there is no way to reach a state the gate judged.
        // A batch publish therefore sees an empty `api` set by construction,
        // and reports no ENDPOINT_GATE / ENDPOINT_SCHEMA code ever again.
        const { engine, rows } = makeStubEngine('showcase');
        const protocol = new ObjectStackProtocolImplementation(engine);

        await attemptApiWrite(protocol, 'open_things', validEndpoint({ name: 'open_things', authRequired: false }), { mode: 'draft' });
        await protocol.saveMetaItem({
            type: 'object',
            name: 'showcase_thing',
            item: objectBody('showcase_thing'),
            packageId: PKG,
            mode: 'draft',
        });

        const res = await protocol.publishPackageDrafts({ packageId: PKG });

        expect(res).toMatchObject({ success: true, publishedCount: 1, failedCount: 0 });
        expect(res.failed.map((f: { code?: string }) => f.code)).toEqual([]);
        expect(activeRows(rows).map((r) => r.name)).toEqual(['showcase_thing']);
        expect(draftRows(rows)).toHaveLength(0);
    });

    it('leaves non-`api` drafts alone — no endpoint gate, no behaviour change', async () => {
        // Survives the retirement unchanged: it pinned that the gate was
        // type-scoped, and it now pins that removing it changed nothing for
        // every other type.
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
