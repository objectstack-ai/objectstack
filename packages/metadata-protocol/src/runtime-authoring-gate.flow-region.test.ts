// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29233] The gate-local `flow-region-malformed` rule, on the pure gate: the
 * gate refuses the ADR-0031 regions the engine's registration refuses (a loop
 * body, a parallel branch, a try or catch region, at any depth), with the
 * sentence the engine throws, located on the container it names. The judge is
 * `validateControlFlow`, the function `canonicalizeFlow` calls; every expected
 * message below is that function's own answer for the case, never a
 * restatement. The draft-read and publish doors over a real protocol are pinned
 * in `protocol.draft-publish-verdict.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { FlowSchema, validateControlFlow } from '@objectstack/spec/automation';
import { evaluateRuntimeAuthoringGate, FLOW_REGION_MALFORMED } from './runtime-authoring-gate.js';

type Rec = Record<string, unknown>;

/** start → the given nodes (unwired) → end; region cases need no top-level edges. */
const flowOf = (name: string, nodes: Rec[]) => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes, { id: 'end', type: 'end', label: 'End' }],
    edges: [] as Rec[],
});

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
    return { err, issues: (err?.issues ?? []).filter((i) => i.rule === FLOW_REGION_MALFORMED) };
}

describe('[#29233] the publish gate refuses the regions the engine refuses', () => {
    it('the card: a loop body a → b → a is refused on the loop, in the engine\'s sentence', () => {
        const flow = flowOf('rgnprobe_loop', [loop('lp', closedBody('k'))]);
        const sentence = engineRefusal(flow);
        expect(sentence).toBe(
            "loop 'lp' body: region has no entry node (every node has an incoming edge — cyclic?); "
            + 'region has no exit node (every node has an outgoing edge — cyclic?); '
            + 'region contains a cycle (region bodies must be acyclic)',
        );
        const { err, issues } = regionIssues(flow);
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err!.rulesRun).toContain(FLOW_REGION_MALFORMED);
        expect(issues).toEqual([{
            severity: 'error',
            rule: FLOW_REGION_MALFORMED,
            where: 'flow "rgnprobe_loop" · node "Loop lp"',
            path: 'flows[0].nodes[1]',
            message: sentence,
            hint: expect.any(String),
        }]);
    });

    it('a parallel block with one branch is refused on the block', () => {
        const flow = flowOf('one_branch', [{ id: 'fan', type: 'parallel', label: 'Fan', config: { branches: [oneStep('only')] } }]);
        expect(regionIssues(flow).issues).toEqual([
            expect.objectContaining({ path: 'flows[0].nodes[1]', message: engineRefusal(flow) }),
        ]);
    });

    it('a try region that closes on itself is refused on the try_catch', () => {
        const flow = flowOf('closed_try', [{
            id: 'guard', type: 'try_catch', label: 'Guard', config: { try: closedBody('t'), catch: oneStep('c') },
        }]);
        const sentence = engineRefusal(flow);
        expect(sentence).toMatch(/^try_catch 'guard' try: /);
        expect(regionIssues(flow).issues).toEqual([
            expect.objectContaining({ path: 'flows[0].nodes[1]', message: sentence }),
        ]);
    });

    it('a region its schema refuses is refused with the engine\'s "invalid region" sentence', () => {
        const flow = flowOf('shapeless', [loop('lp', { nodes: 'not a list' })]);
        const sentence = engineRefusal(flow);
        expect(sentence).toMatch(/^loop 'lp' body: invalid region — /);
        expect(regionIssues(flow).issues).toEqual([
            expect.objectContaining({ path: 'flows[0].nodes[1]', message: sentence }),
        ]);
    });

    it('a malformed region nested in another names both levels and lands on the inner container', () => {
        const flow = flowOf('nested', [{
            id: 'guard', type: 'try_catch', label: 'Guard',
            config: { try: { nodes: [loop('inner', closedBody('n'))], edges: [] }, catch: oneStep('c') },
        }]);
        const sentence = engineRefusal(flow)!;
        expect(sentence).toMatch(/^try_catch 'guard' try → loop 'inner' body: /);
        expect(regionIssues(flow).issues).toEqual([
            expect.objectContaining({
                where: 'flow "nested" · node "Loop inner"',
                path: 'flows[0].nodes[1].config.try.nodes[0]',
                message: sentence,
            }),
        ]);
    });

    it('two malformed top-level containers are reported one finding each', () => {
        const flow = flowOf('two_bad', [loop('first', closedBody('f')), loop('second', closedBody('s'))]);
        expect(regionIssues(flow).issues.map((i) => i.path)).toEqual(['flows[0].nodes[1]', 'flows[0].nodes[2]']);
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
        expect(regionIssues(flow).issues).toEqual([]);
    });

    it('a draft is not gated (D1)', () => {
        const flow = flowOf('draft_loop', [loop('lp', closedBody('d'))]);
        expect(evaluateRuntimeAuthoringGate({ type: 'flow', name: flow.name, state: 'draft', body: structuredClone(flow) }).error)
            .toBeNull();
    });

    it('a body the flow schema refuses is the schema\'s to report: no region finding', () => {
        const flow = { ...flowOf('no_label', [loop('lp', closedBody('x'))]), label: undefined };
        expect(FlowSchema.safeParse(flow).success).toBe(false);
        expect(regionIssues(flow).issues).toEqual([]);
    });
});
