// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6, regime C] The `/meta` door is not a third way to author a
 * sharing rule — pinned at the RUNTIME DISPATCHER's `/meta` door
 * (`HttpDispatcher.handleMetadata`, the transport the `@objectstack/hono`
 * catch-all serves).
 *
 * A sharing rule has two sources: a package declares it (served from the
 * registry, switched off through the activation ledger) and an organization
 * authors its own (`sys_sharing_rule`, through `POST /api/v1/sharing/rules`,
 * behind the same-name guard and the organization wall). `sharing_rule` had no
 * metadata-type registry entry, so `GET /meta/types` advertised it
 * `allowRuntimeCreate: true` and `PUT /meta/sharing_rule/:name` answered 200
 * with an environment-wide item the sharing service then enforced — past both
 * guards. The registry now declares the type code-only.
 *
 * What is pinned, on both kernel shapes:
 *  - a create of a new name — `403` `NOT_CREATABLE`, in publish and draft mode,
 *    no row, nothing registered;
 *  - a write over a declared rule's name — `403` `NOT_OVERRIDABLE`, no row;
 *  - both refusals name the organization door and the activation ledger's
 *    switch, under the REST door's 500-character message bound;
 *  - the listing — `allowRuntimeCreate: false`, `allowEnvironmentOverlay: false`;
 *  - the control: a new position is still created (`200`, a row), so the
 *    refusal is the type's, not the door's.
 *
 * Every case drives the REAL `HttpDispatcher`, the REAL
 * `ObjectStackProtocolImplementation` and the REAL `SysMetadataRepository`
 * over a `sys_metadata`-shaped store, and reads the stored rows back. The store
 * and registry doubles follow `meta-managed-content-seal.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpDispatcherResult } from './http-dispatcher.js';

const PKG = 'com.example.crm';

const DECLARED_RULE = {
    type: 'criteria',
    name: 'crm_share_open_leads',
    label: 'Open Leads → Sales',
    object: 'crm_lead',
    condition: "record.status == 'open'",
    accessLevel: 'read',
    sharedWith: { type: 'position', value: 'sales_rep' },
    active: true,
    _packageId: PKG,
};

const strip = (item: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(item).filter(([k]) => !k.startsWith('_')));

/** The two routes a refusal names: the organization door, and the activation ledger's switch. */
const SANCTIONED_ROUTES = ['POST /api/v1/sharing/rules', 'POST /api/v1/security/_activation/sharing_rule/:name'];

/** A spec-valid rule under a name nothing declares — the probe the gap was measured with. */
const PROBE_RULE = { ...strip(DECLARED_RULE), name: 'probe_meta_rule', label: 'Probe' };

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
        ['sharing_rule', new Map<string, unknown>([[DECLARED_RULE.name, DECLARED_RULE]])],
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
            getObject: () => undefined,
            // The type listing (`GET /meta/types`) reads the live types from here.
            getRegisteredTypes: () => ['sharing_rule', 'position'],
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
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            const rows = tableOf(table).filter((r) => matches(r, opts?.where));
            // The caller's bound, applied after the filter (`check:objectql-double-limit`).
            return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
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
        runtimeItem: (type: string, name: string) => runtimeItems.get(type)?.get(name),
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

/** An authorized caller: `manage_metadata` held, so a 403 below is the type's, never the capability gate. */
const ctx = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: { userId: 'usr_1', systemPermissions: ['manage_metadata'] },
});

function responseOf(result: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    if (!result.response) throw new Error('the dispatcher handled the route but returned no response');
    return result.response;
}

const rowsOf = (engine: any, type: string, name: string) =>
    engine.metaRows().filter((r: any) => r.type === type && r.name === name);

function resetHatch() {
    delete process.env.OS_METADATA_WRITABLE;
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

describe('[ADR-0131 D6] the dispatcher /meta door authors no sharing rule', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';

        for (const query of [undefined, { mode: 'draft' }]) {
            const mode = query ? 'draft' : 'publish';

            it(`PUT /meta/sharing_rule/<new name> (${mode}) — 403 NOT_CREATABLE naming the organization door; no row, nothing registered (${kernel})`, async () => {
                const { engine, dispatcher } = makeStack(environmentId);
                const res = responseOf(await dispatcher.handleMetadata(
                    `/sharing_rule/${PROBE_RULE.name}`, ctx(), 'PUT', PROBE_RULE, query,
                ));
                expect(res.status, JSON.stringify(res.body)).toBe(403);
                expect(res.body?.error?.code).toBe('NOT_CREATABLE');
                // The prescription names both sanctioned paths, not a source glob, and
                // arrives whole through the REST door, which truncates a message of
                // 500 characters or more (`truncateClientMessage`).
                const message = String(res.body?.error?.message);
                for (const route of SANCTIONED_ROUTES) expect(message).toContain(route);
                expect(message.length).toBeLessThan(500);
                expect(rowsOf(engine, 'sharing_rule', PROBE_RULE.name)).toEqual([]);
                expect(engine.runtimeItem('sharing_rule', PROBE_RULE.name)).toBeUndefined();
            });
        }

        it(`PUT /meta/sharing_rule/<declared name> — 403 NOT_OVERRIDABLE; no row (${kernel})`, async () => {
            const { engine, dispatcher } = makeStack(environmentId);
            const res = responseOf(await dispatcher.handleMetadata(
                `/sharing_rule/${DECLARED_RULE.name}`, ctx(), 'PUT', { ...strip(DECLARED_RULE), accessLevel: 'edit' },
            ));
            expect(res.status, JSON.stringify(res.body)).toBe(403);
            expect(res.body?.error?.code).toBe('NOT_OVERRIDABLE');
            const message = String(res.body?.error?.message);
            for (const route of SANCTIONED_ROUTES) expect(message).toContain(route);
            expect(message.length).toBeLessThan(500);
            expect(rowsOf(engine, 'sharing_rule', DECLARED_RULE.name)).toEqual([]);
        });

        it(`GET /meta/types advertises no runtime create and no overlay for sharing_rule (${kernel})`, async () => {
            const { dispatcher } = makeStack(environmentId);
            const listing = responseOf(await dispatcher.handleMetadata('/types', ctx(), 'GET', undefined));
            expect(listing.status).toBe(200);
            const entries = ((listing.body?.data ?? listing.body) as { entries?: any[] })?.entries ?? [];
            const entry = entries.find((e) => e.type === 'sharing_rule');
            expect(entry, 'sharing_rule is listed').toBeDefined();
            expect({ allowRuntimeCreate: entry.allowRuntimeCreate, allowEnvironmentOverlay: entry.allowEnvironmentOverlay })
                .toEqual({ allowRuntimeCreate: false, allowEnvironmentOverlay: false });
        });

        it(`control: a new position is still created through the same door (${kernel})`, async () => {
            const { engine, dispatcher } = makeStack(environmentId);
            const res = responseOf(await dispatcher.handleMetadata(
                '/position/crm_new_position', ctx(), 'PUT', { name: 'crm_new_position', label: 'New Position' },
            ));
            expect(res.status, JSON.stringify(res.body)).toBe(200);
            expect(rowsOf(engine, 'position', 'crm_new_position')).toHaveLength(1);
        });
    }
});
