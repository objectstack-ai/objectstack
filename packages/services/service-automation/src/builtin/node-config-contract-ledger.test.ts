// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **executor `parseNodeConfig` ↔ spec contract map reconciliation** (#20316).
 *
 * The build doors refuse a key a node's executor contract requires, left out,
 * through the spec's one judge `flowNodeConfigRefusals` — which judges each
 * node against `getBuiltinNodeConfigContracts()`. That map is only right while
 * it says what the executors actually do, so this test reads the executors:
 *
 *  - every `parseNodeConfig('<type>', node.id, <Schema>, …)` call in this
 *    directory's executor sources, and the map, name the same node types, and
 *    each type's map entry holds the SAME schema object the executor parses
 *    against — a new contract-parsing builtin with no map entry fails here
 *    (its missing keys would otherwise pass every door again, the #20316
 *    shape), and so does an entry whose parse is gone;
 *  - `loop` is the one executor that parses on a condition (its legacy
 *    flat-graph form, no `body`, is not parsed), and the map's `parsedWhen`
 *    mirrors that guard;
 *  - every builtin node type is classified: judged by a contract, or on the
 *    short, reasoned list of types whose executor parses no `config` contract.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as automation from '@objectstack/spec/automation';
import { getBuiltinNodeConfigContracts } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { installBuiltinNodes } from './index.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `parseNodeConfig<…>('type', node.id, Schema, …)` — the one call shape every executor uses. */
const PARSE_CALL = /parseNodeConfig<\w+>\(\s*'([a-z_]+)'\s*,\s*node\.id\s*,\s*(\w+)\s*,/g;

function executorParses(): Map<string, { schemaName: string; file: string }> {
  const out = new Map<string, { schemaName: string; file: string }>();
  for (const file of readdirSync(HERE)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'parse-config.ts') continue;
    const source = readFileSync(join(HERE, file), 'utf8');
    for (const match of source.matchAll(PARSE_CALL)) {
      expect(out.has(match[1]), `${match[1]} parses its config in two places`).toBe(false);
      out.set(match[1], { schemaName: match[2], file });
    }
  }
  return out;
}

/**
 * Builtins whose executor parses NO `config` contract, each with its reason —
 * the other half of the classification. A new builtin lands here only by an
 * edit that states why.
 */
const NO_CONFIG_CONTRACT: Readonly<Record<string, string>> = {
  decision: 'reads `conditions[]` raw; its branch shape is judged by flowNodeConfigRefusals\' own decision arm',
  assignment: 'normalizes three read-compatible shapes; no single contract describes them',
  wait: 'its input is the FlowNode sibling block `waitEventConfig`, required by FlowSchema itself',
  connector_action: 'its input is the FlowNode sibling block `connectorConfig`, not `config`',
};

describe('executor parseNodeConfig ↔ getBuiltinNodeConfigContracts (#20316)', () => {
  const parses = executorParses();
  const contracts = getBuiltinNodeConfigContracts();

  it('the derivation is not vacuous', () => {
    expect(parses.size).toBeGreaterThanOrEqual(13);
  });

  it('the map names exactly the node types an executor parses a config contract for', () => {
    expect([...contracts.keys()].sort()).toEqual([...parses.keys()].sort());
  });

  it('each map entry holds the very schema object its executor parses against', () => {
    for (const [type, { schemaName, file }] of parses) {
      const published = (automation as Record<string, unknown>)[schemaName];
      expect(published, `${file}: ${schemaName} is not published by @objectstack/spec/automation`).toBeDefined();
      expect(contracts.get(type)?.schema, `${type}: the map's schema is not ${schemaName}`).toBe(published);
    }
  });

  it('`loop` alone parses on a condition — its executor skips the legacy form with no `body`, and the map mirrors it', () => {
    const loopSource = readFileSync(join(HERE, parses.get('loop')!.file), 'utf8');
    expect(loopSource).toContain('if (raw.body == null) {');
    const loop = contracts.get('loop')!;
    expect(loop.parsedWhen?.({})).toBe(false);
    expect(loop.parsedWhen?.({ body: null })).toBe(false);
    expect(loop.parsedWhen?.({ body: { nodes: [] } })).toBe(true);
    expect([...contracts].filter(([, c]) => c.parsedWhen).map(([t]) => t)).toEqual(['loop']);
  });

  it('every builtin node type is classified — judged by a contract, or on the reasoned no-contract list', () => {
    const engine = new AutomationEngine({ info() {}, warn() {}, error() {}, debug() {} } as never);
    installBuiltinNodes(engine, { logger: { info() {}, warn() {}, error() {}, debug() {} }, getService() { throw new Error('none'); } } as never);
    const builtins = engine.getActionDescriptors().map((d) => d.type).sort();
    const classified = [...contracts.keys(), ...Object.keys(NO_CONFIG_CONTRACT)].sort();
    expect(builtins).toEqual(classified);
  });
});
