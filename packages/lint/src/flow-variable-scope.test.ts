// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { SCOPE_ROOTS } from '@objectstack/formula';
import { FlowSchema, FlowVariableSchema } from '@objectstack/spec/automation';

import { collectFlowVariableNames, shadowedFieldReads, shadowedFieldMessage } from './flow-variable-scope.js';

/**
 * Unit coverage for the #14089 collection surface. The end-to-end behaviour
 * (which conditions warn, which stay silent) lives in
 * `validate-expressions.test.ts`; what is pinned HERE is the collection
 * surface's completeness, row by row, because the ruling's criterion is only as
 * closed as this set is.
 */
describe('collectFlowVariableNames (#14089)', () => {
  const graphOf = (...nodes: Array<Record<string, unknown>>) => [{ nodes }];

  it('row 1 — the flow\'s own declared variables', () => {
    const names = collectFlowVariableNames(
      { variables: [{ name: 'batch_size', type: 'number' }, { name: 'cursor', type: 'text' }] },
      [],
    );
    expect([...names].sort()).toEqual(['batch_size', 'cursor']);
  });

  it('rows 2-6 — the four declared config keys whose VALUE is a name', () => {
    const names = collectFlowVariableNames({}, graphOf(
      { id: 'sweep', type: 'loop', config: { iteratorVariable: 'item_row', indexVariable: 'i' } },
      { id: 'guard', type: 'try_catch', config: { errorVariable: 'caught' } },
      { id: 'fetch', type: 'query_records', config: { outputVariable: 'rows' } },
    ));
    for (const expected of ['item_row', 'i', 'caught', 'rows']) expect(names.has(expected)).toBe(true);
  });

  it('row 7 — all THREE assignment shapes, including the wrapper-less one', () => {
    expect(collectFlowVariableNames({}, graphOf(
      { id: 'a', type: 'assignment', config: { assignments: { total: 1 } } },
    )).has('total')).toBe(true);

    expect(collectFlowVariableNames({}, graphOf(
      { id: 'a', type: 'assignment', config: { assignments: [{ variable: 'total', value: 1 }] } },
    )).has('total')).toBe(true);

    // Shape 3 — no wrapper at all. `logic-nodes.ts`'s `else` branch reads the
    // config's own keys, and this is the row a hand-written collector misses.
    expect(collectFlowVariableNames({}, graphOf(
      { id: 'a', type: 'assignment', config: { total: 1, label: 'x' } },
    )).has('total')).toBe(true);
  });

  it('row 7 shape 2 — the `name` and `key` spellings the executor also accepts', () => {
    const names = collectFlowVariableNames({}, graphOf({
      id: 'a', type: 'assignment',
      config: { assignments: [{ name: 'by_name', value: 1 }, { key: 'by_key', value: 2 }] },
    }));
    expect([...names].sort()).toEqual(['a', 'by_key', 'by_name']);
  });

  it('row 7 is gated on the node TYPE — a non-assignment node donates no config keys', () => {
    const names = collectFlowVariableNames({}, graphOf(
      { id: 'fetch', type: 'http', config: { url: 'https://example.test', method: 'GET' } },
    ));
    // Only the node id (row 8). `url` / `method` are config, not variables —
    // reading them would manufacture a warning on any object with a `url` field.
    expect([...names]).toEqual(['fetch']);
  });

  it('row 8 — a node id is collected, because it is a bare CEL root at runtime', () => {
    const names = collectFlowVariableNames({}, graphOf({ id: 'lookup_owner', type: 'query_records' }));
    expect(names.has('lookup_owner')).toBe(true);
  });

  it('is FLOW-scoped: every graph contributes to one flat set', () => {
    // `collectFlowGraphs` yields each ADR-0031 region as its own graph, and
    // `seedRunVariables` builds ONE map per run — so a name declared inside a
    // region is in scope for the whole flow, not just that region.
    const names = collectFlowVariableNames({}, [
      { nodes: [{ id: 'start', type: 'start' }] },
      { nodes: [{ id: 'inner', type: 'assignment', config: { region_local: 1 } }] },
    ]);
    expect(names.has('region_local')).toBe(true);
  });

  it('tolerates the shapes an unparsed source can carry', () => {
    expect([...collectFlowVariableNames({}, [])]).toEqual([]);
    expect([...collectFlowVariableNames({ variables: 'nonsense' }, [])]).toEqual([]);
    expect([...collectFlowVariableNames({ variables: [null, 7, { type: 'text' }] }, [])]).toEqual([]);
    expect([...collectFlowVariableNames({}, graphOf({ id: 'n', config: 'nonsense' }))]).toEqual(['n']);
  });

  /**
   * The alias `control-flow.zod.ts` REJECTS by name. Reading it here would be
   * consumer-side tolerance of a shape the schema refuses (Prime Directive #12)
   * — and it cannot arrive on the parsed path this rule runs on anyway.
   */
  it('does not read the rejected `itemVariable` alias', () => {
    const names = collectFlowVariableNames({}, graphOf(
      { id: 'sweep', type: 'loop', config: { itemVariable: 'should_not_be_collected' } },
    ));
    expect(names.has('should_not_be_collected')).toBe(false);
  });
});

describe('shadowedFieldReads (#14089)', () => {
  const vars = (...names: string[]) => new Set(names);

  it('reports a bare name that is BOTH a variable and a field', () => {
    expect(shadowedFieldReads('status == "dispatched"', vars('status'), ['status', 'amount']))
      .toEqual(['status']);
  });

  it('is silent when the name is a field only', () => {
    expect(shadowedFieldReads('status == "dispatched"', vars('other'), ['status'])).toEqual([]);
  });

  it('is silent when the name is a variable only', () => {
    expect(shadowedFieldReads('batch_size > 0', vars('batch_size'), ['status'])).toEqual([]);
  });

  it('is silent on the dotted spelling it prescribes', () => {
    expect(shadowedFieldReads('record.status == "x"', vars('status'), ['status'])).toEqual([]);
  });

  it('reports every shadowed root in one predicate, in discovery order', () => {
    const found = shadowedFieldReads('status == "x" && amount > 1', vars('status', 'amount'), ['status', 'amount']);
    expect(found.sort()).toEqual(['amount', 'status']);
  });

  /**
   * The reason `firstUndeclaredReference` is the oracle and
   * `collectCelRootIdentifiers` is not (maintainer's implementation input, item
   * 6). A comprehension macro binds its own variable; an AST root scan reports
   * that binder as a root, so a macro variable sharing a field's name would be
   * flagged for a collision that cannot exist. The declaredness oracle acts only
   * on cel-js's own `Unknown variable` fault, so it never sees the binder.
   */
  it('does not flag a comprehension-macro variable that shares a field name', () => {
    expect(shadowedFieldReads(
      'record.lines.exists(status, status.ok)',
      vars('status'),
      ['status'],
    )).toEqual([]);
  });

  it('does not flag a function name that shares a field name', () => {
    expect(shadowedFieldReads('size(record.lines) > 0', vars('size'), ['size'])).toEqual([]);
  });

  it('costs nothing when the two authored sets do not intersect', () => {
    expect(shadowedFieldReads('anything at all', vars('a'), ['b'])).toEqual([]);
    expect(shadowedFieldReads('anything at all', new Set<string>(), ['b'])).toEqual([]);
    expect(shadowedFieldReads('anything at all', vars('a'), [])).toEqual([]);
  });

  it('is empty on a source that does not parse — the syntax pass owns that defect', () => {
    expect(shadowedFieldReads('status == ', vars('status'), ['status'])).toEqual([]);
  });

  /**
   * ⚠️ The oracle's known, DELIBERATE blind spot, pinned so it is a recorded
   * property rather than a surprise: `SCOPE_ROOTS` are declared in the strict
   * environment, so a flow variable named after one of them is never reported as
   * a bare root. That is an UNDER-report — the safe direction for a warning —
   * and closing it means consulting the AST, which re-opens the macro-variable
   * false positive above. The pin reads the real baseline rather than a copied
   * word, so a future `SCOPE_ROOTS` member keeps this honest.
   */
  it('under-reports a variable named after a SCOPE_ROOTS member (documented blind spot)', () => {
    const root = SCOPE_ROOTS[0];
    expect(SCOPE_ROOTS.length).toBeGreaterThan(0);
    expect(shadowedFieldReads(`${root} == "x"`, vars(root), [root])).toEqual([]);
  });
});

describe('shadowedFieldMessage (#14089)', () => {
  it('names the mechanism and both repairs', () => {
    const message = shadowedFieldMessage('status', 'duly_assignment');
    expect(message).toContain('`status`');
    expect(message).toContain('`duly_assignment`');
    expect(message).toContain('record.status');
    expect(message).toMatch(/rename the variable/);
  });
});

/**
 * ── The declared-key guard for this module (#5017's pattern, #14089's surface) ──
 *
 * `validate-expressions.test.ts` pins that every key its rule reads off a
 * metadata receiver is one `@objectstack/spec` declares. This module reads
 * metadata too, so it carries the same guard rather than escaping it by living
 * in a different file: the collection surface is exactly where an undeclared
 * key would go unnoticed, since a key nobody declares simply collects nothing
 * and the diagnostic stays silent — a green gate over a surface nothing read.
 */
const MODULE_SOURCE = readFileSync(new URL('./flow-variable-scope.ts', import.meta.url), 'utf8');
const MODULE_CODE = MODULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

function keysReadOff(receiver: string): string[] {
  const re = new RegExp(`\\b${receiver}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
  return [...new Set([...MODULE_CODE.matchAll(re)].map((m) => m[1]))].sort();
}

/**
 * Declared keys of a schema, unwrapping the optional / lazy layers both of
 * these schemas are built with. Mirrors `validate-expressions.test.ts`'s helper
 * of the same name; `lazySchema` proxies a FUNCTION target, so the `typeof`
 * guard has to admit both or every lazily-built schema answers "declares
 * nothing" and the guard goes vacuous.
 */
function shapeKeysOf(schema: unknown, depth = 0): string[] {
  const s = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown>; unwrap?: () => unknown };
  if (!s || (typeof s !== 'object' && typeof s !== 'function') || depth > 12) return [];
  if (s.shape) return Object.keys(s.shape);
  const d = (s._def ?? {}) as Record<string, unknown>;
  const getter = d.getter as (() => unknown) | undefined;
  for (const next of [d.innerType, d.element, d.valueType, getter?.(), d.in, d.out]) {
    const r = shapeKeysOf(next, depth + 1);
    if (r.length) return r;
  }
  if (typeof s.unwrap === 'function') return shapeKeysOf(s.unwrap(), depth + 1);
  return [];
}

describe('flow-variable-scope reads only keys the spec declares (meta-test)', () => {
  it('the flow receiver reads only `variables`', () => {
    expect(keysReadOff('flow')).toEqual(['variables']);
    const declared = shapeKeysOf(FlowSchema);
    expect(declared.length, 'FlowSchema resolved to no keys — the guard would be vacuous').toBeGreaterThan(0);
    expect(declared).toContain('variables');
  });

  it('the flow-variable receiver reads only `name`', () => {
    expect(keysReadOff('flowVar')).toEqual(['name']);
    const declared = shapeKeysOf(FlowVariableSchema);
    expect(declared.length, 'FlowVariableSchema resolved to no keys — the guard would be vacuous').toBeGreaterThan(0);
    expect(declared).toContain('name');
  });

  it('the node receiver reads only `id` / `type` / `config`', () => {
    expect(keysReadOff('flowNode')).toEqual(['config', 'id', 'type']);
  });

  /**
   * The config-key list is a COMPUTED read the scan above cannot see, so the
   * word list it indexes with is checked here instead — and against the
   * declaring schemas, not a copy. `assignments` is checked separately because
   * it is the one config key this module names literally.
   */
  it('the config-key list is spelled from the declaring schemas', () => {
    const declaration = /const VARIABLE_NAME_CONFIG_KEYS = \[([^\]]*)\] as const/.exec(MODULE_CODE);
    expect(declaration, 'the config-key list moved — update this guard').not.toBeNull();
    const keys = [...declaration![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(['iteratorVariable', 'indexVariable', 'errorVariable', 'outputVariable']);
    // The rejected alias must not be here — reading it would be consumer-side
    // tolerance of a spelling `control-flow.zod.ts` refuses by name.
    expect(keys).not.toContain('itemVariable');
  });

  it('the assignment node type is the one the executor dispatches on', () => {
    expect(/const ASSIGNMENT_NODE_TYPE = 'assignment'/.test(MODULE_CODE)).toBe(true);
  });
});
