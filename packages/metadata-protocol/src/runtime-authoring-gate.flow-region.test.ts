// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29233] The registry rule `flow-region-shape-invalid`
 * (`validateFlowRegionShape`, `@objectstack/lint`) on the pure runtime gate:
 * the gate refuses the ADR-0031 regions the engine's registration refuses (a
 * loop body, a parallel branch, a try or catch region, at any depth), with the
 * sentence the engine throws. The judge is `validateControlFlow`, the function
 * `canonicalizeFlow` calls; every expected sentence below is that function's
 * own answer for the case, never a restatement. The draft-read and publish
 * doors over a real protocol are pinned in
 * `protocol.draft-publish-verdict.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { FlowSchema, validateControlFlow } from '@objectstack/spec/automation';
import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

/** The registry rule's id (`FLOW_REGION_SHAPE_INVALID` in `@objectstack/lint`). */
const RULE = 'flow-region-shape-invalid';

type Rec = Record<string, unknown>;

/**
 * start → the given nodes → end, chained in order: a top-level node no edge
 * reaches is refused at parse, and that is not the rule these cases judge.
 */
const flowOf = (name: string, nodes: Rec[]) => {
    const ids = ['start', ...nodes.map((n) => String(n.id)), 'end'];
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }],
        edges: ids.slice(1).map((target, i) => ({ id: `e${i}`, source: ids[i], target })) as Rec[],
    };
};

const oneStep = (id: string) => ({ nodes: [{ id, type: 'assignment', label: id }], edges: [] });

/** A two-step body whose edges close on themselves: no entry, no exit, a cycle. */
const closedBody = (prefix: string) => ({
    nodes: [
        { id: `${prefix}_a`, type: 'assignment', label: 'A' },
        { id: `${prefix}_b`, type: 'assignment', label: 'B' },
    ],
    edges: [
        { id: `${prefix}_1`, source: `${prefix}_a`, target: `${prefix}_b` },
        { id: `${prefix}_2`, source: `${prefix}_b`, target: `${prefix}_a` },
    ],
});

const loop = (id: string, body: unknown) => ({
    id, type: 'loop', label: `Loop ${id}`, config: { collection: [1, 2], iteratorVariable: 'row', body },
});

/** What the engine's registration throws for this flow, or null. */
function engineRefusal(flow: unknown): string | null {
    try {
        validateControlFlow(FlowSchema.parse(structuredClone(flow)));
        return null;
    } catch (e) {
        return (e as Error).message;
    }
}

function regionIssues(flow: { name: string }, state: 'active' | 'draft' = 'active') {
    const verdict = evaluateRuntimeAuthoringGate({ type: 'flow', name: flow.name, state, body: structuredClone(flow) });
    const err = verdict.error as (Error & { code: string; status: number; issues: any[]; rulesRun: string[] }) | null;
    return { err, issues: (err?.issues ?? []).filter((i) => i.rule === RULE) };
}

/** The registry rule's message: the engine's refusal behind the flow's name. */
const refusedAt = (name: string, sentence: string | null) => `Flow '${name}' would be refused at registration: ${sentence}`;

describe('[#29233] the publish gate refuses the regions the engine refuses, through the registry rule', () => {
    it('the card: a loop body a → b → a is refused, in the engine\'s sentence', () => {
        const flow = flowOf('rgnprobe_loop', [loop('lp', closedBody('k'))]);
        const sentence = engineRefusal(flow);
        expect(sentence).toBe(
            "loop 'lp' body: region has no entry node (every node has an incoming edge — cyclic?); "
            + 'region has no exit node (every node has an outgoing edge — cyclic?); '
            + 'region contains a cycle (region bodies must be acyclic)',
        );
        const { err, issues } = regionIssues(flow);
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err!.rulesRun).toContain('validateFlowRegionShape');
        expect(issues).toEqual([{
            severity: 'error',
            rule: RULE,
            // [#29558] Anchored on the container the engine names, not the flow.
            where: "flow 'rgnprobe_loop' › node 'lp'",
            path: 'flows[0].nodes[1]',
            message: refusedAt('rgnprobe_loop', sentence),
            hint: expect.any(String),
        }]);
    });

    it('a parallel block with one branch is refused', () => {
        const flow = flowOf('one_branch', [{ id: 'fan', type: 'parallel', label: 'Fan', config: { branches: [oneStep('only')] } }]);
        expect(regionIssues(flow).issues).toEqual([
            expect.objectContaining({ path: 'flows[0].nodes[1]', message: refusedAt('one_branch', engineRefusal(flow)) }),
        ]);
    });

    it('a try region that closes on itself is refused', () => {
        const flow = flowOf('closed_try', [{
            id: 'guard', type: 'try_catch', label: 'Guard', config: { try: closedBody('t'), catch: oneStep('c') },
        }]);
        const sentence = engineRefusal(flow);
        expect(sentence).toMatch(/^try_catch 'guard' try: /);
        expect(regionIssues(flow).issues).toEqual([expect.objectContaining({ message: refusedAt('closed_try', sentence) })]);
    });

    it('a region its schema refuses is refused with the engine\'s "invalid region" sentence', () => {
        const flow = flowOf('shapeless', [loop('lp', { nodes: 'not a list' })]);
        const sentence = engineRefusal(flow);
        expect(sentence).toMatch(/^loop 'lp' body: invalid region — /);
        expect(regionIssues(flow).issues).toEqual([expect.objectContaining({ message: refusedAt('shapeless', sentence) })]);
    });

    it('a malformed region nested in another is refused, its sentence naming both levels', () => {
        const flow = flowOf('nested', [{
            id: 'guard', type: 'try_catch', label: 'Guard',
            config: { try: { nodes: [loop('inner', closedBody('n'))], edges: [] }, catch: oneStep('c') },
        }]);
        const sentence = engineRefusal(flow)!;
        expect(sentence).toMatch(/^try_catch 'guard' try → loop 'inner' body: /);
        expect(regionIssues(flow).issues).toEqual([
            expect.objectContaining({ path: 'flows[0].nodes[1].config.try.nodes[0]', message: refusedAt('nested', sentence) }),
        ]);
    });

    it('two malformed containers give one finding, the engine\'s first refusal', () => {
        const flow = flowOf('two_bad', [loop('first', closedBody('f')), loop('second', closedBody('s'))]);
        const sentence = engineRefusal(flow)!;
        expect(sentence).toMatch(/^loop 'first' body: /);
        expect(regionIssues(flow).issues).toEqual([expect.objectContaining({ message: refusedAt('two_bad', sentence) })]);
    });

    it('controls: a well-formed loop, parallel and try_catch region, nested too, raise nothing', () => {
        const flow = flowOf('all_good', [
            loop('lp', oneStep('l1')),
            { id: 'fan', type: 'parallel', label: 'Fan', config: { branches: [oneStep('p1'), oneStep('p2')] } },
            {
                id: 'guard', type: 'try_catch', label: 'Guard',
                config: { try: { nodes: [loop('inner', oneStep('i1'))], edges: [] }, catch: oneStep('c1') },
            },
        ]);
        expect(engineRefusal(flow)).toBeNull();
        const verdict = evaluateRuntimeAuthoringGate({ type: 'flow', name: flow.name, state: 'active', body: structuredClone(flow) });
        expect(((verdict.error as any)?.issues ?? []).filter((i: any) => i.rule === RULE)).toEqual([]);
    });

    it('a draft is not gated (D1)', () => {
        const flow = flowOf('draft_loop', [loop('lp', closedBody('d'))]);
        expect(evaluateRuntimeAuthoringGate({ type: 'flow', name: flow.name, state: 'draft', body: structuredClone(flow) }).error)
            .toBeNull();
    });
});
