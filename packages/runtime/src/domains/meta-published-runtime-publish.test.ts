// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8031] `GET /meta/:type/:name/published` resolves from the AUTHORITATIVE
 * published store — the `state:'active'` `sys_metadata` overlay row.
 *
 * Two publish lifecycles exist in this repo, and they write to different places:
 *
 *   - **Package publish** (ADR-0016 era) — `MetadataManager.publishPackage`
 *     snapshots each item's body into the row-local `publishedDefinition`
 *     envelope key, in the manager's own in-memory registry.
 *   - **Runtime draft publish** (ADR-0027 (E)(5)) — `publishPackageDrafts` /
 *     `promoteDraft` flips the artifact's `sys_metadata` row from
 *     `state:'draft'` to `state:'active'`. ADR-0027 (E)(5) defines sealing a
 *     publish as exactly that flip; `SysMetadataRepository` names `'active'`
 *     "the published, live overlay"; and ADR-0033 §2 — the ADR this route
 *     cites — routes EVERY authoring write into that same ADR-0027 draft.
 *
 * The route used to resolve exclusively through the FIRST of those, while the
 * dispatcher's own `publish-drafts` comment states that path has "no metadata
 * service dependency" — so read and write shared no store, and a
 * runtime-published item answered 404.
 *
 * These tests exercise the REAL protocol implementation over a faithful stub
 * engine and the REAL `MetadataManager` — no mock stands in for either store —
 * so what they measure is the wiring, not a stub's opinion of it.
 */

import { describe, it, expect } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine below
// cannot accept a call ObjectQL itself would refuse — a double looser than the
// real engine is how #4434 shipped a dead route with its suite green. Imported
// from `@objectstack/metadata-core` rather than `@objectstack/objectql`
// (which re-exports it): objectql depends on this side of the graph, so that
// import would close a cycle turbo rejects outright.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { MetadataManager } from '@objectstack/metadata';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';

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
function makeStubEngine() {
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
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            if (table === 'sys_metadata_history') return [];
            return Array.from(rows.values()).filter((r) => matchesWhere(r, opts.where));
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
            getItem: () => undefined,
            getPackage: () => undefined,
        },
    };
    return { engine, rows };
}

/**
 * The protocol as a real kernel wires it: the `metadata` slot is reachable
 * through its services registry, so the protocol's CODE layer really can
 * resolve. Without this the code-published fixture below would pass no matter
 * which primitive this route used — the code layer would be unreachable and
 * every arm would fall through to `getPublished` alike.
 */
function makeProtocol(engine: any, metadata: unknown) {
    return new ObjectStackProtocolImplementation(
        engine,
        () => new Map<string, any>([['metadata', metadata]]),
    );
}

const RUNTIME_BODY = {
    name: 'proj_task',
    label: 'Project Task',
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

function make(services: Record<string, any>) {
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return new HttpDispatcher(kernel);
}

const ctx = (): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u1', systemPermissions: ['manage_metadata'] },
});

/**
 * The dispatcher result's `response` is optional on the type; every call below
 * is a handled route, so narrow once here rather than at each assertion.
 */
function responseOf(result: { handled: boolean; response?: any }) {
    expect(result.response).toBeDefined();
    return result.response!;
}

/** Author a draft and publish it — the ADR-0027 (E)(5) runtime path. */
async function runtimePublish(protocol: any, name: string, body: unknown) {
    await protocol.saveMetaItem({
        type: 'object',
        name,
        item: body,
        packageId: 'app.projects',
        mode: 'draft',
    });
    return protocol.publishPackageDrafts({ packageId: 'app.projects' });
}

describe('#8031 — GET /meta/:type/:name/published resolves from the published store', () => {
    it('serves a RUNTIME-published item, and serves the published body', async () => {
        const { engine, rows } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        await runtimePublish(protocol, 'proj_task', RUNTIME_BODY);

        // ANTI-VACUITY: the publish really landed — an `active` row exists and
        // carries the authored body. Without this, a 404 could merely mean
        // "the write never happened".
        const active = Array.from(rows.values()).filter((r) => r.state === 'active');
        expect(active).toHaveLength(1);
        expect(JSON.parse(active[0]!.metadata)).toMatchObject({ label: 'Project Task' });

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata('/object/proj_task/published', ctx(), 'GET'));

        expect(response.status).toBe(200);
        // Read a value from INSIDE the body, so serving some other document
        // (an envelope, a stub) fails on the value rather than passing on a
        // key that is merely present.
        expect(response.body.data).toMatchObject({ label: 'Project Task' });
        expect(response.body.data.fields.done).toMatchObject({ type: 'boolean' });
    });

    it('an item with only a DRAFT row is not served — a draft is not published', async () => {
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

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata('/object/proj_task/published', ctx(), 'GET'));

        expect(response.status).toBe(404);
        // And specifically: the DRAFT body was not served under another status.
        expect(JSON.stringify(response.body ?? {})).not.toContain('Project Task');
    });

    it('a CODE-published item still resolves through getPublished, byte-identically', async () => {
        const { engine } = makeStubEngine();

        // The code/package store — `publishedDefinition` is what
        // `publishPackage` writes and what `getPublished` reads.
        const published = { ...CODE_BODY, label: 'Code Widget (published)' };
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);
        await metadata.register('object', 'code_widget', {
            metadata: CODE_BODY,
            publishedDefinition: published,
            state: 'active',
        } as any);

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata('/object/code_widget/published', ctx(), 'GET'));

        expect(response.status).toBe(200);
        // BYTE-IDENTICAL to what `getPublished` itself answers — the overlay
        // arm must not have decorated, folded or re-shaped this document.
        const direct = await (metadata as any).getPublished('object', 'code_widget');
        expect(response.body.data).toEqual(direct);
        expect(response.body.data).toEqual(published);
    });

    it('ANTI-VACUITY: the two fixtures resolve from DIFFERENT stores', async () => {
        // Proves the suite can tell code-published from runtime-published —
        // without this, all three cases above could be passing off one store.
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

        const dispatcher = make({ protocol, metadata });
        const runtimeRes = responseOf(await dispatcher.handleMetadata('/object/proj_task/published', ctx(), 'GET'));
        const codeRes = responseOf(await dispatcher.handleMetadata('/object/code_widget/published', ctx(), 'GET'));

        expect(runtimeRes.status).toBe(200);
        expect(codeRes.status).toBe(200);
        expect(runtimeRes.body.data).toMatchObject({ label: 'Project Task' });
        expect(codeRes.body.data).toMatchObject({ label: 'Code Widget' });
    });

    it('a name that exists in NEITHER store still 404s', async () => {
        const { engine } = makeStubEngine();
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata('/object/no_such_thing/published', ctx(), 'GET'));

        expect(response.status).toBe(404);
    });
});
