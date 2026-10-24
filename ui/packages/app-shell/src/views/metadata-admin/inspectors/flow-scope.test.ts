// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  connectorActionOutputKeys,
  connectorActionOutputSchema,
  edgeSourceOutputRefs,
  flowAncestors,
  hasCommittedConnectorAction,
  nodeOutputRefs,
  resolveEdgeScope,
  resolveFlowScope,
  triggerFieldRefs,
} from './flow-scope';

const tokens = (refs: ReadonlyArray<{ token: string }>) => refs.map((r) => r.token);
const groupTokens = (scope: { refs: Array<{ token: string; group: string }> }, group: string) =>
  scope.refs.filter((r) => r.group === group).map((r) => r.token);

describe('flowAncestors', () => {
  const edges = [
    { source: 'start', target: 'a' },
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
  ];
  it('collects all transitive predecessors, excluding the node itself', () => {
    expect([...flowAncestors('c', edges)].sort()).toEqual(['a', 'b', 'start']);
    expect(flowAncestors('c', edges).has('c')).toBe(false);
  });
  it('a node with no incoming edge has no ancestors', () => {
    expect([...flowAncestors('start', edges)]).toEqual([]);
  });
  it('does not count downstream nodes as ancestors', () => {
    expect(flowAncestors('a', edges).has('b')).toBe(false);
    expect(flowAncestors('a', edges).has('c')).toBe(false);
  });
  it('is cycle-safe (a back-edge revise loop does not spin)', () => {
    const cyclic = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' }, // back-edge
    ];
    const anc = flowAncestors('b', cyclic);
    expect(anc.has('a')).toBe(true);
    expect(anc.has('c')).toBe(true);
    expect(anc.has('b')).toBe(false);
  });
  it('handles branch/merge (diamond) graphs', () => {
    const diamond = [
      { source: 's', target: 'l' },
      { source: 's', target: 'r' },
      { source: 'l', target: 'm' },
      { source: 'r', target: 'm' },
    ];
    expect([...flowAncestors('m', diamond)].sort()).toEqual(['l', 'r', 's']);
  });
});

describe('nodeOutputRefs', () => {
  it('reads a single outputVariable', () => {
    expect(tokens(nodeOutputRefs({ id: 'g', type: 'get_record', config: { outputVariable: 'records' } }))).toEqual(['records']);
  });
  it('does NOT read the legacy script outputVariables[] list (framework#4278)', () => {
    // The engine never binds those names — suggesting them offered successors
    // variables that never exist at run time. The script node's real output
    // binding is the singular `outputVariable` on the function path.
    expect(tokens(nodeOutputRefs({ id: 's', type: 'script', config: { outputVariables: ['lead_score', 'qualified'] } }))).toEqual([]);
    expect(tokens(nodeOutputRefs({ id: 's', type: 'script', config: { function: 'score', outputVariable: 'lead_score' } }))).toEqual(['lead_score']);
  });
  it('flags a loop/map iterator as a loop ref and collects its output', () => {
    const refs = nodeOutputRefs({ id: 'm', type: 'map', config: { iteratorVariable: 'item', outputVariable: 'results' } });
    expect(refs.find((r) => r.token === 'item')!.group).toBe('loop');
    expect(refs.find((r) => r.token === 'results')!.group).toBe('outputs');
  });
  it('reads assignment keys from the array shape', () => {
    expect(tokens(nodeOutputRefs({ id: 'a', type: 'assignment', config: { assignments: [{ variable: 'lead_score', value: 0 }, { variable: 'qualified', value: false }] } }))).toEqual(['lead_score', 'qualified']);
  });
  it('reads assignment keys from the map shape', () => {
    expect(tokens(nodeOutputRefs({ id: 'a', type: 'assignment', config: { assignments: { foo: 1, bar: 2 } } }))).toEqual(['foo', 'bar']);
  });
  it('reads screen collected field names', () => {
    expect(tokens(nodeOutputRefs({ id: 'sc', type: 'screen', config: { fields: [{ name: 'discount' }, { name: 'reason' }] } }))).toEqual(['discount', 'reason']);
  });
  it('returns nothing for a node that introduces no variables', () => {
    expect(nodeOutputRefs({ id: 'd', type: 'decision', config: { conditions: [] } })).toEqual([]);
  });
});

describe('resolveFlowScope — graph-aware in-scope references', () => {
  // start(record-after-update crm_lead) -> assign -> get -> decide
  const draft = {
    variables: [
      { name: 'lead_score', type: 'number' },
      { name: 'qualified', type: 'boolean' },
    ],
    nodes: [
      { id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'crm_lead' } },
      { id: 'assign', type: 'assignment', config: { assignments: [{ variable: 'lead_score', value: 0 }] } },
      { id: 'get', type: 'get_record', label: 'Fetch Account', config: { outputVariable: 'account_data' } },
      { id: 'decide', type: 'decision', config: {} },
    ],
    edges: [
      { source: 'start', target: 'assign' },
      { source: 'assign', target: 'get' },
      { source: 'get', target: 'decide' },
    ],
  };

  it('always offers flow variables', () => {
    expect(groupTokens(resolveFlowScope(draft, 'decide'), 'variables')).toEqual(['lead_score', 'qualified']);
  });

  it('offers an upstream node output at a downstream node', () => {
    expect(groupTokens(resolveFlowScope(draft, 'decide'), 'outputs')).toContain('account_data');
  });

  it('does NOT offer a downstream output at an upstream node (graph-aware)', () => {
    // `account_data` is produced by `get`, which is downstream of `assign`.
    expect(groupTokens(resolveFlowScope(draft, 'assign'), 'outputs')).not.toContain('account_data');
  });

  it('offers the trigger record (record.* prefix) downstream, plus previous', () => {
    const scope = resolveFlowScope(draft, 'decide');
    expect(groupTokens(scope, 'trigger')).toContain('record');
    expect(groupTokens(scope, 'trigger')).toContain('previous');
    expect(scope.trigger).toEqual({ objectName: 'crm_lead', fieldPrefix: 'record.', includePrevious: true });
  });

  it('uses a BARE field prefix on the start node itself (entry condition), and the whole `record` is in scope there too (objectui#11789)', () => {
    const scope = resolveFlowScope(draft, 'start');
    expect(scope.trigger).toEqual({ objectName: 'crm_lead', fieldPrefix: '', includePrevious: true });
    // The engine binds `record` beside the flattened fields before it runs the
    // entry condition, so `record.status` is as valid there as bare `status`.
    expect(groupTokens(scope, 'trigger')).toContain('record');
    // `previous` is still available on an update trigger.
    expect(groupTokens(scope, 'trigger')).toContain('previous');
  });

  /**
   * The per-trigger table (objectui#11789), read off the engine: its run
   * seeding binds `record` (with the record's fields flattened beside it)
   * whenever the trigger hands it a record, and binds `previous` on EVERY run —
   * to the pre-image when one exists, to `null` otherwise. So `record` follows
   * "is this a record trigger", and `previous` follows "is there a pre-image".
   * Each row is asserted at the start node AND downstream: one run, one scope.
   */
  it.each([
    ['record-after-update', true, true],
    ['record-before-update', true, true],
    ['record-after-write', true, true],
    ['record-before-write', true, true],
    // The deleted row is the pre-image; the trigger reads `record` off it too.
    ['record-after-delete', true, true],
    // No prior row: `previous` is always `null`, so it is not offered.
    ['record-after-create', true, false],
    // No record is handed to these runs at all.
    ['schedule', false, false],
    ['manual', false, false],
    ['api', false, false],
  ])('%s: `record` in scope = %s, `previous` in scope = %s — at the start node and downstream', (triggerType, hasRecord, hasPrevious) => {
    const flow = { ...draft, nodes: [{ id: 'start', type: 'start', config: { triggerType, objectName: 'crm_lead' } }, ...draft.nodes.slice(1)] };
    for (const at of ['start', 'decide']) {
      const trigger = groupTokens(resolveFlowScope(flow, at), 'trigger');
      expect(trigger.includes('record'), `${triggerType} at ${at}: record`).toBe(hasRecord);
      expect(trigger.includes('previous'), `${triggerType} at ${at}: previous`).toBe(hasPrevious);
    }
  });

  it('omits the trigger record for a non-record trigger', () => {
    const manual = { ...draft, nodes: [{ id: 'start', type: 'start', config: { triggerType: 'manual' } }, ...draft.nodes.slice(1)] };
    const scope = resolveFlowScope(manual, 'decide');
    expect(scope.trigger).toBeUndefined();
    expect(groupTokens(scope, 'trigger')).toEqual([]);
  });

  it('omits `previous` for a create trigger (the engine binds it only as `null` there)', () => {
    const create = { ...draft, nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-create', objectName: 'crm_lead' } }, ...draft.nodes.slice(1)] };
    expect(groupTokens(resolveFlowScope(create, 'decide'), 'trigger')).not.toContain('previous');
  });

  it('offers `record` and `previous` for a create-or-update (record-after-write) trigger (#3427)', () => {
    // A write trigger fires on update too, so `previous` must be offered — it is
    // how an author branches create vs update (`previous == null`).
    const write = { ...draft, nodes: [{ id: 'start', type: 'start', config: { triggerType: 'record-after-write', objectName: 'crm_lead' } }, ...draft.nodes.slice(1)] };
    const scope = resolveFlowScope(write, 'decide');
    expect(groupTokens(scope, 'trigger')).toContain('record');
    expect(groupTokens(scope, 'trigger')).toContain('previous');
    expect(scope.trigger).toEqual({ objectName: 'crm_lead', fieldPrefix: 'record.', includePrevious: true });
  });

  it('de-dupes a name that is both a declared variable and an upstream output', () => {
    // `lead_score` is declared AND assigned upstream — it should appear once.
    const scope = resolveFlowScope(draft, 'decide');
    expect(tokens(scope.refs).filter((t) => t === 'lead_score')).toHaveLength(1);
  });

  it('surfaces an enclosing loop iterator as a loop ref downstream, not at the loop itself', () => {
    const loopDraft = {
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'manual' } },
        { id: 'loop', type: 'loop', config: { iteratorVariable: 'currentItem', collection: '{items}' } },
        { id: 'body', type: 'assignment', config: {} },
      ],
      edges: [
        { source: 'start', target: 'loop' },
        { source: 'loop', target: 'body' },
      ],
    };
    expect(groupTokens(resolveFlowScope(loopDraft, 'body'), 'loop')).toEqual(['currentItem']);
    // The iterator is NOT in scope at the loop node itself (it defines it).
    expect(groupTokens(resolveFlowScope(loopDraft, 'loop'), 'loop')).toEqual([]);
  });

  it('returns only flow variables for an unknown / disconnected node', () => {
    const scope = resolveFlowScope(draft, 'orphan');
    expect(groupTokens(scope, 'outputs')).toEqual([]);
    expect(scope.trigger).toBeUndefined();
    expect(groupTokens(scope, 'variables')).toEqual(['lead_score', 'qualified']);
  });
});

describe('triggerFieldRefs', () => {
  const fields = [
    { name: 'amount', label: 'Deal Amount', type: 'number' },
    { name: 'status', type: 'text' },
  ];
  it('prefixes fields with record. downstream', () => {
    expect(tokens(triggerFieldRefs({ objectName: 'o', fieldPrefix: 'record.', includePrevious: false }, fields))).toEqual(['record.amount', 'record.status']);
  });
  it('uses bare field names on the start node', () => {
    expect(tokens(triggerFieldRefs({ objectName: 'o', fieldPrefix: '', includePrevious: false }, fields))).toEqual(['amount', 'status']);
  });
  it('also emits previous.<field> when the trigger carries a previous snapshot', () => {
    expect(tokens(triggerFieldRefs({ objectName: 'o', fieldPrefix: 'record.', includePrevious: true }, fields))).toEqual([
      'record.amount',
      'previous.amount',
      'record.status',
      'previous.status',
    ]);
  });
});

// objectui#11028 — a `connector_action` node offers `<nodeId>.<key>` for each
// top-level `properties` key of its action's served `outputSchema`, the keys
// the engine writes back from the handler's result. The schema is an open
// record nothing validates, so every other shape offers nothing: keys are
// never guessed.
describe('connector action output references (objectui#11028)', () => {
  const POST_OUTPUT = { type: 'object', properties: { ts: { type: 'string' }, channel: { type: 'string' } } };
  /** A served `GET /automation/connectors` payload, unwrapped to the connector array. */
  const REGISTRY = [
    {
      name: 'slack',
      label: 'Slack',
      actions: [
        { key: 'chat.postMessage', label: 'Post Message', outputSchema: POST_OUTPUT },
        { key: 'chat.delete', label: 'Delete Message' }, // declares no outputSchema
      ],
    },
  ];
  const connectorNode = (connectorConfig: Record<string, unknown> = { connectorId: 'slack', actionId: 'chat.postMessage' }) => ({
    id: 'post',
    type: 'connector_action',
    label: 'Post to Slack',
    connectorConfig,
  });

  describe('connectorActionOutputKeys', () => {
    it('returns each top-level properties key, in declared order', () => {
      expect(connectorActionOutputKeys({ type: 'object', properties: { ts: {}, channel: {} } })).toEqual(['ts', 'channel']);
    });

    it('returns no keys when the schema is absent or declares no properties', () => {
      expect(connectorActionOutputKeys(undefined)).toEqual([]);
      expect(connectorActionOutputKeys({})).toEqual([]);
      expect(connectorActionOutputKeys({ type: 'object' })).toEqual([]);
      expect(connectorActionOutputKeys({ type: 'object', properties: {} })).toEqual([]);
    });

    it('returns no keys for a schema that is not an object', () => {
      expect(connectorActionOutputKeys(null)).toEqual([]);
      expect(connectorActionOutputKeys('object')).toEqual([]);
      expect(connectorActionOutputKeys(['ts'])).toEqual([]);
    });

    it('returns no keys when properties is not an object', () => {
      expect(connectorActionOutputKeys({ properties: ['ts', 'channel'] })).toEqual([]);
      expect(connectorActionOutputKeys({ properties: 'ts' })).toEqual([]);
      expect(connectorActionOutputKeys({ properties: null })).toEqual([]);
    });

    it('reads only the TOP level: nested properties are not references of their own', () => {
      expect(
        connectorActionOutputKeys({ properties: { message: { type: 'object', properties: { text: {}, user: {} } } } }),
      ).toEqual(['message']);
    });
  });

  describe('connectorActionOutputSchema', () => {
    it('finds the named action’s object schema in the registry', () => {
      expect(connectorActionOutputSchema(REGISTRY, 'slack', 'chat.postMessage')).toEqual(POST_OUTPUT);
    });

    it('is undefined for any miss', () => {
      expect(connectorActionOutputSchema(REGISTRY, 'slack', 'chat.delete')).toBeUndefined();
      expect(connectorActionOutputSchema(REGISTRY, 'slack', 'nope')).toBeUndefined();
      expect(connectorActionOutputSchema(REGISTRY, 'jira', 'chat.postMessage')).toBeUndefined();
      expect(connectorActionOutputSchema(REGISTRY, undefined, 'chat.postMessage')).toBeUndefined();
      expect(connectorActionOutputSchema(REGISTRY, 'slack', undefined)).toBeUndefined();
      expect(connectorActionOutputSchema(undefined, 'slack', 'chat.postMessage')).toBeUndefined();
      expect(
        connectorActionOutputSchema([{ name: 'slack', actions: [{ key: 'x', outputSchema: ['ts'] }] }], 'slack', 'x'),
      ).toBeUndefined();
    });
  });

  describe('nodeOutputRefs — the connector_action branch', () => {
    it('an outputSchema with two properties offers two references', () => {
      const refs = nodeOutputRefs(connectorNode(), REGISTRY);
      expect(tokens(refs)).toEqual(['post.ts', 'post.channel']);
      expect(refs.every((r) => r.group === 'outputs' && r.detail === 'Post to Slack')).toBe(true);
    });

    it('an action with no outputSchema offers none', () => {
      expect(nodeOutputRefs(connectorNode({ connectorId: 'slack', actionId: 'chat.delete' }), REGISTRY)).toEqual([]);
    });

    it('offers none without the registry, or before the connector and action are both chosen', () => {
      expect(nodeOutputRefs(connectorNode())).toEqual([]);
      expect(nodeOutputRefs(connectorNode({ connectorId: 'slack' }), REGISTRY)).toEqual([]);
      expect(nodeOutputRefs(connectorNode({ actionId: 'chat.postMessage' }), REGISTRY)).toEqual([]);
    });

    it('reads the pair only on a connector_action node', () => {
      expect(nodeOutputRefs({ ...connectorNode(), type: 'http' }, REGISTRY)).toEqual([]);
    });
  });

  describe('resolveFlowScope — threaded registry', () => {
    const flow = {
      nodes: [
        { id: 'start', type: 'start' },
        connectorNode(),
        { id: 'decide', type: 'decision' },
      ],
      edges: [
        { source: 'start', target: 'post' },
        { source: 'post', target: 'decide' },
      ],
    };

    it('offers the upstream connector action’s output keys downstream', () => {
      expect(groupTokens(resolveFlowScope(flow, 'decide', undefined, REGISTRY), 'outputs')).toEqual(['post.ts', 'post.channel']);
    });

    it('never offers them at the connector node itself, and not without the registry', () => {
      expect(groupTokens(resolveFlowScope(flow, 'post', undefined, REGISTRY), 'outputs')).toEqual([]);
      expect(groupTokens(resolveFlowScope(flow, 'decide'), 'outputs')).toEqual([]);
    });
  });

  describe('hasCommittedConnectorAction', () => {
    it('is true only when a top-level connector_action has both a connector and an action', () => {
      expect(hasCommittedConnectorAction({ nodes: [{ id: 's', type: 'start' }, connectorNode()] })).toBe(true);
      expect(hasCommittedConnectorAction({ nodes: [connectorNode({ connectorId: 'slack' })] })).toBe(false);
      expect(hasCommittedConnectorAction({ nodes: [{ id: 'h', type: 'http', connectorConfig: { connectorId: 'slack', actionId: 'x' } }] })).toBe(false);
      expect(hasCommittedConnectorAction({})).toBe(false);
    });
  });
});

describe('edge scope — the source node’s own outputs are in scope on its out-edges (objectui#11085)', () => {
  // The engine writes a node's outputs before `traverseNext` evaluates its
  // out-edge guards, so `lead` (the get_record's `outputVariable`) exists when
  // the guard on `fetch → route` runs.
  const flow = {
    variables: [{ name: 'threshold', type: 'number' }],
    nodes: [
      { id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'crm_lead' } },
      { id: 'fetch', type: 'get_record', config: { objectName: 'crm_lead', outputVariable: 'lead' } },
      { id: 'route', type: 'decision' },
      { id: 'recover', type: 'end' },
    ],
    edges: [
      { source: 'start', target: 'fetch' },
      { source: 'fetch', target: 'route', condition: "lead.status == 'open'" },
      { source: 'fetch', target: 'recover', type: 'fault' },
    ],
  };

  it('adds the source’s own outputs to the scope at the source', () => {
    const edgeTokens = tokens(resolveEdgeScope(flow, { source: 'fetch', target: 'route' }).refs);
    expect(edgeTokens).toContain('lead');
    // The node scope itself is unchanged: a node never sees its own outputs.
    expect(tokens(resolveFlowScope(flow, 'fetch').refs)).not.toContain('lead');
    // Everything in scope at the source is kept, trigger included.
    expect(edgeTokens).toEqual(expect.arrayContaining(tokens(resolveFlowScope(flow, 'fetch').refs)));
    expect(resolveEdgeScope(flow, { source: 'fetch', target: 'route' }).trigger).toEqual(resolveFlowScope(flow, 'fetch').trigger);
  });

  it('a fault edge adds none — the engine walks it only when the node failed, with nothing written back', () => {
    expect(edgeSourceOutputRefs(flow, { source: 'fetch', target: 'recover', type: 'fault' })).toEqual([]);
    expect(tokens(resolveEdgeScope(flow, { source: 'fetch', target: 'recover', type: 'fault' }).refs)).not.toContain('lead');
  });

  it('an edge leaving the start node adds none, and a missing source resolves the flow variables alone', () => {
    expect(edgeSourceOutputRefs(flow, { source: 'start', target: 'fetch' })).toEqual([]);
    expect(edgeSourceOutputRefs(flow, { source: 'ghost', target: 'route' })).toEqual([]);
    expect(tokens(resolveEdgeScope(flow, { target: 'route' }).refs)).toEqual(['threshold']);
  });

  it('a committed connector action’s declared keys join on its own out-edge, given the registry', () => {
    const REGISTRY = [
      { name: 'slack', actions: [{ key: 'chat.postMessage', outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } } }] },
    ];
    const withPost = {
      nodes: [
        { id: 'start', type: 'start' },
        { id: 'post', type: 'connector_action', connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage' } },
        { id: 'done', type: 'end' },
      ],
      edges: [
        { source: 'start', target: 'post' },
        { source: 'post', target: 'done' },
      ],
    };
    expect(tokens(resolveEdgeScope(withPost, { source: 'post', target: 'done' }, undefined, REGISTRY).refs)).toEqual(['post.ok']);
    expect(tokens(resolveEdgeScope(withPost, { source: 'post', target: 'done' }).refs)).toEqual([]);
  });
});
