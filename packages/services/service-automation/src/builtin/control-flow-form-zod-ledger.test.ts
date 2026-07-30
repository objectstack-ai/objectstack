// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **Designer form ↔ Zod reconciliation for the region-bearing nodes** (#4045).
 *
 * `loop` / `parallel` / `try_catch` each carry TWO descriptions of the same config:
 * a hand-written `configSchema` on the descriptor (drives the Studio form) and a Zod
 * schema in `control-flow.zod.ts` (validates the value). #4064 pinned the *shape* of
 * the first; this pins the *relationship* between the two, so neither can gain or
 * lose a key without the other noticing.
 *
 * ## Why they are not merged into one source
 *
 * The obvious de-duplication — publish `z.toJSONSchema(LoopConfigSchema)` and delete
 * the literal — was measured on main `53fbf49` and is not viable for these three:
 *
 * | node | published form | generated from Zod |
 * |---|---|---|
 * | `loop` | 597 chars, depth 5, 25 keys | 5,537 chars, depth 14, 201 keys |
 * | `parallel` | 294 chars, depth 6, 16 keys | 5,112 chars, depth 15, 189 keys |
 * | `try_catch` | 737 chars, depth 5, 40 keys | 10,739 chars, depth 14, 397 keys |
 *
 * Generation succeeds — no recursion error — but emits **no `$defs` and no `$ref`**:
 * `FlowNodeSchema` is inlined in full at every region key, so a loop body would
 * arrive as the entire node/edge definition instead of the opaque `{ type: 'array' }`
 * the designer needs for a sub-graph that is edited on the canvas. Making the
 * generated output usable would mean a projection pruning ~90% of it back off, at
 * which point "one source" is a fiction: you would maintain the Zod, the projection
 * rules, and a check that the projection still does the right thing.
 *
 * So the two artifacts have different jobs and legitimately differ. What is worth
 * enforcing is not that the difference disappears but that it stays **declared** —
 * the #3569 / #4040 ledger pattern.
 *
 * ## Why this file compares KEY SETS and not generated shapes
 *
 * Deliberate, not an omission. Generating requires `z.toJSONSchema`, and
 * `service-automation` does not depend on `zod` — only `@objectstack/spec` does.
 * Adding that dependency to run a test would put a real edge in the package graph for
 * no runtime need. The Zod's own key set is reachable without it (`schema.shape`),
 * and the key set is where the drift that matters shows up: a key on one side and not
 * the other. The depth divergence is measured once in the table above and its form
 * half is pinned by `config-schemas.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { LoopConfigSchema, ParallelConfigSchema, TryCatchConfigSchema } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerLoopNode } from './loop-node.js';
import { registerParallelNode } from './parallel-node.js';
import { registerTryCatchNode } from './try-catch-node.js';

/**
 * Config keys whose form shape is deliberately shallower than the Zod, with the
 * reason. Checked both ways below — an entry must name a key both sides really
 * declare, so it cannot rot into a reference to something that no longer exists.
 */
const DELIBERATELY_SHALLOW: ReadonlyArray<{ nodeType: string; key: string; why: string }> = [
  {
    nodeType: 'loop', key: 'body',
    why: 'FlowRegionSchema — the body sub-graph is edited on the canvas, so the form publishes an opaque array',
  },
  {
    nodeType: 'parallel', key: 'branches',
    why: 'each branch carries a region; the form publishes name + opaque node/edge arrays',
  },
  {
    nodeType: 'try_catch', key: 'try',
    why: 'protected region — opaque for the same reason as loop.body',
  },
  {
    nodeType: 'try_catch', key: 'catch',
    why: 'handler region — opaque for the same reason as loop.body',
  },
];

const NODES: ReadonlyArray<{ nodeType: string; zod: unknown }> = [
  { nodeType: 'loop', zod: LoopConfigSchema },
  { nodeType: 'parallel', zod: ParallelConfigSchema },
  { nodeType: 'try_catch', zod: TryCatchConfigSchema },
];

function engineWithControlFlow() {
  const logger: any = {
    info() {}, warn() {}, error() {}, debug() {},
    child() { return logger; },
  };
  const ctx: any = { logger, getService() { throw new Error('none'); } };
  const engine = new AutomationEngine(logger);
  registerLoopNode(engine, ctx);
  registerParallelNode(engine, ctx);
  registerTryCatchNode(engine, ctx);
  return engine;
}

const engine = engineWithControlFlow();

/** Top-level keys the designer form offers for a node type. */
function formKeys(nodeType: string): string[] {
  const schema = engine.getActionDescriptor(nodeType)?.configSchema as
    | { properties?: Record<string, unknown> }
    | undefined;
  expect(schema, `${nodeType} should publish a configSchema`).toBeDefined();
  return Object.keys(schema!.properties ?? {}).sort();
}

/**
 * Top-level keys the Zod object accepts, read straight off `.shape` — no `zod`
 * import, so this stays inside the package's existing dependency graph.
 */
function zodKeys(schema: unknown): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  expect(shape, 'the Zod schema should expose a .shape').toBeDefined();
  return Object.keys(shape ?? {}).sort();
}

describe('control-flow form ↔ Zod reconciliation (#4045)', () => {
  it.each(NODES)('$nodeType: the form offers exactly the keys the Zod accepts', ({ nodeType, zod }) => {
    const form = formKeys(nodeType);
    const zodded = zodKeys(zod);

    // Accepted by Zod, absent from the form ⇒ an author cannot set it in Studio.
    // This is #3528's failure in the other direction: a real config key with no way
    // to author it, discoverable only by reading the executor.
    expect(
      zodded.filter((k) => !form.includes(k)),
      `${nodeType}: accepted by the Zod but absent from the designer form`,
    ).toEqual([]);

    // Offered by the form, not accepted by the Zod ⇒ the author fills in a field
    // whose value the parse then rejects or drops.
    expect(
      form.filter((k) => !zodded.includes(k)),
      `${nodeType}: offered by the designer form but not accepted by the Zod`,
    ).toEqual([]);
  });

  it('every ledger entry names a key both sides actually declare', () => {
    // Stops the ledger rotting into references to keys that were renamed or removed —
    // the same bidirectionality the #4040 expression ledger has.
    for (const { nodeType, key } of DELIBERATELY_SHALLOW) {
      const node = NODES.find((n) => n.nodeType === nodeType);
      expect(node, `ledger references unknown node type '${nodeType}'`).toBeDefined();
      expect(formKeys(nodeType), `${nodeType}.${key}: not on the form any more`).toContain(key);
      expect(zodKeys(node!.zod), `${nodeType}.${key}: not in the Zod any more`).toContain(key);
    }
  });

  it('the ledger is not vacuous and every entry carries a reason', () => {
    // The failure mode a ledger test must not have: if the entries stopped resolving,
    // the assertions above would pass over an empty set.
    expect(DELIBERATELY_SHALLOW.length).toBeGreaterThan(0);
    for (const entry of DELIBERATELY_SHALLOW) {
      expect(
        entry.why.length,
        `${entry.nodeType}.${entry.key} needs a reason a reader can act on`,
      ).toBeGreaterThan(20);
    }
  });
});
