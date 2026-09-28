// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20418 — a `connector_action` node its executor cannot dispatch is refused at
 * `FlowSchema.parse`, the first of the three doors.
 *
 * The node's contract is its SIBLING block `connectorConfig`, and the executor
 * reads nothing else: `if (!cfg?.connectorId || !cfg?.actionId)` refuses the
 * node. Measured before the change, all three build doors admitted what that
 * read refuses — the block absent, or an id present and blank (the Studio
 * designer's seed for a new node) — at the top level and inside a region body,
 * and every run then failed at the node.
 *
 * Refused rows assert the issue `code` and the exact `path`, and that the
 * message names the block or the key it refuses — never the prose around it.
 * `registerFlow` meets the same refusal through this parse
 * (`service-automation`'s `connector-nodes.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import { FlowNodeSchema, FlowSchema } from './flow.zod';

type Node = Record<string, unknown>;

/** start → <middle nodes> → end, chained by unconditional edges. */
function flowWith(...middle: Node[]) {
  const nodes: Node[] = [{ id: 'start', type: 'start', label: 'Start' }, ...middle, { id: 'end', type: 'end', label: 'End' }];
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, source: String(nodes[i].id), target: String(n.id) }));
  return { name: 'connector_probe', label: 'Connector probe', type: 'autolaunched', nodes, edges };
}

const connector = (extra: Node = {}): Node => ({ id: 'call', type: 'connector_action', label: 'Call', ...extra });
const COMPLETE = { connectorId: 'slack', actionId: 'chat.postMessage', input: { channel: 'C1', text: 'Hi' } };

/** A `loop` whose body holds `inner` — the ADR-0031 region the walk must reach. */
const loopAround = (inner: Node): Node => ({
  id: 'each', type: 'loop', label: 'Each',
  config: { collection: [1], iteratorVariable: 'item', body: { nodes: [inner], edges: [] } },
});

function issuesOf(flow: unknown) {
  const result = FlowSchema.safeParse(flow);
  return result.success ? [] : result.error.issues.map((i) => ({ code: i.code, path: i.path, message: i.message }));
}

describe('FlowSchema refuses a connector_action node with no connectorConfig block', () => {
  it('top level: one `custom` issue at the block, prescribing it', () => {
    const issues = issuesOf(flowWith(connector()));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'connectorConfig']]]);
    expect(issues[0].message).toContain('requires a `connectorConfig` block');
  });

  it('inside a region body: refused at the path the author wrote', () => {
    const issues = issuesOf(flowWith(loopAround(connector())));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'connectorConfig']],
    ]);
  });

  it('the keys written under `config` instead: refused at the block, and told to move them', () => {
    // A direct parse meets the pre-conversion spelling, like every other
    // tombstone; `registerFlow` and `objectstack validate` convert a complete
    // pair into the block first (the `flow-node-connector-config-lift` D2 entry).
    const issues = issuesOf(flowWith(connector({ config: { connectorId: 'slack', actionId: 'chat.postMessage' } })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'connectorConfig']]]);
    expect(issues[0].message).toContain('from `config` into the block');
  });
});

describe('FlowSchema refuses a blank connectorId / actionId', () => {
  it('the designer seed (both ids empty): one issue per key', () => {
    const issues = issuesOf(flowWith(connector({ connectorConfig: { connectorId: '', actionId: '', input: {} } })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'connectorConfig', 'connectorId']],
      ['custom', ['nodes', 1, 'connectorConfig', 'actionId']],
    ]);
    expect(issues[0].message).toContain('`connectorConfig.connectorId` holds a string that is blank');
    expect(issues[1].message).toContain('`connectorConfig.actionId` holds a string that is blank');
  });

  it.each([
    ['a whitespace-only connectorId', { connectorId: ' \t', actionId: 'chat.postMessage' }, 'connectorId'],
    ['an empty actionId', { connectorId: 'slack', actionId: '' }, 'actionId'],
  ])('%s: refused at that key only', (_name, block, key) => {
    const issues = issuesOf(flowWith(connector({ connectorConfig: block })));
    expect(issues.map((i) => [i.code, i.path])).toEqual([['custom', ['nodes', 1, 'connectorConfig', key]]]);
  });

  it('inside a region body: refused at the path the author wrote', () => {
    const issues = issuesOf(flowWith(loopAround(connector({ connectorConfig: { connectorId: 'slack', actionId: '' } }))));
    expect(issues.map((i) => [i.code, i.path])).toEqual([
      ['custom', ['nodes', 1, 'config', 'body', 'nodes', 0, 'connectorConfig', 'actionId']],
    ]);
  });
});

describe('what is NOT refused by this rule', () => {
  it('CONTROL — a complete block parses, at the top level and in a region body, with and without `input`', () => {
    expect(issuesOf(flowWith(connector({ connectorConfig: COMPLETE })))).toEqual([]);
    expect(issuesOf(flowWith(connector({ connectorConfig: { connectorId: 'rest', actionId: 'request' } })))).toEqual([]);
    expect(issuesOf(flowWith(loopAround(connector({ connectorConfig: COMPLETE }))))).toEqual([]);
  });

  it('CONTROL — another node type carries no connectorConfig and is not asked for one', () => {
    expect(issuesOf(flowWith({ id: 'n', type: 'assignment', label: 'N' }))).toEqual([]);
  });

  it('a block the node shape already refuses is not reported a second time', () => {
    // `{}` and a non-string id fail the block's own shape; this rule judges
    // strings only, so the author sees one issue per key, not two.
    expect(issuesOf(flowWith(connector({ connectorConfig: {} }))).map((i) => [i.code, i.path])).toEqual([
      ['invalid_type', ['nodes', 1, 'connectorConfig', 'connectorId']],
      ['invalid_type', ['nodes', 1, 'connectorConfig', 'actionId']],
    ]);
    expect(issuesOf(flowWith(connector({ connectorConfig: { connectorId: 5, actionId: 'a' } }))).map((i) => i.code))
      .toEqual(['invalid_type']);
  });

  it('FlowNodeSchema alone still parses the designer seed — the refusal is the FLOW\'s', () => {
    // The node contract a designer seed is held to on its own stays structural;
    // the flow it is saved into is what gets refused (see the second describe).
    const seed = connector({ connectorConfig: { connectorId: '', actionId: '', input: {} } });
    expect(FlowNodeSchema.safeParse(seed).success).toBe(true);
  });
});
