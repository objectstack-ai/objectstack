// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/region-slots
 *
 * **Where an ADR-0031 container keeps its nested region(s)** — the one
 * declaration of that fact (#4401).
 *
 * A region is a self-contained sub-graph living inside `FlowNodeSchema.config`,
 * which is deliberately an open `z.record`. Nothing in the type system says
 * which key on which node type holds one, so every pass that needs to reach a
 * region node has to be *told* — and within one week three of them were told
 * separately:
 *
 * | pass | package | unit it walks |
 * |------|---------|---------------|
 * | `mapFlowNodes` (ADR-0087 conversions) | `spec` | node, copy-on-write rewrite |
 * | `collectFlowGraphs` / `validateControlFlow` / `normalizeControlFlowRegions` | `spec` | graph (nodes + edges) |
 * | `walkFlowNodes` (lint flow rules) | `lint` | node, with diagnostic path |
 *
 * Each carried its own copy of the table below, and each pinned its own copy
 * with its own reconciliation test — so every copy was individually protected
 * from drift and *nothing* would have failed if they drifted from each other.
 * Adding a fourth construct meant editing three places, and the failure mode
 * for missing one is precisely the silent blind spot #4347 and #4380 were both
 * filed about.
 *
 * The **walks** are deliberately NOT merged: they take different inputs (parsed
 * `FlowNodeParsed` vs raw authored records), yield different units (a graph, a
 * node, a rewritten tree), and one of them formats human diagnostic trails,
 * which is consumer logic rather than protocol (Prime Directive #2). Only the
 * fact they all need — *this* table — is shared.
 *
 * Deliberately **import-free**: `spec/conversions/walk.ts` is a pure shape
 * walker that takes no schema dependency, and this module has to be usable from
 * there. It is data, not schema; `control-flow.zod.ts` is what maps a slot onto
 * the Zod schema its value parses as.
 */

/** How many regions a slot holds. */
export type FlowRegionArity =
  /** The slot's value IS a region (`loop.config.body`). */
  | 'one'
  /** The slot's value is an ARRAY of regions (`parallel.config.branches`). */
  | 'many';

/** One `config` key on one container node type that holds a region. */
export interface FlowRegionSlotDecl {
  /** The container's `node.type`. */
  readonly nodeType: string;
  /** The `config` key holding the region(s). */
  readonly key: string;
  readonly arity: FlowRegionArity;
}

/**
 * Every region-bearing `config` slot, across every ADR-0031 container.
 *
 * Pinned against the container config schemas that actually declare these keys
 * (`LoopConfigSchema` / `ParallelConfigSchema` / `TryCatchConfigSchema`) by
 * `region-slots.test.ts`, so a renamed or added slot fails there rather than
 * going quietly unwalked by all three passes at once.
 */
export const FLOW_REGION_SLOTS: readonly FlowRegionSlotDecl[] = [
  { nodeType: 'loop', key: 'body', arity: 'one' },
  { nodeType: 'parallel', key: 'branches', arity: 'many' },
  { nodeType: 'try_catch', key: 'try', arity: 'one' },
  { nodeType: 'try_catch', key: 'catch', arity: 'one' },
];

/**
 * {@link FLOW_REGION_SLOTS} indexed by container type — the lookup a walk does
 * per node.
 *
 * A `Map` rather than an object literal on purpose: `node.type` is
 * author-controlled and an open namespace (ADR-0018 removed the enum gate), so
 * an object lookup would resolve `'constructor'` / `'__proto__'` through
 * `Object`'s prototype chain and hand a walk something that is not a slot list.
 */
export const FLOW_REGION_SLOTS_BY_TYPE: ReadonlyMap<string, readonly FlowRegionSlotDecl[]> =
  new Map(
    [...new Set(FLOW_REGION_SLOTS.map(s => s.nodeType))].map(nodeType => [
      nodeType,
      FLOW_REGION_SLOTS.filter(s => s.nodeType === nodeType),
    ]),
  );

/**
 * Every `config` key that may hold a region, across all container types.
 *
 * For the walks that need the flat key set rather than the per-type lookup —
 * chiefly "give me this container's config *without* its regions", the view a
 * rule scanning config recursively must read or it reports every descendant's
 * finding a second time against the container that physically contains it.
 */
export const FLOW_REGION_CONFIG_KEYS: ReadonlySet<string> = new Set(
  FLOW_REGION_SLOTS.map(s => s.key),
);
