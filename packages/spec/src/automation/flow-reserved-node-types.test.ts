// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The retired callout names are reserved inside the open node namespace
 * (#23543 F5-http): the flow parse refuses `http_request` / `http_call` /
 * `webhook` as a node `type`, naming `http`, at every depth the region walk
 * reaches, once per site — and nothing else about the open namespace moves.
 */
import { describe, expect, it } from 'vitest';

import { FlowNodeSchema, FlowSchema } from './flow.zod';
import { FLOW_RESERVED_NODE_TYPES, reservedFlowNodeTypeRefusal } from './flow-reserved-node-types';

const RESERVED = ['http_request', 'http_call', 'webhook'] as const;

const flowWith = (node: Record<string, unknown>) => ({
  name: 'callout',
  label: 'Callout',
  type: 'autolaunched',
  nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'step', label: 'Step', ...node }],
  edges: [{ id: 'e1', source: 'start', target: 'step' }],
});

const loopAround = (inner: Record<string, unknown>) => ({
  type: 'loop',
  config: {
    collection: { dialect: 'cel', source: 'rows' },
    body: { nodes: [{ id: 'inner', label: 'Inner', ...inner }], edges: [] },
  },
});

const issuesOf = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[]; message: string }> } }) =>
  (result.error?.issues ?? []).map((i) => ({ path: i.path.join('.'), message: i.message }));

describe('the reserved callout node types', () => {
  it('are exactly the three callout names ADR-0018 unified into http', () => {
    expect(FLOW_RESERVED_NODE_TYPES).toEqual({ http_request: 'http', http_call: 'http', webhook: 'http' });
    expect(Object.isFrozen(FLOW_RESERVED_NODE_TYPES)).toBe(true);
  });

  it.each(RESERVED)("a top-level node typed '%s' is refused once, at its type, naming http and the release", (type) => {
    const issues = issuesOf(FlowSchema.safeParse(flowWith({ type, config: { url: 'https://example.com' } })));
    expect(issues.map((i) => i.path)).toEqual(['nodes.1.type']);
    expect(issues[0]!.message).toBe(reservedFlowNodeTypeRefusal(type));
    expect(issues[0]!.message).toContain(`Flow node \`type: '${type}'\` was removed in @objectstack/spec 18`);
    expect(issues[0]!.message).toContain("Use `type: 'http'`");
  });

  it.each(RESERVED)("FlowNodeSchema alone refuses '%s' at type", (type) => {
    const issues = issuesOf(FlowNodeSchema.safeParse({ id: 'n', label: 'N', type }));
    expect(issues.map((i) => i.path)).toEqual(['type']);
  });

  it.each(RESERVED)("a node typed '%s' inside a loop body is refused once, where the author wrote it", (type) => {
    const issues = issuesOf(FlowSchema.safeParse(flowWith(loopAround({ type, config: { url: 'https://example.com' } }))));
    const atType = issues.filter((i) => i.path.endsWith('.type'));
    expect(atType.map((i) => i.path)).toEqual(['nodes.1.config.body.nodes.0.type']);
    expect(atType[0]!.message).toBe(reservedFlowNodeTypeRefusal(type));
  });

  it('only the webhook refusal says the wait eventType of the same name stays legal', () => {
    expect(reservedFlowNodeTypeRefusal('webhook')).toContain("`waitEventConfig.eventType: 'webhook'` is a different field");
    expect(reservedFlowNodeTypeRefusal('http_request')).not.toContain('waitEventConfig');
  });

  describe('controls — the open namespace is otherwise unchanged', () => {
    it('the canonical http node parses', () => {
      expect(FlowSchema.safeParse(flowWith({ type: 'http', config: { url: 'https://example.com' } })).success).toBe(true);
    });

    it('a plugin-registered node type parses, top level and inside a region', () => {
      expect(FlowSchema.safeParse(flowWith({ type: 'send_sms', config: { to: '+1' } })).success).toBe(true);
      expect(FlowSchema.safeParse(flowWith(loopAround({ type: 'send_sms', config: { to: '+1' } }))).success).toBe(true);
    });

    it('a name that only contains a reserved one parses — the refusal is by whole name', () => {
      for (const type of ['http_request_v2', 'my_webhook', 'webhooks', 'HTTP_REQUEST']) {
        expect(FlowNodeSchema.safeParse({ id: 'n', label: 'N', type }).success, type).toBe(true);
        expect(reservedFlowNodeTypeRefusal(type), type).toBeUndefined();
      }
    });

    it("a wait node's waitEventConfig.eventType 'webhook' stays legal", () => {
      const result = FlowSchema.safeParse(flowWith({ type: 'wait', waitEventConfig: { eventType: 'webhook' } }));
      expect(issuesOf(result)).toEqual([]);
    });
  });
});
