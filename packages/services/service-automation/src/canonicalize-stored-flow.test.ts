// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4454 — `AutomationEngine.canonicalizeStoredFlow`: one policy, two shapes.
 *
 * `os migrate meta --stored` (#4327) covers every metadata type except `flow`,
 * because flow-node conversions carry ADR-0078's open-namespace conflict guard
 * and that needs the engine's live executor registry. This method is the entry
 * point that lets a caller outside the load seam ask for a flow's canonical
 * shape without registering (and thereby arming) it.
 *
 * The interesting half is what `storable` deliberately does NOT contain.
 * `FlowSchema.parse` materializes defaults — `version`, `runAs`, per-edge
 * `type` / `isDefault` — and persisting a default the author never wrote pins
 * that row to today's value while untouched rows follow tomorrow's. Two
 * populations with different behaviour is precisely the drift a
 * canonicalization pass exists to remove, so these pin that it stays out.
 */
import { describe, expect, it, vi } from 'vitest';
import { AutomationEngine } from './engine.js';

const silentLogger = {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
} as any;

/**
 * A pre-17 flow: the retired `filters` alias on a crud node at top level AND
 * inside a `loop` body, plus bare-string edge conditions in both places (the
 * #4347 nesting case).
 */
const legacyFlow = () => ({
    name: 'sweep_stale',
    label: 'Sweep Stale Leads',
    type: 'autolaunched',
    status: 'active',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'lead', triggerType: 'record-after-update' } },
        { id: 'n1', type: 'delete_record', label: 'Delete Stale', config: { objectName: 'lead', filters: { status: 'stale' } } },
        {
            id: 'loop1',
            type: 'loop',
            label: 'Per Item',
            config: {
                collection: '{record.items}',
                // A well-formed region: single entry (b1), single exit (b2),
                // acyclic — `validateControlFlow` rejects anything else, and it
                // runs before the region canonicalization under test.
                body: {
                    nodes: [
                        { id: 'b1', type: 'update_record', label: 'Touch', config: { objectName: 'lead', filters: { id: '{item.id}' } } },
                        { id: 'b2', type: 'update_record', label: 'Mark', config: { objectName: 'lead', filter: { id: '{item.id}' } } },
                    ],
                    edges: [{ id: 'be1', source: 'b1', target: 'b2', condition: "status == 'x'" }],
                },
            },
        },
    ],
    edges: [
        { id: 'e0', source: 'start', target: 'n1' },
        { id: 'e1', source: 'n1', target: 'loop1', condition: "status == 'y'" },
    ],
});

describe('canonicalizeStoredFlow — the storable shape (#4454)', () => {
    it('lowers the retired filters alias, including inside a loop body', () => {
        const engine = new AutomationEngine(silentLogger);
        const { storable } = engine.canonicalizeStoredFlow('sweep_stale', legacyFlow());
        const s = storable as any;

        expect(s.nodes[1].config.filter).toEqual({ status: 'stale' });
        expect('filters' in s.nodes[1].config).toBe(false);
        // The conversion pass already reaches into regions — only the condition
        // envelope needs the schema's help.
        expect(s.nodes[2].config.body.nodes[0].config.filter).toEqual({ id: '{item.id}' });
        expect('filters' in s.nodes[2].config.body.nodes[0].config).toBe(false);
    });

    it('lifts the condition envelope at BOTH nesting depths', () => {
        const engine = new AutomationEngine(silentLogger);
        const { storable } = engine.canonicalizeStoredFlow('sweep_stale', legacyFlow());
        const s = storable as any;

        expect(s.edges[1].condition).toEqual({ dialect: 'cel', source: "status == 'y'" });
        // #4347's asymmetry is what made this worth doing: the identical
        // predicate one level in used to keep its bare-string shape.
        expect(s.nodes[2].config.body.edges[0].condition).toEqual({ dialect: 'cel', source: "status == 'x'" });
    });

    it('does NOT persist schema defaults — a migrated row must not freeze on today\'s values', () => {
        const engine = new AutomationEngine(silentLogger);
        const { storable, parsed } = engine.canonicalizeStoredFlow('sweep_stale', legacyFlow());
        const s = storable as any;

        // The parse materializes these; the stored shape must not carry them,
        // or every migrated row is pinned to today's default while untouched
        // rows follow tomorrow's.
        expect('version' in s).toBe(false);
        expect('runAs' in s).toBe(false);
        expect('type' in s.edges[0]).toBe(false);
        expect('isDefault' in s.edges[0]).toBe(false);

        // …while the EXECUTION shape does carry them, which is the whole
        // reason the two shapes are distinct.
        expect((parsed as any).version).toBeDefined();
        expect((parsed as any).edges[0].type).toBeDefined();
    });

    it('leaves an already-canonical flow byte-identical — the pass is a no-op on protocol', () => {
        const engine = new AutomationEngine(silentLogger);
        const canonical = engine.canonicalizeStoredFlow('sweep_stale', legacyFlow()).storable;
        const second = engine.canonicalizeStoredFlow('sweep_stale', canonical).storable;

        expect(JSON.stringify(second)).toBe(JSON.stringify(canonical));
        // …and reports nothing, which is what lets a re-run report "canonical".
        expect(engine.canonicalizeStoredFlow('sweep_stale', canonical).notices).toEqual([]);
    });

    it('reports the conversions it applied, so a migration can name them per row', () => {
        const engine = new AutomationEngine(silentLogger);
        const { notices } = engine.canonicalizeStoredFlow('sweep_stale', legacyFlow());

        expect(notices.length).toBeGreaterThan(0);
        expect(notices.some((n) => n.from === 'filters' && n.to === 'filter')).toBe(true);
    });

    it('leaves a node config predicate alone — the parse never lowers an open z.record', () => {
        const engine = new AutomationEngine(silentLogger);
        const flow = legacyFlow();
        (flow.nodes[0].config as any).condition = 'title != previous.title';
        const { storable } = engine.canonicalizeStoredFlow('sweep_stale', flow);

        // A start node's record-change predicate is config, not an edge — no
        // envelope exists on the parsed side, so the graft must not invent one.
        expect((storable as any).nodes[0].config.condition).toBe('title != previous.title');
    });

    it('throws on an unrecognized key rather than silently dropping it (#4001)', () => {
        const engine = new AutomationEngine(silentLogger);
        const flow = { ...legacyFlow(), _uiPosition: { x: 1, y: 2 } };

        // FlowSchema is strict. A stored row carrying this cannot be registered
        // at all, so a migration must report it failed — never persist a guess.
        expect(() => engine.canonicalizeStoredFlow('sweep_stale', flow)).toThrow();
    });
});

describe('registerFlow still behaves identically (#4454 refactor)', () => {
    it('registers the converted flow and serves the parsed shape', async () => {
        const engine = new AutomationEngine(silentLogger);
        engine.registerFlow('sweep_stale', legacyFlow());

        const flow: any = await engine.getFlow('sweep_stale');
        expect(flow).not.toBeNull();
        // Execution sees canonical config…
        expect(flow.nodes[1].config.filter).toEqual({ status: 'stale' });
        // …and the defaults it needs.
        expect(flow.version).toBeDefined();
    });

    // [#12206, Option A] `registerFlow` no longer returns void: it answers the
    // canonicalized PARSED flow it stored — the very object `getFlow` serves —
    // which is what the `/automation` write doors relay to the caller.
    // Reverse verification (predicted before running): reverting the `return
    // parsed` in `registerFlow` makes `returned` undefined and reds all three
    // assertions.
    it('returns the canonicalized parsed flow it stored — the same object getFlow serves', async () => {
        const engine = new AutomationEngine(silentLogger);
        const raw = legacyFlow();
        const returned = engine.registerFlow('sweep_stale', raw);

        expect(returned).toBe(await engine.getFlow('sweep_stale'));
        // Parsed, not the caller's bytes: the converted config and the
        // materialized default are both visible on the returned value.
        expect((returned as any).nodes[1].config.filter).toEqual({ status: 'stale' });
        expect(returned.version).toBe(1);
    });
});
