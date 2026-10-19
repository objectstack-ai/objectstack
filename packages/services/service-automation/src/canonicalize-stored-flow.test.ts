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
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { AutomationEngine, FLOW_REGISTRATION_TODO_ID } from './engine.js';
import type { NodeExecutor } from './engine.js';

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
                collection: { dialect: 'cel', source: 'record.items' },
                // A well-formed region: single entry (b1), single exit (b2),
                // acyclic — `validateControlFlow` rejects anything else, and it
                // runs before the region canonicalization under test.
                body: {
                    nodes: [
                        { id: 'b1', type: 'update_record', label: 'Touch', config: { objectName: 'lead', filters: { id: { dialect: 'cel', source: 'item.id' } } } },
                        { id: 'b2', type: 'update_record', label: 'Mark', config: { objectName: 'lead', filter: { id: { dialect: 'cel', source: 'item.id' } } } },
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
        expect(s.nodes[2].config.body.nodes[0].config.filter).toEqual({ id: { dialect: 'cel', source: 'item.id' } });
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

describe('canonicalizeStoredFlow — a site registerFlow refuses comes back as a TODO (#23269)', () => {
    // A stored v17 flow: a `get_record` filter operand still in the retired
    // single-brace dialect. `FlowSchema` accepts it and no conversion rewrites
    // it (no lossless one exists), so without the TODO the stored pass read
    // this flow as on protocol while `registerFlow` refused it at boot.
    const storedFlow = (operand: unknown) => ({
        name: 'fd_refused_filter',
        label: 'Refused Filter',
        type: 'autolaunched',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'get', type: 'get_record', label: 'Get', config: { objectName: 'lead', filter: { id: operand } } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'get' }, { id: 'e2', source: 'get', target: 'end' }],
    });

    it('a braced operand parses, is not rewritten, and is reported by node — and registerFlow refuses the same site', () => {
        const engine = new AutomationEngine(silentLogger);
        const flow = storedFlow('{record.id}');
        const { storable, notices, todos } = engine.canonicalizeStoredFlow('fd_refused_filter', flow);

        expect(notices).toEqual([]);
        expect((storable as any).nodes[1].config.filter).toEqual({ id: '{record.id}' });
        expect(todos.map((t) => [t.conversionId, t.path])).toEqual([
            ['flow-value-slot-template-dialect-refused', 'flows[0].nodes[1].config.filter.id'],
        ]);
        expect(todos[0]!.reason).toContain("node 'get' (get_record), get_record filter operand at config.filter.id");

        // The listing and the boot refuse one site.
        expect(() => engine.registerFlow('fd_refused_filter', flow))
            .toThrow(/node 'get' \(get_record\) get_record filter operand at config\.filter\.id/);
    });

    it('the same flow in the CEL form reports no TODO and registers', async () => {
        const engine = new AutomationEngine(silentLogger);
        const flow = storedFlow({ dialect: 'cel', source: 'record.id' });

        expect(engine.canonicalizeStoredFlow('fd_refused_filter', flow).todos).toEqual([]);
        engine.registerFlow('fd_refused_filter', flow);
        expect(await engine.getFlow('fd_refused_filter')).not.toBeNull();
    });
});

/**
 * [#23317] `canonicalizeStoredFlow` runs `registerFlow`'s whole validation,
 * not one judge: every registration check, through the one list
 * `registerFlow` itself throws from, each refused site listed as a TODO under
 * `registerFlow`. Before, only the value-slot judge reached the stored pass
 * (through the spec's refused-shape detector), so a stored flow refused for
 * any other reason after the parse was counted as on protocol.
 */
describe('canonicalizeStoredFlow — every site registerFlow refuses after the parse is a TODO (#23317)', () => {
    const STAMP = 'stored_stamp';
    const stampExecutor: NodeExecutor = {
        type: STAMP,
        descriptor: defineActionDescriptor({
            type: STAMP, version: '1.0.0', name: 'Stored stamp', category: 'custom', paradigms: ['flow'], source: 'plugin',
            configSchema: { type: 'object', properties: { count: { type: 'number' } } },
        }),
        async execute() { return { success: true }; },
    };
    const engineWithStamp = () => {
        const engine = new AutomationEngine(silentLogger);
        engine.registerNodeExecutor(stampExecutor);
        return engine;
    };
    const flowOf = (nodes: unknown[], extra: Record<string, unknown> = {}) => ({
        name: 'fd_stored',
        label: 'Stored',
        type: 'autolaunched',
        status: 'active',
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }],
        edges: [],
        ...extra,
    });
    const notify = (title: string) => ({
        id: 'tell', type: 'notify', label: 'Tell', config: { recipients: ['usr_1'], title, message: 'Done' },
    });
    const inLoop = (node: unknown) => ({
        id: 'each', type: 'loop', label: 'Each',
        config: { collection: { dialect: 'cel', source: 'items' }, body: { nodes: [node], edges: [] } },
    });

    /**
     * One flow per registration check, each refused by `registerFlow` after
     * `FlowSchema.parse` accepted it: [label, refused flow, the same flow on
     * protocol, the site, the check's words].
     */
    const CASES: Array<[string, () => unknown, () => unknown, string, RegExp]> = [
        ['a text slot still on the single-brace dialect',
            () => flowOf([notify('Hi {record.name}')]), () => flowOf([notify('Hi {{ record.name }}')]),
            'flows[0].nodes[1].config.title', /notify title at config\.title/],
        ['a text slot whose hole holds an unknown formatter',
            () => flowOf([notify('Hi {{ record.name | nope }}')]), () => flowOf([notify('Hi {{ record.name }}')]),
            'flows[0].nodes[1].config.title', /notify title at config\.title/],
        ['a text slot inside a loop body',
            () => flowOf([inLoop(notify('Hi {item.name}'))]), () => flowOf([inLoop(notify('Hi {{ item.name }}'))]),
            'flows[0].nodes[1].config.body.nodes[0].config.title', /loop 'each' body: node 'tell' \(notify\) notify title at config\.title/],
        ['a decision mode the engine does not have',
            () => flowOf([{ id: 'gate', type: 'decision', label: 'Gate', config: { mode: 'bogus' } }]),
            () => flowOf([{ id: 'gate', type: 'decision', label: 'Gate', config: { mode: 'exclusive' } }]),
            'flows[0].nodes[1].config.mode', /node 'gate' \(decision\) at config\.mode/],
        ['a node predicate that does not parse',
            () => flowOf([{ id: 'gate', type: 'decision', label: 'Gate', config: { condition: 'amount >' } }]),
            () => flowOf([{ id: 'gate', type: 'decision', label: 'Gate', config: { condition: 'amount > 1' } }]),
            'flows[0].nodes[1].config.condition', /node 'gate' \(decision\) condition/],
        ['an edge predicate in template braces',
            () => flowOf([], { edges: [{ id: 'e1', source: 'start', target: 'end', condition: '{record.x} == 1' }] }),
            () => flowOf([], { edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'record.x == 1' }] }),
            'flows[0].edges[0].condition', /edge 'e1' \(start→end\) condition/],
        ['a plugin node config key its descriptor does not declare',
            () => flowOf([{ id: 'w', type: STAMP, label: 'W', config: { count: 1, countz: 2 } }]),
            () => flowOf([{ id: 'w', type: STAMP, label: 'W', config: { count: 1 } }]),
            'flows[0].nodes[1].config.countz', /unknown config key `countz` at config\.countz/],
        ['an api flow whose start node declares no secret',
            () => flowOf([], { type: 'api' }),
            () => ({ ...flowOf([], { type: 'api' }), nodes: [{ id: 'start', type: 'start', label: 'Start', config: { secret: 'whsec_test' } }, { id: 'end', type: 'end', label: 'End' }] }),
            'flows[0].nodes[0].config.secret', /binds the inbound `api` trigger/],
    ];

    it.each(CASES)('%s: listed under registerFlow at its site, in the check\'s words, and refused by registerFlow', (_label, refused, _onProtocol, path, words) => {
        const engine = engineWithStamp();
        const flow = refused();
        const { notices, todos } = engine.canonicalizeStoredFlow('fd_stored', flow);

        expect(notices).toEqual([]);
        expect(todos.map((t) => [t.conversionId, t.path])).toEqual([[FLOW_REGISTRATION_TODO_ID, path]]);
        const todo = todos[0]!;
        expect(todo.reason).toMatch(/^No conversion rewrites it, and registerFlow refuses it: left as stored, the flow is not registered at boot and never runs\. Flow `fd_stored`, /);
        expect(todo.reason).toMatch(words);

        let thrown: unknown;
        try {
            engineWithStamp().registerFlow('fd_stored', flow);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toMatch(words);
    });

    it.each(CASES)('%s, on protocol: no TODO, and the flow registers', async (_label, _refused, onProtocol) => {
        const engine = engineWithStamp();
        expect(engine.canonicalizeStoredFlow('fd_stored', onProtocol()).todos).toEqual([]);
        engine.registerFlow('fd_stored', onProtocol());
        expect(await engine.getFlow('fd_stored')).not.toBeNull();
    });

    it('the listing and the door agree in both directions: a flow is listed exactly when registerFlow refuses it', () => {
        const corpus = [...CASES.flatMap(([, refused, onProtocol]) => [refused, onProtocol]), legacyFlow];
        for (const make of corpus) {
            const listed = engineWithStamp().canonicalizeStoredFlow('fd_stored', make()).todos.length > 0;
            let refusedAtRegistration = false;
            try {
                engineWithStamp().registerFlow('fd_stored', make());
            } catch {
                refusedAtRegistration = true;
            }
            expect(listed).toBe(refusedAtRegistration);
        }
    });

    it('the listing rewrites nothing and throws nothing: a refused flow on no other old shape comes back as stored', () => {
        const flow = flowOf([notify('Hi {record.name}')]);
        const result = engineWithStamp().canonicalizeStoredFlow('fd_stored', flow);
        expect(result.storable).toBe(flow);
        expect(result.todos).toHaveLength(1);
    });

    it('runs the checks only for a caller that reads `todos`, and once however often it is read', () => {
        const engine = engineWithStamp();
        const checks = vi.spyOn(engine as any, 'registrationCheckRefusals');
        const result = engine.canonicalizeStoredFlow('fd_stored', flowOf([notify('Hi {record.name}')]));
        // What the save door, a duplication and the sync's held-flow comparison read.
        void result.parsed;
        void result.storable;
        expect(checks).not.toHaveBeenCalled();
        expect(result.todos).toHaveLength(1);
        expect(result.todos).toBe(result.todos);
        expect(checks).toHaveBeenCalledTimes(1);
    });

    it('every site of a flow refused by several checks is listed, in the order registerFlow judges them', () => {
        const flow = flowOf([
            { id: 'w', type: STAMP, label: 'W', config: { count: 1, countz: 2 } },
            { id: 'gate', type: 'decision', label: 'Gate', config: { mode: 'bogus' } },
            notify('Hi {record.name}'),
        ]);
        const { todos } = engineWithStamp().canonicalizeStoredFlow('fd_stored', flow);
        expect(todos.map((t) => t.path)).toEqual([
            'flows[0].nodes[1].config.countz',
            'flows[0].nodes[2].config.mode',
            'flows[0].nodes[3].config.title',
        ]);
        // registerFlow throws the first check's refusal, as it always has.
        expect(() => engineWithStamp().registerFlow('fd_stored', flow)).toThrow(/1 undeclared config key/);
    });

    it('a site the conversion chain already lists under its D3 entry is listed once, under that entry', () => {
        const flow = flowOf([
            { id: 'get', type: 'get_record', label: 'Get', config: { objectName: 'lead', filter: { id: '{record.id}' } } },
            notify('Hi {record.name}'),
        ]);
        const { todos } = engineWithStamp().canonicalizeStoredFlow('fd_stored', flow);
        expect(todos.map((t) => [t.conversionId, t.path])).toEqual([
            ['flow-value-slot-template-dialect-refused', 'flows[0].nodes[1].config.filter.id'],
            [FLOW_REGISTRATION_TODO_ID, 'flows[0].nodes[2].config.title'],
        ]);
    });

    it('a refusal the parse makes is not a TODO: canonicalizeStoredFlow throws it, as registerFlow does', () => {
        // A builtin value of the wrong type, written as a `{token}`: the value
        // arm of the builtin contracts refuses it inside `FlowSchema.parse`, so
        // the stored pass reports the row `failed` with the parse's words.
        const flow = flowOf([{ id: 'get', type: 'get_record', label: 'Get', config: { objectName: 'lead', limit: '{page.size}' } }]);
        expect(() => engineWithStamp().canonicalizeStoredFlow('fd_stored', flow)).toThrow(/limit/);
        expect(() => engineWithStamp().registerFlow('fd_stored', flow)).toThrow(/limit/);
    });

    it('logs nothing for the checks it runs: the schema-aware advisory pass is registration\'s alone', () => {
        const warn = vi.fn();
        const engine = new AutomationEngine({ ...silentLogger, warn });
        engine.setObjectSchemaResolver(() => ({ fields: ['amount'], fieldTypes: { amount: 'number' } }));
        // `amout` is not a field of the object: an advisory finding, never a refusal.
        const flow = {
            ...flowOf([]),
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { objectName: 'deal', triggerType: 'record-after-update', condition: 'amout > 1' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
        };
        expect(engine.canonicalizeStoredFlow('fd_stored', flow).todos).toEqual([]);
        expect(warn).not.toHaveBeenCalled();
        engine.registerFlow('fd_stored', flow);
        expect(warn).toHaveBeenCalled();
    });
});

/**
 * [#23775, ruling B] `canonicalizeStoredFlow`'s `includeRetired` option: the
 * metadata save door closes the retired window for a flow with no stored row,
 * so an authored retired spelling meets the parse refusal instead of being
 * lifted. Every other caller passes nothing and keeps the full chain, and
 * `registerFlow` (the rehydration seam) is not changed by the option at all.
 *
 * The spelling is the card's own example: a `wait` node's loose
 * `config.duration`, lifted to `waitEventConfig.timerDuration` by the entry
 * retired from the load path at 18 (`flow-node-wait-event-config-lift`).
 */
describe('[#23775] canonicalizeStoredFlow — the authoring posture is an option, the rehydration is unchanged', () => {
    const waitFlow = (wait: Record<string, unknown>) => ({
        name: 'settle_order',
        label: 'Settle Order',
        type: 'autolaunched',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'hold', type: 'wait', label: 'Hold', ...wait },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'hold' },
            { id: 'e2', source: 'hold', target: 'end' },
        ],
    });
    const legacyWait = () => waitFlow({ config: { duration: 'PT1M' } });

    /** The parse's refusal, read as data: the ZodError's issues, or a failure. */
    const refusalOf = (fn: () => unknown): Array<{ path: PropertyKey[]; message: string }> => {
        try {
            fn();
        } catch (err) {
            return ((err as { issues?: Array<{ path: PropertyKey[]; message: string }> }).issues ?? []);
        }
        throw new Error('expected the canonicalization to be refused');
    };

    it('with no option, the retired spelling is lifted: the full chain, as every at-rest caller gets it', () => {
        const { storable } = new AutomationEngine(silentLogger).canonicalizeStoredFlow('settle_order', legacyWait());
        const hold = (storable as any).nodes[1];
        expect(hold.waitEventConfig).toEqual({ timerDuration: 'PT1M', eventType: 'timer' });
        expect(hold.config).toEqual({});
    });

    it('`includeRetired: false` leaves it in place, and the parse refuses it where it is written, naming the new key', () => {
        // Beside a declared block the loose key is the only finding: the full
        // chain would delete it (the block shadows it), the authoring posture
        // refuses it at `config.duration`.
        const flow = waitFlow({ waitEventConfig: { eventType: 'timer', timerDuration: 'PT5M' }, config: { duration: 'PT9M' } });
        const issues = refusalOf(() => new AutomationEngine(silentLogger)
            .canonicalizeStoredFlow('settle_order', flow, { includeRetired: false }));
        expect(issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.config.duration']);
        expect(issues[0]!.message).toContain('waitEventConfig.timerDuration');
    });

    it('`includeRetired: false` on the bare loose key: refused at the block the lift would have written, naming it', () => {
        // The card's literal shape. Without the lift the node has no
        // `waitEventConfig` at all, and the node's own rule answers first —
        // exactly what the authoring funnel answers for the same body.
        const issues = refusalOf(() => new AutomationEngine(silentLogger)
            .canonicalizeStoredFlow('settle_order', legacyWait(), { includeRetired: false }));
        expect(issues.map((i) => i.path.join('.'))).toEqual(['nodes.1.waitEventConfig']);
        expect(issues[0]!.message).toContain('timerDuration');
    });

    it('`includeRetired: false` changes nothing for a body already in the canonical spelling', () => {
        const engine = new AutomationEngine(silentLogger);
        const canonical = waitFlow({ waitEventConfig: { eventType: 'timer', timerDuration: 'PT1M' } });
        const closed = engine.canonicalizeStoredFlow('settle_order', canonical, { includeRetired: false });
        const open = engine.canonicalizeStoredFlow('settle_order', canonical);
        expect(closed.storable).toEqual(open.storable);
        expect(closed.storable).toBe(canonical);
    });

    it('`includeRetired: true` is the default spelled out', () => {
        const engine = new AutomationEngine(silentLogger);
        expect(engine.canonicalizeStoredFlow('settle_order', legacyWait(), { includeRetired: true }).storable)
            .toEqual(engine.canonicalizeStoredFlow('settle_order', legacyWait()).storable);
    });

    it('registerFlow, the rehydration seam, still registers the stored legacy spelling', () => {
        const parsed = new AutomationEngine(silentLogger).registerFlow('settle_order', legacyWait()) as any;
        const hold = parsed.nodes.find((n: { id: string }) => n.id === 'hold');
        expect(hold.waitEventConfig).toMatchObject({ timerDuration: 'PT1M', eventType: 'timer' });
    });
});
