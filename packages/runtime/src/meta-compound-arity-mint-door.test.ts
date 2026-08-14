// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8421 — the COMPOUND `/meta` arity survives the unrecognised-type refusal,
 * pinned at the LIVE ROUTE.
 *
 * `/metadata/lead/views/all_leads` is `type='lead'`, `name='views/all_leads'`:
 * ONE operation reaching ONE `saveMetaItem`, the shape this dispatcher's own
 * `/meta` branch documents verbatim ("compound names are how the client
 * expresses sub-resources of a type"). The segment in the `:type` position is an
 * OBJECT name — runtime data, which no static contract can enumerate — so a
 * static type verdict applied there refuses every object name that is not
 * coincidentally a metadata type.
 *
 * ## Why this file exists rather than one more case next door
 *
 * `domains/meta-save-capability-gate.test.ts` already drives this exact path,
 * and it stayed GREEN through the regression: its caller holds no capabilities,
 * so `PERMISSION_DENIED` answers before the protocol is ever resolved, and its
 * `saveMetaItem` is a `vi.fn()` that could not have refused anything anyway. The
 * site was masked, not unaffected — a 403 arriving first is not evidence about
 * what the door behind it does. So every case here holds `manage_metadata` and
 * drives the REAL `ObjectStackProtocolImplementation` over a real store, and
 * then reads the stored ROW rather than the response body.
 *
 * ⚠️ `packages/runtime` resolves `@objectstack/metadata-protocol` through its
 * built `dist`, and stack traces are source-mapped back to `src` — so any
 * ablation of the refusal must REBUILD that package before it proves anything.
 * A source-only revert measures the pre-mutation artifact and stays green.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Deleting the compound exemption from `refuseUnmintableMetaType` (the
 * `request.name.includes('/')` line) and rebuilding must turn the two compound
 * cases RED — `400 INVALID_REQUEST`, no row — and leave the simple-arity
 * refusal and the recognised-type control GREEN. Predicted 2 red / 3 green;
 * measured 2 red / 3 green.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so this double
// cannot accept a call the real ObjectQL engine would refuse. Imported from
// `@objectstack/metadata-core` and never `@objectstack/objectql`.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpDispatcherResult } from './http-dispatcher.js';

interface Row { id: string; [k: string]: unknown }

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
    if (!where) return true;
    for (const [key, cond] of Object.entries(where)) {
        if (cond === undefined) continue;
        // ⚠️ Conjoined with its siblings, never early-returned (#7846 / #7620).
        if (key === '$or') {
            const branches = cond as Array<Record<string, unknown>>;
            if (!branches.some((b) => matches(row, b))) return false;
            continue;
        }
        const value = row[key];
        if (cond !== null && typeof cond === 'object') {
            const op = cond as Record<string, unknown>;
            if ('$null' in op) {
                const isNull = value === null || value === undefined;
                if (isNull !== (op.$null === true)) return false;
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

/** The object the compound arity addresses — runtime-authored, no `_packageId`. */
const LEAD_OBJECT = {
    name: 'lead',
    label: 'Lead',
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
};

function makeEngine() {
    const tables = new Map<string, Row[]>();
    let nextId = 0;
    const tableOf = (name: string) => {
        let t = tables.get(name);
        if (!t) { t = []; tables.set(name, t); }
        return t;
    };
    const runtimeItems = new Map<string, Map<string, unknown>>([
        ['object', new Map<string, unknown>([[LEAD_OBJECT.name, LEAD_OBJECT]])],
    ]);

    const engine: any = {
        registry: {
            listItems: (type: string) => Array.from(runtimeItems.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => runtimeItems.get(type)?.get(name),
            // Nothing here is package-stamped, so nothing is artifact-backed.
            getArtifactItem: () => undefined,
            getObject: (name: string) => runtimeItems.get('object')?.get(name),
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
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
            return tableOf(table).find((r) => matches(r, opts?.where)) ?? null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row: Row = { id: (data.id as string) ?? `r_${nextId}`, ...data };
            tableOf(table).push(row);
            return row;
        },
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
            const deleted = rows.length - keep.length;
            tables.set(table, keep);
            return { deleted };
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

function makeDispatcher(protocol: unknown, engine: any) {
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
    return new HttpDispatcher(kernel);
}

/**
 * An authorized context. Without `manage_metadata` (#7019) every PUT 403s
 * before the mint door is reached — which is precisely how the compound site
 * stayed green while it was broken.
 */
const ctx = (): any => ({
    request: { headers: {} },
    environmentId: 'env_1',
    executionContext: { userId: 'usr_1', systemPermissions: ['manage_metadata'] },
});

function makeStack() {
    const engine = makeEngine();
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), undefined);
    return { engine, protocol, dispatcher: makeDispatcher(protocol, engine) };
}

const metaRow = (engine: any, type: string, name: string) =>
    engine.metaRows().find((r: any) => r.type === type && r.name === name && r.state === 'active');

function responseOf(result: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
    const response = result.response;
    if (!response) throw new Error('the dispatcher handled the route but returned no response');
    return response;
}

describe('#8421 — the compound `/meta` arity is not a metadata-type claim', () => {
    beforeEach(() => {
        // The protocol logs degradation lines on these paths; not the subject.
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('saves a sub-resource addressed under an OBJECT name', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/lead/views/all_leads', ctx(), 'PUT',
            { name: 'all_leads', label: 'All Leads', columns: ['name'] },
        ));

        expect(res.status).toBe(200);
        // The stored ROW, not the answer: the compound name is reassembled and
        // used as ONE key — not split, not truncated to its last segment.
        expect(metaRow(engine, 'lead', 'views/all_leads')).toBeDefined();
        expect(metaRow(engine, 'lead', 'all_leads')).toBeUndefined();
    });

    it('…on a deeper compound name too', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/lead/views/all_leads/columns', ctx(), 'PUT', { name: 'columns', label: 'Columns' },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'lead', 'views/all_leads/columns')).toBeDefined();
    });

    it('ANTI-VACUITY — the same object name at the SIMPLE arity is still refused', async () => {
        // The line between the two arities. At `/meta/:type/:name` the first
        // segment IS a type claim, so `lead` is refused there — otherwise this
        // file would be pinning "the refusal stopped firing" and calling it a
        // fix. ADR-0112: code AND status, never "it threw".
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/lead/all_leads', ctx(), 'PUT', { name: 'all_leads', label: 'All Leads' },
        ));

        expect(res.status).toBe(400);
        expect(res.body?.error?.code).toBe('INVALID_REQUEST');
        expect(metaRow(engine, 'lead', 'all_leads')).toBeUndefined();
    });

    it('CONTROL — a recognised type at the simple arity is unaffected', async () => {
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/theme/midnight', ctx(), 'PUT', { name: 'midnight', label: 'Midnight' },
        ));

        expect(res.status).toBe(200);
        expect(metaRow(engine, 'theme', 'midnight')).toBeDefined();
    });

    it('CONTROL — the capability gate still fires first on the compound form', async () => {
        // #7019's gate is what masked this site, and it must keep masking an
        // UNAUTHORIZED caller: the fix moved the door behind it, not the gate.
        const { engine, dispatcher } = makeStack();

        const res = responseOf(await dispatcher.handleMetadata(
            '/lead/views/all_leads',
            { request: { headers: {} }, environmentId: 'env_1', executionContext: { userId: 'u', systemPermissions: [] } } as any,
            'PUT',
            { name: 'all_leads', label: 'All Leads' },
        ));

        expect(res.status).toBe(403);
        expect(res.body?.error?.code).toBe('PERMISSION_DENIED');
        expect(metaRow(engine, 'lead', 'views/all_leads')).toBeUndefined();
    });
});
