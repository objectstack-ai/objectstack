// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { registerLogicNodes } from './logic-nodes.js';

/**
 * ⭐ A STATUS-QUO PIN, NOT A CONTRACT (#15429).
 *
 * Every assertion below records what the engine **does today** when two
 * out-edges of one `decision` node carry conditions that both hold. None of it
 * says the behaviour is right, and nothing here blesses it. The card that asked
 * for this file is explicit that changing evaluation semantics on a shipped node
 * type is a behaviour change with its own ruling, ⛔ not a bug fix — so the
 * first step is a baseline that cannot drift while that ruling is pending.
 *
 * ⇒ When the ruling lands, **this file is rewritten with it**. A failure here
 * after a deliberate semantic change is the pin doing its job, not a regression:
 * update the assertions and the prose together. A failure here after a change
 * that did NOT intend to touch branch selection is the drift it exists to catch.
 *
 * What the card reported, and what this file measured against it:
 *
 *  • REPORTED (from one hotcrm deployment, reasoned backwards from a
 *    reproduction): a decision with no declared `config.conditions` takes every
 *    out-edge whose condition holds, **in parallel**.
 *  • MEASURED here: the take-every-match half is real. The **in parallel** half
 *    is not — matching conditional edges are traversed one at a time, each
 *    successor fully executed before the next is evaluated (`traverseNext`
 *    awaits inside the loop). Only the *unconditional* bucket fans out through
 *    `Promise.all`, and this file keeps that fan-out as a positive control so
 *    the interleaving instrument is shown to detect parallelism where it exists.
 *
 * The distinction matters for whoever writes the ruling: the hazard is
 * multi-branch execution, not concurrency. Two branches that both write the same
 * record run in a defined order, which is a different (and easier) starting
 * point than a genuine race.
 *
 * The two modes are separate on purpose (`logic-nodes.ts`, #4414): a decision
 * that DECLARES `config.conditions` reports the first matching entry's label and
 * traversal narrows to the edge carrying it; a decision that declares none
 * reports no branch at all and is a plain gateway whose out-edges route. The
 * last two tests pin both halves of that split, because "is undeclared a
 * distinct mode?" is the other question the ruling has to start from.
 *
 * On provenance, stated because the answer is "none": the take-every-match loop
 * predates the buckets it lives in. Before `cc8484224` (2026-02-21) traversal
 * was one loop that `continue`d past a closed gate and executed everything else;
 * that commit split conditional from unconditional edges, recorded a decision
 * about the unconditional half ("parallel branch execution (Promise.all for
 * unconditional edges)") and carried the conditional half over unchanged, under
 * a new comment reading `// Conditional edges: evaluate sequentially (mutually
 * exclusive)`. That comment is the only written trace of the assumption, and it
 * is an assumption: nothing in the engine, the schema or the linter makes
 * sibling conditions exclusive. ⛔ No commit message, ADR or doc records the
 * multi-take as a decision — searched with `git log -S` over `engine.ts` for the
 * loop's symbols, and `content/docs/automation/flows.mdx` describes the mode
 * ("BPMN exclusive gateway") without ever saying what happens when two
 * conditions hold at once.
 */

/** One captured `warn` call, so "nothing reports this" is measured, not assumed. */
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

describe('decision with overlapping out-edge conditions — status-quo pin (#15429)', () => {
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
        // the vocabulary it contributes is complete (#4771). Without the seal the
        // first `execute()` warns about it and the zero-warning assertion below —
        // which is about branch reporting, not node types — would count that line.
        engine.sealNodeTypeVocabulary();
    });

    /**
     * The hotcrm shape, reduced: one `decision`, two out-edges, no
     * `config.conditions` on the node. `a` and `b` are the two edge predicates;
     * an empty string means the edge carries no condition at all.
     */
    function gatewayFlow(opts: { a: string; b: string; conditions?: Array<{ label: string; expression: string }> }) {
        return {
            name: 'gateway',
            label: 'Gateway',
            type: 'autolaunched' as const,
            variables: [{ name: 'lead', type: 'object', isInput: true }],
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                {
                    id: 'check', type: 'decision' as const, label: 'Check',
                    ...(opts.conditions ? { config: { conditions: opts.conditions } } : {}),
                },
                { id: 'refuse', type: 'mark' as const, label: 'Refuse' },
                { id: 'convert', type: 'mark' as const, label: 'Convert' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                { id: 'e_refuse', source: 'check', target: 'refuse', label: 'Refuse', ...(opts.a ? { condition: opts.a } : {}) },
                { id: 'e_convert', source: 'check', target: 'convert', label: 'Convert', ...(opts.b ? { condition: opts.b } : {}) },
            ],
        };
    }

    const run = (lead: Record<string, unknown>) => engine.execute('gateway', { params: { lead } } as any);

    const stepsOfLastRun = async () => {
        const [log] = await engine.listRuns('gateway');
        return (log?.steps ?? []).map(s => ({ nodeId: s.nodeId, status: s.status, edgeId: s.skippedBy?.edgeId ?? null }));
    };

    // ── The instrument, before any reading taken with it ──────────────────

    it('CONTROL — disjoint edge conditions take exactly one successor', async () => {
        // Same node, same two edges, same record: only the predicates differ.
        // If this read "both" the counting method would prove nothing below.
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status == 'suspected'",
            b: "lead.status == 'confirmed'",
        }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:convert', 'exit:convert']);
        // …and the branch not taken leaves a trace: a closed gate records a
        // `skipped` step naming the edge that closed it (#4354).
        expect(await stepsOfLastRun()).toContainEqual({ nodeId: 'refuse', status: 'skipped', edgeId: 'e_refuse' });
    });

    // ── The reading ───────────────────────────────────────────────────────

    it('takes EVERY out-edge whose condition holds — the reported hazard, confirmed', async () => {
        // The hotcrm pair verbatim in shape: a `Clean` guard spelled as a
        // negation, and a later `== confirmed` branch added beside it. For a
        // confirmed record both predicates are true, and the author's reading of
        // the node — "one of these" — is nowhere written down.
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status != 'suspected'",
            b: "lead.status == 'confirmed'",
        }));

        const result = await run({ status: 'confirmed' });

        // Both successors run. The refusal screen renders AND the conversion
        // runs, in one execution — pinned as today's behaviour, ⛔ not endorsed.
        expect(trace.filter(t => t.startsWith('enter:'))).toEqual(['enter:refuse', 'enter:convert']);
        expect(result.success).toBe(true);
    });

    it('takes them one at a time, NOT in parallel — the card says parallel; the engine does not', async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status != 'suspected'",
            b: "lead.status == 'confirmed'",
        }));

        await run({ status: 'confirmed' });

        // Nested, not interleaved: `refuse` finishes before `convert` starts.
        expect(trace).toEqual(['enter:refuse', 'exit:refuse', 'enter:convert', 'exit:convert']);
    });

    it('POSITIVE CONTROL — the same instrument reads interleaving on the unconditional fan-out', async () => {
        // Drop both conditions and the identical pair of edges lands in the
        // unconditional bucket, which really is `Promise.all`. This is what
        // proves the previous test measured sequencing rather than an instrument
        // that cannot see concurrency at all.
        engine.registerFlow('gateway', gatewayFlow({ a: '', b: '' }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'enter:convert', 'exit:refuse', 'exit:convert']);
    });

    it('reports the multi-take NOWHERE — no warning, and no `skipped` step to notice it by', async () => {
        engine.registerFlow('gateway', gatewayFlow({
            a: "lead.status != 'suspected'",
            b: "lead.status == 'confirmed'",
        }));

        await run({ status: 'confirmed' });

        // Both edges opened, so neither records the `skipped` step that makes a
        // closed gate visible in the CONTROL above: the run log of a
        // two-branch execution is indistinguishable from a flow that was
        // *authored* to run both.
        const steps = await stepsOfLastRun();
        expect(steps.filter(s => s.status === 'skipped')).toEqual([]);
        expect(steps.filter(s => s.status === 'success').map(s => s.nodeId)).toEqual(['start', 'check', 'refuse', 'convert']);
        expect(warnings).toEqual([]);
    });

    // ── The other half of the question: is undeclared a distinct mode? ────

    it('declared `config.conditions` is a DIFFERENT mode — first match wins, even when two match', async () => {
        // The same two overlapping predicates, moved onto the node. The executor
        // returns on the first match (`logic-nodes.ts`), traversal narrows to the
        // edge carrying that label, and the second branch is never reached.
        engine.registerFlow('gateway', gatewayFlow({
            a: '', b: '',
            conditions: [
                { label: 'Refuse', expression: "lead.status != 'suspected'" },
                { label: 'Convert', expression: "lead.status == 'confirmed'" },
            ],
        }));

        await run({ status: 'confirmed' });

        expect(trace).toEqual(['enter:refuse', 'exit:refuse']);
        // Narrowed away, not gated: the losing edge leaves no step at all — not
        // even the `skipped` one a closed gate writes. The two modes differ in
        // what they record as well as in what they run.
        const steps = await stepsOfLastRun();
        expect(steps.map(s => s.nodeId)).toEqual(['start', 'check', 'refuse']);
        expect(warnings).toEqual([]);
    });
});
