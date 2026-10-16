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
 *
 * [#23775, ruling B] The healing is a RE-SAVE's: a flow with no stored row at
 * the save's address is authored input, canonicalized without the entries
 * retired from the authoring funnel, so a retired spelling on a new flow is
 * refused (the last describe block). The pins below that heal or keep a legacy
 * spelling therefore seed the stored row they re-save ({@link seedStoredFlow}),
 * the only way a retired spelling is still at rest today.
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
  assertEngineUpdateDispatch, assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackDefinitionSchema, applyConversionsToFlow, normalizeStackInput } from '@objectstack/spec';
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
 *
 * [#23775] …and its `includeRetired` option. `filters` → `filter` is retired
 * from the authoring funnel (`flow-node-crud-filter-alias`), so with the window
 * closed the engine leaves `filters` in place and its strict parse throws, as
 * `service-automation`'s `canonicalize-stored-flow.test.ts` pins for the real
 * engine. The door then judges the body itself, with the spec's own schema.
 */
const canonicalizeStoredFlow = (_name: string, body: any, options: { includeRetired?: boolean } = {}) => {
    const node = body?.nodes?.[0];
    if (!node || !('filters' in (node.config ?? {}))) {
        return { storable: body, notices: [], conflicts: [] };
    }
    if (options.includeRetired === false) {
        throw new Error('Unrecognized key(s) on this delete_record node config: `filters`');
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
    // ⚠️ Keyed BY TABLE, and that is a correctness property of this harness
    // rather than tidiness. One flat row map answers a read of `sys_metadata`
    // with rows the protocol wrote to `sys_metadata_history` and
    // `sys_metadata_commit`: a DRAFT save appends a history row carrying no
    // `state`, the declared `defaultValue: 'active'` modelled below fills it
    // in, and the draft comes back as an ACTIVE metadata row. Measured in
    // #16223, where one assertion's polarity was the only thing that caught it.
    const tables = new Map<string, Map<string, Row>>();
    const tableOf = (table: string): Map<string, Row> => {
        const existing = tables.get(table);
        if (existing) return existing;
        const created = new Map<string, Row>();
        tables.set(table, created);
        return created;
    };
    /** The store table these tests assert on; the journals get their own. */
    const rows = tableOf('sys_metadata');
    let nextId = 0;
    const findRow = (table: string, w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of tableOf(table)) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of tableOf(table)) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(table, opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            return Array.from(tableOf(table).values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            tableOf(table).set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(table, opts.where);
            if (!found) return { id: null };
            tableOf(table).set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(table, opts.where);
            if (!found) return { deleted: 0 };
            tableOf(table).delete(found.key);
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
    return { protocol, rows, services, engine };
}

/** The flow row at one lifecycle (the active one unless asked). */
const storedFlow = (rows: Map<string, Row>, state: 'active' | 'draft' = 'active') => {
    const row = Array.from(rows.values()).find((r) => r.type === 'flow' && r.state === state);
    return row ? { row, body: JSON.parse(row.metadata) } : undefined;
};

/**
 * [#23775] A flow row AT REST, written straight to the store as `put` stamps
 * one — how a retired spelling is still stored: the door refuses it on a new
 * flow, so no save can mint one.
 */
async function seedStoredFlow(engine: any, body: Record<string, unknown>, state: 'active' | 'draft' = 'active') {
    await engine.insert('sys_metadata', {
        type: 'flow',
        name: 'purge_flow',
        organization_id: null,
        package_id: null,
        state,
        metadata: JSON.stringify(body),
        checksum: hashSpec(body, 'flow'),
        version: 1,
    });
}

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

    it('a stored legacy dialect is healed by its re-save — the promise every other type already keeps', async () => {
        const { protocol, rows, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );
        await seedStoredFlow(engine, legacyBody());

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
        const { protocol, rows, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );
        await seedStoredFlow(engine, legacyBody());

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

    it('no automation service reachable → a stored row re-saves exactly as today', async () => {
        // A control-plane / metadata-only host must not start refusing flow
        // writes it accepted yesterday. The row is then no better than before —
        // `os migrate meta --stored` reports it. [#23775] A NEW flow's retired
        // spelling is refused here as on an engine host (the last block).
        const { protocol, rows, engine } = makeProtocol(new Map());
        await seedStoredFlow(engine, legacyBody());

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

    it('draft mode canonicalizes the same way — Studio\'s first draft over a stored active row', async () => {
        // [#23775] Studio's flow designer saves drafts: its first edit of a
        // stored flow has no draft row yet, and the active row the draft
        // overlays is what makes it a re-save rather than a new flow.
        const { protocol, rows, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );
        await seedStoredFlow(engine, legacyBody(), 'active');

        const result = await save(protocol, legacyBody(), { mode: 'draft' });

        expect(result.success).toBe(true);
        const stored = storedFlow(rows, 'draft')!;
        expect(stored.row.state).toBe('draft');
        expect(stored.body.nodes[0].config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
    });

    it('draft mode keeps the throw-fallback too — a WIP cycle stays saveable', async () => {
        const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
        const { protocol, rows, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );
        await seedStoredFlow(engine, legacyBody(), 'active');

        const result = await save(protocol, legacyBody(), { mode: 'draft' });

        expect(result.success).toBe(true);
        expect(storedFlow(rows, 'draft')!.body.nodes[0].config).toHaveProperty('filters');
    });

    it('resolution is LAZY — a service registered after construction is still found', async () => {
        const services = new Map<string, any>();
        const { protocol, rows, engine } = makeProtocol(services);
        services.set('automation', { canonicalizeStoredFlow });
        await seedStoredFlow(engine, legacyBody());

        await save(protocol, legacyBody());

        expect(storedFlow(rows)!.body.nodes[0].config).not.toHaveProperty('filters');
    });

    it('the canonicalizer is called with the request NAME, not the body', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        await seedStoredFlow(engine, legacyBody());
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
        const { protocol, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );
        await seedStoredFlow(engine, legacyBody());

        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(1);
        const msg = fallbackWarnings()[0];
        expect(msg).toContain('flow/purge_flow');
        expect(msg).toContain('cycle detected: n1 → n1');
        expect(msg).toContain('os migrate meta --stored');
    });

    it('the fallback warning is deduped per flow — Studio autosave must not spam', async () => {
        const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
        const { protocol, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
        );
        await seedStoredFlow(engine, legacyBody());

        await save(protocol, legacyBody());
        await save(protocol, legacyBody());
        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(1);
    });

    it('the clean path stays silent — a healed row needs no warning', async () => {
        const { protocol, engine } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow }]]),
        );
        await seedStoredFlow(engine, legacyBody());

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
        const { protocol, engine } = makeProtocol(new Map());
        await seedStoredFlow(engine, legacyBody());

        await save(protocol, legacyBody());

        expect(fallbackWarnings()).toHaveLength(0);
    });

    /**
     * [#21982] On the fallback path — no canonicalizer resolved, or it threw —
     * the gate judges the body in its ADR-0087 D2-converted spelling, for the
     * verdict only. The flow parse refuses an undeclared config key on the
     * builtin node types, so without the conversion a D2 spelling the
     * canonicalizer converts first (`registerFlow`'s full chain, retired
     * entries included) would be refused here, and only here: a verdict that
     * depended on whether the host runs an automation service. So the fallback
     * replays that same full chain (#23487) for a re-save of a stored row — for
     * the seven flow spellings retired from the authoring funnel at 18 and for
     * those retired before them alike. What is STORED stays the raw body.
     * [#23775] Each pin re-saves the stored row it seeds: a new flow's retired
     * spelling is refused by both hosts alike (the last block).
     */
    describe('[#21982] the fallback gate judges the D2-converted body, and stores the raw one', () => {
        const scriptBody = (config: Record<string, unknown>) => ({
            ...flowBody({}),
            nodes: [{ id: 'n1', type: 'script', label: 'Triage', config }],
        });
        const issuesOf = async (promise: Promise<unknown>) => {
            try {
                await promise;
            } catch (err) {
                return err as { code?: unknown; status?: unknown; issues?: Array<{ path: string }> };
            }
            throw new Error('expected the save to be refused');
        };

        it('a legacy script `functionName` body saves on a host with no automation service, stored raw', async () => {
            const { protocol, rows, engine } = makeProtocol(new Map());
            await seedStoredFlow(engine, scriptBody({ functionName: 'helpdesk.triage' }));

            const result = await save(protocol, scriptBody({ functionName: 'helpdesk.triage' }));

            expect(result.success).toBe(true);
            // Judged as `function`, stored exactly as written.
            expect(storedFlow(rows)!.body.nodes[0].config).toEqual({ functionName: 'helpdesk.triage' });
        });

        it('an older-retired flow shape (`flow.active`) reaches the canonicalizer\'s verdict too — healed for the verdict, stored raw', async () => {
            // `flow-inert-keys-removed` (retired from the load path after 16.1.0)
            // tombstones `active`. On a host with no automation service the
            // fallback used to judge it in the authoring posture and refuse it
            // 422; the service-backed path replays the entry and heals it. Since
            // #23487 the fallback replays the same chain, so both hosts agree.
            const { protocol, rows, engine } = makeProtocol(new Map());
            const body = { ...flowBody({ objectName: 'lead', filter: { status: 'stale' } }), active: false };
            await seedStoredFlow(engine, body);

            const result = await save(protocol, body);

            expect(result.success).toBe(true);
            expect(storedFlow(rows)!.body.active).toBe(false);
        });

        it('an undeclared key on delete_record is refused 422 INVALID_METADATA at its path — the alias beside it is not', async () => {
            const { protocol, rows, engine } = makeProtocol(new Map());
            await seedStoredFlow(engine, legacyBody());

            const err = await issuesOf(save(protocol, flowBody({ objectName: 'lead', filters: { status: 'stale' }, bogusKey: 1 })));

            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect((err.issues ?? []).map((i) => i.path)).toEqual(['nodes.0.config.bogusKey']);
            // The stored row is the one seeded: the refused save wrote nothing.
            expect(storedFlow(rows)!.body).toEqual(legacyBody());
        });

        it('a canonicalizer throw still refuses a body the gate rejects after conversion', async () => {
            const throwing = () => { throw new Error('cycle detected: n1 → n1'); };
            const { protocol, rows, engine } = makeProtocol(
                new Map([['automation', { canonicalizeStoredFlow: throwing }]]),
            );
            await seedStoredFlow(engine, legacyBody());

            const err = await issuesOf(save(protocol, flowBody({ objectName: 'lead', filters: { status: 'stale' }, bogusKey: 1 })));

            expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
            expect((err.issues ?? []).map((i) => i.path)).toEqual(['nodes.0.config.bogusKey']);
            expect(storedFlow(rows)!.body).toEqual(legacyBody());
        });
    });

    it('non-flow saves never consult the canonicalizer', async () => {
        const spy = vi.fn(canonicalizeStoredFlow);
        const { protocol } = makeProtocol(
            new Map([['automation', { canonicalizeStoredFlow: spy }]]),
        );
        await protocol.saveMetaItem({
            type: 'view',
            name: 'case_grid',
            // [#7741] carries the object binding the inline arm now requires.
            item: { name: 'case_grid', type: 'grid', label: 'Cases', columns: ['id', 'title'], object: 'case', viewKind: 'list' },
        });
        expect(spy).not.toHaveBeenCalled();
    });

    /**
     * [#23775, ruling B; ADR-0087 addendum 2026-07-31] A flow with no stored
     * row at the save's address is authored input: the canonicalizer runs
     * without the retired entries, so a retired spelling meets the parse
     * refusal — `422 INVALID_METADATA`, located, naming the key it moved to,
     * the text the authoring funnel (`os validate`) prints — while a re-save
     * of a stored row keeps the full chain. Pinned on both hosts: an engine's
     * canonicalizer (the option-faithful stub) and none (the fallback).
     */
    describe('[#23775] a NEW flow is judged as authored input; a stored row keeps the full chain', () => {
        const hosts = {
            'an automation service': () => new Map([['automation', { canonicalizeStoredFlow }]]),
            'no automation service': () => new Map(),
        } as const;
        const refusalOf = async (promise: Promise<unknown>) => {
            try {
                await promise;
            } catch (err) {
                return err as { code?: unknown; status?: unknown; issues?: Array<{ path: string; message: string }> };
            }
            throw new Error('expected the save to be refused');
        };
        const filtersIssue = (err: { issues?: Array<{ path: string; message: string }> }) =>
            (err.issues ?? []).find((i) => i.path === 'nodes.0.config.filters');

        for (const [host, services] of Object.entries(hosts)) {
            it(`${host}: a retired spelling on a new flow is refused 422 INVALID_METADATA at its path, naming the new key, and nothing is stored`, async () => {
                const { protocol, rows } = makeProtocol(services());

                const err = await refusalOf(save(protocol, legacyBody()));

                expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
                const hit = filtersIssue(err);
                expect(hit, JSON.stringify(err.issues)).toBeDefined();
                expect(hit!.message).toContain('`filter`');
                expect(rows.size).toBe(0);
                // Refused, so never "saved WITHOUT canonicalization" (#4580's line).
                expect(fallbackWarnings()).toHaveLength(0);
            });

            it(`${host}: draft mode does not change it — a new draft with a retired spelling is refused too`, async () => {
                const { protocol, rows } = makeProtocol(services());

                const err = await refusalOf(save(protocol, legacyBody(), { mode: 'draft' }));

                expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
                expect(filtersIssue(err)).toBeDefined();
                expect(rows.size).toBe(0);
            });

            it(`${host}: a new flow in the canonical spelling saves`, async () => {
                const { protocol, rows } = makeProtocol(services());
                const body = flowBody({ objectName: 'lead', filter: { status: 'stale' } });

                const result = await save(protocol, body);

                expect(result.success).toBe(true);
                expect(storedFlow(rows)!.body).toEqual(body);
            });

            it(`${host}: a stored legacy row re-saves, and is served`, async () => {
                const { protocol, engine } = makeProtocol(services());
                await seedStoredFlow(engine, legacyBody());

                const result = await save(protocol, { ...legacyBody(), label: 'Purge Stale Leads (edited)' });

                expect(result.success).toBe(true);
                const served = (await protocol.getMetaItem({ type: 'flow', name: 'purge_flow' }) as any).item;
                expect(served.label).toBe('Purge Stale Leads (edited)');
            });

            it(`${host}: a stored legacy DRAFT re-saves in draft mode`, async () => {
                const { protocol, rows, engine } = makeProtocol(services());
                await seedStoredFlow(engine, legacyBody(), 'draft');

                const result = await save(protocol, legacyBody(), { mode: 'draft' });

                expect(result.success).toBe(true);
                expect(storedFlow(rows, 'draft')).toBeDefined();
            });
        }

        it('the canonicalizer is asked for the authoring posture on a new flow and for the full chain on a re-save', async () => {
            const spy = vi.fn(canonicalizeStoredFlow);
            const { protocol, engine } = makeProtocol(new Map([['automation', { canonicalizeStoredFlow: spy }]]));
            const body = flowBody({ objectName: 'lead', filter: { status: 'stale' } });

            await save(protocol, body);
            expect(spy.mock.lastCall?.[2]).toEqual({ includeRetired: false });

            await seedStoredFlow(engine, legacyBody(), 'draft');
            await save(protocol, legacyBody(), { mode: 'draft' });
            expect(spy.mock.lastCall?.[2]).toEqual({ includeRetired: true });
        });

        it('the refusal is the authoring funnel\'s own text: the issue `os validate` gets for the same flow', async () => {
            const { protocol } = makeProtocol(new Map());
            const err = await refusalOf(save(protocol, legacyBody()));

            const authored = ObjectStackDefinitionSchema.safeParse(normalizeStackInput({ flows: [legacyBody()] }));
            expect(authored.success).toBe(false);
            const funnel = (authored.error?.issues ?? []).find((i) => i.path.join('.') === 'flows.0.nodes.0.config.filters');
            expect(funnel, JSON.stringify(authored.error?.issues)).toBeDefined();
            expect(filtersIssue(err)!.message).toBe(funnel!.message);
        });

        for (const writeFace of ['package-duplicate', 'package-unmanaged-import'] as const) {
            it(`a server-stated write (\`${writeFace}\`) carries a body at rest: judged in the full chain on a host with no automation service, as an engine host's caller canonicalizes it`, async () => {
                const { protocol, rows } = makeProtocol(new Map());

                const result = await save(protocol, legacyBody(), { writeFace });

                expect(result.success).toBe(true);
                expect(storedFlow(rows)!.body.nodes[0].config).toHaveProperty('filters');
            });
        }
    });
});

/**
 * [#23903, ruling B′] A re-save whose body NEWLY INTRODUCES a retired spelling
 * is authored input, refused like a new flow's: a retired entry that fires on
 * the request at a site where no stored row carries it ⇒ the save is judged
 * without the retired entries and meets the parse refusal (`422
 * INVALID_METADATA`, located, the key the spelling moved to). A request whose
 * retired hits the stored row all carries keeps the full chain.
 *
 * The spellings are two of the seven #23487 retired, neither moved by F5-http:
 * a `delete_record` node's `config.filters` (`flow-node-crud-filter-alias`,
 * refused at the key, naming `filter`) and a `wait` node's loose
 * `config.duration` beside its block (`flow-node-wait-event-config-lift`,
 * refused at the key, naming `waitEventConfig.timerDuration`). No node TYPE is
 * retired at this base: the one type rename, the callout rename, is what
 * F5-http retires.
 *
 * Pinned on both hosts. The engine is the spec's own pass behind the
 * canonicalizer's option (`includeRetired`), so a carried re-save is healed and
 * stored canonical, as `AutomationEngine.canonicalizeStoredFlow` stores it. With
 * the window closed it hands the retired spelling back and the gate refuses it;
 * the real engine's strict parse throws first, and the door's fallback verdict
 * refuses the same body with the same issues.
 */
describe('[#23903] a re-save that newly introduces a retired spelling is judged as authored input', () => {
    const specCanonicalizer = (_name: string, body: unknown, options: { includeRetired?: boolean } = {}) => {
        const notices: unknown[] = [];
        const storable = applyConversionsToFlow(body, {
            includeRetired: options.includeRetired ?? true,
            excludeConversionIds: ['flow-decision-mode-inclusive-explicit'],
            onNotice: (n) => notices.push(n),
        });
        return { storable, notices, conflicts: [] };
    };
    const hosts = {
        'an automation service': () => new Map([['automation', { canonicalizeStoredFlow: specCanonicalizer }]]),
        'no automation service': () => new Map(),
    } as const;

    const purge = (id: string, config: Record<string, unknown>) =>
        ({ id, type: 'delete_record', label: `Purge ${id}`, config });
    const hold = (id: string) => ({
        id, type: 'wait', label: `Hold ${id}`,
        waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' },
        config: { duration: 'PT9M' },
    });
    const flowOf = (nodes: unknown[], label = 'Purge Stale Leads') =>
        ({ name: 'purge_flow', label, type: 'autolaunched', status: 'active', nodes, edges: [] });
    const legacyNode = (id: string) => purge(id, { objectName: 'lead', filters: { status: 'stale' } });
    const canonicalNode = (id: string) => purge(id, { objectName: 'lead', filter: { status: 'stale' } });

    const refusalOf = async (promise: Promise<unknown>) => {
        try {
            await promise;
        } catch (err) {
            return err as { code?: unknown; status?: unknown; issues?: Array<{ path: string; message: string }> };
        }
        throw new Error('expected the save to be refused');
    };
    /** The ADR-0112 `code` and status, and the issue at `path`, which must name `key`. */
    const expectRefusedAt = (
        err: { code?: unknown; status?: unknown; issues?: Array<{ path: string; message: string }> },
        path: string,
        key: string,
    ) => {
        expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        const issue = (err.issues ?? []).find((i) => i.path === path);
        expect(issue, JSON.stringify(err.issues)).toBeDefined();
        expect(issue!.message).toContain(key);
    };

    for (const [host, services] of Object.entries(hosts)) {
        it(`${host}: adding a node with a retired spelling the stored row does not carry is refused 422 at the new node's key, naming the new key; the stored row is untouched`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            const stored = flowOf([legacyNode('n1')]);
            await seedStoredFlow(engine, stored);

            const err = await refusalOf(save(protocol, flowOf([legacyNode('n1'), hold('h1')])));

            expectRefusedAt(err, 'nodes.1.config.duration', '`waitEventConfig.timerDuration`');
            expect(storedFlow(rows)!.body).toEqual(stored);
        });

        it(`${host}: the stored row carrying the SAME retired spelling on another node does not carry the added node's: refused at the new node's key`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            const stored = flowOf([legacyNode('n1')]);
            await seedStoredFlow(engine, stored);

            const err = await refusalOf(save(protocol, flowOf([legacyNode('n1'), legacyNode('n2')])));

            expectRefusedAt(err, 'nodes.1.config.filters', '`filter`');
            expect(storedFlow(rows)!.body).toEqual(stored);
        });

        it(`${host}: a retired spelling newly written on a node the stored row already has is refused at that key`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            const stored = flowOf([canonicalNode('n1'), legacyNode('n2')]);
            await seedStoredFlow(engine, stored);

            const err = await refusalOf(save(protocol, flowOf([legacyNode('n1'), legacyNode('n2')])));

            expectRefusedAt(err, 'nodes.0.config.filters', '`filter`');
            expect(storedFlow(rows)!.body).toEqual(stored);
        });

        it(`${host}: draft mode with no draft row yet — the active row it overlays is the baseline — refuses the added node`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            await seedStoredFlow(engine, flowOf([legacyNode('n1')]), 'active');

            const err = await refusalOf(save(protocol, flowOf([legacyNode('n1'), legacyNode('n2')]), { mode: 'draft' }));

            expectRefusedAt(err, 'nodes.1.config.filters', '`filter`');
            expect(storedFlow(rows, 'draft')).toBeUndefined();
        });

        it(`${host}: draft mode over a stored draft row refuses the added node`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            const draft = flowOf([legacyNode('n1')], 'Purge Stale Leads (draft)');
            await seedStoredFlow(engine, draft, 'draft');

            const err = await refusalOf(save(protocol, flowOf([legacyNode('n1'), hold('h1')]), { mode: 'draft' }));

            expectRefusedAt(err, 'nodes.1.config.duration', '`waitEventConfig.timerDuration`');
            expect(storedFlow(rows, 'draft')!.body).toEqual(draft);
        });

        it(`${host}: re-saving the served legacy body unchanged saves, healed as before`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            await seedStoredFlow(engine, flowOf([legacyNode('n1'), hold('h1')]));
            const served = (await protocol.getMetaItem({ type: 'flow', name: 'purge_flow' }) as any).item;

            const result = await save(protocol, served);

            expect(result.success).toBe(true);
            const body = storedFlow(rows)!.body;
            if (host === 'an automation service') {
                expect(body.nodes[0].config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
                expect(body.nodes[1].config ?? {}).not.toHaveProperty('duration');
            } else {
                // No canonicalizer here: judged converted, stored as written
                // (the read's own `_diagnostics` envelope is never stored).
                const { _diagnostics: _served, ...asWritten } = served;
                expect(body).toEqual(asWritten);
            }
        });

        it(`${host}: a canonical node added in front of a carried one keeps it carried — the site is the node's id, not its index`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            await seedStoredFlow(engine, flowOf([legacyNode('n1')]));

            const result = await save(protocol, flowOf([canonicalNode('n0'), legacyNode('n1')]));

            expect(result.success).toBe(true);
            expect(storedFlow(rows)!.body.nodes.map((n: { id: string }) => n.id)).toEqual(['n0', 'n1']);
        });

        it(`${host}: Studio's draft autosaves of a legacy flow keep saving after the first one healed the draft row — the active row still carries the spelling — and an added node is still refused`, async () => {
            const { protocol, rows, engine } = makeProtocol(services());
            await seedStoredFlow(engine, flowOf([legacyNode('n1')]), 'active');

            // Studio's buffer is the served legacy body; a save does not replace it.
            expect((await save(protocol, flowOf([legacyNode('n1')], 'First'), { mode: 'draft' })).success).toBe(true);
            if (host === 'an automation service') {
                expect(storedFlow(rows, 'draft')!.body.nodes[0].config).toEqual({ objectName: 'lead', filter: { status: 'stale' } });
            }
            expect((await save(protocol, flowOf([legacyNode('n1')], 'Second'), { mode: 'draft' })).success).toBe(true);
            expect(storedFlow(rows, 'draft')!.body.label).toBe('Second');

            const err = await refusalOf(save(protocol, flowOf([legacyNode('n1'), legacyNode('n2')], 'Third'), { mode: 'draft' }));
            expectRefusedAt(err, 'nodes.1.config.filters', '`filter`');
            expect(storedFlow(rows, 'draft')!.body.label).toBe('Second');
        });
    }

    it('the canonicalizer is asked for the authoring posture when a re-save introduces a retired spelling, and for the full chain when the stored row carries it', async () => {
        const spy = vi.fn(specCanonicalizer);
        const { protocol, engine } = makeProtocol(new Map([['automation', { canonicalizeStoredFlow: spy }]]));
        await seedStoredFlow(engine, flowOf([legacyNode('n1')]));

        await refusalOf(save(protocol, flowOf([legacyNode('n1'), legacyNode('n2')])));
        expect(spy.mock.lastCall?.[2]).toEqual({ includeRetired: false });

        await save(protocol, flowOf([legacyNode('n1')], 'Edited'));
        expect(spy.mock.lastCall?.[2]).toEqual({ includeRetired: true });
    });
});
