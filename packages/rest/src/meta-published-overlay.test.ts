// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8278] REST's `GET /meta/:type/:name/published` resolves from the
 * AUTHORITATIVE published store — the `state:'active'` `sys_metadata` overlay
 * row — not from the code snapshot alone.
 *
 * This is #8031's fix (PR #8254, `packages/runtime/src/domains/meta.ts`)
 * mirrored onto the transport that actually serves the cloud runtime. The
 * dispatcher was corrected; this door was not, so the defect stayed reachable
 * through REST: two publish lifecycles write to two different places, and this
 * route knew only the older one.
 *
 *   - **Package publish** (ADR-0016 era) — `MetadataManager.publishPackage`
 *     snapshots each item's body into the row-local `publishedDefinition`
 *     envelope key of its own in-memory registry. That is what `getPublished`
 *     reads, and it was this route's ONLY source.
 *   - **Runtime draft publish** (ADR-0027 (E)(5)) — `publishPackageDrafts` /
 *     `promoteDraft` flips the artifact's `sys_metadata` row `state:'draft' →
 *     'active'`. ADR-0027 (E)(5) defines sealing a publish as exactly that
 *     flip, `SysMetadataRepository` names `'active'` "the published, live
 *     overlay", and ADR-0033 §2 routes EVERY runtime authoring write into that
 *     same ADR-0027 draft.
 *
 * ⛔ THE TRAP ON THIS ROUTE, stated so the next reader does not "fix" it:
 * #8031's own verification arm — *"an item that is genuinely unpublished still
 * 404s"* — is **FALSE for a code-defined item by design**. `getPublished`'s
 * documented fallback answers **200 with the current definition**, and the
 * route's own comment preserves that distinction on purpose. The version of
 * that arm which IS correct is §2 below: a **draft-only** item must not be
 * served. Narrowing the 404 into "unpublished" would be breaking the contract
 * while believing it was being tightened.
 *
 * These tests drive the REAL `ObjectStackProtocolImplementation` and the REAL
 * `MetadataManager` over a stub engine — no mock stands in for either store, so
 * what they measure is this route's wiring rather than a double's opinion of
 * it. Both are already devDependencies of this package; nothing new is pulled
 * in to test this.
 */

import { describe, it, expect, vi } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL itself would refuse — a double looser than the
// real engine is how a dead route once shipped with its suite green.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { MetadataManager } from '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const PUBLISHED = '/api/v1/meta/:type/:name/published';
const PUBLISHED_COMPOUND = '/api/v1/meta/:type/:section/:name/published';

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
}

/** ADR-0048 overlay key — an env-wide draft and an active row coexist. */
function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

/** Minimal multi-table stub engine — honours `$or` and `organization_id IS NULL`. */
function makeStubEngine(opts: { failSysMetadataReads?: Error } = {}) {
    const rows = new Map<string, Row>();
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
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const engine: any = {
        async findOne(table: string, options: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata' && opts.failSysMetadataReads) throw opts.failSysMetadataReads;
            if (table === 'sys_metadata_history') return null;
            return findRow(options.where)?.row ?? null;
        },
        async find(table: string, options: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata' && opts.failSysMetadataReads) throw opts.failSysMetadataReads;
            if (table === 'sys_metadata_history') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, options.where));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            if (table === 'sys_metadata_history') {
                nextId += 1;
                return { id: `h_${nextId}` };
            }
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, options: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, options);
            const found = findRow(options.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, options: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(options);
            const found = findRow(options.where);
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
            getItem: () => undefined,
            getPackage: () => undefined,
        },
    };
    return { engine, rows };
}

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

const RUNTIME_BODY = {
    name: 'proj_task',
    label: 'Project Task',
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
        done: { type: 'boolean', label: 'Done' },
    },
};

/** A DISTINCT body, so "which store answered" is readable off the response. */
const CODE_BODY = {
    name: 'code_widget',
    label: 'Code Widget',
    fields: { sku: { type: 'text', label: 'SKU' } },
};

/**
 * A server wired the way a real host wires one: the `protocol` slot carries the
 * protocol under test, and the `metadata` slot is reached through the same
 * provider `rest-api-plugin` passes to the constructor. The private field is
 * assigned rather than threaded through twenty positional constructor
 * arguments — the convention this package's other route tests already use for
 * `resolveExecCtx`.
 */
function setup(protocol: unknown, metadata: unknown) {
    const rest = new RestServer(
        createMockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    if (metadata !== undefined) {
        (rest as any).metadataServiceProvider = async () => metadata;
    }
    rest.registerRoutes();
    return rest;
}

async function callPublished(rest: any, params: any, path = PUBLISHED) {
    const res = makeRes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    if (!route) throw new Error(`GET ${path} route not registered`);
    await route.handler({ method: 'GET', params, query: {}, headers: {} }, res);
    return res;
}

/** Author a draft and publish it — the ADR-0027 (E)(5) runtime path. */
async function runtimePublish(protocol: any, name: string, body: unknown, type = 'object') {
    await protocol.saveMetaItem({
        type,
        name,
        item: body,
        packageId: 'app.projects',
        mode: 'draft',
    });
    return protocol.publishPackageDrafts({ packageId: 'app.projects' });
}

function makeProtocol(engine: any, metadata: unknown) {
    return new ObjectStackProtocolImplementation(
        engine,
        () => new Map<string, any>([['metadata', metadata]]),
    );
}

describe('[#8278] REST `/meta/:type/:name/published` resolves from the published store', () => {
    it('§1 serves a RUNTIME-published item, and serves the PUBLISHED body', async () => {
        const { engine, rows } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        await runtimePublish(protocol, 'proj_task', RUNTIME_BODY);

        // ANTI-VACUITY: the publish really landed — an `active` row exists and
        // carries the authored body. Without this a 404 could merely mean "the
        // write never happened".
        const active = Array.from(rows.values()).filter((r) => r.state === 'active');
        expect(active).toHaveLength(1);
        expect(JSON.parse(active[0]!.metadata)).toMatchObject({ label: 'Project Task' });

        const res = await callPublished(setup(protocol, metadata), { type: 'object', name: 'proj_task' });

        expect(res.statusCode).toBe(200);
        // Read a value from INSIDE the body, so serving some other document (an
        // envelope, a stub) fails on the value rather than passing on a key
        // that is merely present.
        expect(res.body).toMatchObject({ label: 'Project Task' });
        expect(res.body.fields.done).toMatchObject({ type: 'boolean' });
    }, 60_000);

    it('§2 an item with only a DRAFT row is not served — a draft is not published', async () => {
        const { engine, rows } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        // Authored, never published — the draft row exists and nothing else.
        await protocol.saveMetaItem({
            type: 'object',
            name: 'proj_task',
            item: RUNTIME_BODY,
            packageId: 'app.projects',
            mode: 'draft',
        });

        // ANTI-VACUITY: the draft really is there, and no active row is.
        expect(Array.from(rows.values()).filter((r) => r.state === 'draft')).toHaveLength(1);
        expect(Array.from(rows.values()).filter((r) => r.state === 'active')).toHaveLength(0);

        const res = await callPublished(setup(protocol, metadata), { type: 'object', name: 'proj_task' });

        expect(res.statusCode).toBe(404);
        // And specifically: the DRAFT body was not served under another status.
        expect(JSON.stringify(res.body ?? {})).not.toContain('Project Task');
    }, 60_000);

    it('§3 a CODE-published item still resolves through getPublished, byte-identically', async () => {
        const { engine } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        // The code/package store — `publishedDefinition` is what
        // `publishPackage` writes and what `getPublished` reads.
        const published = { ...CODE_BODY, label: 'Code Widget (published)' };
        await metadata.register('object', 'code_widget', {
            metadata: CODE_BODY,
            publishedDefinition: published,
            state: 'active',
        } as any);

        const res = await callPublished(setup(protocol, metadata), { type: 'object', name: 'code_widget' });

        expect(res.statusCode).toBe(200);
        // BYTE-IDENTICAL to what `getPublished` itself answers — the new
        // overlay arm must not have decorated, folded or re-shaped this
        // document on its way past.
        const direct = await (metadata as any).getPublished('object', 'code_widget');
        expect(res.body).toEqual(direct);
        expect(res.body).toEqual(published);
    }, 60_000);

    it('§4 ANTI-VACUITY: the two fixtures really resolve from DIFFERENT stores', async () => {
        // Proves this suite can tell code-published from runtime-published —
        // without it, §1 and §3 could both be passing off one store.
        const { engine, rows } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        await runtimePublish(protocol, 'proj_task', RUNTIME_BODY);
        await metadata.register('object', 'code_widget', {
            metadata: CODE_BODY,
            publishedDefinition: CODE_BODY,
            state: 'active',
        } as any);

        // The runtime item exists ONLY as an overlay row…
        expect(Array.from(rows.values()).some((r) => r.name === 'proj_task')).toBe(true);
        expect(await (metadata as any).getPublished('object', 'proj_task')).toBeUndefined();

        // …and the code item exists ONLY in the registry.
        expect(Array.from(rows.values()).some((r) => r.name === 'code_widget')).toBe(false);
        expect(await (metadata as any).getPublished('object', 'code_widget')).toBeDefined();

        const rest = setup(protocol, metadata);
        const runtimeRes = await callPublished(rest, { type: 'object', name: 'proj_task' });
        const codeRes = await callPublished(rest, { type: 'object', name: 'code_widget' });

        expect(runtimeRes.statusCode).toBe(200);
        expect(codeRes.statusCode).toBe(200);
        expect(runtimeRes.body).toMatchObject({ label: 'Project Task' });
        expect(codeRes.body).toMatchObject({ label: 'Code Widget' });
    }, 60_000);

    it('§5 a name that exists in NEITHER store still 404s', async () => {
        const { engine } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        const res = await callPublished(setup(protocol, metadata), { type: 'object', name: 'no_such_thing' });

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }, 60_000);

    it('§6 the COMPOUND arity resolves the runtime-published sub-resource', async () => {
        // `getPublished('lead', 'views/all_leads')` is the shape the SDK
        // documents and the shape this route's own comment names
        // (`lead/views/all_leads/published`). It reaches a DIFFERENT route
        // registration than §1, so the overlay consult has to be on both or
        // the fix covers only one of the two doors this card puts in scope.
        const { engine, rows } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        const viewBody = { name: 'all_leads', label: 'All Leads', columns: ['name'] };
        await runtimePublish(protocol, 'views/all_leads', viewBody, 'lead');

        expect(Array.from(rows.values()).filter((r) => r.state === 'active')).toHaveLength(1);

        const res = await callPublished(
            setup(protocol, metadata),
            { type: 'lead', section: 'views', name: 'all_leads' },
            PUBLISHED_COMPOUND,
        );

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ label: 'All Leads' });
        // The compound name was reassembled and used as ONE key — not split,
        // and not truncated to its last segment.
        expect(Array.from(rows.values())[0]!.name).toBe('views/all_leads');
    }, 60_000);
});

describe('[#8278] what the overlay consult must NOT change', () => {
    it('§7 [#5532] a metadata-store OUTAGE is a 503, never a 404 "not found"', async () => {
        // The one deliberate divergence from the dispatcher twin, and the
        // reason it exists. `getMetaItemLayered` documents a `503
        // SERVICE_UNAVAILABLE` for an overlay read that failed for any reason
        // other than the table not being provisioned yet. Blanket-swallowing
        // that throw — as a literal mirror of the dispatcher would — lets an
        // availability failure fall through and reach the client as `404 Not
        // found`: an outage reported as an existence fact, which is exactly
        // the #5532 defect this package pins in `rest-meta-outage-vs-miss`.
        const driverError = new Error('connect ECONNREFUSED 10.0.0.5:5432');
        const { engine } = makeStubEngine({ failSysMetadataReads: driverError });
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        const res = await callPublished(setup(protocol, metadata), { type: 'object', name: 'proj_task' });

        expect(res.statusCode).toBe(503);
        expect((res.body as any)?.code).toBe('SERVICE_UNAVAILABLE');
        // The client is never told the item does not exist, and the driver
        // line never reaches the wire (#5437: a declared 5xx drops its text).
        expect(JSON.stringify(res.body ?? {})).not.toContain('ECONNREFUSED');
        expect(JSON.stringify(res.body ?? {})).not.toMatch(/not found/i);
    }, 60_000);

    it('§8 the 501 arm survives: no `getPublished` in the kernel is still NOT_IMPLEMENTED', async () => {
        // SCOPE FENCE. The card records a latent, independent second failure
        // mode — `getPublished` is an OPTIONAL member of `IMetadataService`
        // with exactly one implementation, so a topology whose `metadata` slot
        // is filled by something else answers 501 here. That is NOT this
        // card's defect and is deliberately not fixed. This arm pins that it
        // was not fixed by accident either: with a null overlay and no
        // `getPublished`, the route still answers exactly what it answered
        // before.
        const { engine } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);
        const rest = setup(protocol, {} /* a metadata slot with no getPublished */);

        const res = await callPublished(rest, { type: 'object', name: 'proj_task' });

        expect(res.statusCode).toBe(501);
        expect(res.body).toEqual({
            error: {
                code: 'NOT_IMPLEMENTED',
                // [#8297] Reworded to state the TRUE post-#8278 condition — this
                // arm is reached only after a null overlay consult, so it no
                // longer means "this kernel cannot answer /published" at all.
                message: 'Nothing is runtime-published for this item, and this kernel has no code/package store (metadata.getPublished() is not available).',
            },
        });
    }, 60_000);

    it('§9 a RUNTIME-published item is served even where `getPublished` is absent', async () => {
        // The ordering consequence, stated so it is a decision rather than an
        // accident: the overlay is consulted BEFORE the 501 arm (the card's
        // ruling — "consult the overlay row FIRST"), so a topology missing
        // `getPublished` now serves the items it genuinely has published
        // instead of refusing all of them. The 501 in §8 remains for the case
        // it actually describes: nothing in the overlay AND no code store.
        const { engine } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        await runtimePublish(protocol, 'proj_task', RUNTIME_BODY);

        const res = await callPublished(
            setup(protocol, {} /* a metadata slot with no getPublished */),
            { type: 'object', name: 'proj_task' },
        );

        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ label: 'Project Task' });
    }, 60_000);
});
