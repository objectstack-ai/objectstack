// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The maps a node hands to a CALLEE are value slots** — `subflow.input.*`,
 * `map.input.*` and `script.inputs.*` (#19939, the rider positions' first
 * stage; #11182 ruling D; ADR-0032 Decision 2, a computed value is whole-field
 * CEL). Declared in the expression ledger and evaluated in the same change.
 *
 * Before this, each executor handed its map to `interpolate()` whole: a
 * `{token}` resolved, and an envelope written there reached the callee as the
 * object `{ dialect: 'cel', source: '…' }` it spells, with the run reporting
 * success. Pinned through the shipped `AutomationEngine`:
 *
 *  1. **Refused at every door.** A `{token}` at each position stops the flow
 *     registering, located at `config.<map>.<key>` and naming its CEL envelope;
 *     the executor's contract parse refuses the same token as a guard, for a
 *     node that reached it without `registerFlow`.
 *  2. **Evaluated.** Each prescribed envelope is evaluated in the PARENT's
 *     scope and reaches the callee as the raw value it computes — a list stays
 *     a list, a record a record; on a `map`, once per item with the item
 *     variable bound; on a `script`, as the function's `input`.
 *  3. **The callee's default.** A whole token that resolved to nothing handed
 *     the callee nothing, and the child seeded the variable from its
 *     `defaultValue`. The guarded form hands `null`, a supplied value that wins
 *     over the default — which is why the refusal says so, and names the two
 *     ways to keep the default (write it in the guard, or leave the key out).
 */

import { describe, expect, it } from 'vitest';
import { VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';
import { interpolate } from './template.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

/** An engine with every builtin node, and the functions a `script` node may call. */
function makeEngine(functions: Record<string, (c: { input: Record<string, unknown> }) => unknown> = {}): AutomationEngine {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, ctx());
  engine.setFunctionResolver((name) => functions[name] as never);
  return engine;
}

/** The builtin executors themselves — the run-time door, reached without `registerFlow`. */
function captureExecutors(): Map<string, { execute: (...args: any[]) => Promise<any> }> {
  const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const engine = new AutomationEngine(silentLogger());
  const recorder = new Proxy(engine, {
    get(target, key, receiver) {
      if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
      return Reflect.get(target, key, receiver);
    },
  });
  installBuiltinNodes(recorder as AutomationEngine, ctx());
  return executors;
}

/** start → `node` → end, with `variables` declared. */
function flowWith(name: string, node: Record<string, unknown>, variables: unknown[] = []): any {
  return {
    name, label: name, type: 'autolaunched', variables,
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { label: 'Node', ...node }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: node.id }, { id: 'e2', source: node.id, target: 'end' }],
  };
}

/** A child flow that echoes its input variables back as its output. */
function echoChild(name: string, variables: Array<{ name: string; defaultValue?: unknown }>): any {
  return {
    name, label: name, type: 'autolaunched',
    variables: variables.map((v) => ({ type: 'text', isInput: true, isOutput: true, ...v })),
    nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
  };
}

const ROWS = [{ id: 'r1', owner: 'u1' }, { id: 'r2', owner: 'u2' }];
const REC = { id: 'acc_1', name: 'Acme' };
const PARENT_VARIABLES = [
  { name: 'rows', type: 'list', isInput: true },
  { name: 'rec', type: 'object', isInput: true },
  { name: 'out', type: 'object', isOutput: true },
];

/** The three positions: node type, the map's key, a config with the map put in. */
const POSITIONS = [
  ['subflow', 'input', (map: Record<string, unknown>) => ({ flowName: 'child', outputVariable: 'out', input: map })],
  ['map', 'input', (map: Record<string, unknown>) => ({ flowName: 'child', collection: '{rows}', outputVariable: 'out', input: map })],
  ['script', 'inputs', (map: Record<string, unknown>) => ({ function: 'echo', outputVariable: 'out', inputs: map })],
] as const;

describe('1. a `{token}` in a callee\'s input map is refused at every door', () => {
  it.each(POSITIONS)('%s: `registerFlow` refuses it at `config.%s.<key>`, naming the envelope', (type, key, configOf) => {
    const engine = makeEngine();
    let message = '';
    try {
      engine.registerFlow('refused', flowWith('refused', { id: 'n', type, config: configOf({ list: '{rows}' }) }, PARENT_VARIABLES));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain(`at config.${key}.list: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain("{ dialect: 'cel', source: 'rows' }");
  });

  it.each(POSITIONS)('%s: the executor\'s contract parse refuses it too, as a guard', async (type, key, configOf) => {
    const executor = captureExecutors().get(type)!;
    const result = await executor.execute(
      { id: 'n', type, label: 'Node', config: configOf({ list: '{rows}' }) },
      new Map<string, unknown>([['rows', ROWS]]),
      {},
    );
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('guard');
    expect(result.error).toContain(`config.${key}.list: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
  });
});

describe('2. each prescribed envelope is evaluated in the parent\'s scope and handed over raw', () => {
  it('subflow: the child receives the list as a list, the record as a record, and literals as written', async () => {
    const engine = makeEngine();
    engine.registerFlow('child', echoChild('child', [{ name: 'list' }, { name: 'record_in' }, { name: 'greeting' }, { name: 'n' }]));
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'subflow',
      config: {
        flowName: 'child', outputVariable: 'out',
        input: {
          list: { dialect: 'cel', source: 'rows' },
          record_in: { dialect: 'cel', source: 'rec' },
          greeting: { dialect: 'cel', source: "'Hi ' + rec.name" },
          n: 3,
        },
      },
    }, PARENT_VARIABLES));
    const run = await engine.execute('parent', { params: { rows: ROWS, rec: REC } } as any);
    expect(run.success, run.error).toBe(true);
    const out = (run.output as { out: Record<string, unknown> }).out;
    expect(out.list).toEqual(ROWS);
    expect(Array.isArray(out.list)).toBe(true);
    expect(out.record_in).toEqual(REC);
    expect(out.greeting).toBe('Hi Acme');
    expect(out.n).toBe(3);
  });

  it('map: evaluated once per item, with the item variable bound', async () => {
    const engine = makeEngine();
    engine.registerFlow('child', echoChild('child', [{ name: 'owner' }, { name: 'row' }]));
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'map',
      config: {
        flowName: 'child', collection: '{rows}', outputVariable: 'out',
        input: { owner: { dialect: 'cel', source: 'item.owner' }, row: { dialect: 'cel', source: 'item' } },
      },
    }, PARENT_VARIABLES));
    const run = await engine.execute('parent', { params: { rows: ROWS } } as any);
    expect(run.success, run.error).toBe(true);
    expect((run.output as { out: unknown }).out).toEqual([
      { owner: 'u1', row: ROWS[0] },
      { owner: 'u2', row: ROWS[1] },
    ]);
  });

  it('script: the function\'s `input` carries the computed values, type kept', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine({ echo: (c) => { seen.push(c.input); return c.input; } });
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'script',
      config: { function: 'echo', outputVariable: 'out', inputs: { lines: { dialect: 'cel', source: 'rows' }, title: 'plain' } },
    }, PARENT_VARIABLES));
    const run = await engine.execute('parent', { params: { rows: ROWS } } as any);
    expect(run.success, run.error).toBe(true);
    expect(seen).toEqual([{ lines: ROWS, title: 'plain' }]);
    expect(Array.isArray(seen[0]!.lines)).toBe(true);
  });

  it('a value that faults on the live variables fails the run with its source — nothing is handed over', async () => {
    const engine = makeEngine();
    engine.registerFlow('child', echoChild('child', [{ name: 'd' }]));
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'subflow', config: { flowName: 'child', outputVariable: 'out', input: { d: { dialect: 'cel', source: 'nope' } } },
    }, PARENT_VARIABLES));
    const run = await engine.execute('parent', {} as any);
    expect(run.success).toBe(false);
    expect(run.error).toContain('input.d: value expression failed to evaluate as CEL');
    expect(run.error).toContain('source: `nope`');
  });
});

describe('3. the callee\'s default: the guarded form SUPPLIES `null`, which wins over it', () => {
  const GUARDED = { dialect: 'cel', source: 'has(vars.nope) ? vars.nope : null' };
  const GUARDED_WITH_DEFAULT = { dialect: 'cel', source: "has(vars.nope) ? vars.nope : 'dflt'" };

  async function childD(input: Record<string, unknown>): Promise<unknown> {
    const engine = makeEngine();
    engine.registerFlow('child', echoChild('child', [{ name: 'd', defaultValue: 'dflt' }]));
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'subflow', config: { flowName: 'child', outputVariable: 'out', input },
    }, PARENT_VARIABLES));
    const run = await engine.execute('parent', {} as any);
    expect(run.success, run.error).toBe(true);
    return (run.output as { out: { d: unknown } }).out.d;
  }

  it('what the template did: a whole token that resolved to nothing handed `undefined`, so the default applied', async () => {
    expect(interpolate({ d: '{nope}' }, new Map(), {} as any)).toEqual({ d: undefined });
    const engine = makeEngine();
    engine.registerFlow('child', echoChild('child', [{ name: 'd', defaultValue: 'dflt' }]));
    const run = await engine.execute('child', { params: { d: undefined } } as any);
    expect(run.output).toEqual({ d: 'dflt' });
  });

  it('the guarded form hands `null`, and the child takes it over its `defaultValue`', async () => {
    expect(await childD({ d: GUARDED })).toBeNull();
  });

  it('the two ways to keep the default: write it in the guard, or leave the key out', async () => {
    expect(await childD({ d: GUARDED_WITH_DEFAULT })).toBe('dflt');
    expect(await childD({})).toBe('dflt');
  });

  it('map: the same, per item', async () => {
    const engine = makeEngine();
    engine.registerFlow('child', echoChild('child', [{ name: 'd', defaultValue: 'dflt' }]));
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'map', config: { flowName: 'child', collection: '{rows}', outputVariable: 'out', input: { d: GUARDED } },
    }, PARENT_VARIABLES));
    const run = await engine.execute('parent', { params: { rows: [1] } } as any);
    expect(run.success, run.error).toBe(true);
    expect((run.output as { out: unknown }).out).toEqual([{ d: null }]);
  });

  it('script: the function is handed `null` where the template handed `undefined`', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const engine = makeEngine({ echo: (c) => { seen.push(c.input); return null; } });
    engine.registerFlow('parent', flowWith('parent', {
      id: 'n', type: 'script', config: { function: 'echo', inputs: { k: GUARDED } },
    }, PARENT_VARIABLES));
    expect((await engine.execute('parent', {} as any)).success).toBe(true);
    expect(seen).toEqual([{ k: null }]);
    expect('k' in interpolate({ k: '{nope}' }, new Map(), {} as any)).toBe(true);
    expect(interpolate({ k: '{nope}' }, new Map(), {} as any).k).toBeUndefined();
  });

  it('the registration refusal says so, at the position', () => {
    const engine = makeEngine();
    let message = '';
    try {
      engine.registerFlow('refused', flowWith('refused', {
        id: 'n', type: 'subflow', config: { flowName: 'child', input: { d: '{nope}' } },
      }));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('`input.d` is the child flow\'s input variable `d`.');
    expect(message).toContain('the guarded form hands `null`, a supplied value, which wins over that default');
  });
});
