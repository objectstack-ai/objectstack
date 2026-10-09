// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] Managed content is sealed — pinned at the RUNTIME DISPATCHER's
 * `/meta` door (`HttpDispatcher.handleMetadata`, the transport the
 * `@objectstack/hono` catch-all serves), beside the REST door's pin
 * (`packages/rest/src/rest-meta-managed-seal-hatch.test.ts`).
 *
 * The `OS_METADATA_WRITABLE` hatch used to open a write onto an item a managed
 * package ships for every type it named: a flow, an object (and through it a
 * field), a permission set, a position. With the hatch open the dispatcher now
 * answers what it answers with the hatch shut — `403` `NOT_OVERRIDABLE`, no
 * row — under both spellings the protocol's reader honours, on both kernel
 * shapes; and the read envelope stops promising an edit the door refuses.
 *
 * What stays open, pinned beside it:
 *  - a regime-O overlay: a packaged VIEW is overlaid (`200`, a row), because
 *    the registry allows that type an environment overlay;
 *  - the hatch's TYPE-level unlock for an item no managed package ships: a new
 *    flow is created (`200`, a row) with the hatch open as with it shut.
 *
 * Every case drives the REAL `HttpDispatcher`, the REAL
 * `ObjectStackProtocolImplementation` and the REAL `SysMetadataRepository`
 * over a `sys_metadata`-shaped store, and reads the stored rows back: a 403 with
 * a row behind it is the defect wearing a different status code. The store and
 * registry doubles follow `meta-field-overlay-lock.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpDispatcherResult } from './http-dispatcher.js';

const PKG = 'com.example.crm';
const HATCH = 'flow,object,field,permission,position';

const PACKAGED_FLOW = { name: 'crm_alert', label: 'Alert', type: 'autolaunched', nodes: [], edges: [], _packageId: PKG };
const PACKAGED_OBJECT = {
    name: 'crm_lead',
    label: 'Lead',
    // [#8310] The runtime object door requires an authored OWD — without it the
    // 422 lint door could answer first and a refusal would pass for the wrong reason.
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Lead Name', required: true } },
    _packageId: PKG,
};
const PACKAGED_PERMISSION = { name: 'crm_sales_user', label: 'Sales User', objects: {}, _packageId: PKG };
const PACKAGED_POSITION = { name: 'sales_rep', label: 'Sales Representative', _packageId: PKG };
const PACKAGED_VIEW = {
    name: 'crm_lead.all',
    label: 'All Leads',
    object: 'crm_lead',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
    _packageId: PKG,
};

const strip = (item: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));

/** The managed items the hatch used to open, and the PUT each one is edited with. */
const EDITS: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
    ['flow', PACKAGED_FLOW.name, { ...strip(PACKAGED_FLOW), label: 'Edited in place' }],
    ['object', PACKAGED_OBJECT.name, {
        ...strip(PACKAGED_OBJECT), fields: { name: { type: 'text', label: 'Renamed field', required: true } },
    }],
    ['field', `${PACKAGED_OBJECT.name}.name`, { name: 'name', type: 'text', label: 'Renamed field' }],
    ['permission', PACKAGED_PERMISSION.name, { ...strip(PACKAGED_PERMISSION), label: 'Edited in place' }],
    ['position', PACKAGED_POSITION.name, { ...strip(PACKAGED_POSITION), label: 'Edited in place' }],
];

interface Row { id: string; [k: string]: unknown }

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
        if (cond === undefined) continue;
        if (key === '$or') {
            if (!(cond as Array<Record<string, unknown>>).some((b) => matches(row, b))) return false;
            continue;
        }
        const value = row[key];
        if (cond !== null && typeof cond === 'object') {
            const op = cond as Record<string, unknown>;
            if ('$null' in op) {
                if ((value === null || value === undefined) !== (op.$null === true)) return false;
                continue;
            }
            if ('$in' in op) {
                if (!(op.$in as unknown[]).includes(value)) return false;
                continue;
            }
            continue;
        }
        if (cond === null) {
            if (value !== null && value !== undefined) return false;
            continue;
        }
        if (value !== cond) return false;
    }
    return true;
}

function makeEngine() {
    const tables = new Map<string, Row[]>();
    let nextId = 0;
    const tableOf = (name: string) => {
        let t = tables.get(name);
        if (!t) { t = []; tables.set(name, t); }
        return t;
    };
    const artifacts = new Map<string, Map<string, unknown>>([
        ['flow', new Map<string, unknown>([[PACKAGED_FLOW.name, PACKAGED_FLOW]])],
        ['object', new Map<string, unknown>([[PACKAGED_OBJECT.name, PACKAGED_OBJECT]])],
        ['permission', new Map<string, unknown>([[PACKAGED_PERMISSION.name, PACKAGED_PERMISSION]])],
        ['position', new Map<string, unknown>([[PACKAGED_POSITION.name, PACKAGED_POSITION]])],
        ['view', new Map<string, unknown>([[PACKAGED_VIEW.name, PACKAGED_VIEW]])],
    ]);
    const runtimeItems = new Map<string, Map<string, unknown>>();
    const engine: any = {
        registry: {
            listItems: (type: string) => [
                ...Array.from(artifacts.get(type)?.values() ?? []),
                ...Array.from(runtimeItems.get(type)?.values() ?? []),
            ],
            getItem: (type: string, name: string) => runtimeItems.get(type)?.get(name) ?? artifacts.get(type)?.get(name),
            getArtifactItem: (type: string, name: string) => artifacts.get(type)?.get(name),
            getObject: (name: string) => artifacts.get('object')?.get(name) ?? runtimeItems.get('object')?.get(name),
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
            // The producer's arity: `(type, item, keyStrategy, ownerId?)`.
            registerItem: (type: string, item: any, keyStrategy?: string) => {
                const key = keyStrategy === 'object' ? (item?.object as string) : (item?.name as string);
                if (!key) return;
                let byName = runtimeItems.get(type);
                if (!byName) { byName = new Map(); runtimeItems.set(type, byName); }
                byName.set(key, item);
            },
            registerObject: () => {},
        },
        async find(table: string, opts?: { where?: Record<string, unknown> }) {
            return tableOf(table).filter((r) => matches(r, opts?.where));
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return tableOf(table).find((r) => matches(r, opts?.where)) ?? null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row: Row = { id: (data.id as string) ?? `r_${nextId}`, ...data };
            tableOf(table).push(row);
            return row;
        },
        // [#5619] Both write verbs open with the PRODUCER's own dispatch predicate
        // (`check:engine-double-contract`).
        async update(table: string, data: Record<string, unknown>, opts?: { where?: Record<string, unknown> }) {
            const dispatch = assertEngineUpdateDispatch(data as any, opts as any);
            const rows = tableOf(table);
            const target = dispatch.kind === 'by-id'
                ? rows.find((r) => r.id === dispatch.id)
                : rows.find((r) => matches(r, opts?.where));
            if (target) Object.assign(target, data);
            return target ?? null;
        },
        async delete(table: string, opts?: { where?: Record<string, unknown> }) {
            const dispatch = assertEngineDeleteDispatch(opts as any);
            const rows = tableOf(table);
            const keep = dispatch.kind === 'by-id'
                ? rows.filter((r) => r.id !== dispatch.id)
                : rows.filter((r) => !matches(r, opts?.where));
            tables.set(table, keep);
            return { deleted: rows.length - keep.length };
        },
        async count(table: string, opts?: { where?: Record<string, unknown> }) {
            return tableOf(table).filter((r) => matches(r, opts?.where)).length;
        },
        async aggregate() { return []; },
        async execute() { return undefined; },
        metaRows: () => tableOf('sys_metadata'),
    };
    return engine;
}

function makeStack(environmentId?: string) {
    const engine = makeEngine();
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
    const services: Record<string, unknown> = {
        protocol,
        objectql: { registry: engine.registry },
        auth: { api: { getSession: async () => ({ session: {} }) } },
    };
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    return { engine, dispatcher: new HttpDispatcher(kernel) };
}

/** An authorized caller: `manage_metadata` held, so a 403 below is the seal, never the capability gate. */
const ctx = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: { userId: 'usr_1', systemPermissions: ['manage_metadata'] },
});

function responseOf(result: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    if (!result.response) throw new Error('the dispatcher handled the route but returned no response');
    return result.response;
}

const activeRow = (engine: any, type: string, name: string) =>
    engine.metaRows().find((r: any) => r.type === type && r.name === name && r.state === 'active');

function resetHatch() {
    delete process.env.OS_METADATA_WRITABLE;
    delete process.env.OBJECTSTACK_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
}

beforeEach(() => {
    resetHatch();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    resetHatch();
    vi.restoreAllMocks();
});

describe('[ADR-0131 D6] the dispatcher /meta door: the hatch opens no write onto a managed item', () => {
    for (const variable of ['OS_METADATA_WRITABLE', 'OBJECTSTACK_METADATA_WRITABLE'] as const) {
        for (const environmentId of [undefined, 'env_1']) {
            const kernel = environmentId ? 'environment' : 'host-config';

            it(`${variable}=${HATCH}: PUT of a managed flow, object, field, permission set and position — 403 NOT_OVERRIDABLE, no row (${kernel})`, async () => {
                const shut = makeStack(environmentId);
                const sealed: Array<NonNullable<HttpDispatcherResult['response']>> = [];
                for (const [type, name, body] of EDITS) {
                    sealed.push(responseOf(await shut.dispatcher.handleMetadata(`/${type}/${name}`, ctx(), 'PUT', body)));
                }

                process.env[variable] = HATCH;
                ObjectStackProtocolImplementation.resetEnvWritableCache();
                resetEnvWritableMetadataTypes();
                const { engine, dispatcher } = makeStack(environmentId);
                for (const [i, [type, name, body]] of EDITS.entries()) {
                    const res = responseOf(await dispatcher.handleMetadata(`/${type}/${name}`, ctx(), 'PUT', body));
                    expect(res.status, `${type}/${name}`).toBe(403);
                    expect(res.body?.error?.code, `${type}/${name}`).toBe('NOT_OVERRIDABLE');
                    // The same refusal the shut hatch gets — sentence included.
                    expect(res.body?.error?.message, `${type}/${name}`).toBe(sealed[i].body?.error?.message);
                    expect(activeRow(engine, type, name), `${type}/${name}`).toBeUndefined();
                }
                expect(engine.metaRows()).toEqual([]);
            });

            it(`${variable}=${HATCH}: the read envelope promises no edit and no removal of a managed flow (${kernel})`, async () => {
                process.env[variable] = HATCH;
                ObjectStackProtocolImplementation.resetEnvWritableCache();
                resetEnvWritableMetadataTypes();
                const { dispatcher } = makeStack(environmentId);
                const res = responseOf(await dispatcher.handleMetadata(`/flow/${PACKAGED_FLOW.name}`, ctx(), 'GET', undefined));
                expect(res.status).toBe(200);
                const envelope = (res.body?.data ?? res.body) as { editable?: unknown; deletable?: unknown };
                expect({ editable: envelope?.editable, deletable: envelope?.deletable }).toEqual({ editable: false, deletable: false });
            });

            it(`${variable}=${HATCH} — controls: a packaged VIEW is overlaid, and a NEW flow is created (${kernel})`, async () => {
                process.env[variable] = HATCH;
                ObjectStackProtocolImplementation.resetEnvWritableCache();
                resetEnvWritableMetadataTypes();
                const { engine, dispatcher } = makeStack(environmentId);

                const view = responseOf(await dispatcher.handleMetadata(
                    `/view/${PACKAGED_VIEW.name}`, ctx(), 'PUT', { ...strip(PACKAGED_VIEW), label: 'My Leads' },
                ));
                expect(view.status, JSON.stringify(view.body)).toBe(200);
                expect(activeRow(engine, 'view', PACKAGED_VIEW.name)).toBeDefined();

                const created = responseOf(await dispatcher.handleMetadata(
                    '/flow/crm_new_alert', ctx(), 'PUT',
                    { name: 'crm_new_alert', label: 'New Alert', type: 'autolaunched', nodes: [], edges: [] },
                ));
                expect(created.status, JSON.stringify(created.body)).toBe(200);
                expect(activeRow(engine, 'flow', 'crm_new_alert')).toBeDefined();
            });
        }
    }
});
