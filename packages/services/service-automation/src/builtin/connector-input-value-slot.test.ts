// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **A `connector_action` node's `connectorConfig.input` is a value slot**
 * (#27327) — evaluated through the one per-key resolver every other value
 * map uses (`resolveValueSlotMap`), so a flow can send a per-record value to a
 * connector's action.
 *
 * Before this, the executor handed `cfg.input` to the connector's handler as
 * written: an envelope reading a record field reached the provider as the
 * object `{ dialect: 'cel', source: '…' }` it spells, and a declarative
 * connector interpolating it into a request path sent `[object Object]`, with
 * the run reporting success. Pinned through the shipped `AutomationEngine`:
 *
 *  1. **Evaluated.** A top-level envelope is evaluated in the run's scope and
 *     reaches the handler as the raw value it computes — a string, a number,
 *     a record — next to literal keys handed on as written.
 *  2. **A constant payload is unchanged.** Every literal reaches the handler
 *     as it was authored, a nested envelope-shaped object included, and as a
 *     copy: a handler that writes into its input never writes into the node.
 *  3. **A fault fails the step.** An envelope that faults on the live
 *     variables fails the node with its source, and the handler is never
 *     called — nothing is sent upstream.
 */

import { describe, expect, it } from 'vitest';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import type { Connector } from '@objectstack/spec/integration';

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

/** An engine with every builtin node and one connector whose action records each input it is handed. */
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

/** start → a `connector_action` with `input` → end, the record an input variable. */
function flowWith(name: string, input: Record<string, unknown>): any {
  return {
    name, label: name, type: 'autolaunched',
    variables: [{ name: 'rec', type: 'object', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'call', type: 'connector_action', label: 'Call', connectorConfig: { connectorId: 'vendor', actionId: 'lookup', input } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'end' }],
  };
}

const REC = { id: 'cus_42', name: 'Acme', seats: 7 };

describe('1. an envelope in `connectorConfig.input` is evaluated in the run\'s scope', () => {
  it('the handler receives the values it computes, raw, beside literals as written', async () => {
    const { engine, received } = makeEngine();
    engine.registerFlow('per_record', flowWith('per_record', {
      customerId: { dialect: 'cel', source: 'rec.id' },
      seats: { dialect: 'cel', source: 'rec.seats + 1' },
      record: { dialect: 'cel', source: 'rec' },
      greeting: { dialect: 'cel', source: "'Hi ' + rec.name" },
      region: 'eu',
    }));
    const run = await engine.execute('per_record', { params: { rec: REC } } as any);
    expect(run.success, run.error).toBe(true);
    expect(received).toEqual([{ customerId: 'cus_42', seats: 8, record: REC, greeting: 'Hi Acme', region: 'eu' }]);
  });
});

describe('2. a constant payload reaches the handler exactly as authored', () => {
  it('literals, a nested envelope-shaped object included, are handed on as written, and as a copy', async () => {
    const { engine, received } = makeEngine();
    const input = {
      path: '/v1/customers',
      limit: 10,
      tags: ['a', 'b'],
      body: { filter: { dialect: 'cel', source: 'rec.id' } },
    };
    const flow = flowWith('constant', input);
    engine.registerFlow('constant', flow);
    const run = await engine.execute('constant', { params: { rec: REC } } as any);
    expect(run.success, run.error).toBe(true);
    expect(received).toEqual([input]);
    expect(received[0]).not.toBe(flow.nodes[1].connectorConfig.input);
    expect(received[0].body).not.toBe(input.body);
  });

  it('a node with no `input` hands the handler an empty map, as before', async () => {
    const { engine, received } = makeEngine();
    const flow = flowWith('no_input', {});
    delete flow.nodes[1].connectorConfig.input;
    engine.registerFlow('no_input', flow);
    const run = await engine.execute('no_input', { params: { rec: REC } } as any);
    expect(run.success, run.error).toBe(true);
    expect(received).toEqual([{}]);
  });
});

describe('3. an envelope that faults fails the step with its source, and nothing is sent', () => {
  it('a read of an absent key fails the node, naming the slot and the source; the handler is never called', async () => {
    const { engine, received } = makeEngine();
    engine.registerFlow('faulting', flowWith('faulting', {
      customerId: { dialect: 'cel', source: 'rec.missing.id' },
    }));
    const run = await engine.execute('faulting', { params: { rec: REC } } as any);
    expect(run.success).toBe(false);
    expect(run.error).toContain('input.customerId');
    expect(run.error).toContain('rec.missing.id');
    expect(received).toEqual([]);
  });
});
