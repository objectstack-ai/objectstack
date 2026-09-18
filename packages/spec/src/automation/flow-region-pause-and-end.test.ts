// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a structured region body may NOT contain — #15646, absorbing #18112.
 *
 * Director seat ruling 5714239196 (maintainer 「同意,其他也同意」) and its scope
 * addition 5714981966 (maintainer 「146 同意」) put the rule here; ruling
 * 5724940095, decision batch #153 item 1 letter **D** (maintainer 「其他同意」),
 * fixed its POPULATION and is quoted verbatim in the PR:
 *
 * 「inside `loop` / `parallel` branch / `try_catch` (try and catch) bodies at
 * any depth, the node types `screen`, `wait`, `approval`, `approval_revise`
 * and `end` are refused by `FlowSchema.superRefine`, the message naming the
 * node and the region. `map` and `subflow` are ⛔ not refused by type.」
 *
 * Both halves are authoring-time enforcement of the limit #3267 ruled 禁: a
 * region body runs synchronously inside the enclosing run, so it can neither
 * park that run nor terminate it. The engine already refuses both AT RUN TIME
 * (`durable pause inside a structured region … is not supported`, and the
 * #15788 refusing-`end` conversion) — this moves the refusal to where the
 * author is standing, for the half a parse can actually judge.
 *
 * ⭐ The `map` / `subflow` exclusion is load-bearing and has its own pins in
 * "the declared boundaries" below: those two pause exactly when the child flow
 * they name pauses, so a type-keyed refusal would also refuse
 * `loop { map(synchronous child) }` — a shape that runs correctly today. The
 * run-time half of ruling D is what meets them.
 *
 * Every refusal case here fails without the rule: the shapes below all parsed
 * green before it.
 */
import { describe, it, expect } from 'vitest';
import {
  FlowSchema,
  FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES,
  defineFlow,
  type Flow,
  type FlowNode,
  type FlowEdge,
} from './flow.zod';
import { APPROVAL_NODE_TYPE, APPROVAL_REVISE_NODE_TYPE } from './approval.zod';
import { validateControlFlow } from './control-flow.zod';
import { formatZodError } from '../shared/error-map.zod';

/** A `wait` node owes a `waitEventConfig` block, so every fixture carries one. */
const pausingNode = (type: string, id = 'pauser'): FlowNode => ({
  id,
  type,
  label: `A ${type}`,
  ...(type === 'wait' ? { waitEventConfig: { eventType: 'timer' as const, timerDuration: 'PT1H' } } : {}),
  ...(type === 'map' ? { config: { collection: '{items}', flowName: 'per_item' } } : {}),
  ...(type === 'subflow' ? { config: { flowName: 'child' } } : {}),
});

const step = (id: string): FlowNode => ({ id, type: 'assignment', label: id });

const flowWith = (nodes: FlowNode[], edges: FlowEdge[] = []): Flow => ({
  name: 'region_contents',
  label: 'Region contents',
  type: 'autolaunched',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, ...nodes],
  edges,
});

const loopOver = (bodyNodes: FlowNode[], id = 'sweep'): FlowNode => ({
  id, type: 'loop', label: 'Sweep',
  config: { collection: '{items}', body: { nodes: bodyNodes, edges: [] } },
});

const tryCatchOver = (tryNodes: FlowNode[], catchNodes: FlowNode[], id = 'guard'): FlowNode => ({
  id, type: 'try_catch', label: 'Guard',
  config: { try: { nodes: tryNodes, edges: [] }, catch: { nodes: catchNodes, edges: [] } },
});

const parallelOver = (branches: FlowNode[][], id = 'fan'): FlowNode => ({
  id, type: 'parallel', label: 'Fan out',
  config: { branches: branches.map((nodes) => ({ nodes, edges: [] })) },
});

/** Every issue as `[path, message]`, for the assertions below. */
const issuesOf = (flow: Flow): Array<[string, string]> => {
  const result = FlowSchema.safeParse(flow);
  if (result.success) return [];
  return result.error.issues.map((i) => [i.path.join('.'), i.message]);
};

describe('FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES — the declared set, and how it was derived', () => {
  it('names the four built-in types that park a run on EVERY execution', () => {
    // Read off the descriptors, not recalled. SIX shipped executors declare
    // `supportsPause: true` — `screen` / `wait` / `subflow` / `map` in
    // `service-automation`'s builtins, `approval` / `approval_revise` in
    // `plugin-approvals`, the same six the ADR-0044 `resumeAuthority`
    // default-flip migration entry names. Four of them pause from this flow's
    // own text; those four are the region rule's population.
    expect([...FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES]).toEqual([
      'screen', 'wait', 'approval', 'approval_revise',
    ]);
  });

  it('⛔ excludes `subflow` and `map`, which are pause-capable but not unconditionally so', () => {
    // Ruling D, verbatim: 「`map` and `subflow` are ⛔ not refused by type.」
    // They pause exactly when the child flow `config.flowName` names pauses —
    // a different metadata record, unreadable from here. Pinned as a DECISION
    // so re-adding either is an edit somebody makes on purpose, against the
    // ruling, rather than a tidy-up that looks like completing a list.
    expect(FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES).not.toContain('subflow');
    expect(FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES).not.toContain('map');
  });

  it('carries the approval node types by their declared constants, so a rename cannot desynchronise the two', () => {
    expect(FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES).toContain(APPROVAL_NODE_TYPE);
    expect(FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES).toContain(APPROVAL_REVISE_NODE_TYPE);
  });
});

describe('a region body refuses a pause-capable node (#15646)', () => {
  it.each(FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES)('refuses a `%s` node in a loop body, anchored on its `type`', (type) => {
    expect(issuesOf(flowWith([loopOver([pausingNode(type)])]))).toEqual([[
      'nodes.1.config.body.nodes.0.type',
      expect.stringContaining(
        `A \`${type}\` node may not sit inside a structured region — \`loop 'sweep' body\` is a region body ` +
        `and the \`${type}\` node \`pauser\` is inside it`,
      ) as unknown as string,
    ]]);
  });

  it('refuses it in a try_catch TRY region', () => {
    expect(issuesOf(flowWith([tryCatchOver([pausingNode('wait')], [step('recover')])]))).toEqual([[
      'nodes.1.config.try.nodes.0.type',
      expect.stringContaining("`try_catch 'guard' try` is a region body and the `wait` node `pauser` is inside it") as unknown as string,
    ]]);
  });

  it('refuses it in a try_catch CATCH region — the arm route B could never see', () => {
    expect(issuesOf(flowWith([tryCatchOver([step('attempt')], [pausingNode('approval')])]))).toEqual([[
      'nodes.1.config.catch.nodes.0.type',
      expect.stringContaining("`try_catch 'guard' catch` is a region body and the `approval` node `pauser` is inside it") as unknown as string,
    ]]);
  });

  it('refuses it in a parallel BRANCH — the other arm route B could never see', () => {
    expect(issuesOf(flowWith([parallelOver([[step('left')], [pausingNode('screen')]])]))).toEqual([[
      'nodes.1.config.branches.1.nodes.0.type',
      expect.stringContaining("`parallel 'fan' branch 1` is a region body and the `screen` node `pauser` is inside it") as unknown as string,
    ]]);
  });

  it('names the CHAINED region path when the regions nest — `loop { try_catch { approval } }`', () => {
    // The nesting shape of this card's own reproduction, with a node type the
    // parse can judge. The reproduction's own `map` is pinned as still
    // declarable in "the declared boundaries" below — that is ruling D, not a
    // hole in this assertion.
    const issues = issuesOf(flowWith([loopOver([tryCatchOver([pausingNode('approval')], [step('recover')])])]));
    expect(issues.map(([path]) => path)).toEqual([
      'nodes.1.config.body.nodes.0.config.try.nodes.0.type',
    ]);
    expect(issues[0][1]).toContain("`loop 'sweep' body → try_catch 'guard' try` is a region body");
  });

  it('says WHY, and names the node and the region — the sentence an author acts on', () => {
    const [[, message]] = issuesOf(flowWith([loopOver([pausingNode('wait')])]));
    expect(message).toContain('A region body runs synchronously and cannot durably pause');
    expect(message).toContain('parks the run on EVERY execution');
    expect(message).toContain('reads back as progress');
    expect(message).toContain("Move the `wait` node onto the top-level graph and route the region's exit to it");
    // ⛔ The message must not advertise a population the rule does not refuse:
    // naming `map` / `subflow` here would send an author hunting for a refusal
    // that never fires.
    expect(message).not.toContain('subflow');
    expect(message).not.toContain('`map`');
  });

  it('renders through formatZodError pointing INTO the region', () => {
    const result = FlowSchema.safeParse(flowWith([loopOver([pausingNode('wait')])]));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatZodError(result.error)).toContain(
      'nodes.1.config.body.nodes.0.type: A `wait` node may not sit inside a structured region',
    );
  });

  it('defineFlow refuses it with the same anchored issue', () => {
    let caught: unknown;
    try {
      defineFlow(flowWith([loopOver([pausingNode('screen')])]));
    } catch (error) {
      caught = error;
    }
    const issues = (caught as { issues?: Array<{ code: string; path: PropertyKey[] }> })?.issues;
    expect(issues).toBeDefined();
    expect(issues!.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'type']],
    ]);
  });
});

describe('a region body refuses an `end` node (#18112, absorbed into #15646)', () => {
  it.each([
    ['loop body', loopOver([{ id: 'stop', type: 'end', label: 'Stop' }]), 'nodes.1.config.body.nodes.0.type', "loop 'sweep' body"],
    ['try region', tryCatchOver([{ id: 'stop', type: 'end', label: 'Stop' }], [step('recover')]), 'nodes.1.config.try.nodes.0.type', "try_catch 'guard' try"],
    ['catch region', tryCatchOver([step('attempt')], [{ id: 'stop', type: 'end', label: 'Stop' }]), 'nodes.1.config.catch.nodes.0.type', "try_catch 'guard' catch"],
    ['parallel branch', parallelOver([[step('left')], [{ id: 'stop', type: 'end', label: 'Stop' }]]), 'nodes.1.config.branches.1.nodes.0.type', "parallel 'fan' branch 1"],
  ])('refuses an `end` in a %s', (_kind, container, path, scope) => {
    const issues = issuesOf(flowWith([container]));
    expect(issues.map(([p]) => p)).toEqual([path]);
    expect(issues[0][1]).toContain(
      `An \`end\` node may not sit inside a structured region — \`${scope}\` is a region body and the \`end\` node \`stop\` is inside it`,
    );
  });

  it('gives the ruled prescription verbatim — a region body cannot end the run; put the `end` on the top-level graph', () => {
    const [[, message]] = issuesOf(flowWith([loopOver([{ id: 'stop', type: 'end', label: 'Stop' }])]));
    expect(message).toContain('A region body cannot END the run');
    expect(message).toContain("Put the `end` on the top-level graph and route the region's exit to it");
  });

  it('refuses it whatever the `outcome` — a plain terminal is a no-op there, a refusing one is converted to a region error', () => {
    for (const config of [undefined, { outcome: 'completed' as const }, { outcome: 'refused' as const, message: 'Refused: {record.name}' }]) {
      const issues = issuesOf(flowWith([loopOver([{ id: 'stop', type: 'end', label: 'Stop', config }])]));
      expect(issues.map(([p]) => p), JSON.stringify(config)).toEqual(['nodes.1.config.body.nodes.0.type']);
    }
  });
});

describe('the rule does NOT over-reach', () => {
  it('accepts every pause-capable type on the TOP-LEVEL graph — a refusal that over-reaches is worse than the silence it replaces', () => {
    for (const type of [...FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES, 'subflow', 'map']) {
      const flow = flowWith([pausingNode(type)], [{ id: 'e1', source: 'start', target: 'pauser' }]);
      expect(FlowSchema.safeParse(flow).success, type).toBe(true);
    }
  });

  it('accepts an `end` on the top-level graph, including one inside a flow that also has regions', () => {
    const flow = flowWith(
      [loopOver([step('work')]), { id: 'stop', type: 'end', label: 'Stop' }],
      [{ id: 'e1', source: 'start', target: 'sweep' }, { id: 'e2', source: 'sweep', target: 'stop' }],
    );
    const parsed = FlowSchema.safeParse(flow);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(() => validateControlFlow(parsed.data)).not.toThrow();
  });

  it('leaves every non-pausing node type alone inside a region — the rule is a list, not a mood', () => {
    for (const type of ['assignment', 'decision', 'create_record', 'update_record', 'get_record', 'http', 'notify', 'loop']) {
      const node: FlowNode = type === 'loop'
        ? loopOver([step('inner')], 'inner_loop')
        : { id: 'work', type, label: 'Work' };
      expect(FlowSchema.safeParse(flowWith([loopOver([node])])).success, type).toBe(true);
    }
  });

  it('judges the node TYPE, not the node id — a node merely NAMED `end` or `wait` in a region still parses', () => {
    expect(FlowSchema.safeParse(flowWith([loopOver([step('end'), step('wait')])])).success).toBe(true);
  });
});

describe('the declared boundaries — measured, so they move deliberately', () => {
  it.each(['map', 'subflow'])('⛔ does NOT refuse a `%s` in a region body — ruling D, letter for letter', (type) => {
    // 「`map` and `subflow` are ⛔ not refused by type.」 Their pause lives in
    // the child flow `config.flowName` names — a metadata record this parse
    // does not hold — so a type-keyed refusal would also refuse
    // `loop { map(synchronous child) }`, which runs correctly today and is
    // covered by #15616's regression suite in `packages/services`.
    expect(FlowSchema.safeParse(flowWith([loopOver([pausingNode(type)])])).success, type).toBe(true);
  });

  it("⛔ leaves this card's own reproduction declarable — `loop { try_catch { map } }` — and that is the ruling, not a hole", () => {
    // The exact shape #15646 was filed on. It parses, deliberately: what makes
    // it wrong is that the child flow pauses, which only the RUN knows. Ruling
    // D's second half is a `domain:services` card that fails such a run with a
    // named error instead of reporting `success` with `summary.failed = 0`.
    // ⛔ Do not "fix" this pin by widening the parse — that is route A/C, both
    // explicitly refused.
    const flow = flowWith([loopOver([tryCatchOver([pausingNode('map')], [step('recover')])])]);
    expect(FlowSchema.safeParse(flow).success).toBe(true);
  });

  it('a PLUGIN-contributed pausing type is not refused: a parse has no registry (ADR-0018 open namespace)', () => {
    // ⚠️ Not an oversight and not a gap to quietly close: `FlowNodeSchema.type`
    // is a validated `string`, and a plugin registers pause-capable types at run
    // time. The engine's own run-time refusal is what meets this one. Extending
    // `FLOW_UNCONDITIONAL_PAUSE_NODE_TYPES` is how a first-party type joins the
    // rule — and this pin is what makes that an edit somebody makes on purpose.
    const flow = flowWith([loopOver([{ id: 'vendor', type: 'vendor_signature_pause', label: 'Sign' }])]);
    expect(FlowSchema.safeParse(flow).success).toBe(true);
  });

  it('the seam at MAX_REGION_DEPTH: an unconditionally pausing node at nesting 32 is refused; at nesting 33 the parse does not judge it', () => {
    // The walk this rule rides (`collectFlowGraphs`) stops at 32, the ceiling
    // `parseFlowNodeRegions` shares — the same measured boundary #16134's
    // one-id-space rule hands off at. Past it there is no second spec refusal
    // for THIS rule (unlike a duplicate id, which `analyzeRegion` still names),
    // so the engine's run-time refusal is the only one left. Stated in the
    // docblock and in the changeset rather than discovered by an author.
    const nestedTo = (nesting: number): Flow => {
      let body: { nodes: FlowNode[]; edges: FlowEdge[] } = { nodes: [pausingNode('wait')], edges: [] };
      for (let k = nesting - 1; k >= 1; k--) {
        body = { nodes: [{ id: `l${k}`, type: 'loop', label: `L${k}`, config: { collection: '{items}', body } }], edges: [] };
      }
      return JSON.parse(JSON.stringify(flowWith([
        { id: 'sweep', type: 'loop', label: 'Sweep', config: { collection: '{items}', body } },
      ]))) as Flow;
    };

    const atCeiling = FlowSchema.safeParse(nestedTo(32));
    expect(atCeiling.success).toBe(false);
    if (atCeiling.success) return;
    expect(atCeiling.error.issues).toHaveLength(1);
    expect(atCeiling.error.issues[0].message).toContain('A `wait` node may not sit inside a structured region');
    expect(atCeiling.error.issues[0].path.slice(-2)).toEqual([0, 'type']);

    expect(FlowSchema.safeParse(nestedTo(33)).success).toBe(true);
  });
});
