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
 *
 * ## Unknown keys are rejected (#4001 / ADR-0078)
 *
 * Every shape below is `strictObject`. Before that they were plain `z.object`,
 * so zod's default `.strip` applied and a key this file does not declare was
 * **discarded in silence** — the container still parsed, still registered, and
 * still ran, with the author's configuration simply absent. On these five
 * shapes that silence is unusually expensive, because each one carries
 * *control* rather than data: a swallowed `maxIterations` is an uncapped loop,
 * a swallowed branch key is a branch that runs without what it was given.
 *
 * ### How this relates to {@link validateControlFlow}
 *
 * `validateControlFlow` is a **sibling guard, not a key gate** — it answers
 * "is this region single-entry / single-exit / acyclic", which no amount of
 * key strictness can answer. The two do not overlap and cannot fight: the
 * schema rejects undeclared KEYS, the analysis rejects malformed STRUCTURE.
 * They do now meet at one seam, deliberately — `validateControlFlow`
 * `safeParse`s each region slot before analyzing it, so from #4001 that parse
 * is also where a region's undeclared key surfaces, reported as
 * `<where>: invalid region — <the strictObject message>`. Nothing was
 * duplicated and nothing was removed; the structural prose this guard exists
 * for is untouched, and it simply stopped silently repairing its own input.
 */

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { FlowNodeSchema, FlowEdgeSchema } from './flow.zod';
import type { FlowNodeParsed, FlowEdgeParsed } from './flow.zod';
import { FLOW_REGION_SLOTS_BY_TYPE } from './region-slots';

/**
 * Shared history sentence for the five shapes in this file — one silence, one
 * description of it, so the five rejections cannot drift apart.
 */
const CONTROL_FLOW_STRIP_HISTORY =
  'Until this shape was closed, an undeclared key here was dropped silently — the container still parsed, registered and ran, with the author\'s configuration simply absent.';

/**
 * ADR-0031 §Decision 2, stated once per spelling a BPMN-trained author reaches
 * for on a `parallel` block.
 *
 * Two entries rather than one shared string, because `guidance` prescriptions
 * are emitted **verbatim, one bullet per rejected key** — writing a flow with
 * both spellings would otherwise print the identical paragraph twice, which
 * reads as a bug in the error rather than as an answer. Each spelling gets the
 * half of the decision that actually addresses it.
 */
const IMPLICIT_JOIN_PRESCRIPTIONS = {
  join:
    'A `parallel` block joins IMPLICITLY: it continues once, when every branch has completed (ADR-0031 §Decision 2). There is no join to configure and no arrival count to get wrong — that is the point of the construct, so the key has no replacement.',
  joinGateway:
    '`join_gateway` is a BPMN **interop** node type, not a `parallel` config key. ADR-0031 §Decision 5 keeps the BPMN gateways for import/export and §Decision 2 folds an imported `parallel_gateway`/`join_gateway` pair INTO this block — so by the time you are writing `parallel`, the join has already been absorbed.',
} as const;

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
export const FlowRegionSchema = lazySchema(() => strictObject(
  {
    surface: 'this control-flow region',
    history: CONTROL_FLOW_STRIP_HISTORY,
    guidance: {
      // Both entries are wrong-LAYER pointers, not renames: a region has no
      // name of any spelling, so suggesting one would send the author to a key
      // this schema cannot accept.
      name: 'A region is not named. Only a `parallel` branch carries a `name` (`config.branches[].name`) — a `loop` body, a `try` region and a `catch` region are identified by the container that holds them.',
      label: 'A region is not labelled. `label` is required on every NODE inside `nodes[]`, which is where you are seeing it; the region itself is identified by its container slot.',
    },
  },
  {
    /** Body nodes (must not include `start`/`end` trigger sentinels). */
    nodes: z.array(z.lazy(() => FlowNodeSchema)).min(1).describe('Region body nodes (single-entry/single-exit sub-graph)'),
    /** Body edges connecting the region nodes. */
    edges: z.array(z.lazy(() => FlowEdgeSchema)).default([]).describe('Region body edges'),
  },
));

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
export const LoopConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'this loop container config',
    history: CONTROL_FLOW_STRIP_HISTORY,
    // `itemVariable` is here to OVERRULE the edit-distance fallback, which was
    // measured getting it wrong: `itemVariable` is 4 edits from
    // `indexVariable` and further from `iteratorVariable`, so the bare
    // suggester answers "did you mean `indexVariable`?" — pointing an author
    // who wants the ITEM at the key that binds the INDEX. Following it yields
    // a loop whose variable holds a number, silently, which is the failure
    // this campaign exists to remove, produced by the campaign's own helper
    // (the `pii` → `min` shape from batch 6b, and finding 7's "never signpost
    // the way into the failure mode"). An alias entry wins over edit distance,
    // so naming it is the whole fix.
    aliases: { itemVariable: 'iteratorVariable' },
    guidance: {
      // `map` is `loop`'s nearest neighbour — the two share `collection`,
      // `iteratorVariable` and `indexVariable`, and `flowName` is the key that
      // DEFINES map (required there). An author moving between them borrows it.
      // A pointer, not a rename: `loop` has no subflow key to rename it to.
      flowName: '`flowName` belongs to the `map` node, which runs a separate subflow per item (ADR-0037). A `loop` runs an INLINE `body` region in the enclosing variable scope — put the per-item steps in `config.body`, or change the node `type` to `map` if you meant the subflow form.',
    },
  },
  {
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
  },
));

export type LoopConfig = z.input<typeof LoopConfigSchema>;
export type LoopConfigParsed = z.infer<typeof LoopConfigSchema>;

// ─── Parallel block ──────────────────────────────────────────────────

/** One named branch of a {@link ParallelConfigSchema} parallel block. */
export const ParallelBranchSchema = lazySchema(() => strictObject(
  {
    surface: 'this parallel branch',
    history: CONTROL_FLOW_STRIP_HISTORY,
    // `label` is not a typo of `name` — no edit distance connects them. It is
    // the word this protocol uses for a human-readable name EVERYWHERE ELSE in
    // the same object literal: `FlowNodeSchema.label` is REQUIRED on every
    // element of the `nodes[]` array sitting right beside this key. A branch is
    // the one shape here that spells it `name`, so borrowing `label` is a
    // reasonable author's guess, and the `visibleWhen → visible` category
    // `aliases` exists for.
    aliases: { label: 'name' },
  },
  {
    /** Optional human label for the branch (designer + logs). */
    name: z.string().optional().describe('Branch label'),
    nodes: z.array(z.lazy(() => FlowNodeSchema)).min(1).describe('Branch body nodes'),
    edges: z.array(z.lazy(() => FlowEdgeSchema)).default([]).describe('Branch body edges'),
  },
));

export type ParallelBranch = z.input<typeof ParallelBranchSchema>;
/** Post-parse shape of {@link ParallelBranch} — defaults applied, transforms run (ADR-0122). */
export type ParallelBranchParsed = z.infer<typeof ParallelBranchSchema>;

/**
 * `parallel` block config — N branch regions that run concurrently and **join
 * implicitly at block end** (the engine continues once when all branches
 * complete). There is no author-visible split/join gateway to mis-wire. The
 * branches run in the enclosing variable scope.
 */
export const ParallelConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'this parallel block config',
    history: CONTROL_FLOW_STRIP_HISTORY,
    guidance: IMPLICIT_JOIN_PRESCRIPTIONS,
  },
  {
    branches: z.array(ParallelBranchSchema).min(2)
      .describe('Branch regions executed concurrently; implicit join at block end'),
  },
));

export type ParallelConfig = z.input<typeof ParallelConfigSchema>;
export type ParallelConfigParsed = z.infer<typeof ParallelConfigSchema>;

// ─── Try / catch / retry ─────────────────────────────────────────────

/**
 * Structured retry policy — surfaces the engine's existing exponential-backoff
 * retry (`FlowSchema.errorHandling`) as a per-construct policy.
 *
 * The declaration moved to `shared/retry-policy.zod.ts` in 17.0.0 (#4661): the
 * identically-named `system/job.zod.ts` shape was the same concept under a
 * different spelling, so `@objectstack/spec/automation` and
 * `@objectstack/spec/system` handed out two different `RetryPolicy` types for
 * one idea (the #4411 trap). One declaration now serves both entries. For THIS
 * entry the visible change is the base delay: `retryDelayMs` → `backoffMs`
 * (tombstoned, with a conversion), plus `maxRetries`/`backoffMultiplier`
 * defaults that are unchanged here — 0 and 1 were already the automation values.
 *
 * Re-exported so `./automation` keeps publishing the name (and its
 * `automation/RetryPolicy` JSON-Schema def, which is keyed by entry namespace).
 */
export { RetryPolicySchema, type RetryPolicy, type RetryPolicyParsed } from '../shared/retry-policy.zod';
import { RetryPolicySchema } from '../shared/retry-policy.zod';

/**
 * `try_catch` config — structured error handling. The `try` region runs; if it
 * throws, the `catch` region runs (with the caught error bound to
 * `errorVariable`). `retry`, when present, re-runs the `try` region with
 * exponential backoff before falling through to `catch`. This is the low-code
 * native error model — the same `fault` + retry semantics already in the engine,
 * surfaced as a construct rather than BPMN boundary events (ADR-0031 §Decision 3).
 */
export const TryCatchConfigSchema = lazySchema(() => strictObject(
  {
    surface: 'this try/catch config',
    history: CONTROL_FLOW_STRIP_HISTORY,
    guidance: {
      // The strongest prior any author brings to a construct named
      // `try_catch`: every mainstream language pairs it with `finally`. This
      // one deliberately does not, and the answer is a real place to put the
      // steps — not "that key does not exist".
      finally: 'There is no `finally` region. The `try_catch` node\'s ORDINARY out-edges are the continuation and run whichever way the protected region went (ADR-0031 §Decision 3 surfaces the engine\'s existing `fault` edge, not BPMN boundary events) — put the always-run steps in the nodes AFTER this container.',
    },
  },
  {
    try: FlowRegionSchema.describe('Protected region'),
    catch: FlowRegionSchema.optional().describe('Handler region run when the try region fails'),
    /** Variable the caught error is bound to inside the catch region. */
    errorVariable: z.string().default('$error').describe('Variable holding the caught error in the catch region'),
    retry: RetryPolicySchema.optional().describe('Optional retry policy for the try region'),
  },
));

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
 * Resolve one node's region slots against the shared declaration
 * ({@link FLOW_REGION_SLOTS_BY_TYPE}, #4401) — binding each declared slot to
 * the value it holds, the Zod schema that value parses as, and a diagnostic
 * label.
 *
 * The three readers in this module use it ({@link validateControlFlow},
 * {@link parseFlowNodeRegions}, {@link collectFlowGraphs}). WHERE the
 * slots are is no longer stated here — that moved to `region-slots.ts` so the
 * conversion walk and the lint walk read the same list. What stays here is the
 * schema half, which is this module's business.
 *
 * Emits a slot for a declared key even when its value is not region-shaped —
 * `validateControlFlow` needs to reject that, not skip it.
 */
function regionSlotsOf(node: FlowNodeParsed): RegionSlot[] {
  const cfg = node.config as Record<string, unknown> | undefined;
  if (!cfg) return [];
  const declared = FLOW_REGION_SLOTS_BY_TYPE.get(node.type);
  if (!declared) return [];

  const slots: RegionSlot[] = [];
  for (const { key, arity } of declared) {
    const value = cfg[key];
    if (arity === 'many') {
      if (!Array.isArray(value)) continue;
      value.forEach((raw, index) => slots.push({
        raw,
        key,
        index,
        label: `${node.type} '${node.id}' ${singularize(key)} ${index}`,
        // A branch also carries an optional `name`. Picking the branch schema
        // here used to be a fidelity choice — the region schema would have
        // STRIPPED `name`, losing it. Since #4001 both schemas are strict, so
        // it is a correctness choice: the region schema would REJECT a legal
        // branch outright. Same line, higher stakes.
        schema: ParallelBranchSchema,
      }));
      continue;
    }
    if (value == null) continue;
    slots.push({ raw: value, key, label: `${node.type} '${node.id}' ${key}`, schema: FlowRegionSchema });
  }
  return slots;
}

/** `branches` → `branch`, for the per-item label of a `many` slot. */
function singularize(key: string): string {
  return key.endsWith('es') ? key.slice(0, -2) : key.replace(/s$/, '');
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
 * `loop` bodies, `parallel` branches, and `try_catch` try/catch regions —
 * **at every depth** (#4389), so a container nested inside another container's
 * region is checked too. Only validates the *nested structure* when present, so
 * legacy flat-graph `loop` nodes (no `config.body`) are untouched — the
 * constructs are additive.
 *
 * The recursion is not extra strictness looking for work: a malformed nested
 * region already failed, just later and worse. `runRegion` calls
 * `findRegionEntry`, which throws mid-run — after the enclosing container has
 * begun iterating and its side effects have landed. Refusing it at
 * `registerFlow` is what ADR-0031's "reject the malformed before it can run"
 * asks for, and it cannot break a flow that works today: everything newly
 * rejected here was already guaranteed to throw on execution.
 *
 * Intended to be called from `registerFlow()` after DAG cycle detection. Region
 * bodies are cycle-checked here rather than by `detectCycles` — `analyzeRegion`
 * carries its own DAG pass — so this recursion is also what closes cycle
 * detection over nested regions.
 */
export function validateControlFlow(flow: { nodes: FlowNodeParsed[] }): void {
  for (const graph of collectFlowGraphs(flow)) {
    for (const node of graph.nodes) {
      const cfg = node.config as Record<string, unknown> | undefined;
      if (!cfg) continue;
      if (node.type === PARALLEL_NODE_TYPE && Array.isArray(cfg.branches) && cfg.branches.length < 2) {
        throw new Error(`parallel '${node.id}': a parallel block needs at least 2 branches`);
      }
      for (const slot of regionSlotsOf(node)) {
        const where = graph.scope ? `${graph.scope} → ${slot.label}` : slot.label;
        const parsed = slot.schema.safeParse(slot.raw);
        if (!parsed.success) {
          throw new Error(
            `${where}: invalid region — ${parsed.error.issues.map(i => i.message).join('; ')}`,
          );
        }
        // Both region schemas produce `{ nodes, edges }` (a parallel branch adds
        // `name` — a superset); `z.ZodTypeAny` just cannot say so.
        const analysis = analyzeRegion(parsed.data as { nodes: FlowNodeParsed[]; edges?: FlowEdgeParsed[] });
        if (analysis.errors.length > 0) {
          throw new Error(`${where}: ${analysis.errors.join('; ')}`);
        }
      }
    }
  }
}


// ─── Region parsing (the FlowNodeSchema transform) ───────────────────

/**
 * Re-entrancy depth of {@link parseFlowNodeRegions}.
 *
 * A module-level counter rather than a parameter, because the recursion is no
 * longer ours to thread: `FlowRegionSchema.nodes` is `z.array(FlowNodeSchema)`,
 * so the descent happens *inside Zod*, which has nowhere to carry a depth. Safe
 * as shared state because Zod parsing is synchronous — the whole tree unwinds on
 * one stack, and the `finally` below restores the counter on the error path too.
 *
 * Without it a flow assembled as hand-built objects (not parsed JSON) could hold
 * a self-reference and recurse until the stack blows, at the load seam. The
 * post-parse pass this replaced guarded the same hazard with an explicit `depth`
 * argument; the ceiling is unchanged.
 */
let regionParseDepth = 0;

/**
 * Parse every ADR-0031 region a node's `config` holds — the body of
 * {@link FlowNodeSchema}'s `.transform()` (#4415).
 *
 * `FlowNodeSchema.config` is a deliberately open `z.record` (ADR-0018), so
 * nothing about a container's nested sub-graph is described by the node's own
 * shape. This resolves each declared slot against {@link FLOW_REGION_SLOTS_BY_TYPE}
 * and runs its value through the schema that slot's value IS — `FlowRegionSchema`
 * for `loop.config.body` / `try_catch.config.try` / `.catch`,
 * `ParallelBranchSchema` for each `parallel.config.branches[]`.
 *
 * Nesting needs no recursion here: those schemas hold `z.array(FlowNodeSchema)`,
 * so a region's own nodes come back through this transform on the way down. That
 * is the whole reason this reads shorter than the pass it replaced.
 *
 * **A value that does not parse is returned untouched.** Rejecting a malformed
 * region is {@link validateControlFlow}'s job (and, at run time, the container
 * executor's `parseNodeConfig`): a transform that threw here would change *which*
 * flows parse at all, moving a structural diagnostic out of the validator that
 * owns its message and into a Zod issue on `config`. Copy-on-write — a node with
 * no region comes back by identity.
 */
export function parseFlowNodeRegions<T extends { type: string; config?: unknown }>(node: T): T {
  const cfg = node.config as Record<string, unknown> | undefined;
  if (!cfg) return node;
  if (regionParseDepth >= MAX_REGION_DEPTH) return node;

  regionParseDepth++;
  try {
    let next = cfg;
    for (const slot of regionSlotsOf(node as unknown as FlowNodeParsed)) {
      if (!isRegionDict(slot.raw)) continue;
      const parsed = slot.schema.safeParse(slot.raw);
      if (!parsed.success) continue;
      if (slot.index === undefined) {
        next = { ...next, [slot.key]: parsed.data };
      } else {
        const branches = [...(next[slot.key] as unknown[])];
        branches[slot.index] = parsed.data;
        next = { ...next, [slot.key]: branches };
      }
    }
    return next === cfg ? node : { ...node, config: next };
  } finally {
    regionParseDepth--;
  }
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
