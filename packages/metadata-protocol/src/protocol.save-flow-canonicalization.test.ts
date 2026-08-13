// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4542 — `saveMetaItem` canonicalizes flow bodies on write.
 *
 * The read path serves stored flows verbatim (the ADR-0078 conflict guard
 * needs the engine's executor registry), and `FlowNodeSchema.config` is an
 * open record — so before this fix a Studio round-trip (GET legacy dialect →
 * edit label → PUT it back) re-persisted the pre-protocol shape and the row
 * stayed `pending` in `os migrate meta --stored` forever. Every other type is
 * healed by an author's save; these tests pin that flows now are too.
 *
 * Harness: the real repository write path (stub engine with findOne / find /
 * insert / update, as in objectql's protocol-save-meta-repo-path tests) plus
 * the services-table canonicalizer stub from protocol.flow-canonicalizer.test
 * — the existing flow-canonicalizer harness mocks `saveMetaItem` itself, which
 * a fix INSIDE `saveMetaItem` cannot use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// [#5619] `assertEngine{Delete,Update}Dispatch` are the producer's OWN write-verb
// dispatch decisions (#4550 delete / #5480 update), so the fake engine below
// cannot accept a call ObjectQL refuses. They arrive from
// `@objectstack/metadata-core` and not from `@objectstack/objectql`: objectql
// DEPENDS ON this package, so that import would close a dependency cycle turbo
// rejects outright — which is why all 26 of this package's (file, verb) pairs sat
// in the gate's DEBT ledger until #5619 sank the two predicates into a package
// both sides already depend on.
import {
  hashSpec,
  assertEngineDeleteDispatch,
  assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** A flow body that passes `saveMetaItem`'s schema gate. */
const flowBody = (config: Record<string, unknown>) => ({
    name: 'purge_flow',
    label: 'Purge Stale Leads',
    type: 'autolaunched',
    status: 'active',
    nodes: [{ id: 'n1', type: 'delete_record', label: 'Purge', config }],
    edges: [],
});

/**
 * Stands in for `AutomationEngine.canonicalizeStoredFlow` — same contract,
 * including the copy-on-write identity an unchanged body comes back with.
 */
const canonicalizeStoredFlow = (_name: string, body: any) => {
    const node = body?.nodes?.[0];
    if (!node || !('filters' in (node.config ?? {}))) {
        return { storable: body, notices: [], conflicts: [] };
    }
    const { filters, ...rest } = node.config;
    return {
        storable: { ...body, nodes: [{ ...node, config: { ...rest, filter: filters } }] },
        notices: [{
            conversionId: 'flow-node-crud-filter-alias',
            surface: 'flow.node.config.filter',
            from: 'filters',
            to: 'filter',
            path: 'flows[0].nodes[0].config',
            message: 'filters → filter',
        }],
        conflicts: [],
    };
};

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;
}

/** The engine surface the repository write path touches. */
function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
        },
    };
    return { engine, rows };
}

function makeProtocol(services: Map<string, any> = new Map()) {
    const { engine, rows } = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(engine, () => services);
    return { protocol, rows, services };
}

const storedFlow = (rows: Map<string, Row>) => {
    const row = Array.from(rows.values()).find((r) => r.type === 'flow');
    return row ? { row, body: JSON.parse(row.metadata) } : undefined;
};

const save = (protocol: any, item: unknown, extra: Record<string, unknown> = {}) =>
    protocol.saveMetaItem({ type: 'flow', name: 'purge_flow', item, ...extra });

describe('saveMetaItem canonicalizes flow bodies (#4542)', () => {
    const legacyBody = () => flowBody({ objectName: 'lead', filters: { status: 'stale' } });

    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    /**
     * Only the throw-fallback's own warnings. The protocol emits unrelated
     * one-shot warnings (e.g. #3770's "engine has no schema registry"), and
     * whether one has already fired depends on test order — matching on the
     * message keeps these assertions immune to that.
     */
    const fallbackWarnings = (): string[] => (warn.mock.calls as unknown[][])
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes('WITHOUT canonicalization'));

    it('a legacy dialect is healed by the save — the promise every other type already keeps', async () => {
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );

        const result = await save(protocol, legacyBody());

        expect(result.success).toBe(true);
        const stored = storedFlow(rows)!;
        expect(stored.body.nodes[0].config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
        expect(stored.body.nodes[0].config).not.toHaveProperty('filters');
        // The checksum pairs with the CANONICAL body — what the row holds is
        // what was hashed, so history/OCC stay coherent.
        expect(stored.row.checksum).toBe(hashSpec(stored.body));
    });

    it('a refused rename fails the save loudly and persists NOTHING', async () => {
        const conflicting = () => ({
            storable: {},
            notices: [],
            conflicts: [{
                conversionId: 'flow-node-type-open-namespace',
                token: 'http_request',
                path: 'flows[0].nodes[0].type',
                message: 'a custom executor owns this node type here',
            }],
        });
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: conflicting }]]),
        );

        await expect(save(protocol, legacyBody())).rejects.toMatchObject({
            code: 'FLOW_CONVERSION_CONFLICT',
            status: 409,
        });
        await expect(save(protocol, legacyBody())).rejects.toThrow(/'http_request' at flows\[0\]\.nodes\[0\]\.type is a live name in this environment/);
        expect(rows.size).toBe(0);
    });

    it('a canonicalizer throw falls back to the raw save — today\'s gate stays the arbiter', async () => {
        // `canonicalizeStoredFlow` is stricter than the schema gate (cycle
        // detection, control-flow regions). A WIP draft that saves fine today
        // must not become unsaveable.
        const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );

        const result = await save(protocol, legacyBody());

        expect(result.success).toBe(true);
        expect(storedFlow(rows)!.body.nodes[0].config).toHaveProperty('filters');
    });

    it('a canonicalizer throw does NOT rescue a body the schema gate rejects', async () => {
        const throwing = () => { throw new Error("Unrecognized key: '_uiPosition'"); };
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );

        await expect(
            save(protocol, { ...legacyBody(), _uiPosition: { x: 1, y: 2 } }),
        ).rejects.toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(rows.size).toBe(0);
    });

    it('no automation service reachable → saved exactly as today', async () => {
        // A control-plane / metadata-only host must not start refusing flow
        // writes it accepted yesterday. The row is then no better than before —
        // `os migrate meta --stored` reports it.
        const { protocol, rows } = makeProtocol(new Map());

        const result = await save(protocol, legacyBody());

        expect(result.success).toBe(true);
        expect(storedFlow(rows)!.body.nodes[0].config).toHaveProperty('filters');
    });

    it('an already-canonical body persists byte-identical (copy-on-write identity)', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        const body = flowBody({ objectName: 'lead', filter: { status: 'stale' } });

        await save(protocol, body);

        expect(spy).toHaveBeenCalledTimes(1);
        expect(storedFlow(rows)!.body).toEqual(body);
    });

    it('draft mode canonicalizes the same way', async () => {
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );

        const result = await save(protocol, legacyBody(), { mode: 'draft' });

        expect(result.success).toBe(true);
        const stored = storedFlow(rows)!;
        expect(stored.row.state).toBe('draft');
        expect(stored.body.nodes[0].config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
    });

    it('draft mode keeps the throw-fallback too — a WIP cycle stays saveable', async () => {
        const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
        const { protocol, rows } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );

        const result = await save(protocol, legacyBody(), { mode: 'draft' });

        expect(result.success).toBe(true);
        expect(storedFlow(rows)!.body.nodes[0].config).toHaveProperty('filters');
    });

    it('resolution is LAZY — a service registered after construction is still found', async () => {
        const services = new Map<string, any>();
        const { protocol, rows } = makeProtocol(services);
        services.set('automation', { canonicalizeStoredFlow });

        await save(protocol, legacyBody());

        expect(storedFlow(rows)!.body.nodes[0].config).not.toHaveProperty('filters');
    });

    it('the canonicalizer is called with the request NAME, not the body', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        await save(protocol, legacyBody());
        expect(spy.mock.calls[0][0]).toBe('purge_flow');
    });

    // ── #4580: the throw-fallback is correct, but it must not be silent ──

    it('a throw-fallback SAYS SO — naming the flow and the canonicalizer\'s own reason', async () => {
        // Before #4580 this posture was the only one with no signal at all: a
        // save that skipped canonicalization looked exactly like one that
        // healed the row, and a body that is BOTH legacy and unparseable
        // re-persisted verbatim while the boot warning told the author that
        // re-saving would fix it.
        const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );

        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(1);
        const msg = fallbackWarnings()[0];
        expect(msg).toContain('flow/purge_flow');
        expect(msg).toContain('cycle detected: n1 → n1');
        expect(msg).toContain('os migrate meta --stored');
    });

    it('the fallback warning is deduped per flow — Studio autosave must not spam', async () => {
        const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );

        await save(protocol, legacyBody());
        await save(protocol, legacyBody());
        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(1);
    });

    it('the clean path stays silent — a healed row needs no warning', async () => {
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );

        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(0);
    });

    it('the conflict path stays silent — the 409 IS the signal', async () => {
        const conflicting = () => ({
            storable: {},
            notices: [],
            conflicts: [{
                conversionId: 'flow-node-type-open-namespace',
                token: 'http_request',
                path: 'flows[0].nodes[0].type',
                message: 'a custom executor owns this name here.',
            }],
        });
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: conflicting }]]),
        );

        await expect(save(protocol, legacyBody())).rejects.toMatchObject({ status: 409 });

        expect(fallbackWarnings()).toHaveLength(0);
    });

    it('a host with no automation service stays silent — nothing was skipped', async () => {
        // There is no canonicalizer to fall back FROM; `os migrate meta
        // --stored` is what reports these rows.
        const { protocol } = makeProtocol(new Map());

        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(0);
    });

    it('non-flow saves never consult the canonicalizer', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        await protocol.saveMetaItem({
            type: 'view',
            name: 'case_grid',
            organizationId: 'org_alpha',
            // [#7741] carries the object binding the inline arm now requires.
            item: { name: 'case_grid', type: 'grid', label: 'Cases', columns: ['id', 'title'], object: 'case', viewKind: 'list' },
        });
        expect(spy).not.toHaveBeenCalled();
    });
});
