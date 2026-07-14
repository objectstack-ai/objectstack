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
 * Immutably map every flow node in `stack.flows[].nodes[]`.
 *
 * `mapper` receives each node dict and its path (`flows[i].nodes[j]`) and
 * returns either the same reference (no change) or a new dict. The stack, the
 * `flows` array, an individual flow, and its `nodes` array are each copied only
 * when a descendant actually changed.
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
      const mapped = mapper(node, `flows[${fi}].nodes[${ni}]`);
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
