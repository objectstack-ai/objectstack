// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24535] The by-name read's EXECUTION face (`getMetaItemForExecution`) is
// the served face (`getMetaItem`) minus the serving decorations, and nothing
// else.
//
// Both faces are one body (`readMetaItemFace` → `readMetaItem`); the face
// decides only what happens at the read's exits. So the parity this file pins
// is exact, not "close enough":
//
//  - THE ITEM: decorating the execution face's item reproduces the served
//    face's item, `toEqual` — `decorateMetadataItem` is the served exit's
//    decoration (`_diagnostics` computed on the raw body, then the type's
//    credential redaction), so this one equality says "the served item minus
//    `_diagnostics` and redaction", for a redacting type as for a plain one.
//  - THE ENVELOPE: every other key (`lock`, `editable`, `version`, `packageId`,
//    …) is equal, save `registration`, which the served face alone carries,
//    as the list read's served face alone carries `registrations`.
//  - THE REFUSALS: a disabled package's object and a missing draft are refused
//    with the same code on both faces.
//  - THE CACHE: an environment-overlay item's active rows are read through ONE
//    overlay-cache entry for both faces, retired by a write for both.
//
// Every parity row also asserts the served item IS decorated, so the equality
// cannot hold by both faces skipping the decoration.
//
// Test-path resolution: every subject is imported by relative specifier, so
// vitest resolves it from this package's source.

import { describe, it, expect } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { decorateMetadataItem } from './metadata-diagnostics.js';
import { metaOverlayCacheEntryCount } from './meta-overlay-cache.js';

type Row = Record<string, unknown>;

const matches = (row: Row, where: Row = {}): boolean => Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$')) throw new Error(`store double: unsupported combinator ${k}`);
    if (v !== null && typeof v === 'object') {
        const set = (v as { $in?: unknown }).$in;
        if (!Array.isArray(set)) throw new Error(`store double: unsupported operator in ${JSON.stringify(v)}`);
        return set.includes(row[k] ?? null);
    }
    return v === undefined || (row[k] ?? null) === (v ?? null);
});

/** A code-registered object: the registry's item, no stored row. */
const CODE_OBJECT = {
    name: 'code_widget',
    label: 'Code Widget',
    fields: { title: { name: 'title', label: 'Title', type: 'text' } },
    enable: { apiMethods: ['get', 'list'] },
};

const objectRow = (name: string, state: 'active' | 'draft', body: Row): Row => ({
    id: `r_${name}_${state}`, type: 'object', name, state, package_id: null,
    metadata: JSON.stringify({ name, fields: {}, ...body }),
});

/** A `datasource` row holding an inline credential — the type with a registered redactor. */
const DATASOURCE_ROW: Row = {
    id: 'r_warehouse', type: 'datasource', name: 'warehouse', state: 'active', package_id: null,
    metadata: JSON.stringify({
        name: 'warehouse', label: 'Warehouse', driver: 'postgres',
        config: { host: 'db.internal', database: 'warehouse', username: 'reporting', password: 'hunter2' },
    }),
};

const FLOW_ROW: Row = {
    id: 'r_flow', type: 'flow', name: 'notify_owner', state: 'active', package_id: null,
    metadata: JSON.stringify({
        name: 'notify_owner', label: 'Notify Owner', type: 'autolaunched',
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
    }),
};

function harness(rows: Row[], opts: { disabledObjects?: string[]; automation?: boolean } = {}) {
    const reads: Row[] = [];
    let epoch = 0;
    const seam = {
        get current() { return epoch; },
        bump(): number { epoch += 1; return epoch; },
        subscribe(): () => void { return () => {}; },
    };
    const disabled = new Set(opts.disabledObjects ?? []);
    const engine: Record<string, unknown> = {
        registry: {
            getItem: (type: string, name: string) =>
                (type === 'object' || type === 'objects') && name === CODE_OBJECT.name
                    ? structuredClone(CODE_OBJECT)
                    : undefined,
            getObject: () => undefined,
            listItems: () => [],
            getPackage: () => undefined,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            isObjectPackageDisabled: (name: string) => disabled.has(name),
            registerItem: () => undefined,
            registerObject: () => undefined,
            applyNavContributions: (app: unknown) => app,
        },
        writeEpoch: seam,
        find: async (table: string, q: { where?: Row; limit?: number } = {}) => {
            if (table !== 'sys_metadata') return [];
            reads.push(structuredClone(q.where ?? {}));
            const hits = rows.filter((r) => matches(r, q.where));
            return typeof q.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where?: Row } = {}) => {
            assertEngineFindOnePredicate(table, q as never);
            if (table !== 'sys_metadata') return null;
            reads.push(structuredClone(q.where ?? {}));
            return rows.find((r) => matches(r, q.where)) ?? null;
        },
    };
    type Middleware = (ctx: { object: string; operation: string }, next: () => Promise<void>) => Promise<void>;
    const middlewares: Middleware[] = [];
    engine.registerMiddleware = (fn: Middleware) => {
        middlewares.push(fn);
    };
    /** A `sys_metadata` write as the engine makes one: the epoch first, then the chain around the row. */
    const write = async (apply: () => void) => {
        seam.bump();
        const chain = [...middlewares];
        let i = 0;
        const next = async (): Promise<void> => {
            if (i < chain.length) return chain[i++]!({ object: 'sys_metadata', operation: 'update' }, next);
            apply();
        };
        await next();
    };
    const services = new Map<string, unknown>();
    if (opts.automation) {
        services.set('automation', { getFlowRegistration: () => ({ state: 'registered' }) });
    }
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, never>) as any;
    return { protocol, engine, reads, write };
}

/** Read one request on both faces. */
async function bothFaces(h: ReturnType<typeof harness>, request: Row) {
    const served = await h.protocol.getMetaItem(structuredClone(request));
    const execution = await h.protocol.getMetaItemForExecution(structuredClone(request));
    return { served, execution };
}

/**
 * THE parity: the served item is the execution item decorated, every other
 * envelope key is equal, and the served item really is decorated.
 */
function expectParity(type: string, served: any, execution: any) {
    expect(served.item, 'the served face found an item').toBeTruthy();
    expect(served.item._diagnostics, 'the served item is decorated (anti-vacuity)').toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(execution.item, '_diagnostics')).toBe(false);
    expect(served.item).toEqual(decorateMetadataItem(type, execution.item));
    const { item: _servedItem, registration: _servedOnly, ...servedEnvelope } = served;
    const { item: _executionItem, ...executionEnvelope } = execution;
    expect(executionEnvelope).toEqual(servedEnvelope);
}

const byNameReads = (reads: Row[], name: string) =>
    reads.filter((w) => w.name === name && JSON.stringify(w.type) === JSON.stringify({ $in: ['object', 'objects'] }));

describe('[#24535] the by-name execution read is the served read minus the serving decorations', () => {
    it('a CODE item: the registry\'s object, no stored row', async () => {
        const h = harness([]);
        const { served, execution } = await bothFaces(h, { type: 'object', name: CODE_OBJECT.name });
        expectParity('object', served, execution);
        expect(execution.item.enable).toEqual(CODE_OBJECT.enable);
        expect(execution.version).toBeNull();
    });

    it('an ENVIRONMENT-OVERLAY item: the stored row, read through ONE overlay-cache entry for both faces', async () => {
        const rows = [objectRow('stored_widget', 'active', { label: 'Stored', enable: { apiMethods: ['get'] } })];
        const h = harness(rows);
        const served = await h.protocol.getMetaItem({ type: 'object', name: 'stored_widget' });
        expect(byNameReads(h.reads, 'stored_widget')).toHaveLength(1);
        // The execution face is served by the entry the served face filled.
        const execution = await h.protocol.getMetaItemForExecution({ type: 'object', name: 'stored_widget' });
        expect(byNameReads(h.reads, 'stored_widget')).toHaveLength(1);
        expect(metaOverlayCacheEntryCount(h.engine)).toBe(1);
        expectParity('object', served, execution);
        expect(execution.item.enable).toEqual({ apiMethods: ['get'] });

        // A write retires the entry for BOTH faces: the execution face reads
        // the store and serves the new row, and the served face is then
        // answered from the entry the execution face filled.
        await h.write(() => {
            rows[0] = objectRow('stored_widget', 'active', { label: 'Stored', enable: { apiMethods: ['get', 'list'] } });
        });
        const executionAfter = await h.protocol.getMetaItemForExecution({ type: 'object', name: 'stored_widget' });
        expect(executionAfter.item.enable).toEqual({ apiMethods: ['get', 'list'] });
        expect(byNameReads(h.reads, 'stored_widget')).toHaveLength(2);
        const servedAfter = await h.protocol.getMetaItem({ type: 'object', name: 'stored_widget' });
        expect(byNameReads(h.reads, 'stored_widget')).toHaveLength(2);
        expectParity('object', servedAfter, executionAfter);
    });

    it('a REDACTING type: the execution item is the stored body, the served one its projection', async () => {
        const h = harness([DATASOURCE_ROW]);
        const { served, execution } = await bothFaces(h, { type: 'datasource', name: 'warehouse' });
        expectParity('datasource', served, execution);
        expect(execution.item.config.password).toBe('hunter2');
        expect(served.item.config.password).toBeUndefined();
    });

    it('the STRICT DRAFT read: the draft row, undecorated, with the same version token', async () => {
        const rows = [
            objectRow('stored_widget', 'active', { label: 'Active' }),
            objectRow('stored_widget', 'draft', { label: 'Draft', enable: { apiMethods: ['get'] } }),
        ];
        const h = harness(rows);
        const { served, execution } = await bothFaces(h, { type: 'object', name: 'stored_widget', state: 'draft' });
        expectParity('object', served, execution);
        expect(execution.item.label).toBe('Draft');
    });

    it('the DRAFT-PREVIEW read: the draft where one exists, the active item where none does', async () => {
        const withDraft = harness([
            objectRow('stored_widget', 'active', { label: 'Active' }),
            objectRow('stored_widget', 'draft', { label: 'Draft' }),
        ]);
        const preview = await bothFaces(withDraft, { type: 'object', name: 'stored_widget', previewDrafts: true });
        expectParity('object', preview.served, preview.execution);
        expect(preview.execution.item).toMatchObject({ label: 'Draft', _draft: true });

        const withoutDraft = harness([objectRow('stored_widget', 'active', { label: 'Active' })]);
        const fallback = await bothFaces(withoutDraft, { type: 'object', name: 'stored_widget', previewDrafts: true });
        expectParity('object', fallback.served, fallback.execution);
        expect(fallback.execution.item.label).toBe('Active');
    });

    it('a missing draft is refused `NO_DRAFT` on both faces', async () => {
        const h = harness([objectRow('stored_widget', 'active', { label: 'Active' })]);
        const request = { type: 'object', name: 'stored_widget', state: 'draft' };
        await expect(h.protocol.getMetaItem({ ...request })).rejects.toMatchObject({ code: 'NO_DRAFT', status: 404 });
        await expect(h.protocol.getMetaItemForExecution({ ...request })).rejects.toMatchObject({ code: 'NO_DRAFT', status: 404 });
    });

    it('an object of a DISABLED package is refused `OBJECT_PACKAGE_DISABLED` on both faces', async () => {
        const h = harness([], { disabledObjects: [CODE_OBJECT.name] });
        const request = { type: 'object', name: CODE_OBJECT.name };
        const servedRefusal = await h.protocol.getMetaItem({ ...request }).catch((e: unknown) => e);
        const executionRefusal = await h.protocol.getMetaItemForExecution({ ...request }).catch((e: unknown) => e);
        expect(servedRefusal).toMatchObject({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
        expect(executionRefusal).toMatchObject({ code: 'OBJECT_PACKAGE_DISABLED', status: 404 });
        expect((executionRefusal as Error).message).toBe((servedRefusal as Error).message);
    });

    it('a name with nothing behind it answers no item on both faces', async () => {
        const h = harness([]);
        const { served, execution } = await bothFaces(h, { type: 'object', name: 'no_such_object' });
        expect(served.item).toBeUndefined();
        expect(execution).toEqual(served);
    });

    it('`registration` is the served face\'s alone, as the list read\'s `registrations` are', async () => {
        const h = harness([FLOW_ROW], { automation: true });
        const { served, execution } = await bothFaces(h, { type: 'flow', name: 'notify_owner' });
        expect(served.registration).toEqual({ state: 'registered' });
        expect(Object.prototype.hasOwnProperty.call(execution, 'registration')).toBe(false);
        expectParity('flow', served, execution);
    });
});
