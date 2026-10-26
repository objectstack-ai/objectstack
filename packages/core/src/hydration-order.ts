// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D5 — the order a boot hydrates its installed packages in.
 *
 * A boot re-registers what earlier installs admitted, from two batches: the
 * `sys_packages` rows (`@objectstack/service-package`) and the install-local
 * ledger (`@objectstack/cloud-connection`, on `kernel:ready`). Each used to
 * register in whatever order its source listed — `list()` rows, `readdirSync`
 * files — and the install gate is order-sensitive: two modules hydrated before
 * the parent whose namespace they share meet the gate with that namespace
 * unreadable, and the second is refused and never recovered for the process
 * lifetime (the recorded verdict AGENTS.md's *Startup registry reads* names as
 * a defect). So both batches sort themselves by `manifest.dependencies` before
 * registering any of it.
 *
 * ## The one sorter, the one reading of the key
 *
 * The sort is `resolvePluginOrder` (ADR-0116's single topological sorter), with
 * declared ids as OPTIONAL edges — the reading
 * `resolveArtifactPackageEntries` already gives the key inside one artifact: a
 * declared id that names a package in the batch is a real edge, one that does
 * not is simply not an edge here. ⛔ No second sort.
 *
 * A node is whatever the batch registers in one act — a `sys_packages` row is
 * one package; an install-local ledger entry is an artifact that may carry
 * several — so a node lists every package id it carries, a declared id resolves
 * to the node that carries it, and an id declared between packages of one node
 * is no edge between nodes.
 *
 * ## A cycle never costs the batch
 *
 * `resolvePluginOrder` throws on a cycle, and a cycle is reachable here — two
 * authored packages whose `PATCH` edits declare each other, two marketplace
 * artifacts that declare each other. Both hydrates are per-entry ("one stale
 * package must not brick the environment"), so a sort that threw outside the
 * loop would register nothing, worse than source order. So the edges INSIDE a
 * cycle are dropped before sorting: its members keep source order among
 * themselves while still following every acyclic dependency, the acyclic rest
 * keeps its sorted order, nothing throws, and the cycle is handed back for the
 * caller to log as a refusal naming its members.
 */

import { resolvePluginOrder } from './plugin-order.js';

/** One unit a hydrate registers in one act. */
export interface HydrationNode<T> {
  /** What the caller registers. */
  item: T;
  /** The name a logged cycle uses for this node. */
  label: string;
  /** Every package id this node delivers. */
  packageIds: readonly string[];
  /** Every package id this node's packages declare in `manifest.dependencies`. */
  declaredIds: readonly string[];
}

/** {@link orderHydrationBatch}'s answer. */
export interface HydrationOrder<T> {
  /** The items, dependencies first; source order wherever no edge decides. */
  ordered: T[];
  /** Each dependency cycle found, as its members' labels in source order. Empty when there is none. */
  cycles: string[][];
}

/**
 * Order a hydrate batch by its declared dependencies (ADR-0141 D5). Never
 * throws on the batch's shape: a cycle degrades to source order for its members
 * and is reported in {@link HydrationOrder.cycles}.
 */
export function orderHydrationBatch<T>(nodes: readonly HydrationNode<T>[]): HydrationOrder<T> {
  // Keyed by position, not by label: two rows naming one id must still both
  // reach the caller, which judges each as it always has.
  const carrierOf = new Map<string, number>();
  nodes.forEach((node, index) => {
    for (const id of node.packageIds) if (!carrierOf.has(id)) carrierOf.set(id, index);
  });

  const edges: number[][] = nodes.map((node, index) => {
    const targets = new Set<number>();
    for (const id of node.declaredIds) {
      const carrier = carrierOf.get(id);
      if (carrier !== undefined && carrier !== index) targets.add(carrier);
    }
    return [...targets];
  });

  const components = stronglyConnectedComponents(edges);
  const componentOf = new Array<number>(nodes.length);
  components.forEach((members, c) => { for (const m of members) componentOf[m] = c; });
  const cyclic = components.filter((members) => members.length > 1);

  const graph = new Map(nodes.map((_, index) => [String(index), {
    name: String(index),
    optionalDependencies: edges[index]
      .filter((target) => !(components[componentOf[index]].length > 1 && componentOf[target] === componentOf[index]))
      .map(String),
    index,
  }]));

  return {
    ordered: resolvePluginOrder(graph).map(({ index }) => nodes[index].item),
    cycles: cyclic.map((members) => [...members].sort((a, b) => a - b).map((m) => nodes[m].label)),
  };
}

/** Tarjan's algorithm over node indices; iterative, so a long chain cannot overflow the stack. */
function stronglyConnectedComponents(edges: readonly number[][]): number[][] {
  const index = new Array<number>(edges.length).fill(-1);
  const low = new Array<number>(edges.length).fill(0);
  const onStack = new Array<boolean>(edges.length).fill(false);
  const stack: number[] = [];
  const components: number[][] = [];
  let counter = 0;

  for (let root = 0; root < edges.length; root++) {
    if (index[root] !== -1) continue;
    const work: Array<{ node: number; next: number }> = [{ node: root, next: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = true;

    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;
      if (frame.next < edges[node].length) {
        const target = edges[node][frame.next++];
        if (index[target] === -1) {
          index[target] = low[target] = counter++;
          stack.push(target);
          onStack[target] = true;
          work.push({ node: target, next: 0 });
        } else if (onStack[target]) {
          low[node] = Math.min(low[node], index[target]);
        }
        continue;
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        low[parent] = Math.min(low[parent], low[node]);
      }
      if (low[node] === index[node]) {
        const members: number[] = [];
        let member: number;
        do {
          member = stack.pop()!;
          onStack[member] = false;
          members.push(member);
        } while (member !== node);
        components.push(members);
      }
    }
  }
  return components;
}
