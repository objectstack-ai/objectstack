// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4432 — the `/meta` type segment folds to ONE canonical namespace.
 *
 * #3985 made the per-type GATES accept both spellings of the type segment. It
 * did not fold them, so `PUT /meta/actions/x` and `PUT /meta/action/x` addressed
 * two different overlay namespaces and the layers below disagreed about which
 * one an item lived in. The worst of it was not the duplicate row — it was the
 * shadowing: `getMetaItems` registered overlay rows back into the SchemaRegistry
 * under the CALLER's spelling, so one plural-spelled read minted a plural
 * registry entry, `listItems('actions')` stopped being empty, and the singular
 * fallback that had been supplying every code-authored action never ran again.
 * One overlay row hid an entire code-authored listing, on a spelling that no
 * DELETE could reach.
 *
 * These tests are written against the shape of the defect, not its wording:
 * each fails if the fold is removed from `getMetaItems` / `getMetaItem` /
 * `saveMetaItem` / `deleteMetaItem`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';

/** One env-wide, active overlay row for `rc1_probe`, stored under the canonical type. */
const OVERLAY_ROW = {
    id: 'row_1',
    type: 'action',
    name: 'rc1_probe',
    state: 'active',
    organization_id: null,
    package_id: null,
    version: 1,
    metadata: JSON.stringify({ name: 'rc1_probe', label: 'Probe' }),
};

describe('#4432 — canonical `/meta` type segment', () => {
    let registry: SchemaRegistry;
    let engine: any;
    let protocol: ObjectStackProtocolImplementation;
    let rows: any[];

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        // Two CODE-AUTHORED actions, indexed the way the artifact loader indexes
        // them: under the SINGULAR metadata type name (Prime Directive #3).
        registry.registerItem('action', { name: 'code_one', label: 'One' }, 'name');
        registry.registerItem('action', { name: 'code_two', label: 'Two' }, 'name');

        rows = [OVERLAY_ROW];
        engine = {
            registry,
            find: vi.fn(async (_table: string, opts: any) => {
                const w = opts?.where ?? {};
                return rows.filter((r) =>
                    (w.type === undefined || r.type === w.type)
                    && (w.name === undefined || r.name === w.name)
                    && (w.state === undefined || r.state === w.state)
                    && (w.organization_id === undefined || r.organization_id === w.organization_id));
            }),
            findOne: vi.fn(async (table: string, opts: any) => {
                const found = await engine.find(table, opts);
                return found[0] ?? null;
            }),
            insert: vi.fn(async () => ({ id: 'new' })),
            update: vi.fn(async (_t: string, data: any, opts?: any) => {
                assertEngineUpdateDispatch(data, opts);
                return { id: 'row_1' };
            }),
            delete: vi.fn(async (_t: string, opts: any) => {
                assertEngineDeleteDispatch(opts);
                const id = opts?.where?.id;
                rows = rows.filter((r) => r.id !== id);
                return { deleted: 1 };
            }),
            count: vi.fn(async () => 0),
            aggregate: vi.fn(async () => []),
        };
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    const namesOf = (res: any): string[] =>
        (Array.isArray(res) ? res : res?.items ?? []).map((i: any) => i?.name).sort();

    it('a plural-spelled list is artifact ∪ overlay — never overlay-only', async () => {
        // The step-3 symptom: `GET /meta/actions` returned ONLY the overlay and
        // hid every code-authored action.
        expect(namesOf(await protocol.getMetaItems({ type: 'actions' })))
            .toEqual(['code_one', 'code_two', 'rc1_probe']);
        expect(namesOf(await protocol.getMetaItems({ type: 'action' })))
            .toEqual(['code_one', 'code_two', 'rc1_probe']);
    });

    it('reading the plural spelling does not mint a phantom namespace', async () => {
        // The mechanism, pinned directly. The first read used to REGISTER the
        // overlay under the plural key; from the second read on, the non-empty
        // `listItems('actions')` suppressed the singular fallback and the
        // code-authored actions were gone for the rest of the process — and the
        // phantom outlived any DELETE, because nothing addresses that key.
        await protocol.getMetaItems({ type: 'actions' });

        expect(registry.listItems('actions')).toEqual([]);
        expect(namesOf(await protocol.getMetaItems({ type: 'actions' })))
            .toEqual(['code_one', 'code_two', 'rc1_probe']);
        // …and repeated reads stay stable rather than degrading once more.
        await protocol.getMetaItems({ type: 'actions' });
        expect(namesOf(await protocol.getMetaItems({ type: 'action' })))
            .toEqual(['code_one', 'code_two', 'rc1_probe']);
    });

    it('both spellings resolve the same single item', async () => {
        const plural: any = await protocol.getMetaItem({ type: 'actions', name: 'rc1_probe' });
        const singular: any = await protocol.getMetaItem({ type: 'action', name: 'rc1_probe' });
        expect(plural?.item?.name).toBe('rc1_probe');
        expect(singular?.item?.name).toBe('rc1_probe');
        // The response states the CANONICAL type, so a client cannot round-trip
        // a non-canonical spelling back into a second namespace.
        expect(plural?.type).toBe('action');
        expect(singular?.type).toBe('action');
    });

    /**
     * Every `type` any storage lookup was issued against during the calls so
     * far. The write and delete paths run through `SysMetadataRepository`,
     * whose full transaction/history machinery is out of scope for a mock — but
     * the namespace question is answerable without it.
     *
     * Stated plainly: the two assertions below already held before this fix.
     * `SysMetadataRepository` folded to singular on its own, so the ROW was
     * always canonical; what read the caller's spelling was everything around
     * it — the authorization tier, the registry heal, and (the damaging one)
     * `getMetaItems`' registry hydration. These pin the property so a future
     * change cannot reintroduce the split from the write side either.
     */
    const queriedTypes = (): string[] => {
        const types = new Set<string>();
        for (const call of [...engine.find.mock.calls, ...engine.findOne.mock.calls]) {
            const t = call?.[1]?.where?.type;
            if (typeof t === 'string') types.add(t);
        }
        return [...types].sort();
    };

    it('a plural-spelled write addresses the canonical namespace and no other', async () => {
        await protocol.saveMetaItem({
            type: 'actions',
            name: 'rc1_probe2',
            item: { name: 'rc1_probe2', label: 'Probe 2', target: 'noop' },
        }).catch(() => { /* repository machinery is out of scope — the lookups are not */ });

        const types = queriedTypes();
        expect(types.length).toBeGreaterThan(0);
        expect(types).toContain('action');
        expect(types).not.toContain('actions');

        const writtenTypes = [
            ...engine.insert.mock.calls.map((c: any[]) => c[1]?.type),
            ...engine.update.mock.calls.map((c: any[]) => c[1]?.type),
        ].filter((t) => typeof t === 'string');
        expect(writtenTypes).not.toContain('actions');
    });

    it('a plural-spelled DELETE addresses the canonical namespace and no other', async () => {
        // The step-4 symptom: the row a plural PUT created was unreachable by
        // either spelling, because the authorization tier and the registry heal
        // read the caller's spelling while the repository deleted the singular.
        await protocol.deleteMetaItem({ type: 'actions', name: 'rc1_probe' })
            .catch(() => { /* as above */ });

        const types = queriedTypes();
        expect(types.length).toBeGreaterThan(0);
        expect(types).toContain('action');
        expect(types).not.toContain('actions');
    });
});
