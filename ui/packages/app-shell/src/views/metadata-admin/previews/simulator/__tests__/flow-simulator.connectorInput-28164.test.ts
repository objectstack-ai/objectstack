// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28164 — the Debug run judges a `connector_action` node's
 * `connectorConfig.input` like every other value slot. The executor resolves
 * that map before it dispatches and refuses a `{…}` token there, so the action
 * is never called: the step fails with the spec's own refusal, which names the
 * block. A literal and a CEL value envelope pass, and the node is mocked as
 * before.
 *
 * Expected refusals are read from the installed spec, never restated.
 */

import { describe, it, expect } from 'vitest';
import { flowNodeValueTemplateRefusals } from '@objectstack/spec/automation';
import { FlowSimulator } from '../flow-simulator';
import type { SimNode } from '../flow-sim-types';

const connector = (input: Record<string, unknown>): SimNode => ({
  id: 'post',
  type: 'connector_action',
  label: 'Post',
  connectorConfig: { connectorId: 'slack', actionId: 'chat.postMessage', input },
});

function runNode(node: SimNode) {
  const sim = new FlowSimulator(
    [{ id: 's', type: 'start' }, node, { id: 'e', type: 'end' }],
    [
      { source: 's', target: node.id },
      { source: node.id, target: 'e' },
    ],
  );
  sim.reset({ who: 'Ada' });
  sim.runToEnd();
  return { sim, step: sim.state.steps.find((st) => st.nodeId === node.id) };
}

describe('connector_action — connectorConfig.input is a value slot (objectstack#28164)', () => {
  it('fails the step with the spec’s refusal of a `{…}` token, naming the block', () => {
    const node = connector({ channel: 'C1', text: 'hi {who}' });
    const expected = flowNodeValueTemplateRefusals('connector_action', {}, node)[0];
    expect(expected?.block).toBe('connectorConfig');
    const { sim, step } = runNode(node);
    expect(step?.status).toBe('error');
    expect(step?.error).toContain(`at connectorConfig.${expected!.path}`);
    expect(step?.error).toContain(expected!.message);
    expect(sim.state.steps.some((st) => st.nodeId === 'e')).toBe(false);
  });

  it('mocks the node when every input value is a literal or a CEL value envelope', () => {
    const { sim, step } = runNode(connector({ channel: 'C1', text: { dialect: 'cel', source: "'hi ' + who" } }));
    expect(step?.status).toBe('mocked');
    expect(sim.state.steps.some((st) => st.nodeId === 'e')).toBe(true);
  });
});
