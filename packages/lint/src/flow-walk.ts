// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared flow-node traversal for the rules that inspect `FlowNode.config`
 * (issue #4380) — the flow-side counterpart of `page-walk.ts`, and here for the
 * same reason: every rule had hand-written the same one-liner,
 *
 * ```ts
 * const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
 * ```
 *
 * …and every one of them was therefore blind to the same thing.
 *
 * ## What the one-liner misses
 *
 * `FlowRegionSchema` (`@objectstack/spec/automation`) holds a FULL
 * `nodes: z.array(FlowNodeSchema)`, and four config slots carry one:
 *
 * | node type   | slot(s)                          |
 * |-------------|----------------------------------|
 * | `try_catch` | `config.try`, `config.catch`     |
 * | `loop`      | `config.body`                    |
 * | `parallel`  | `config.branches[].nodes`        |
 *
 * Regions nest arbitrarily (a region node may itself be a `try_catch`). Before
 * this walk, a node moved into any of them left the checking behind:
 * `flow-node-write-unknown-field` and `flow-update-readonly-field` — both
 * GATING errors — reported nothing, and `approval-approver-*` went quiet too.
 *
 * `validate-flow-template-paths` failed a third way, worth naming because it is
 * the one a reader would not predict: it scans a node's whole `config` for
 * string leaves, so it still SAW tokens inside a region — but its `filter`
 * position split only looks at the top level of the node it was handed, so a
 * nested filter token lost its position and the #3810 finding silently
 * downgraded from `error` to `warning`, reported against the wrapping
 * `try_catch` instead of the `get_record` that cannot run. Being visible is not
 * the same as being judged correctly, which is why {@link WalkedFlowNode}
 * carries a real per-node `path` rather than only the node object.
 *
 * ## The double-count trap
 *
 * A container node is yielded too — it has its own config worth checking (a
 * `loop`'s `collection`, a `try_catch`'s `retry`). But its `config` physically
 * CONTAINS every descendant, so any rule that walks config recursively would
 * report each nested finding twice: once at the inner node, once at the
 * container. {@link WalkedFlowNode.localConfig} is the container's config with
 * the region slots removed — the view a recursive scan must use. Rules that
 * read named keys (`config.fields`, `config.objectName`) can use either.
 */

import { FLOW_REGION_SLOTS_BY_TYPE, FLOW_REGION_CONFIG_KEYS } from '@objectstack/spec/automation';

export type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Config keys that hold a nested region, by owning node type.
 *
 * Projected from `@objectstack/spec/automation` rather than declared here
 * (#4401). This used to be a local copy with its own reconciliation test — as
 * did the ADR-0087 conversion walk's copy and the spec-side control-flow walk's.
 * Three tables, three tests each pinning its own copy, and nothing that would
 * fail if they drifted from ONE ANOTHER: every copy was individually protected
 * and the set was not. A fourth construct is now a single entry in
 * `spec/src/automation/region-slots.ts`.
 *
 * The **walk** below stays here. It takes raw authored records (not
 * `FlowNodeParsed`), and it yields per-node diagnostic paths and label trails —
 * formatting that is lint's business, not the protocol's (Prime Directive #2).
 * Only the table is shared; the three traversals stay separate because they walk
 * different units for different consumers.
 */
export const REGION_SLOTS: ReadonlyMap<string, readonly string[]> = new Map(
  [...FLOW_REGION_SLOTS_BY_TYPE].map(([type, slots]) => [type, slots.map(s => s.key)]),
);

/** Every config key that may hold region nodes, across all node types. */
export const REGION_CONFIG_KEYS: ReadonlySet<string> = FLOW_REGION_CONFIG_KEYS;

/**
 * Depth cap. Regions are a tree in parsed metadata, so this is not a cycle
 * guard — it is a cheap promise that a hand-authored (pre-parse) stack cannot
 * make a lint hang. Well past anything reviewable: five levels of nested
 * try/loop/parallel is already an unreadable flow.
 */
export const MAX_REGION_DEPTH = 16;

/** A visited flow node plus everything needed to locate and describe it. */
export interface WalkedFlowNode {
  /** The node record itself. */
  node: AnyRec;
  /** Config path, e.g. `flows[0].nodes[1].config.catch.nodes[0]`. */
  path: string;
  /**
   * The node's config with region slots stripped — what a rule that scans
   * config RECURSIVELY must read, or it reports every descendant's finding a
   * second time against this node. `undefined` when the node has no config.
   */
  localConfig?: AnyRec;
  /**
   * Region breadcrumb from the flow root, e.g. `try_catch "Guard" › catch`.
   * Empty string for a top-level node, so a caller can append it unconditionally.
   */
  regionTrail: string;
  /** 0 for a top-level node; 1 inside one region; and so on. */
  depth: number;
}

/** A node's label for diagnostics: `label` → `id` → `#index`. */
export function flowNodeLabel(node: AnyRec, index: number): string {
  return strName(node.label) ?? strName(node.id) ?? `#${index}`;
}

/** `config` minus the region slots, or `undefined` when there is no config. */
function stripRegions(config: unknown): AnyRec | undefined {
  if (!isRec(config)) return undefined;
  let out: AnyRec | undefined;
  for (const key of Object.keys(config)) {
    if (!REGION_CONFIG_KEYS.has(key)) continue;
    out ??= { ...config };
    delete out[key];
  }
  return out ?? config;
}

/**
 * Walk every node of a flow, depth-first, including those nested in
 * `try_catch` / `loop` / `parallel` regions. Yields each with its own config
 * path, so a finding lands on the node that is actually wrong.
 *
 * `flowPath` is the caller's path prefix for the flow (e.g. `flows[3]`).
 */
export function walkFlowNodes(flow: AnyRec, flowPath: string): WalkedFlowNode[] {
  const out: WalkedFlowNode[] = [];
  if (!isRec(flow)) return out;

  const visitList = (nodes: unknown, basePath: string, trail: string, depth: number): void => {
    if (!Array.isArray(nodes) || depth > MAX_REGION_DEPTH) return;
    nodes.forEach((raw, index) => {
      if (!isRec(raw)) return;
      const path = `${basePath}[${index}]`;
      out.push({
        node: raw,
        path,
        localConfig: stripRegions(raw.config),
        regionTrail: trail,
        depth,
      });

      const type = strName(raw.type);
      const slots = type ? REGION_SLOTS.get(type) : undefined;
      if (!slots || !isRec(raw.config)) return;
      const config = raw.config;
      const here = `${type} "${flowNodeLabel(raw, index)}"`;

      for (const slot of slots) {
        const value = config[slot];
        if (slot === 'branches') {
          // parallel: an array of regions, each with its own nodes.
          if (!Array.isArray(value)) continue;
          value.forEach((branch, b) => {
            if (!isRec(branch)) return;
            const branchName = strName(branch.name) ?? `#${b}`;
            visitList(
              branch.nodes,
              `${path}.config.branches[${b}].nodes`,
              joinTrail(trail, `${here} › branch ${branchName}`),
              depth + 1,
            );
          });
          continue;
        }
        if (!isRec(value)) continue;
        visitList(
          value.nodes,
          `${path}.config.${slot}.nodes`,
          joinTrail(trail, `${here} › ${slot}`),
          depth + 1,
        );
      }
    });
  };

  visitList(flow.nodes, `${flowPath}.nodes`, '', 0);
  return out;
}

function joinTrail(trail: string, segment: string): string {
  return trail ? `${trail} › ${segment}` : segment;
}
