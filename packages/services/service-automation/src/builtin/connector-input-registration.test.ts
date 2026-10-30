// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **A `connector_action` node's `connectorConfig.input` is judged at
 * registration** (#27968) — the registration half of #27327.
 *
 * #27327 made the executor evaluate the map through the one per-key value-slot
 * resolver (`connector-input-value-slot.test.ts`). Registration judges value
 * slots only through the spec's expression ledger, whose paths were rooted in
 * `node.config`, so it could not name a slot in the `connectorConfig` sibling
 * block: a malformed CEL envelope, a template-dialect envelope and a `{…}`
 * token string all REGISTERED there, while the same three under a `subflow`'s
 * `config.input` were refused. One slot, two reject sets. The ledger now roots
 * the slot in the block, and `registerFlow` judges it like every other value
 * slot, located at `connectorConfig.input.<key>`:
 *
 *  1. the three shapes are refused, each at its key, each with the value
 *     slot's own refusal — and side by side with the `subflow` control, which
 *     answers the same sentence;
 *  2. a valid envelope and literals still register and run.
 */

import { describe, expect, it } from 'vitest';
import { VALUE_ENVELOPE_REFUSAL, VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import type { Connector } from '@objectstack/spec/integration';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

const CONNECTOR = {
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  authentication: { type: 'none' },
  actions: [{ key: 'lookup', label: 'Lookup' }],
} as Connector;

function makeEngine(): { engine: AutomationEngine; received: Record<string, unknown>[] } {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, ctx());
  const received: Record<string, unknown>[] = [];
  engine.registerConnector(CONNECTOR, {
    async lookup(input) {
      received.push(input);
      return { ok: true };
    },
  });
  return { engine, received };
}

/** start → `node` → end, the record an input variable. */
function flowWith(name: string, node: Record<string, unknown>): any {
  return {
    name, label: name, type: 'autolaunched',
    variables: [{ name: 'rec', type: 'object', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'call', label: 'Call', ...node },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'end' }],
  };
}

const connectorNode = (input: Record<string, unknown>) => ({
  type: 'connector_action',
  connectorConfig: { connectorId: 'vendor', actionId: 'lookup', input },
});
const subflowNode = (input: Record<string, unknown>) => ({
  type: 'subflow',
  config: { flowName: 'child', input },
});

/** The message `registerFlow` throws for `node`, or `''` when it registers. */
function registrationError(node: Record<string, unknown>): string {
  const { engine } = makeEngine();
  try {
    engine.registerFlow('judged', flowWith('judged', node));
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

/** The three shapes the #27327 thread measured registering under `connectorConfig.input`. */
const SHAPES = [
  ['a malformed CEL envelope', { dialect: 'cel', source: 'rec.' }, ''],
  ['a template-dialect envelope', { dialect: 'template', source: '{rec.id}' }, VALUE_ENVELOPE_REFUSAL],
  ['a bare `{…}` token string', '{rec.id}', VALUE_SLOT_TEMPLATE_REFUSAL],
] as const;

describe('1. registerFlow refuses the three shapes at `connectorConfig.input.<key>`', () => {
  it.each(SHAPES)('%s', (_shape, value, lead) => {
    const message = registrationError(connectorNode({ customerId: value, region: 'eu' }));
    expect(message).toContain(`node 'call' (connector_action) connector_action input value at connectorConfig.input.customerId: ${lead}`);
    // Only the key that holds the shape is named; the literal beside it is not.
    expect(message).not.toContain('connectorConfig.input.region');
    // The same shape under a `subflow`'s input map draws the same refusal —
    // one slot rule, two positions, one reject set.
    const control = registrationError(subflowNode({ customerId: value }));
    expect(control).toContain(`node 'call' (subflow) subflow input value at config.input.customerId: ${lead}`);
    const detail = (m: string) => m.slice(m.indexOf('input.customerId: ') + 'input.customerId: '.length).split('\n')[0];
    expect(detail(message)).toBe(detail(control));
  });

  it('a refused flow is not registered: it cannot be run', async () => {
    const { engine, received } = makeEngine();
    expect(() => engine.registerFlow('refused', flowWith('refused', connectorNode({ customerId: '{rec.id}' })))).toThrow();
    const run = await engine.execute('refused', { params: { rec: { id: 'cus_42' } } } as any).catch((e: Error) => ({ success: false, error: e.message }));
    expect(run.success).toBe(false);
    expect(received).toEqual([]);
  });
});

describe('2. a valid envelope and literals still register, and the run evaluates the envelope', () => {
  it('registers, and the action receives the computed value beside the literal', async () => {
    const { engine, received } = makeEngine();
    engine.registerFlow('valid', flowWith('valid', connectorNode({
      customerId: { dialect: 'cel', source: 'rec.id' },
      region: 'eu',
      body: { filter: { dialect: 'cel', source: 'rec.id' } },
    })));
    const run = await engine.execute('valid', { params: { rec: { id: 'cus_42' } } } as any);
    expect(run.success, run.error).toBe(true);
    expect(received).toEqual([{ customerId: 'cus_42', region: 'eu', body: { filter: { dialect: 'cel', source: 'rec.id' } } }]);
  });

  it('a node with no `input` registers, as before', () => {
    expect(registrationError({ type: 'connector_action', connectorConfig: { connectorId: 'vendor', actionId: 'lookup' } })).toBe('');
  });
});
