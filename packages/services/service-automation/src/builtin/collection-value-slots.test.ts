// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The list a `loop` (with a `body`) and a `map` iterate is a value slot** —
 * their `collection` (#19939, the rider positions' third stage; #11182 ruling
 * D; ADR-0032 Decision 2, a computed value is whole-field CEL). Declared in the
 * expression ledger and evaluated in the same change.
 *
 * Before this, each executor ran a string `collection` through `interpolate()`:
 * a whole `{token}` handed back the variable's value, and the contract also
 * declared a variable's bare name there — which the structured `loop` and
 * `map` never read: `interpolate('rows')` returns `'rows'`, the fallback to a
 * variable lookup fired only on `null`, and every run failed at the node with
 * "did not resolve to an array" (measured on the base through this engine).
 * Pinned through the shipped `AutomationEngine`:
 *
 *  1. **Refused at every door.** A `{token}` and a bare name stop the flow
 *     registering, located at `config.collection` and naming the envelope; the
 *     executor's contract parse refuses both as a guard. A body-less `loop` —
 *     the legacy flat-graph form — is judged nowhere and still reads a bare
 *     name into `$loopItems` / `$loopIndex`.
 *  2. **Evaluated in the run's scope.** An envelope is evaluated to the list,
 *     a computed one included; an inline array is iterated as written, its
 *     strings never interpolated.
 *  3. **Absent, `null`, not a list.** An absent variable fails the run with an
 *     evaluation fault naming it; anything the envelope evaluates to but a list
 *     fails the node, `null` included; a guard answering `[]` iterates nothing.
 */

import { describe, expect, it } from 'vitest';
import { VALUE_SLOT_TEMPLATE_REFUSAL } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { installBuiltinNodes } from './index.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function ctx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

const CEL = (source: string) => ({ dialect: 'cel', source });
const BODY = { nodes: [{ id: 'b', type: 'zz_seen', label: 'Body' }], edges: [] };

/** An engine with the builtins, a body node that records the item, and a child flow that records its param. */
function makeEngine(): { engine: AutomationEngine; seen: unknown[] } {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, ctx());
  const seen: unknown[] = [];
  engine.registerNodeExecutor({
    type: 'zz_seen',
    async execute(_node, variables, context) {
      seen.push(variables.has('item') ? variables.get('item') : (context as any)?.params?.val);
      return { success: true };
    },
  } as NodeExecutor);
  engine.registerNodeExecutor({
    type: 'zz_peek',
    async execute(_node, variables) {
      seen.push({ $loopItems: variables.get('$loopItems'), $loopIndex: variables.get('$loopIndex') });
      return { success: true };
    },
  } as NodeExecutor);
  engine.registerFlow('zz_child', {
    name: 'zz_child', label: 'Child', type: 'autolaunched',
    nodes: [
      { id: 'cs', type: 'start', label: 'cs' },
      { id: 'mark', type: 'zz_seen', label: 'mark' },
      { id: 'ce', type: 'end', label: 'ce' },
    ],
    edges: [{ id: 'c1', source: 'cs', target: 'mark' }, { id: 'c2', source: 'mark', target: 'ce' }],
  } as never);
  return { engine, seen };
}

/** start → the node → peek → end, with `rows` an input variable. */
function flowOf(name: string, nodeType: 'loop' | 'map', config: Record<string, unknown>): any {
  return {
    name, label: name, type: 'autolaunched',
    variables: [{ name: 'rows', type: 'list', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'node', type: nodeType, label: 'Node', config },
      { id: 'peek', type: 'zz_peek', label: 'Peek' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'node' },
      { id: 'e2', source: 'node', target: 'peek' },
      { id: 'e3', source: 'peek', target: 'end' },
    ],
  };
}

/** The two positions: the config around a `collection`. */
const POSITIONS = [
  ['loop', (collection: unknown) => ({ collection, iteratorVariable: 'item', body: BODY })],
  ['map', (collection: unknown) => ({ collection, flowName: 'zz_child', input: { val: CEL('item') } })],
] as const;

/** The builtin executor itself — the run-time door, reached without `registerFlow`. */
function executorOf(type: string): { execute: (...args: any[]) => Promise<any> } {
  const executors = new Map<string, { execute: (...args: any[]) => Promise<any> }>();
  const engine = new AutomationEngine(silentLogger());
  const recorder = new Proxy(engine, {
    get(target, key, receiver) {
      if (key === 'registerNodeExecutor') return (e: any) => { executors.set(e.type, e); };
      return Reflect.get(target, key, receiver);
    },
  });
  installBuiltinNodes(recorder as AutomationEngine, ctx());
  return executors.get(type)!;
}

function registerError(nodeType: 'loop' | 'map', config: Record<string, unknown>): string {
  try {
    makeEngine().engine.registerFlow('refused', flowOf('refused', nodeType, config));
  } catch (e) {
    return (e as Error).message;
  }
  return '';
}

async function run(nodeType: 'loop' | 'map', config: Record<string, unknown>, params: Record<string, unknown> = {}) {
  const { engine, seen } = makeEngine();
  engine.registerFlow('probe', flowOf('probe', nodeType, config));
  const result = await engine.execute('probe', { params } as any);
  const runs = await engine.listRuns('probe');
  const step = runs[0]?.steps.find((s) => s.nodeId === 'node');
  return { result, seen, step };
}

describe('1. a string `collection` is refused at every door', () => {
  it.each(POSITIONS)('%s: `registerFlow` refuses a `{token}` at config.collection, naming the envelope and the list', (nodeType, configOf) => {
    const message = registerError(nodeType, configOf('{rows}'));
    expect(message).toContain(`collection at config.collection: ${VALUE_SLOT_TEMPLATE_REFUSAL}`);
    expect(message).toContain("Write `{rows}` as { dialect: 'cel', source: 'rows' }.");
    expect(message).toContain('a guard answering `[]` iterates nothing instead: `has(vars.rows) ? vars.rows : []`');
  });

  it.each(POSITIONS)('%s: `registerFlow` refuses a bare variable name, naming that variable in an envelope', (nodeType, configOf) => {
    const message = registerError(nodeType, configOf('rows'));
    expect(message).toContain(`This \`${nodeType}\` node's config is refused at \`collection\``);
    expect(message).toContain("A variable's bare name, `rows`, is not one");
    expect(message).toContain("`{ dialect: 'cel', source: 'rows' }`");
  });

  it.each(POSITIONS)('%s: the executor\'s contract parse refuses both as a guard', async (nodeType, configOf) => {
    for (const [collection, words] of [['{rows}', VALUE_SLOT_TEMPLATE_REFUSAL], ['rows', "A variable's bare name, `rows`"]] as const) {
      const result = await executorOf(nodeType).execute(
        { id: 'node', type: nodeType, label: 'Node', config: configOf(collection) },
        new Map<string, unknown>([['rows', [1, 2]]]),
        {},
      );
      expect(result.success, collection).toBe(false);
      expect(result.errorClass, collection).toBe('guard');
      expect(result.error, collection).toContain('config.collection');
      expect(result.error, collection).toContain(words);
    }
  });

  it('a body-less `loop` is the legacy flat-graph form: judged nowhere, and `$loopItems` / `$loopIndex` unchanged', async () => {
    const legacy = await run('loop', { collection: 'rows' }, { rows: [1, 2] });
    expect(legacy.result.success).toBe(true);
    expect(legacy.seen).toEqual([{ $loopItems: [1, 2], $loopIndex: 0 }]);
    // A token there was never read by that form, and is not judged now either.
    const token = await run('loop', { collection: '{rows}' }, { rows: [1, 2] });
    expect(token.result.success).toBe(true);
    expect(token.seen).toEqual([{ $loopItems: undefined, $loopIndex: undefined }]);
  });
});

describe('2. an envelope is evaluated in the run\'s scope; an inline array is iterated as written', () => {
  it.each(POSITIONS)('%s: an envelope iterates the list it evaluates to', async (nodeType, configOf) => {
    const { result, seen } = await run(nodeType, configOf(CEL('rows')), { rows: ['a', 'b', 'c'] });
    expect(result.success).toBe(true);
    expect(seen.slice(0, 3)).toEqual(['a', 'b', 'c']);
  });

  it.each(POSITIONS)('%s: a computed list — the CEL stdlib is reachable', async (nodeType, configOf) => {
    const { result, seen } = await run(nodeType, configOf(CEL('rows.filter(r, r > 1)')), { rows: [1, 2, 3] });
    expect(result.success).toBe(true);
    expect(seen.slice(0, 2)).toEqual([2, 3]);
  });

  it.each(POSITIONS)('%s: an inline array is the list, its strings data — never interpolated', async (nodeType, configOf) => {
    const { result, seen } = await run(nodeType, configOf(['{rows}', 'b']), { rows: [1, 2] });
    expect(result.success).toBe(true);
    expect(seen.slice(0, 2)).toEqual(['{rows}', 'b']);
  });
});

describe('3. absent, `null`, not a list', () => {
  it.each(POSITIONS)('%s: an absent variable fails the run with an evaluation fault naming it', async (nodeType, configOf) => {
    const { result, step } = await run(nodeType, configOf(CEL('rows')));
    expect(result.success).toBe(false);
    expect(step?.status).toBe('failure');
    expect(step?.error?.code).toBe('EXECUTION_ERROR');
    expect(step?.error?.message).toContain('collection: value expression failed to evaluate as CEL: Unknown variable: rows');
  });

  it.each(POSITIONS)('%s: a guard answering `[]` iterates nothing, and the run goes on', async (nodeType, configOf) => {
    const { result, seen } = await run(nodeType, configOf(CEL('has(vars.rows) ? vars.rows : []')));
    expect(result.success).toBe(true);
    expect(seen.filter((s) => typeof s !== 'object' || s === null)).toEqual([]);
  });

  it.each(POSITIONS)('%s: `null` — the value slots\' usual guard — fails the node, as an unresolved token did', async (nodeType, configOf) => {
    const { result, step } = await run(nodeType, configOf(CEL('has(vars.rows) ? vars.rows : null')));
    expect(result.success).toBe(false);
    expect(step?.error?.code).toBe('NODE_FAILURE');
    expect(step?.error?.message).toBe(
      `${nodeType} 'node': collection evaluated to \`null\`, not a list — source: \`has(vars.rows) ? vars.rows : null\``,
    );
  });

  it.each(POSITIONS)('%s: a value that is no list fails the node, naming what it evaluated to', async (nodeType, configOf) => {
    const { step } = await run(nodeType, configOf(CEL('rows')), { rows: 'abc' });
    expect(step?.error?.code).toBe('NODE_FAILURE');
    expect(step?.error?.message).toBe(`${nodeType} 'node': collection evaluated to a string, not a list — source: \`rows\``);
  });
});
