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
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
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
            assertEngineFindOnePredicate(table, opts);
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
    // [#8310] The runtime object door requires an authored OWD (the
    // draft→active promotion runs the 422 lint gate).
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

/**
 * [#21002, ADR-0126 §2] The dispatcher twin of `RestServer`'s `/published`
 * follows the layered read the same way: for a flow name the loader ships, the
 * layered read's effective layer is the loader's body even when a stored row of
 * that name is present (`isShippedFlowName` decides it), and when that decision
 * was made this door serves the effective layer. In every other case it serves
 * the stored row exactly as before. The predicate is ASKED of the protocol,
 * never re-derived here.
 *
 * The registry below ships ONE flow from a package — the package id stamped
 * on the loader's own entry, the shape `lookupArtifactItem` reads off a
 * partial registry — so the real protocol's predicate, code layer and layered
 * read all run unmocked over this file's own engine double. The cold-boot proof over
 * the real composition is `flow-shipped-name-published-door.dogfood.test.ts`.
 */
describe('[#21002] the dispatcher published door follows the layered read for a shipped flow name', () => {
    const SHIPPED = 'pkg_flow';
    const CUSTOMER = 'customer_flow';
    const flowBody = (name: string, label: string) => ({
        name,
        label,
        type: 'autolaunched',
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: `${label.toLowerCase()}_end`, type: 'end', label: 'End' }],
        edges: [{ id: 'e1', source: 'start', target: `${label.toLowerCase()}_end` }],
    });

    /** This file's engine double, with a registry that ships {@link SHIPPED} from a package. */
    function shippedHarness() {
        const { engine, rows } = makeStubEngine();
        const loaderEntry = { ...flowBody(SHIPPED, 'LOADER'), _packageId: 'com.example.pkg' };
        engine.registry = {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
            getItem: (type: string, name: string) =>
                (type === 'flow' || type === 'flows') && name === SHIPPED ? loaderEntry : undefined,
        };
        const metadata = new MetadataManager({});
        const protocol = makeProtocol(engine, metadata);
        return { engine, rows, metadata, protocol };
    }

    async function storeActiveRow(engine: any, type: string, name: string, body: unknown) {
        await engine.insert('sys_metadata', {
            type, name, organization_id: null, package_id: null, state: 'active',
            metadata: JSON.stringify(body), checksum: 'sha256:stored', version: 1,
        });
    }

    it('a shipped flow name with a stored row: the door answers the loader\'s body, the layered effective layer', async () => {
        const { engine, metadata, protocol } = shippedHarness();
        await storeActiveRow(engine, 'flow', SHIPPED, flowBody(SHIPPED, 'STORED'));

        // The decision this door follows: a stored layer IS present, and the
        // layered read put the loader's body over it.
        const layered: any = await protocol.getMetaItemLayered({ type: 'flow', name: SHIPPED });
        expect(layered.overlay).toMatchObject({ label: 'STORED' });
        expect(layered.effective).toMatchObject({ label: 'LOADER' });
        expect(protocol.isShippedFlowName('flow', SHIPPED)).toBe(true);

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata(`/flow/${SHIPPED}/published`, ctx(), 'GET'));

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ name: SHIPPED, label: 'LOADER' });
        expect(JSON.stringify(response.body.data)).not.toContain('STORED');
        expect(response.body.data).toEqual(layered.effective);
    });

    it('the plural type spelling reaches the same decision', async () => {
        const { engine, metadata, protocol } = shippedHarness();
        await storeActiveRow(engine, 'flow', SHIPPED, flowBody(SHIPPED, 'STORED'));

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata(`/flows/${SHIPPED}/published`, ctx(), 'GET'));

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ name: SHIPPED, label: 'LOADER' });
    });

    it('control: a flow name no package ships keeps its stored row on this door', async () => {
        const { engine, metadata, protocol } = shippedHarness();
        await storeActiveRow(engine, 'flow', CUSTOMER, flowBody(CUSTOMER, 'STORED'));

        const layered: any = await protocol.getMetaItemLayered({ type: 'flow', name: CUSTOMER });
        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata(`/flow/${CUSTOMER}/published`, ctx(), 'GET'));

        expect(protocol.isShippedFlowName('flow', CUSTOMER)).toBe(false);
        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ name: CUSTOMER, label: 'STORED' });
        expect(response.body.data).toEqual(layered.overlay);
    });

    it('control: an object\'s published stored row is served unchanged, not its effective layer', async () => {
        const { metadata, protocol } = shippedHarness();
        await runtimePublish(protocol, 'proj_task', RUNTIME_BODY);

        const layered: any = await protocol.getMetaItemLayered({ type: 'object', name: 'proj_task' });
        // The control discriminates: the effective layer is NOT the stored
        // row, so serving the effective layer here would fail the last line.
        expect(layered.effective).not.toEqual(layered.overlay);

        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata('/object/proj_task/published', ctx(), 'GET'));

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual(layered.overlay);
    });

    it('control: a protocol that brings no such predicate keeps today\'s answer, the stored row', async () => {
        const { engine, metadata, protocol } = shippedHarness();
        await storeActiveRow(engine, 'flow', SHIPPED, flowBody(SHIPPED, 'STORED'));
        // The same protocol with the predicate the door asks hidden from the
        // door only; its own methods keep calling it on the real instance.
        // [#21986] That predicate is `declinesStoredRow`. `isShippedFlowName`
        // stays visible, so this also pins that the door does not fall back
        // to it: a protocol without the one predicate gets the stored row.
        const withoutPredicate = new Proxy(protocol, {
            get(target, key) {
                if (key === 'declinesStoredRow') return undefined;
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });

        const response = responseOf(await make({ protocol: withoutPredicate, metadata })
            .handleMetadata(`/flow/${SHIPPED}/published`, ctx(), 'GET'));

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ name: SHIPPED, label: 'STORED' });
    });
});

/**
 * [#21986] The dispatcher twin, for the other name class whose stored row the
 * layered read declines: a CODE-DEFINED DATASOURCE name (here one an installed
 * package declares). The layered read's effective layer for such a name is the
 * code definition, the MetadataService's registration, and the stored row is
 * residue, still reported in `overlay`. This door asks the protocol's one
 * predicate for both name classes, `declinesStoredRow`, so it serves that
 * effective layer, as `RestServer`'s `/published` does. A runtime datasource's
 * stored row is still served.
 */
describe('[#21986] the dispatcher published door serves a code-defined datasource\'s code definition over a stored row', () => {
    const CODE_DS = 'showcase_external';
    const RUNTIME_DS = 'rt_datasource_21986';
    const CODE_LABEL = 'External Analytics (SQLite)';
    const SHADOW_LABEL = 'Shadow 21986';
    const dsBody = (name: string, label: string, origin: 'code' | 'runtime', filename: string) => ({
        name, label, driver: 'sqlite', config: { filename }, origin,
    });

    /**
     * This file's engine double, with an installed package that declares
     * {@link CODE_DS}, and the MetadataService holding the code definition the
     * runtime registers at boot (and a copy of the runtime datasource under a
     * label its row does not carry, so the control can tell which layer answered).
     */
    async function datasourceHarness() {
        const { engine, rows } = makeStubEngine();
        engine.registry = {
            registerItem: () => {},
            registerObject: () => {},
            getPackage: () => undefined,
            getItem: () => undefined,
            getAllPackages: () => [{
                manifest: {
                    id: 'com.example.showcase',
                    datasources: [{ name: CODE_DS, label: CODE_LABEL, driver: 'sqlite', config: { filename: 'x.db' } }],
                },
            }],
        };
        const metadata = new MetadataManager({});
        await metadata.register('datasource', CODE_DS, dsBody(CODE_DS, CODE_LABEL, 'code', `${CODE_DS}.db`));
        await metadata.register('datasource', RUNTIME_DS, dsBody(RUNTIME_DS, 'Runtime (MetadataService copy)', 'runtime', 'rt.db'));
        const protocol = makeProtocol(engine, metadata);
        return { engine, rows, metadata, protocol };
    }

    async function storeActiveRow(engine: any, name: string, body: unknown) {
        await engine.insert('sys_metadata', {
            type: 'datasource', name, organization_id: null, package_id: null, state: 'active',
            metadata: JSON.stringify(body), checksum: 'sha256:stored', version: 1,
        });
    }

    /**
     * {@link ctx}, for a caller the `/meta` doors admit to a datasource read:
     * `datasource` reads require `manage_platform_settings`, the capability
     * the datasource admin door requires.
     */
    const platformAdminCtx = (): any => ({
        ...ctx(),
        executionContext: { userId: 'u_platform', systemPermissions: ['manage_platform_settings'] },
    });

    it('a stored row under a code-defined datasource name: the door answers the code definition, the layered effective layer', async () => {
        const { engine, rows, metadata, protocol } = await datasourceHarness();
        await storeActiveRow(engine, CODE_DS, dsBody(CODE_DS, SHADOW_LABEL, 'runtime', 'shadow-external.db'));
        expect(rows.size).toBe(1);

        // The decision this door follows: a stored layer IS present, and the
        // layered read put the code definition over it.
        const layered: any = await protocol.getMetaItemLayered({ type: 'datasource', name: CODE_DS });
        expect(layered.overlay).toMatchObject({ origin: 'runtime', label: SHADOW_LABEL });
        expect(layered.effective).toMatchObject({ origin: 'code', label: CODE_LABEL });

        const dispatcher = make({ protocol, metadata });
        for (const type of ['datasource', 'datasources']) {
            const response = responseOf(await dispatcher.handleMetadata(`/${type}/${CODE_DS}/published`, platformAdminCtx(), 'GET'));

            expect(response.status, type).toBe(200);
            expect(response.body.data, type).toMatchObject({ name: CODE_DS, origin: 'code', label: CODE_LABEL });
            expect(JSON.stringify(response.body.data), type).not.toContain('shadow-external.db');
            expect(response.body.data, type).toEqual(layered.effective);
        }
        // The row stays at rest: the door read past it, nothing removed it.
        expect(rows.size).toBe(1);
    });

    it('control: a runtime datasource\'s stored row is still what the door serves', async () => {
        const { engine, metadata, protocol } = await datasourceHarness();
        await storeActiveRow(engine, RUNTIME_DS, dsBody(RUNTIME_DS, 'Runtime (stored row)', 'runtime', 'rt.db'));

        const layered: any = await protocol.getMetaItemLayered({ type: 'datasource', name: RUNTIME_DS });
        const response = responseOf(await make({ protocol, metadata })
            .handleMetadata(`/datasource/${RUNTIME_DS}/published`, platformAdminCtx(), 'GET'));

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({ name: RUNTIME_DS, label: 'Runtime (stored row)' });
        expect(response.body.data).toEqual(layered.overlay);
    });
});
