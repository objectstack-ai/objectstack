// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **A `connector_action` call is checked against the action's declared
 * `inputSchema` before it is dispatched** (#27995).
 *
 * Before this, the schema was advisory: a call to an OpenAPI `getPet` with
 * `input: {}` reached the remote URL although `petId` is declared `required`,
 * and what came back depended on the remote. Pinned through the shipped
 * `AutomationEngine` + builtin nodes, with the `inputSchema` shapes the three
 * connector producers actually emit:
 *
 *  1. **Missing required → refused, nothing sent.** The step fails with
 *     `code: 'VALIDATION_ERROR'`, the error names every missing parameter by
 *     its dotted path and says how to fix it, and the handler is never called.
 *  2. **Wrong type → refused, nothing sent.** The error names the parameter,
 *     the declared type and the type it got. The EVALUATED input is judged: a
 *     CEL envelope computing the wrong type is refused like a literal one.
 *  3. **A valid call dispatches as before**, including one whose required
 *     value is computed by an envelope.
 *  4. **Only the judged subset refuses.** `required`, `type` (with OpenAPI 3.0
 *     `nullable`), `properties` and `items` are judged; keywords outside that
 *     subset (`$ref`, `oneOf`, `enum`, `format`, `additionalProperties`, …)
 *     never refuse a call, and an action with no `inputSchema` dispatches
 *     whatever it is given.
 *  5. **The refusal is routable.** The input can come from run data, so the
 *     failure is a `runtime` one: a `fault` edge receives it, with
 *     `$error.code === 'VALIDATION_ERROR'`.
 */

import { describe, expect, it } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import type { Connector } from '@objectstack/spec/integration';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

/** The shape `connector-openapi`'s `buildInputSchema` emits for `GET /pets/{petId}?verbose=`. */
const OPENAPI_GET_PET = {
  type: 'object',
  properties: {
    path: { type: 'object', properties: { petId: { type: 'integer', format: 'int64' } }, required: ['petId'] },
    query: { type: 'object', properties: { verbose: { type: 'boolean' }, tag: { type: 'string', nullable: true } } },
  },
  required: ['path'],
};

/** An MCP `tools/list` schema, passed through verbatim by `connector-mcp`. */
const MCP_ECHO = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Text to upper-case' },
    mode: { enum: ['upper', 'lower'] },
    meta: { $ref: '#/$defs/meta' },
    tags: { type: 'array', items: { type: 'string' } },
    when: { type: 'string', format: 'date-time' },
    either: { oneOf: [{ type: 'string' }, { type: 'number' }] },
  },
  required: ['text'],
  additionalProperties: false,
};

/** A hand-written code connector's schema (`connector-slack`'s `chat.postMessage`). */
const SLACK_POST = {
  type: 'object',
  required: ['channel'],
  properties: {
    channel: { type: 'string' },
    text: { type: 'string' },
    blocks: { type: 'array' },
  },
};

const CONNECTOR = {
  name: 'vendor',
  label: 'Vendor',
  type: 'api',
  authentication: { type: 'none' },
  actions: [
    { key: 'getPet', label: 'Get pet', inputSchema: OPENAPI_GET_PET },
    { key: 'echo', label: 'Echo', inputSchema: MCP_ECHO },
    { key: 'post', label: 'Post', inputSchema: SLACK_POST },
    { key: 'update', label: 'Update', inputSchema: { ...SLACK_POST, required: ['channel', 'ts'] } },
    { key: 'free', label: 'Free-form' },
  ],
} as Connector;

type Seen = { code?: string; message?: string } | undefined;

/** An engine with every builtin node, one connector recording each dispatch, and a fault-edge capture node. */
function makeEngine(): { engine: AutomationEngine; sent: Array<{ action: string; input: unknown }>; faults: Seen[] } {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, ctx());
  const sent: Array<{ action: string; input: unknown }> = [];
  const handler = (action: string) => async (input: Record<string, unknown>) => {
    sent.push({ action, input });
    return { ok: true };
  };
  engine.registerConnector(CONNECTOR, {
    getPet: handler('getPet'),
    echo: handler('echo'),
    post: handler('post'),
    update: handler('update'),
    free: handler('free'),
  });
  const faults: Seen[] = [];
  engine.registerNodeExecutor({
    type: 'capture_error',
    async execute(_node, variables) {
      faults.push(variables.get('$error') as Seen);
      return { success: true };
    },
  } as NodeExecutor);
  return { engine, sent, faults };
}

/** start → `connector_action` (vendor.ACTION, input) → end; `rec` is an input variable. */
function flowWith(name: string, actionId: string, input: Record<string, unknown> | undefined, opts: { fault?: boolean } = {}): any {
  const nodes: any[] = [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'call', type: 'connector_action', label: 'Call', connectorConfig: { connectorId: 'vendor', actionId, ...(input ? { input } : {}) } },
    { id: 'end', type: 'end', label: 'End' },
  ];
  const edges: any[] = [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'end' }];
  if (opts.fault) {
    nodes.push({ id: 'handler', type: 'capture_error', label: 'Handler' });
    edges.push({ id: 'ef', source: 'call', target: 'handler', type: 'fault' }, { id: 'e3', source: 'handler', target: 'end' });
  }
  return {
    name, label: name, type: 'autolaunched',
    variables: [{ name: 'rec', type: 'object', isInput: true }],
    nodes,
    edges,
  };
}

async function run(engine: AutomationEngine, name: string, actionId: string, input: Record<string, unknown> | undefined, opts: { fault?: boolean } = {}) {
  engine.registerFlow(name, flowWith(name, actionId, input, opts));
  return engine.execute(name, { params: { rec: { id: 'cus_42', petId: 7, name: 'Rex' } } } as any);
}

describe('1. a missing required parameter is refused before dispatch', () => {
  it('OpenAPI `getPet` with `input: {}` fails naming `path`, and nothing is sent', async () => {
    const { engine, sent, faults } = makeEngine();
    const result = await run(engine, 'no_path', 'getPet', {}, { fault: true });
    expect(sent).toEqual([]);
    expect(faults).toHaveLength(1);
    expect(faults[0]?.code).toBe('VALIDATION_ERROR');
    expect(faults[0]?.message).toContain("missing required 'path'");
    expect(result.success).toBe(true);
  });

  it('`input: { path: {} }` fails naming the nested `path.petId`, with the fix', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'no_pet_id', 'getPet', { path: {} });
    expect(result.success).toBe(false);
    expect(sent).toEqual([]);
    expect(result.error).toContain("'vendor.getPet'");
    expect(result.error).toContain("missing required 'path.petId'");
    expect(result.error).toContain('connectorConfig.input');
  });

  it('every missing parameter is named, not only the first', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'two_missing', 'update', { text: 'hi' });
    expect(result.success).toBe(false);
    expect(sent).toEqual([]);
    expect(result.error).toContain("missing required 'channel'");
    expect(result.error).toContain("missing required 'ts'");
  });

  it('a code connector\'s required `channel` is enforced the same way', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'no_channel', 'post', { text: 'hi' });
    expect(result.success).toBe(false);
    expect(sent).toEqual([]);
    expect(result.error).toContain("missing required 'channel'");
  });
});

describe('2. a parameter of the wrong type is refused before dispatch', () => {
  it('a literal string for an `integer` path parameter names the parameter and both types', async () => {
    const { engine, sent, faults } = makeEngine();
    await run(engine, 'bad_literal', 'getPet', { path: { petId: 'seven' } }, { fault: true });
    expect(sent).toEqual([]);
    expect(faults[0]?.code).toBe('VALIDATION_ERROR');
    expect(faults[0]?.message).toContain("'path.petId' must be integer, got string");
  });

  it('an envelope evaluating to the wrong type is judged on its evaluated value', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'bad_envelope', 'getPet', { path: { petId: 1 }, query: { dialect: 'cel', source: '{"verbose": rec.name}' } });
    expect(result.success).toBe(false);
    expect(sent).toEqual([]);
    expect(result.error).toContain("'query.verbose' must be boolean, got string");
  });

  it('an array item of the wrong type names its index', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'bad_item', 'echo', { text: 'x', tags: ['a', 2] });
    expect(result.success).toBe(false);
    expect(sent).toEqual([]);
    expect(result.error).toContain("'tags[1]' must be string, got number");
  });
});

describe('3. a valid call dispatches as before', () => {
  it('a required value computed by an envelope reaches the handler', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'ok_envelope', 'getPet', { path: { dialect: 'cel', source: '{"petId": rec.petId}' } });
    expect(result.success, result.error).toBe(true);
    expect(sent).toEqual([{ action: 'getPet', input: { path: { petId: 7 } } }]);
  });

  it('OpenAPI 3.0 `nullable` admits null', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'ok_nullable', 'getPet', { path: { petId: 1 }, query: { tag: null } });
    expect(result.success, result.error).toBe(true);
    expect(sent).toHaveLength(1);
  });
});

describe('4. only the judged subset refuses', () => {
  it('values outside `enum`/`format`/`$ref`/`oneOf`, and keys outside `properties`, still dispatch', async () => {
    const { engine, sent } = makeEngine();
    const input = { text: 'x', mode: 'sideways', meta: 42, when: 'not a date', either: true, extra: 'kept' };
    const result = await run(engine, 'ok_unjudged', 'echo', input);
    expect(result.success, result.error).toBe(true);
    expect(sent).toEqual([{ action: 'echo', input }]);
  });

  it('an action with no `inputSchema` dispatches whatever it is given, an absent input included', async () => {
    const { engine, sent } = makeEngine();
    const result = await run(engine, 'ok_free', 'free', undefined);
    expect(result.success, result.error).toBe(true);
    expect(sent).toEqual([{ action: 'free', input: {} }]);
  });
});
