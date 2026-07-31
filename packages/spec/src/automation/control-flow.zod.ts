// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module automation/control-flow
 *
 * Structured control-flow constructs (ADR-0031) — the **native + AI-authored**
 * flow model: a `loop` **container**, a `parallel` **block**, and structured
 * `try/catch/retry`. Unlike BPMN's gateway/boundary/token graph (kept in the
 * protocol for *interop* only), these constructs are **well-formed by
 * construction**, locally composable, and statically analyzable — the right
 * substrate for LLM authoring (ADR-0010/0011).
 *
 * ## Representation — decision: **(B) nested sub-structure**
 *
 * ADR-0031 flagged two ways to carry structured containers in the flat
 * `nodes[]`+`edges[]` model:
 *
 *  - **(A)** marker-delimited scoped regions (a container node + a scope-end
 *    marker; the body is the edges *between* them in the main graph), or
 *  - **(B)** the container node carries a **nested mini-flow** in its `config`.
 *
 * We adopt **(B)**. Each container holds its body as a self-contained
 * {@link FlowRegionSchema} (`config.body` for `loop`, `config.branches[]` for
 * `parallel`, `config.try`/`config.catch` for `try_catch`). The reasons:
 *
 *  1. **Well-formed by construction** — a nested region is its *own* graph, so
 *     single-entry is intrinsic; there are no scope markers to balance and no
 *     way to "leak" an edge across a boundary. Validation is local.
 *  2. **The shared engine traversal stays untouched** — the container executor
 *     runs its own body via a scoped helper; the main DAG `traverseNext` never
 *     learns about scope markers (important under the multi-agent discipline
 *     around `engine.ts`). The container's *ordinary* out-edges remain the
 *     "after-loop / after-block" continuation.
 *  3. **Cleaner AST for AI** — ADR-0031 calls (B) "the cleaner long-term AST,"
 *     and AI authoring is the design center.
 *
 * Existing flat-graph loops (a `loop` node with no `config.body`) keep their
 * legacy behavior — the constructs are **additive**, activated only when the
 * nested structure is present.
 *
 * The canonical construct type ids are {@link LOOP_NODE_TYPE} (`loop`,
 * pre-existing), {@link PARALLEL_NODE_TYPE} (`parallel`), and
 * {@link TRY_CATCH_NODE_TYPE} (`try_catch`). These are distinct from the BPMN
 * interop node types (`parallel_gateway` / `join_gateway` / `boundary_event`),
 * which remain author-invisible interchange representations.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { FlowNodeSchema, FlowEdgeSchema } from './flow.zod';
import type { FlowNodeParsed, FlowEdgeParsed } from './flow.zod';

// ─── Canonical construct type ids ────────────────────────────────────

/** The structured iteration container (pre-existing built-in id). */
export const LOOP_NODE_TYPE = 'loop' as const;
/** The structured parallel block (implicit join at block end). */
export const PARALLEL_NODE_TYPE = 'parallel' as const;
/** The structured try/catch/retry construct. */
export const TRY_CATCH_NODE_TYPE = 'try_catch' as const;

/**
 * Hard ceiling on loop iterations — the engine refuses to iterate beyond this
 * regardless of `maxIterations`, so a runaway collection can never spin the
 * runtime. ADR-0031 §Decision 1 ("a **hard max-iteration guard**").
 */
export const LOOP_MAX_ITERATIONS_CEILING = 100_000;

// ─── Region — a nested single-entry/single-exit sub-graph ────────────

/**
 * A **region** is a self-contained sub-graph (nodes + edges) executed as the
 * body of a container. It must be **single-entry / single-exit** and acyclic —
 * exactly the well-formedness {@link analyzeRegion} enforces. Region nodes
 * execute in the **enclosing variable scope** (the iterator variable and any
 * body mutations are visible to the surrounding flow), so a region is *not* a
 * separate `subflow` invocation.
 */
export const FlowRegionSchema = lazySchema(() => z.object({
  /** Body nodes (must not include `start`/`end` trigger sentinels). */
  nodes: z.array(FlowNodeSchema).min(1).describe('Region body nodes (single-entry/single-exit sub-graph)'),
  /** Body edges connecting the region nodes. */
  edges: z.array(FlowEdgeSchema).default([]).describe('Region body edges'),
}));

export type FlowRegion = z.input<typeof FlowRegionSchema>;
export type FlowRegionParsed = z.infer<typeof FlowRegionSchema>;

// ─── Loop container ──────────────────────────────────────────────────

/**
 * `loop` container config — bounded iteration over a collection. The `body`
 * region runs once per item in the enclosing variable scope, with the current
 * item bound to `iteratorVariable` (and the zero-based index to `indexVariable`,
 * when given). Iteration is hard-capped by `maxIterations` (clamped to
 * {@link LOOP_MAX_ITERATIONS_CEILING}) so termination stays analyzable.
 *
 * `body` is **optional** for back-compat: a `loop` node with no `body` keeps the
 * legacy flat-graph behavior (the constructs are additive).
 */
export const LoopConfigSchema = lazySchema(() => z.object({
  /**
   * The collection to iterate. A `{token}` template or bare variable name that
   * resolves (at run time) to an array in the flow's variable scope, or an
   * inline array — the same union `map.collection` declares, because the two
   * executors share the resolve logic (#4277 aligned this contract with what
   * the executor has always read; the string-only declaration under-declared).
   */
  // `xExpression: 'template'` marks the string form as an `interpolate()`
  // `{var}` template (not bare CEL), so the flow designer renders a `{var}`
  // picker + mono editor and skips the CEL brace-trap (objectui #2670 Phase 3).
  // Flows through `z.toJSONSchema` verbatim, same channel as `xRef` /
  // `xEnumDeprecated`. The shipped `loop` descriptor carries the same marker on
  // its hand-written configSchema literal (service-automation/builtin/loop-node.ts).
  collection: z.union([z.string().min(1), z.array(z.unknown())]).meta({
    description: 'Template/variable resolving to the array to iterate (an inline array is accepted)',
    xExpression: 'template',
  }),
  /** Variable name the current item is bound to inside the body. */
  iteratorVariable: z.string().min(1).default('item').describe('Loop variable holding the current item'),
  /** Optional variable name the zero-based index is bound to inside the body. */
  indexVariable: z.string().optional().describe('Optional loop variable holding the current index'),
  /**
   * Maximum iterations to run — a guard against runaway collections. Clamped to
   * {@link LOOP_MAX_ITERATIONS_CEILING}; a collection longer than this fails the
   * node rather than truncating silently.
   */
  maxIterations: z.number().int().min(1).max(LOOP_MAX_ITERATIONS_CEILING).optional()
    .describe('Hard cap on iterations (clamped to the engine ceiling)'),
  /** The body region executed once per item (single-entry/single-exit). */
  body: FlowRegionSchema.optional().describe('Loop body region (omit for legacy flat-graph loops)'),
}));

export type LoopConfig = z.input<typeof LoopConfigSchema>;
export type LoopConfigParsed = z.infer<typeof LoopConfigSchema>;

// ─── Parallel block ──────────────────────────────────────────────────

/** One named branch of a {@link ParallelConfigSchema} parallel block. */
export const ParallelBranchSchema = lazySchema(() => z.object({
  /** Optional human label for the branch (designer + logs). */
  name: z.string().optional().describe('Branch label'),
  nodes: z.array(FlowNodeSchema).min(1).describe('Branch body nodes'),
  edges: z.array(FlowEdgeSchema).default([]).describe('Branch body edges'),
}));

export type ParallelBranch = z.input<typeof ParallelBranchSchema>;

/**
 * `parallel` block config — N branch regions that run concurrently and **join
 * implicitly at block end** (the engine continues once when all branches
 * complete). There is no author-visible split/join gateway to mis-wire. The
 * branches run in the enclosing variable scope.
 */
export const ParallelConfigSchema = lazySchema(() => z.object({
  branches: z.array(ParallelBranchSchema).min(2)
    .describe('Branch regions executed concurrently; implicit join at block end'),
}));

export type ParallelConfig = z.input<typeof ParallelConfigSchema>;
export type ParallelConfigParsed = z.infer<typeof ParallelConfigSchema>;

// ─── Try / catch / retry ─────────────────────────────────────────────

/**
 * Structured retry policy — surfaces the engine's existing exponential-backoff
 * retry (`FlowSchema.errorHandling`) as a per-construct policy. Mirrors that
 * shape so the engine can reuse one backoff implementation.
 */
export const RetryPolicySchema = lazySchema(() => z.object({
  maxRetries: z.number().int().min(0).max(10).default(0).describe('Retry attempts before giving up'),
  retryDelayMs: z.number().int().min(0).default(1000).describe('Base delay between retries (ms)'),
  backoffMultiplier: z.number().min(1).default(1).describe('Exponential backoff multiplier'),
  maxRetryDelayMs: z.number().int().min(0).default(30000).describe('Maximum delay between retries (ms)'),
  jitter: z.boolean().default(false).describe('Add random jitter to retry delay'),
}));

export type RetryPolicy = z.input<typeof RetryPolicySchema>;

/**
 * `try_catch` config — structured error handling. The `try` region runs; if it
 * throws, the `catch` region runs (with the caught error bound to
 * `errorVariable`). `retry`, when present, re-runs the `try` region with
 * exponential backoff before falling through to `catch`. This is the low-code
 * native error model — the same `fault` + retry semantics already in the engine,
 * surfaced as a construct rather than BPMN boundary events (ADR-0031 §Decision 3).
 */
export const TryCatchConfigSchema = lazySchema(() => z.object({
  try: FlowRegionSchema.describe('Protected region'),
  catch: FlowRegionSchema.optional().describe('Handler region run when the try region fails'),
  /** Variable the caught error is bound to inside the catch region. */
  errorVariable: z.string().default('$error').describe('Variable holding the caught error in the catch region'),
  retry: RetryPolicySchema.optional().describe('Optional retry policy for the try region'),
}));

export type TryCatchConfig = z.input<typeof TryCatchConfigSchema>;
export type TryCatchConfigParsed = z.infer<typeof TryCatchConfigSchema>;

// ─── Well-formedness analysis ────────────────────────────────────────

/** The result of analyzing a region for structural well-formedness. */
export interface RegionAnalysis {
  /** The single entry node id (node with no in-edges), if well-formed. */
  entryId?: string;
  /** The single exit node id (node with no out-edges), if well-formed. */
  exitId?: string;
  /** Well-formedness problems; empty when the region is valid. */
  errors: string[];
}

/**
 * Analyze a region's structural well-formedness (ADR-0031 §Sequencing 1):
 *
 *  - every edge references nodes that exist in the region,
 *  - node ids are unique,
 *  - exactly **one entry** (a node with no incoming edge) — execution needs a
 *    unique place to start,
 *  - exactly **one exit** (a node with no outgoing edge),
 *  - the region is **acyclic** (loops/iteration are the *container's* job; a
 *    region body is a plain DAG).
 *
 * Returns the entry/exit ids and a list of problems. A malformed region is
 * rejected at `registerFlow()` so the broken flow never runs.
 */
export function analyzeRegion(region: { nodes: FlowNodeParsed[]; edges?: FlowEdgeParsed[] }): RegionAnalysis {
  const errors: string[] = [];
  const nodes = region.nodes ?? [];
  const edges = region.edges ?? [];

  if (nodes.length === 0) {
    return { errors: ['region has no nodes'] };
  }

  // Unique ids.
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) errors.push(`duplicate node id '${n.id}'`);
    ids.add(n.id);
  }

  // Edge integrity + in/out degree.
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (!ids.has(e.source)) errors.push(`edge '${e.id}' source '${e.source}' is not a region node`);
    if (!ids.has(e.target)) errors.push(`edge '${e.id}' target '${e.target}' is not a region node`);
    if (ids.has(e.source) && ids.has(e.target)) {
      hasOutgoing.add(e.source);
      hasIncoming.add(e.target);
      adj.get(e.source)!.push(e.target);
    }
  }

  const entries = [...ids].filter(id => !hasIncoming.has(id));
  const exits = [...ids].filter(id => !hasOutgoing.has(id));

  if (entries.length === 0) errors.push('region has no entry node (every node has an incoming edge — cyclic?)');
  else if (entries.length > 1) errors.push(`region must be single-entry but has ${entries.length}: ${entries.join(', ')}`);

  if (exits.length === 0) errors.push('region has no exit node (every node has an outgoing edge — cyclic?)');
  else if (exits.length > 1) errors.push(`region must be single-exit but has ${exits.length}: ${exits.join(', ')}`);

  // Acyclicity (DFS coloring) — a region body must be a DAG.
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);
  let cyclic = false;
  const dfs = (id: string): void => {
    color.set(id, GRAY);
    for (const next of adj.get(id) ?? []) {
      if (color.get(next) === GRAY) { cyclic = true; return; }
      if (color.get(next) === WHITE) { dfs(next); if (cyclic) return; }
    }
    color.set(id, BLACK);
  };
  for (const id of ids) {
    if (color.get(id) === WHITE) { dfs(id); if (cyclic) break; }
  }
  if (cyclic) errors.push('region contains a cycle (region bodies must be acyclic)');

  return {
    entryId: entries.length === 1 ? entries[0] : undefined,
    exitId: exits.length === 1 ? exits[0] : undefined,
    errors,
  };
}

/**
 * The single entry node id of a region, or throw if the region is not
 * well-formed. Used by the engine's loop/parallel executors to know where to
 * begin executing a body region.
 */
export function findRegionEntry(region: { nodes: FlowNodeParsed[]; edges?: FlowEdgeParsed[] }): string {
  const analysis = analyzeRegion(region);
  if (!analysis.entryId) {
    throw new Error(`malformed control-flow region: ${analysis.errors.join('; ')}`);
  }
  return analysis.entryId;
}

// ─── Where the containers keep their regions ─────────────────────────

/** A dict — region-shaped enough to reach its `nodes` / `edges`. */
function isRegionDict(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** One region slot found on a node: its raw value, its `config` key, and a label. */
interface RegionSlot {
  /** The raw value at `config[key]` — region-shaped or not; callers check. */
  readonly raw: unknown;
  /** Replace this `config` key to write a normalized region back. */
  readonly key: string;
  /** Index within `key`, for the array-valued slot (`parallel.branches`). */
  readonly index?: number;
  /** Diagnostic label, e.g. `loop 'sweep' body` / `parallel 'fan' branch 0`. */
  readonly label: string;
  /** The schema this slot's value parses as. */
  readonly schema: z.ZodTypeAny;
}

/**
 * The region slots one node carries — the single place that knows where each
 * ADR-0031 container keeps its nested graph(s). Three passes read it
 * ({@link validateControlFlow}, {@link normalizeControlFlowRegions},
 * {@link collectFlowGraphs}), which is exactly why it is one function: a fourth
 * container construct is added here once, not in three walks that drift.
 *
 * Emits a slot for a declared key even when its value is not region-shaped —
 * `validateControlFlow` needs to reject that, not skip it.
 */
function regionSlotsOf(node: FlowNodeParsed): RegionSlot[] {
  const cfg = node.config as Record<string, unknown> | undefined;
  if (!cfg) return [];

  if (node.type === LOOP_NODE_TYPE) {
    return cfg.body == null
      ? []
      : [{ raw: cfg.body, key: 'body', label: `loop '${node.id}' body`, schema: FlowRegionSchema }];
  }
  if (node.type === PARALLEL_NODE_TYPE && Array.isArray(cfg.branches)) {
    return cfg.branches.map((raw, index) => ({
      raw,
      key: 'branches',
      index,
      label: `parallel '${node.id}' branch ${index}`,
      // A branch also carries an optional `name`, which the plain region schema
      // (a non-strict `z.object`) would strip.
      schema: ParallelBranchSchema,
    }));
  }
  if (node.type === TRY_CATCH_NODE_TYPE) {
    const slots: RegionSlot[] = [];
    if (cfg.try != null) {
      slots.push({ raw: cfg.try, key: 'try', label: `try_catch '${node.id}' try`, schema: FlowRegionSchema });
    }
    if (cfg.catch != null) {
      slots.push({ raw: cfg.catch, key: 'catch', label: `try_catch '${node.id}' catch`, schema: FlowRegionSchema });
    }
    return slots;
  }
  return [];
}

/**
 * Depth ceiling for the recursive region walks below. Regions nest (a `loop`
 * inside a `try_catch` inside a `loop`) but not deeply, and a flow arriving as
 * hand-built objects rather than parsed JSON could carry a self-reference —
 * which would otherwise be an unbounded recursion at the load seam.
 */
const MAX_REGION_DEPTH = 32;

/**
 * Validate every structured control-flow construct in a flow, throwing on the
 * first malformed region (ADR-0031 — "reject the malformed before run"). Covers
 * `loop` bodies, `parallel` branches, and `try_catch` try/catch regions. Only
 * validates the *nested structure* when present, so legacy flat-graph `loop`
 * nodes (no `config.body`) are untouched — the constructs are additive.
 *
 * Intended to be called from `registerFlow()` after DAG cycle detection.
 */
export function validateControlFlow(flow: { nodes: FlowNodeParsed[] }): void {
  for (const node of flow.nodes) {
    const cfg = node.config as Record<string, unknown> | undefined;
    if (!cfg) continue;
    if (node.type === PARALLEL_NODE_TYPE && Array.isArray(cfg.branches) && cfg.branches.length < 2) {
      throw new Error(`parallel '${node.id}': a parallel block needs at least 2 branches`);
    }
    for (const slot of regionSlotsOf(node)) {
      const parsed = slot.schema.safeParse(slot.raw);
      if (!parsed.success) {
        throw new Error(
          `${slot.label}: invalid region — ${parsed.error.issues.map(i => i.message).join('; ')}`,
        );
      }
      // Both region schemas produce `{ nodes, edges }` (a parallel branch adds
      // `name` — a superset); `z.ZodTypeAny` just cannot say so.
      const analysis = analyzeRegion(parsed.data as { nodes: FlowNodeParsed[]; edges?: FlowEdgeParsed[] });
      if (analysis.errors.length > 0) {
        throw new Error(`${slot.label}: ${analysis.errors.join('; ')}`);
      }
    }
  }
}

// ─── Region normalization ────────────────────────────────────────────

/**
 * Parse ONE region value through its own schema, then recurse into the
 * containers its nodes carry.
 *
 * A value that does not parse is returned untouched: rejecting a malformed
 * region is {@link validateControlFlow}'s job (and, at run time, the container
 * executor's `parseNodeConfig`). A normalization pass that also threw would
 * change *which* flows register, which is not what it is for.
 */
function normalizeRegion(slot: RegionSlot, depth: number): unknown {
  if (!isRegionDict(slot.raw)) return slot.raw;
  const parsed = slot.schema.safeParse(slot.raw);
  if (!parsed.success) return slot.raw;
  const region = parsed.data as { nodes?: FlowNodeParsed[] };
  if (!Array.isArray(region.nodes)) return region;
  return { ...region, nodes: region.nodes.map(n => normalizeNodeRegions(n, depth + 1)) };
}

/** Normalize every region one node carries — recursively, since regions nest. */
function normalizeNodeRegions(node: FlowNodeParsed, depth: number): FlowNodeParsed {
  if (depth >= MAX_REGION_DEPTH) return node;
  const cfg = node.config as Record<string, unknown> | undefined;
  if (!cfg) return node;

  let next = cfg;
  for (const slot of regionSlotsOf(node)) {
    const normalized = normalizeRegion(slot, depth);
    if (normalized === slot.raw) continue;
    if (slot.index === undefined) {
      next = { ...next, [slot.key]: normalized };
    } else {
      const branches = [...(next[slot.key] as unknown[])];
      branches[slot.index] = normalized;
      next = { ...next, [slot.key]: branches };
    }
  }

  return next === cfg ? node : { ...node, config: next };
}

/**
 * Canonicalize the metadata **inside** every structured region of a flow (#4347).
 *
 * `FlowSchema.parse` normalizes a flow's own `nodes[]` / `edges[]` — most
 * visibly, `FlowEdgeSchema.condition` is `ExpressionInputSchema`, so a
 * bare-string predicate becomes the canonical `{ dialect: 'cel', source }`
 * envelope. It does not reach a region, because a region lives inside
 * `FlowNodeSchema.config`, which is deliberately `z.record(z.unknown())` — open,
 * per node type. So the *same predicate* was stored enveloped on a top-level edge
 * and left a bare string on a loop-body edge: a representation that depended on
 * where in the graph it sat, which no flow author can be expected to predict.
 *
 * This pass closes that. Each region is run through its own schema — recursively,
 * because regions nest — producing a flow whose nested edges and nodes carry the
 * same canonical shapes as its top-level ones. Copy-on-write: a flow with no
 * structured container comes back untouched.
 *
 * Call it at the load seam, after `FlowSchema.parse` and `validateControlFlow`.
 * The container executors parse their own config at run time (`parseNodeConfig`,
 * #4277), so this is not what makes a nested predicate *evaluate* correctly — it
 * is what makes the stored flow SAY so, for every reader that is not the
 * executor: the Studio designer, `getFlow`, the version history, and any
 * consumer that reads a region without re-parsing it.
 */
export function normalizeControlFlowRegions<T extends { nodes: FlowNodeParsed[] }>(flow: T): T {
  if (!Array.isArray(flow.nodes)) return flow;
  let changed = false;
  const nodes = flow.nodes.map(node => {
    const next = normalizeNodeRegions(node, 0);
    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...flow, nodes } : flow;
}

// ─── Whole-flow graph traversal ──────────────────────────────────────

/** One executable graph within a flow: the flow's own, or a nested region's. */
export interface FlowGraph {
  /**
   * Where this graph sits. Empty string for the flow's own `nodes`/`edges`;
   * otherwise the region path, e.g. `loop 'sweep' body` or
   * `loop 'sweep' body → try_catch 'guard' catch`.
   */
  readonly scope: string;
  readonly nodes: readonly FlowNodeParsed[];
  readonly edges: readonly FlowEdgeParsed[];
}

/**
 * Every graph in a flow — its own, plus each nested structured region, depth
 * first (#4347).
 *
 * A flow's nodes and edges are not all in `flow.nodes` / `flow.edges`: an
 * ADR-0031 container keeps a whole sub-graph in its `config`. A validator that
 * iterates only the top-level arrays therefore checks *part* of the flow while
 * reporting on all of it — which is how a `{record.x}` brace-trap inside a loop
 * body passed registration while the identical predicate one level out was a
 * hard error. Iterate this instead of `flow.nodes` wherever a pass means "every
 * node in this flow", and use {@link FlowGraph.scope} to say where a finding is.
 */
export function collectFlowGraphs(
  flow: { nodes?: readonly FlowNodeParsed[]; edges?: readonly FlowEdgeParsed[] },
): FlowGraph[] {
  const graphs: FlowGraph[] = [];

  const visit = (
    nodes: readonly FlowNodeParsed[],
    edges: readonly FlowEdgeParsed[],
    scope: string,
    depth: number,
  ): void => {
    graphs.push({ scope, nodes, edges });
    if (depth >= MAX_REGION_DEPTH) return;
    for (const node of nodes) {
      for (const slot of regionSlotsOf(node)) {
        if (!isRegionDict(slot.raw) || !Array.isArray(slot.raw.nodes)) continue;
        visit(
          slot.raw.nodes as FlowNodeParsed[],
          Array.isArray(slot.raw.edges) ? (slot.raw.edges as FlowEdgeParsed[]) : [],
          scope ? `${scope} → ${slot.label}` : slot.label,
          depth + 1,
        );
      }
    }
  };

  visit(flow.nodes ?? [], flow.edges ?? [], '', 0);
  return graphs;
}
