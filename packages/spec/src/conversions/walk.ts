// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Copy-on-write walkers over the collections conversions target.
 *
 * A conversion must rewrite deep-nested metadata (`flows[].nodes[]`, `pages[]`)
 * without mutating the caller's input and without cloning branches it doesn't
 * touch — `normalizeStackInput` shares array/object references from the caller's
 * definition, and an ObjectStack stack can carry non-clonable values (plugin
 * instances with methods), so a blanket `structuredClone` is both wasteful and
 * unsafe. These helpers copy **only** the path from the root down to a changed
 * leaf; if a mapper returns its input unchanged, the original references are
 * preserved all the way up.
 */

type Dict = Record<string, unknown>;

function isDict(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Where each ADR-0031 structured container carries its nested region(s) — the
 * map that makes {@link mapFlowNodes} reach a node inside a `loop` body, a
 * `parallel` branch, or a `try_catch` block (#4347).
 *
 * A region is a self-contained mini-flow (`{ nodes, edges }`) living in the
 * container's OPEN `config` record, so a pass that walked only
 * `flows[].nodes[]` saw the container and stopped there. The consequence was
 * **position-dependent metadata**: the same node converted at the top level and
 * did not one level in — a `webhook` callout inside a loop body kept its
 * protocol-11 type (no executor owns that id, so the run fails), and a
 * `delete_record` kept `config.filters`, leaving the canonical `filter` the
 * executor reads absent — the erased-condition hazard
 * `flow-node-crud-filter-alias` exists to prevent. Same flow, same
 * `registerFlow` call, different outcome by nesting depth.
 *
 * Declared here rather than imported from `automation/control-flow.zod.ts` to
 * keep this module free of schema imports (it is a pure shape walker). The ids
 * and keys are pinned to that module's `LOOP_NODE_TYPE` / `PARALLEL_NODE_TYPE` /
 * `TRY_CATCH_NODE_TYPE` and to the `LoopConfigSchema` / `ParallelConfigSchema` /
 * `TryCatchConfigSchema` shapes by a reconciliation test (`region-walk.test.ts`),
 * so a new construct cannot be added there and silently go unwalked here.
 *
 * A `Map` rather than an object literal so a node whose `type` is
 * `'constructor'` / `'__proto__'` cannot reach `Object`'s prototype chain.
 */
export const FLOW_REGION_SLOTS: ReadonlyMap<
  string,
  ReadonlyArray<{ readonly key: string; readonly many: boolean }>
> = new Map([
  ['loop', [{ key: 'body', many: false }]],
  ['parallel', [{ key: 'branches', many: true }]],
  ['try_catch', [{ key: 'try', many: false }, { key: 'catch', many: false }]],
]);

/**
 * Depth ceiling for the region recursion. Containers nest, but not deeply, and
 * a stack handed to `defineStack` is hand-built objects rather than parsed JSON
 * — so a self-referencing region is reachable, and would otherwise be an
 * unbounded recursion on the load path. Mirrors the ceiling the region walks in
 * `automation/control-flow.zod.ts` use.
 */
const MAX_REGION_DEPTH = 32;

/**
 * Immutably map every node of one structured region (`{ nodes, edges }`).
 *
 * A value that is not region-shaped passes through untouched: the `config` keys
 * above are only *conventionally* regions (`config` is an open record, and
 * `body` in particular is also an ordinary key elsewhere — an `http` node's
 * request payload), so the shape is checked, never assumed.
 */
function mapRegionNodes(
  region: unknown,
  path: string,
  mapper: (node: Dict, path: string) => Dict,
  depth: number,
): unknown {
  if (!isDict(region) || !Array.isArray(region.nodes)) return region;
  let changed = false;
  const nextNodes = region.nodes.map((node, i) => {
    if (!isDict(node)) return node;
    const mapped = mapNodeTree(node, `${path}.nodes[${i}]`, mapper, depth);
    if (mapped !== node) changed = true;
    return mapped;
  });
  return changed ? { ...region, nodes: nextNodes } : region;
}

/**
 * Map one flow node **and everything nested under it**: the node itself, then
 * the nodes of every region its `config` carries, recursively — regions nest (a
 * `loop` inside a `try_catch` inside a `loop`).
 *
 * The mapper runs on the container FIRST and the region lookup keys off the
 * *mapped* node's `type`, so a conversion that renames a container type still
 * has its body walked, under the canonical id.
 */
function mapNodeTree(
  node: Dict,
  path: string,
  mapper: (node: Dict, path: string) => Dict,
  depth: number,
): Dict {
  const mapped = mapper(node, path);
  if (depth >= MAX_REGION_DEPTH) return mapped;
  const slots = typeof mapped.type === 'string' ? FLOW_REGION_SLOTS.get(mapped.type) : undefined;
  if (!slots) return mapped;
  const config = mapped.config;
  if (!isDict(config)) return mapped;

  let nextConfig = config;
  for (const { key, many } of slots) {
    const raw = nextConfig[key];
    if (many) {
      if (!Array.isArray(raw)) continue;
      let branchesChanged = false;
      const nextBranches = raw.map((branch, i) => {
        const next = mapRegionNodes(branch, `${path}.config.${key}[${i}]`, mapper, depth + 1);
        if (next !== branch) branchesChanged = true;
        return next;
      });
      if (branchesChanged) nextConfig = { ...nextConfig, [key]: nextBranches };
    } else {
      const next = mapRegionNodes(raw, `${path}.config.${key}`, mapper, depth + 1);
      if (next !== raw) nextConfig = { ...nextConfig, [key]: next };
    }
  }

  return nextConfig === config ? mapped : { ...mapped, config: nextConfig };
}

/**
 * Immutably map every flow node in `stack.flows[].nodes[]` — **including the
 * nodes nested inside ADR-0031 structured regions** (`loop.config.body`,
 * `parallel.config.branches[]`, `try_catch.config.try`/`.catch`), to any depth.
 *
 * `mapper` receives each node dict and its path (`flows[i].nodes[j]`, or
 * `flows[i].nodes[j].config.body.nodes[k]` for a nested one) and returns either
 * the same reference (no change) or a new dict. The stack, the `flows` array, an
 * individual flow, its `nodes` array, and every container `config` on the way
 * down are each copied only when a descendant actually changed.
 */
export function mapFlowNodes(
  stack: Dict,
  mapper: (node: Dict, path: string) => Dict,
): Dict {
  const flows = stack.flows;
  if (!Array.isArray(flows)) return stack;

  let flowsChanged = false;
  const nextFlows = flows.map((flow, fi) => {
    if (!isDict(flow) || !Array.isArray(flow.nodes)) return flow;
    let nodesChanged = false;
    const nextNodes = flow.nodes.map((node, ni) => {
      if (!isDict(node)) return node;
      const mapped = mapNodeTree(node, `flows[${fi}].nodes[${ni}]`, mapper, 0);
      if (mapped !== node) nodesChanged = true;
      return mapped;
    });
    if (!nodesChanged) return flow;
    flowsChanged = true;
    return { ...flow, nodes: nextNodes };
  });

  if (!flowsChanged) return stack;
  return { ...stack, flows: nextFlows };
}

/**
 * Immutably map every page in `stack.pages[]`.
 *
 * `mapper` receives each page dict and its path (`pages[i]`) and returns the
 * same reference (no change) or a new dict. The stack and `pages` array are
 * copied only when a page actually changed.
 */
export function mapPages(stack: Dict, mapper: (page: Dict, path: string) => Dict): Dict {
  const pages = stack.pages;
  if (!Array.isArray(pages)) return stack;

  let changed = false;
  const nextPages = pages.map((page, pi) => {
    if (!isDict(page)) return page;
    const mapped = mapper(page, `pages[${pi}]`);
    if (mapped !== page) changed = true;
    return mapped;
  });

  if (!changed) return stack;
  return { ...stack, pages: nextPages };
}

/**
 * Immutably map every dict item of a top-level array collection
 * (`stack[key][]`) — the generic form of {@link mapPages}, for conversions
 * targeting `objects`, `books`, `sharingRules`, `views`, ….
 *
 * `mapper` receives each item dict and its path (`<key>[i]`) and returns the
 * same reference (no change) or a new dict. Non-array collections and
 * non-dict items pass through untouched.
 */
export function mapCollection(
  stack: Dict,
  key: string,
  mapper: (item: Dict, path: string) => Dict,
): Dict {
  const items = stack[key];
  if (!Array.isArray(items)) return stack;

  let changed = false;
  const next = items.map((item, i) => {
    if (!isDict(item)) return item;
    const mapped = mapper(item, `${key}[${i}]`);
    if (mapped !== item) changed = true;
    return mapped;
  });

  if (!changed) return stack;
  return { ...stack, [key]: next };
}

/**
 * Rename `dict[from]` → `dict[to]`, immutably, only when `from` is present
 * (non-null) and the canonical `to` is absent. Returns `null` when there is
 * nothing to do — the caller keeps the original reference.
 */
export function renameKey(dict: Dict, from: string, to: string): Dict | null {
  if (!(from in dict) || dict[from] == null) return null;
  if (dict[to] != null) return null; // canonical already wins — nothing to do
  const next: Dict = { ...dict };
  next[to] = next[from];
  delete next[from];
  return next;
}

/** Rename `config[from]` → `config[to]` on a node dict, immutably, only if `to` is absent. */
export function renameConfigKey(node: Dict, from: string, to: string): Dict | null {
  const config = node.config;
  if (!isDict(config)) return null;
  if (!(from in config) || config[from] == null) return null;
  if (config[to] != null) return null; // canonical already wins — nothing to do
  const nextConfig: Dict = { ...config };
  nextConfig[to] = nextConfig[from];
  delete nextConfig[from];
  return { ...node, config: nextConfig };
}
