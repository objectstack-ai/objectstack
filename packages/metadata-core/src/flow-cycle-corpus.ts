// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29025] The shared corpus of the flow-cycle judge (`findUndeclaredFlowCycle`, `./flow-cycle.ts`).
 *
 * Each case is a complete flow body that `FlowSchema` accepts, with the cycle
 * walk the judge must report (`null` = acyclic once `back` edges are set
 * aside). Three suites read it: the judge's own, the automation engine's
 * registration, and the runtime authoring gate's. Each asserts its face refuses
 * exactly the cases whose `cycle` is non-null, with the judge's message, so the
 * engine and the gate cannot drift apart on which graphs they refuse.
 *
 * Nodes are `start`, `assignment` and `end` only, and no edge carries a
 * condition, so no other registration or authoring check has anything to say
 * about a case: the cycle is the only verdict in play.
 */

export interface FlowCycleCorpusCase {
    /** What the case pins, in a few words. */
    readonly title: string;
    /** A complete flow body; its `name` is unique in the corpus. */
    readonly flow: {
        readonly name: string;
        readonly label: string;
        readonly type: 'autolaunched';
        readonly nodes: ReadonlyArray<{ readonly id: string; readonly type: string; readonly label: string }>;
        readonly edges: ReadonlyArray<{ readonly id: string; readonly source: string; readonly target: string; readonly type?: string }>;
    };
    /** The cycle walk the judge reports, or `null` when the flow must register and publish. */
    readonly cycle: readonly string[] | null;
    /** The index in `edges` of the cycle-closing edge, when `cycle` is set. */
    readonly closingEdgeIndex?: number;
}

const node = (id: string, type = 'assignment') => ({ id, type, label: id });

/** The card's shape: start → push → check → revise → push, the loop edge untyped. */
const reworkNodes = [node('start', 'start'), node('push'), node('check'), node('revise'), node('end', 'end')];
const reworkEdges = (loopType?: string) => [
    { id: 'e1', source: 'start', target: 'push' },
    { id: 'e2', source: 'push', target: 'check' },
    { id: 'e3', source: 'check', target: 'end' },
    { id: 'e4', source: 'check', target: 'revise' },
    { id: 'e5', source: 'revise', target: 'push', ...(loopType ? { type: loopType } : {}) },
];

export const FLOW_CYCLE_CORPUS: readonly FlowCycleCorpusCase[] = [
    {
        title: 'a rework loop whose closing edge is untyped is refused',
        flow: { name: 'cyc_rework_untyped', label: 'Rework', type: 'autolaunched', nodes: reworkNodes, edges: reworkEdges() },
        cycle: ['push', 'check', 'revise', 'push'],
        closingEdgeIndex: 4,
    },
    {
        title: 'the same loop with its closing edge typed back registers',
        flow: { name: 'cyc_rework_back', label: 'Rework', type: 'autolaunched', nodes: reworkNodes, edges: reworkEdges('back') },
        cycle: null,
    },
    {
        title: 'a closing edge typed fault still closes a cycle',
        flow: { name: 'cyc_rework_fault', label: 'Rework', type: 'autolaunched', nodes: reworkNodes, edges: reworkEdges('fault') },
        cycle: ['push', 'check', 'revise', 'push'],
        closingEdgeIndex: 4,
    },
    {
        title: 'a self-loop is refused',
        flow: {
            name: 'cyc_self', label: 'Self', type: 'autolaunched',
            nodes: [node('start', 'start'), node('again'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'again' },
                { id: 'e2', source: 'again', target: 'again' },
                { id: 'e3', source: 'again', target: 'end' },
            ],
        },
        cycle: ['again', 'again'],
        closingEdgeIndex: 1,
    },
    {
        title: 'a self-loop typed back registers',
        flow: {
            name: 'cyc_self_back', label: 'Self', type: 'autolaunched',
            nodes: [node('start', 'start'), node('again'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'again' },
                { id: 'e2', source: 'again', target: 'again', type: 'back' },
                { id: 'e3', source: 'again', target: 'end' },
            ],
        },
        cycle: null,
    },
    {
        title: 'any edge of the loop typed back breaks it — the graph minus back edges is what must be acyclic',
        flow: {
            name: 'cyc_mid_back', label: 'Mid', type: 'autolaunched', nodes: reworkNodes,
            edges: reworkEdges().map((e) => (e.id === 'e2' ? { ...e, type: 'back' } : e)),
        },
        cycle: null,
    },
    {
        title: 'two loops, one declared, one not: the undeclared one is refused',
        flow: {
            name: 'cyc_two_loops', label: 'Two', type: 'autolaunched',
            nodes: [node('start', 'start'), node('a'), node('b'), node('c'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'a' },
                { id: 'e2', source: 'a', target: 'b' },
                { id: 'e3', source: 'b', target: 'a', type: 'back' },
                { id: 'e4', source: 'b', target: 'c' },
                { id: 'e5', source: 'c', target: 'b' },
                { id: 'e6', source: 'c', target: 'end' },
            ],
        },
        cycle: ['b', 'c', 'b'],
        closingEdgeIndex: 4,
    },
    {
        title: 'a diamond (two paths meeting again) is no cycle',
        flow: {
            name: 'cyc_diamond', label: 'Diamond', type: 'autolaunched',
            nodes: [node('start', 'start'), node('left'), node('right'), node('join'), node('end', 'end')],
            edges: [
                { id: 'e1', source: 'start', target: 'left' },
                { id: 'e2', source: 'start', target: 'right' },
                { id: 'e3', source: 'left', target: 'join' },
                { id: 'e4', source: 'right', target: 'join' },
                { id: 'e5', source: 'join', target: 'end' },
            ],
        },
        cycle: null,
    },
];
