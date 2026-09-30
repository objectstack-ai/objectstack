// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { ALL_CONVERSIONS } from '@objectstack/spec';
import { applyMetaMigrations } from '@objectstack/spec/migrations';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';

/**
 * ⭐ THE CONTRACT PIN for an edge-branched `decision` (#15429).
 *
 * This file began life as a STATUS-QUO pin: it recorded that a decision with
 * no declared `config.conditions` took EVERY out-edge whose condition held,
 * one after another, and reported nothing — the hotcrm#1555 hazard — under a
 * header that said "when the ruling lands, this file is rewritten with it".
 * The ruling landed (maintainer, 2026-09-23, 「跟主流对齐」), and this is that
 * rewrite. Every assertion below is the contract now, not a measurement of
 * drift:
 *
 *  1. **Exclusive by default.** The conditioned out-edges are evaluated in the
 *     order the flow's `edges` array declares them and the FIRST one whose
 *     condition holds is the branch — the BPMN exclusive gateway, Salesforce
 *     Flow's Decision, n8n's Switch default. Its later siblings are passed over
 *     unevaluated and record the same `skipped` step a closed gate does.
 *  2. **Inclusive by declaration.** `config.mode: 'inclusive'` takes every
 *     out-edge whose condition holds, sequentially — never `Promise.all`; that
 *     fan-out belongs to the unconditional bucket, kept below as the positive
 *     control for the interleaving instrument.
 *  3. **`isDefault` is unchanged**: it runs when no conditioned sibling did,
 *     in either mode.
 *  4. **`mode` is judged at registration** through the spec's own
 *     `DecisionConfigSchema`: a value outside the closed pair, or a `mode`
 *     beside a non-empty `conditions` list, refuses the flow with the schema's
 *     sentence — the same one `os validate` prints.
 *  5. **The rehydration seam does not rewrite the flip, and a stored row takes
 *     the new meaning.** The ADR-0087 conversion
 *     `flow-decision-mode-inclusive-explicit` writes `mode: 'inclusive'` onto a
 *     two-branch decision so an OLD authored source keeps its behaviour, but
 *     only where the operator asserts the source's age (`os migrate meta
 *     --from 17`); `registerFlow` cannot date a body and refuses the entry by
 *     id, or every NEW exclusive decision would register as an inclusive one.
 *     So a decision stored in `sys_metadata` before protocol 18, with no
 *     `mode` and overlapping conditions, runs FIRST-MATCH after the upgrade —
 *     by maintainer ruling letter C on #15429 (no stored-row rewrite, no
 *     cutoff, no read-path completion); `os migrate meta --stored` lists such
 *     nodes for review and writes nothing.
 *  6. **Scoped to `decision`.** Conditioned out-edges of any other node type
 *     keep the every-true-edge traversal they had.
 *
 * A failure here after a change that did NOT intend to touch branch selection
 * is the drift this file exists to catch.
 */

/** One captured `warn` call, so "nothing reports this" stays measured, not assumed. */
const warnings: Array<{ msg: string; meta?: Record<string, unknown> }> = [];

function createTestLogger(): any {
    const logger: any = {
        info: () => {},
        warn: (msg: string, meta?: Record<string, unknown>) => { warnings.push({ msg: String(msg), meta }); },
        error: () => {},
        debug: () => {},
        child: () => logger,
    };
    return logger;
}

function createCtx(): any {
    return { logger: createTestLogger(), getService: () => undefined };
}

/** The refusal sentences, as the spec spells them — pinned by prefix, never re-derived. */
const MODE_BESIDE_LIST = /is not valid on a decision that declares a `conditions` list/;
const MODE_NOT_A_MODE = /is not a decision mode/;

describe('decision edge branching — exclusive by default, inclusive by declaration (#15429)', () => {
    let engine: AutomationEngine;
    /** `enter:<id>` / `exit:<id>` per visited successor — order AND nesting. */
    let trace: string[];

    beforeEach(() => {
        warnings.length = 0;
        trace = [];
        engine = new AutomationEngine(createTestLogger());
        registerLogicNodes(engine, createCtx());
        // A terminal that yields between its two marks, so a fan-out that really
        // is concurrent interleaves (`enter,enter,exit,exit`) and a sequential
        // traversal nests (`enter,exit,enter,exit`). The yield is a macrotask,
        // not a duration: both orderings below are deterministic.
        engine.registerNodeExecutor({
            type: 'mark',
            async execute(node) {
                trace.push(`enter:${node.id}`);
                await new Promise(resolve => setTimeout(resolve, 0));
                trace.push(`exit:${node.id}`);
                return { success: true };
            },
        });
        // This harness is an embedded host, so it owes the ADR-0018 host half:
        // the vocabulary it contributes is complete (#4771).
        engine.sealNodeTypeVocabulary();
    });

    /**
     * The hotcrm shape, reduced: one `decision`, two conditioned out-edges
     * (`a` on `refuse`, `b` on `convert`; an empty string means no condition),
     * optionally a third `isDefault` edge to `fallback`, optionally a node
     * config. `reversed` declares `convert` before `refuse`, so declaration
     * order — not edge id, not target name — is what the pin reads.
     */
    function gatewayFlow(opts: {
        a: string;
        b: string;
        config?: Record<string, unknown>;
        withDefault?: boolean;
        reversed?: boolean;
        gatewayType?: string;
    }) {
        const gatewayType = opts.gatewayType ?? 'decision';
        const refuseEdge = { id: 'e_refuse', source: 'check', target: 'refuse', label: 'Refuse', ...(opts.a ? { condition: opts.a } : {}) };
        const convertEdge = { id: 'e_convert', source: 'check', target: 'convert', label: 'Convert', ...(opts.b ? { condition: opts.b } : {}) };
        return {
            name: 'gateway',
            label: 'Gateway',
            type: 'autolaunched' as const,
            variables: [{ name: 'lead', type: 'object', isInput: true }],
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                { id: 'check', type: gatewayType, label: 'Check', ...(opts.config ? { config: opts.config } : {}) },
                { id: 'refuse', type: 'mark' as const, label: 'Refuse' },
                { id: 'convert', type: 'mark' as const, label: 'Convert' },
                ...(opts.withDefault ? [{ id: 'fallback', type: 'mark' as const, label: 'Fallback' }] : []),
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                ...(opts.reversed ? [convertEdge, refuseEdge] : [refuseEdge, convertEdge]),
                ...(opts.withDefault ? [{ id: 'e_fallback', source: 'check', target: 'fallback', label: 'Otherwise', isDefault: true }] : []),
            ],
        };
    }

    /** The hotcrm#1555 pair: both predicates hold for a confirmed record. */
    const OVERLAP = { a: "lead.status != 'suspected'", b: "lead.status == 'confirmed'" };

    const run = (lead: Record<string, unknown>) => engine.execute('gateway', { params: { lead } } as any);

    const stepsOfLastRun = async () => {
        const [log] = await engine.listRuns('gateway');
        return (log?.steps ?? []).map(s => ({ nodeId: s.nodeId, status: s.status, edgeId: s.skippedBy?.edgeId ?? null }));
    };

    // ── The instrument, before any reading taken with it ──────────────────

    it('CONTROL — disjoint edge conditions take exactly one successor, and the closed gate leaves a skipped step', async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status == 'suspected'",
            b: "lead.status == 'confirmed'",
        }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:convert', 'exit:convert']);
        expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'refuse', status: 'skipped', edgeId: 'e_refuse' });
    });

    it('POSITIVE CONTROL — the same instrument reads interleaving on the unconditional fan-out', async () => {
        // Drop both conditions and the identical pair of edges lands in the
        // unconditional bucket, which really is `Promise.all`. This is what
        // proves the sequential readings below measured sequencing rather than
        // an instrument that cannot see concurrency at all.
        engine.registerFlow('gateway', gatewayFlow({ a: '', b: '' }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'enter:convert', 'exit:refuse', 'exit:convert']);
    });

    // ── 1. Exclusive by default ───────────────────────────────────────────

    it('two overlapping true edges → exactly ONE successor runs: the first declared', async () => {
        engine.registerFlow('gateway', gatewayFlow(OVERLAP));

        const result = await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
        expect(result.success).toBe(true);
        expect(warnings).toEqual([]);
    });

    it('the passed-over sibling records a `skipped` step naming the gate and its edge', async () => {
        engine.registerFlow('gateway', gatewayFlow(OVERLAP));

        await run({ status: 'confirmed' });

        const steps = await stepsOfLastRun();
        expect(steps).toContainEqual({ nodeId: 'convert', status: 'skipped', edgeId: 'e_convert' });
        expect(steps.filter(s => s.status === 'success').map(s => s.nodeId)).toEqual(['start', 'check', 'refuse']);
    });

    it('DECLARATION ORDER decides — the same two predicates, declared the other way round, take the other branch', async () => {
        engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, reversed: true }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:convert', 'exit:convert']);
        expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'refuse', status: 'skipped', edgeId: 'e_refuse' });
    });

    it("`mode: 'exclusive'` written out says the same thing as an omitted `mode`", async () => {
        engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, config: { mode: 'exclusive' } }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
    });

    // ── 2. Inclusive by declaration ───────────────────────────────────────

    it("`mode: 'inclusive'` → BOTH run, one after another (nested, never interleaved), with no skipped step", async () => {
        engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, config: { mode: 'inclusive' } }));

        const result = await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'exit:refuse', 'enter:convert', 'exit:convert']);
        expect(result.success).toBe(true);
        const steps = await stepsOfLastRun();
        expect(steps.filter(s => s.status === 'skipped')).toEqual([]);
        expect(steps.filter(s => s.status === 'success').map(s => s.nodeId)).toEqual(['start', 'check', 'refuse', 'convert']);
    });

    it("`mode: 'inclusive'` with one true edge takes that one and records the closed gate", async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status == 'suspected'",
            b: "lead.status == 'confirmed'",
            config: { mode: 'inclusive' },
        }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:convert', 'exit:convert']);
        expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'refuse', status: 'skipped', edgeId: 'e_refuse' });
    });

    // ── 3. `isDefault` is unchanged in both modes ─────────────────────────

    it('none true → the `isDefault` edge runs (exclusive), and every closed gate is recorded', async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status == 'suspected'",
            b: "lead.status == 'confirmed'",
            withDefault: true,
        }));

        await run({ status: 'new' });

        expect(trace).toEqual(['enter:fallback', 'exit:fallback']);
        const steps = await stepsOfLastRun();
        expect(steps).toContainEqual({ nodeId: 'refuse', status: 'skipped', edgeId: 'e_refuse' });
        expect(steps).toContainEqual({ nodeId: 'convert', status: 'skipped', edgeId: 'e_convert' });
    });

    it('none true → the `isDefault` edge runs (inclusive too)', async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status == 'suspected'",
            b: "lead.status == 'confirmed'",
            withDefault: true,
            config: { mode: 'inclusive' },
        }));

        await run({ status: 'new' });

        expect(trace).toEqual(['enter:fallback', 'exit:fallback']);
    });

    it('a true edge beside a default → the branch runs and the default is passed over, in both modes', async () => {
        engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, withDefault: true }));
        await run({ status: 'confirmed' });
        expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
        expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'fallback', status: 'skipped', edgeId: 'e_fallback' });

        trace = [];
        engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, withDefault: true, config: { mode: 'inclusive' } }));
        await run({ status: 'confirmed' });
        expect(trace).toEqual(['enter:refuse', 'exit:refuse', 'enter:convert', 'exit:convert']);
        expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'fallback', status: 'skipped', edgeId: 'e_fallback' });
    });

    // ── A `conditions` list is a different mechanism, and it is unchanged ──

    it('declared `config.conditions` stays first-match by label narrowing — the losing edge leaves no step at all', async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: '', b: '',
            config: {
                conditions: [
                    { label: 'Refuse', expression: "lead.status != 'suspected'" },
                    { label: 'Convert', expression: "lead.status == 'confirmed'" },
                ],
            },
        }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
        const steps = await stepsOfLastRun();
        expect(steps.map(s => s.nodeId)).toEqual(['start', 'check', 'refuse']);
        expect(warnings).toEqual([]);
    });

    // ── 4. `mode` is judged at registration, with the spec's own sentence ──

    describe('registration parses `DecisionConfigSchema` and refuses an invalid `mode`', () => {
        it('refuses `mode` beside a non-empty `conditions` list — either member — at config.mode, with the refinement sentence', async () => {
            for (const mode of ['inclusive', 'exclusive']) {
                const definition = gatewayFlow({
                    a: '', b: '',
                    config: { mode, conditions: [{ label: 'Refuse', expression: "lead.status != 'suspected'" }] },
                });
                expect(() => engine.registerFlow('gateway', definition)).toThrow(MODE_BESIDE_LIST);
                try {
                    engine.registerFlow('gateway', definition);
                } catch (e) {
                    const message = (e as Error).message;
                    expect(message).toContain("Flow 'gateway' rejected");
                    expect(message).toContain("node 'check' (decision) at config.mode");
                    expect(message).toContain(`\`mode: '${mode}'\``);
                    // Both ruled ways out ride along, verbatim from the schema.
                    expect(message).toContain('Either delete `mode` and keep the list');
                    expect(message).toContain('move the branches onto the out-edges');
                }
                // Refused means never armed (`getFlow` answers `null` for a name it does not hold).
                expect(await engine.getFlow('gateway')).toBeNull();
            }
        });

        it('refuses a `mode` outside the closed pair with the value prescription', async () => {
            const definition = gatewayFlow({ ...OVERLAP, config: { mode: 'all' } });
            expect(() => engine.registerFlow('gateway', definition)).toThrow(MODE_NOT_A_MODE);
            try {
                engine.registerFlow('gateway', definition);
            } catch (e) {
                const message = (e as Error).message;
                expect(message).toContain("`mode: 'all'` is not a decision mode");
                expect(message).toContain("at config.mode");
            }
            expect(await engine.getFlow('gateway')).toBeNull();
        });

        it('refuses the same shape inside a loop body, naming the region', () => {
            const definition = {
                name: 'gateway',
                label: 'Gateway',
                type: 'autolaunched' as const,
                variables: [{ name: 'leads', type: 'object', isInput: true }],
                nodes: [
                    { id: 'start', type: 'start' as const, label: 'Start' },
                    {
                        id: 'sweep', type: 'loop' as const, label: 'Sweep',
                        config: {
                            collection: '{leads}',
                            iteratorVariable: 'lead',
                            body: {
                                nodes: [
                                    { id: 'gate', type: 'decision', label: 'Gate', config: { mode: 'parallel' } },
                                    { id: 'x', type: 'mark', label: 'X' },
                                ],
                                edges: [{ id: 'g1', source: 'gate', target: 'x', condition: 'true' }],
                            },
                        },
                    },
                ],
                edges: [{ id: 'e1', source: 'start', target: 'sweep' }],
            };
            expect(() => engine.registerFlow('gateway', definition)).toThrow(MODE_NOT_A_MODE);
            try {
                engine.registerFlow('gateway', definition);
            } catch (e) {
                expect((e as Error).message).toMatch(/loop 'sweep'.*node 'gate' \(decision\) at config\.mode/);
            }
        });

        it('CONTROLS — `mode` on an empty list, `mode` alone, and a list without `mode` all register', () => {
            const shapes: Record<string, unknown>[] = [
                { mode: 'inclusive', conditions: [] },
                { mode: 'exclusive', conditions: [] },
                { mode: 'inclusive' },
                { conditions: [{ label: 'Refuse', expression: "lead.status != 'suspected'" }] },
            ];
            for (const config of shapes) {
                const registered = engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, config }));
                expect(registered.name).toBe('gateway');
                engine.unregisterFlow('gateway');
            }
        });
    });

    // ── 5. The rehydration seam does not rewrite the flip (ruling C) ──────

    describe('the flow rehydration seam refuses `flow-decision-mode-inclusive-explicit` by id', () => {
        const twoBranches = () => gatewayFlow(OVERLAP);

        it('the refused id is a real registry entry, retired from the load path (anti-vacuity for the seam pin)', () => {
            const entry = ALL_CONVERSIONS.find((c) => c.id === 'flow-decision-mode-inclusive-explicit');
            expect(entry).toBeDefined();
            expect(entry!.retiredFromLoadPath).toBe(true);
            expect(entry!.toMajor).toBe(18);
        });

        it('`canonicalizeStoredFlow` leaves a two-branch decision without `mode` — parsed AND storable — and emits no notice for it', () => {
            const { parsed, storable, notices } = engine.canonicalizeStoredFlow('gateway', twoBranches());
            const parsedCheck = parsed.nodes.find((n) => n.id === 'check')!;
            expect(parsedCheck.config).toBeUndefined();
            const storableCheck = ((storable as { nodes: Array<{ id: string; config?: unknown }> }).nodes).find((n) => n.id === 'check')!;
            expect(storableCheck.config).toBeUndefined();
            expect(notices.map((n) => n.conversionId)).not.toContain('flow-decision-mode-inclusive-explicit');
        });

        it('…and the registered flow therefore runs EXCLUSIVE, which is the ruled default for a body this seam cannot date', async () => {
            engine.registerFlow('gateway', twoBranches());
            await run({ status: 'confirmed' });
            expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
        });

        it('RULING C — a STORED decision lacking `mode`, with overlapping conditions, evaluates FIRST-MATCH after the upgrade: the row registers as stored', async () => {
            // The body exactly as a `sys_metadata` row written before protocol 18
            // carries it — JSON text, no `mode` — and every door a stored row
            // re-enters by (the boot pull, a Studio save, `os migrate meta
            // --stored`) goes through this one seam.
            const stored = JSON.parse(JSON.stringify(twoBranches()));

            // What the stored pass would persist: no `mode` written, no notice for it.
            const { storable, notices } = engine.canonicalizeStoredFlow('gateway', stored);
            const storableCheck = ((storable as { nodes: Array<{ id: string; config?: unknown }> }).nodes).find((n) => n.id === 'check')!;
            expect(storableCheck.config).toBeUndefined();
            expect(notices.map((n) => n.conversionId)).not.toContain('flow-decision-mode-inclusive-explicit');

            engine.registerFlow('gateway', stored);
            await run({ status: 'confirmed' });

            // Both predicates hold for a confirmed lead; only the first declared runs.
            expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
            expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'convert', status: 'skipped', edgeId: 'e_convert' });
        });

        it('RULING C, and the FIRING CONTROL for both pins above — a SOURCE migrated with `os migrate meta --from 17` carries explicit `mode: inclusive` and still takes EVERY branch', async () => {
            const result = applyMetaMigrations({ flows: [twoBranches()] }, 17, 18);
            const migrated = (result.stack.flows as Array<{ nodes: Array<{ id: string; config?: Record<string, unknown> }> }>)[0]!;
            expect(migrated.nodes.find((n) => n.id === 'check')!.config).toEqual({ mode: 'inclusive' });
            expect(result.applied.map((a) => a.conversionId)).toContain('flow-decision-mode-inclusive-explicit');

            engine.registerFlow('gateway', migrated);
            await run({ status: 'confirmed' });

            // Every true branch, one after another — exactly what the flow did before protocol 18.
            expect(trace).toEqual(['enter:refuse', 'exit:refuse', 'enter:convert', 'exit:convert']);
            expect((await stepsOfLastRun()).filter((s) => s.status === 'skipped')).toEqual([]);
        });
    });

    // ── 6. Scoped to `decision` ───────────────────────────────────────────

    it('a NON-decision node with two true conditioned out-edges keeps the every-true-edge traversal (the boundary)', async () => {
        // `mark` returns success with no branch label, so its out-edges route
        // through the same conditional loop — and `mode` is not its key.
        engine.registerFlow('gateway', gatewayFlow({ ...OVERLAP, gatewayType: 'mark' }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:check', 'exit:check', 'enter:refuse', 'exit:refuse', 'enter:convert', 'exit:convert']);
    });
});
