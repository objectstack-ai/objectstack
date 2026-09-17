// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a structured region body may NOT contain — #15646, absorbing #18112.
 *
 * Director seat ruling 5714239196 (maintainer 「同意,其他也同意」) and its scope
 * addition 5714981966 (maintainer 「146 同意」), quoted in the PR: an ADR-0031
 * region body (`loop` / `try_catch` / `parallel`) refuses a node that can
 * durably pause, and refuses an `end` node — one rule family, one PR.
 *
 * Both halves are authoring-time enforcement of the limit #3267 ruled 禁: a
 * region body runs synchronously inside the enclosing run, so it can neither
 * park that run nor terminate it. The engine already refuses both AT RUN TIME
 * (`durable pause inside a structured region … is not supported`, and the
 * #15788 refusing-`end` conversion) — this moves the refusal to where the
 * author is standing.
 *
 * Every case here fails without the rule: the shapes below all parsed green
 * before it.
 */
import { describe, it, expect } from 'vitest';
import {
  FlowSchema,
  FLOW_PAUSE_CAPABLE_NODE_TYPES,
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

describe('FLOW_PAUSE_CAPABLE_NODE_TYPES — the declared set, and how it was derived', () => {
  it('names the six built-in types whose shipped executor declares `supportsPause: true`', () => {
    // Read off the descriptors, not recalled: `screen` / `wait` / `subflow` /
    // `map` in `service-automation`'s builtins, `approval` / `approval_revise`
    // in `plugin-approvals` — the same six the ADR-0044 `resumeAuthority`
    // default-flip migration entry names in its own prose.
    expect([...FLOW_PAUSE_CAPABLE_NODE_TYPES]).toEqual([
      'screen', 'wait', 'subflow', 'map', 'approval', 'approval_revise',
    ]);
  });

  it('carries the approval node types by their declared constants, so a rename cannot desynchronise the two', () => {
    expect(FLOW_PAUSE_CAPABLE_NODE_TYPES).toContain(APPROVAL_NODE_TYPE);
    expect(FLOW_PAUSE_CAPABLE_NODE_TYPES).toContain(APPROVAL_REVISE_NODE_TYPE);
  });
});

describe('a region body refuses a pause-capable node (#15646)', () => {
  it.each(FLOW_PAUSE_CAPABLE_NODE_TYPES)('refuses a `%s` node in a loop body, anchored on its `type`', (type) => {
    expect(issuesOf(flowWith([loopOver([pausingNode(type)])]))).toEqual([[
      'nodes.1.config.body.nodes.0.type',
      expect.stringContaining(
        `A \`${type}\` node may not sit inside a structured region — \`loop 'sweep' body\` is a region body ` +
        `and the \`${type}\` node \`pauser\` is inside it`,
      ) as unknown as string,
    ]]);
  });

  it('refuses it in a try_catch TRY region', () => {
    expect(issuesOf(flowWith([tryCatchOver([pausingNode('map')], [step('recover')])]))).toEqual([[
      'nodes.1.config.try.nodes.0.type',
      expect.stringContaining("`try_catch 'guard' try` is a region body and the `map` node `pauser` is inside it") as unknown as string,
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

  it("refuses this card's own reproduction — `loop { try_catch { map } }` — with the chained region path", () => {
    const issues = issuesOf(flowWith([loopOver([tryCatchOver([pausingNode('map')], [step('recover')])])]));
    expect(issues.map(([path]) => path)).toEqual([
      'nodes.1.config.body.nodes.0.config.try.nodes.0.type',
    ]);
    expect(issues[0][1]).toContain("`loop 'sweep' body → try_catch 'guard' try` is a region body");
  });

  it('says WHY on the node type rather than on the child flow — the sentence an author acts on', () => {
    const [[, message]] = issuesOf(flowWith([loopOver([pausingNode('map')])]));
    expect(message).toContain('A region body runs synchronously and cannot durably pause');
    expect(message).toContain('reads back as progress');
    expect(message).toContain("Move the `map` node onto the top-level graph and route the region's exit to it");
    expect(message).toContain('`map` / `subflow` pause exactly when the child flow they name pauses');
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
      defineFlow(flowWith([loopOver([pausingNode('subflow')])]));
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
    for (const type of FLOW_PAUSE_CAPABLE_NODE_TYPES) {
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

describe('the two declared boundaries — measured, so they move deliberately', () => {
  it('a PLUGIN-contributed pausing type is not refused: a parse has no registry (ADR-0018 open namespace)', () => {
    // ⚠️ Not an oversight and not a gap to quietly close: `FlowNodeSchema.type`
    // is a validated `string`, and a plugin registers pause-capable types at run
    // time. The engine's own run-time refusal is what meets this one. Extending
    // `FLOW_PAUSE_CAPABLE_NODE_TYPES` is how a first-party type joins the rule —
    // and this pin is what makes that an edit somebody makes on purpose.
    const flow = flowWith([loopOver([{ id: 'vendor', type: 'vendor_signature_pause', label: 'Sign' }])]);
    expect(FlowSchema.safeParse(flow).success).toBe(true);
  });

  it('the seam at MAX_REGION_DEPTH: a pause-capable node at nesting 32 is refused; at nesting 33 the parse does not judge it', () => {
    // The walk this rule rides (`collectFlowGraphs`) stops at 32, the ceiling
    // `parseFlowNodeRegions` shares — the same measured boundary #16134's
    // one-id-space rule hands off at. Past it there is no second spec refusal
    // for THIS rule (unlike a duplicate id, which `analyzeRegion` still names),
    // so the engine's run-time refusal is the only one left. Stated in the
    // docblock and in the changeset rather than discovered by an author.
    const nestedTo = (nesting: number): Flow => {
      let body: { nodes: FlowNode[]; edges: FlowEdge[] } = { nodes: [pausingNode('map')], edges: [] };
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
    expect(atCeiling.error.issues[0].message).toContain('A `map` node may not sit inside a structured region');
    expect(atCeiling.error.issues[0].path.slice(-2)).toEqual([0, 'type']);

    expect(FlowSchema.safeParse(nestedTo(33)).success).toBe(true);
  });
});
