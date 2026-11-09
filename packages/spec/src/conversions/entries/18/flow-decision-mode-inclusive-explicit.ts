// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#29987 codemod] The `flow-decision-mode-inclusive-explicit` conversion
// (`toMajor: 18`), moved out of `conversions/registry.ts` whole by
// `scripts/codemod-split-conversions-registry.mjs` (ruling 6583399215:
// per-entry files).
//
// A MOVE, not a redesign: each declaration below is its `registry.ts` text
// exactly, with the comments above it, in the order it stood there (the helpers
// `DECISION_MODE_INCLUSIVE_MIN_CONDITIONED_EDGES`,
// `DECISION_MODE_REGION_DEPTH_CEILING`, `edgeCarriesCondition`,
// `rewriteDecisionModesInGraph` are read by this conversion alone). A LEAF: it
// imports neither `registry.ts` nor another conversion's module. `registry.ts`
// imports `flowDecisionModeInclusiveExplicit` and lists it where it stood.

import type { ConversionApplication, MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { FLOW_REGION_SLOTS_BY_TYPE } from '../../../automation/region-slots.js';
import { isDict } from '../shared.js';

/**
 * `decision` edge branching became EXCLUSIVE — first match in declaration
 * order — and taking every true branch is now the declared `mode: 'inclusive'`
 * (protocol 18, #15429; maintainer ruling 「跟主流对齐」, 2026-09-23).
 *
 * Until this change an edge-branched decision (no `config.conditions`) took
 * EVERY out-edge whose condition held, one after another, while its schema,
 * its docs and the engine's own comment all called it an exclusive gateway. The
 * traversal now takes the FIRST conditioned out-edge that holds, in the order
 * the flow's `edges` array declares them — the BPMN exclusive gateway,
 * Salesforce Flow's Decision, n8n's Switch default — and `mode: 'inclusive'`
 * is what an author writes to take every one (the BPMN inclusive gateway).
 *
 * ## What this rewrites, and the one thing it does not infer
 *
 * A decision with no `conditions` list (absent or empty), no `mode` of its
 * own, and TWO OR MORE out-edges carrying a `condition` (a `fault` edge is
 * error routing, not a branch) gets `mode: 'inclusive'` written explicitly, so
 * a flow written while every true branch ran keeps that behaviour under the
 * exclusive traversal. One conditioned edge plus a default is left alone:
 * first-match and every-true-edge cannot differ there, so there is nothing to
 * preserve. A decision whose author already wrote `mode` — either member — has
 * spoken and is left alone, which is also what makes a second replay a no-op.
 *
 * ⛔ No smarter inference: a pair of conditions that PROVABLY partition
 * (`x == 'a'` beside `x != 'a'`) is rewritten too. First-match equals
 * every-true-edge only when the conditions are exclusive, and the ruling's
 * predicate is the count, not a decision procedure over CEL — the author then
 * deletes the key where the branches partition, and the `os migrate meta` diff
 * is where that judgment is made (the paired D3 entry
 * `flow-decision-edge-branching-first-match` says how).
 *
 * Reaches the nodes inside ADR-0031 regions (`loop.config.body`,
 * `parallel.config.branches[]`, `try_catch.config.try` / `.catch`) through the
 * shared slot table, judging each region's decisions against ITS OWN edges —
 * a nested gate's out-edges live in the region, not in `flow.edges`.
 *
 * ## Where it replays — `os migrate meta --from 17`, and no load seam
 *
 * This is a DEFAULT FLIP, not a rename or a delete: the old shape (no `mode`)
 * still parses and now MEANS exclusive, and the rewrite changes what it means.
 * Such an entry is sound only where "this source predates the flip" is a fact,
 * and that is the D3 chain alone — the operator asserts the source's age with
 * `--from`. `retiredFromLoadPath: true` keeps it off the authoring funnel
 * (`normalizeStackInput`), where an author who wrote two branches today, against
 * the contract that says an omitted `mode` is exclusive, must not be rewritten
 * into an inclusive gateway. The flag's jurisdiction ends there — its own
 * docblock on `MetadataConversion` says so, and ADR-0087's 2026-07-31 addendum
 * is why: data-at-rest seams replay retired entries on purpose — so every
 * data-at-rest seam that opens the retired window has to refuse this id by
 * name, on the artifact door's precedent for `app-hidden-to-unpublished`
 * (#17885, `DEFAULT_FLIPS_NOT_REPLAYED_HERE` in `@objectstack/metadata-core`):
 * the automation engine's flow rehydration seam does
 * (`CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION` in `service-automation/src/engine.ts`:
 * `registerFlow` serves code-shipped flows, REST bodies and Studio saves alike,
 * none of them dated), and the artifact-ingestion door does
 * (`DEFAULT_FLIPS_NOT_REPLAYED_HERE` in `metadata-core/src/artifact-forward-conversion.ts`:
 * a scaffolded `^17.0.0` floor is a dependency range, not an age). ⛔ Not replayed over stored `sys_metadata`
 * flows either, by maintainer ruling (letter C on #15429): a stored row takes
 * the first-match meaning on upgrade — BREAKING, stated in the D3 entry and the
 * changeset with the one-line fix `mode: 'inclusive'` — with no stored-row
 * rewrite, no cutoff and no read-path completion. `os migrate meta --stored`
 * runs this entry's `apply` over each stored flow body only to LIST the nodes
 * it would write (`collectDecisionModeReview` in
 * `@objectstack/metadata-protocol`), discarding the result, so the review list
 * and this predicate are one and the same.
 */
const flowDecisionModeInclusiveExplicit: MetadataConversion = {
  id: 'flow-decision-mode-inclusive-explicit',
  toMajor: 18,
  retiredFromLoadPath: true,
  retiredAfter: '17.4.0',
  surface: 'flow.nodes[].config.mode (decision)',
  summary:
    "edge-branched decision with two or more conditioned out-edges and no `mode`: `mode: 'inclusive'` written "
    + 'explicitly (the traversal became exclusive, first match in declaration order, as mainstream engines '
    + 'treat a decision, and taking every true edge must now be declared; the key keeps the '
    + 'every-true-edge behaviour those nodes had, and the author deletes it where the branches partition)',
  apply(stack, emit) {
    return mapCollection(stack, 'flows', (flow, path) => rewriteDecisionModesInGraph(flow, path, emit, 0));
  },
  fixture: {
    // DISJOINT from every other flow fixture: only `start` / `decision` / `end`
    // / `loop` nodes, no key another entry rewrites, so the whole table hits
    // only this one.
    before: {
      flows: [
        {
          name: 'lead_verdict',
          nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            // The hotcrm#1555 shape: two conditioned out-edges that can BOTH
            // hold for a confirmed record. Rewritten — every true branch ran.
            { id: 'verdict', type: 'decision', label: 'Verdict?' },
            { id: 'refuse', type: 'end', label: 'Refuse' },
            { id: 'convert', type: 'end', label: 'Convert' },
            // One guarded branch plus the default: first-match and
            // every-true-edge agree, so there is nothing to preserve. Left alone.
            { id: 'converted', type: 'decision', label: 'Already converted?' },
            { id: 'abort', type: 'end', label: 'Abort' },
            { id: 'proceed', type: 'end', label: 'Proceed' },
            // The author already spoke. Left alone (and a second replay is a no-op).
            { id: 'spoken', type: 'decision', label: 'Spoken', config: { mode: 'exclusive' } },
            { id: 'a', type: 'end', label: 'A' },
            { id: 'b', type: 'end', label: 'B' },
            // A `conditions` list is first-match on its own and refuses `mode`. Left alone.
            {
              id: 'listed', type: 'decision', label: 'Listed',
              config: { conditions: [{ label: 'Hot', expression: 'lead.score > 80' }] },
            },
            { id: 'hot', type: 'end', label: 'Hot' },
            // The same two-branch shape inside a loop body, judged against the
            // region's own edges. Rewritten.
            {
              id: 'sweep', type: 'loop', label: 'Sweep',
              config: {
                collection: '{leads}',
                iteratorVariable: 'lead',
                body: {
                  nodes: [
                    { id: 'gate', type: 'decision', label: 'Gate' },
                    { id: 'x', type: 'end', label: 'X' },
                    { id: 'y', type: 'end', label: 'Y' },
                  ],
                  edges: [
                    { id: 'g1', source: 'gate', target: 'x', condition: "lead.status != 'suspected'" },
                    { id: 'g2', source: 'gate', target: 'y', condition: { dialect: 'cel', source: "lead.status == 'confirmed'" } },
                  ],
                },
              },
            },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'verdict' },
            { id: 'e2', source: 'verdict', target: 'refuse', condition: "lead.status != 'suspected'", label: 'Refuse' },
            { id: 'e3', source: 'verdict', target: 'convert', condition: "lead.status == 'confirmed'", label: 'Convert' },
            { id: 'e4', source: 'converted', target: 'abort', condition: "lead.status == 'converted'" },
            { id: 'e5', source: 'converted', target: 'proceed', isDefault: true },
            { id: 'e6', source: 'spoken', target: 'a', condition: 'x > 1' },
            { id: 'e7', source: 'spoken', target: 'b', condition: 'x > 2' },
            { id: 'e8', source: 'listed', target: 'hot', label: 'Hot' },
          ],
        },
      ],
    },
    after: {
      flows: [
        {
          name: 'lead_verdict',
          nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'verdict', type: 'decision', label: 'Verdict?', config: { mode: 'inclusive' } },
            { id: 'refuse', type: 'end', label: 'Refuse' },
            { id: 'convert', type: 'end', label: 'Convert' },
            { id: 'converted', type: 'decision', label: 'Already converted?' },
            { id: 'abort', type: 'end', label: 'Abort' },
            { id: 'proceed', type: 'end', label: 'Proceed' },
            { id: 'spoken', type: 'decision', label: 'Spoken', config: { mode: 'exclusive' } },
            { id: 'a', type: 'end', label: 'A' },
            { id: 'b', type: 'end', label: 'B' },
            {
              id: 'listed', type: 'decision', label: 'Listed',
              config: { conditions: [{ label: 'Hot', expression: 'lead.score > 80' }] },
            },
            { id: 'hot', type: 'end', label: 'Hot' },
            {
              id: 'sweep', type: 'loop', label: 'Sweep',
              config: {
                collection: '{leads}',
                iteratorVariable: 'lead',
                body: {
                  nodes: [
                    { id: 'gate', type: 'decision', label: 'Gate', config: { mode: 'inclusive' } },
                    { id: 'x', type: 'end', label: 'X' },
                    { id: 'y', type: 'end', label: 'Y' },
                  ],
                  edges: [
                    { id: 'g1', source: 'gate', target: 'x', condition: "lead.status != 'suspected'" },
                    { id: 'g2', source: 'gate', target: 'y', condition: { dialect: 'cel', source: "lead.status == 'confirmed'" } },
                  ],
                },
              },
            },
          ],
          edges: [
            { id: 'e1', source: 'start', target: 'verdict' },
            { id: 'e2', source: 'verdict', target: 'refuse', condition: "lead.status != 'suspected'", label: 'Refuse' },
            { id: 'e3', source: 'verdict', target: 'convert', condition: "lead.status == 'confirmed'", label: 'Convert' },
            { id: 'e4', source: 'converted', target: 'abort', condition: "lead.status == 'converted'" },
            { id: 'e5', source: 'converted', target: 'proceed', isDefault: true },
            { id: 'e6', source: 'spoken', target: 'a', condition: 'x > 1' },
            { id: 'e7', source: 'spoken', target: 'b', condition: 'x > 2' },
            { id: 'e8', source: 'listed', target: 'hot', label: 'Hot' },
          ],
        },
      ],
    },
    expectedNotices: 2,
  },
};

/**
 * The ruling's predicate, as a number: an edge-branched decision is rewritten
 * when at least this many of its out-edges carry a `condition`. Below it,
 * first-match and every-true-edge cannot differ.
 */
const DECISION_MODE_INCLUSIVE_MIN_CONDITIONED_EDGES = 2;

/**
 * Depth ceiling for the region recursion — mirrors the walkers' ceiling
 * (`walk.ts`, `control-flow.zod.ts`): a self-referencing region in a
 * hand-built stack must not recurse without bound.
 */
const DECISION_MODE_REGION_DEPTH_CEILING = 32;

/** An edge whose `condition` carries a predicate — bare text, or the parsed `{ dialect, source }` envelope. */
function edgeCarriesCondition(edge: Record<string, unknown>): boolean {
  const c = edge.condition;
  if (typeof c === 'string') return c.trim() !== '';
  if (isDict(c)) return typeof c.source === 'string' && c.source.trim() !== '';
  return false;
}

/**
 * One graph — a flow, or one ADR-0031 region — for
 * {@link flowDecisionModeInclusiveExplicit}: rewrite its own decisions against
 * its own `edges`, then descend into each node's region slots. Copy-on-write:
 * the same reference comes back when nothing under it changed.
 */
function rewriteDecisionModesInGraph(
  graph: Record<string, unknown>,
  path: string,
  emit: (detail: ConversionApplication) => void,
  depth: number,
): Record<string, unknown> {
  const nodes = graph.nodes;
  if (!Array.isArray(nodes)) return graph;
  const edges = Array.isArray(graph.edges) ? graph.edges.filter(isDict) : [];
  let changed = false;
  const nextNodes = nodes.map((node, i) => {
    if (!isDict(node)) return node;
    const nodePath = `${path}.nodes[${i}]`;
    let next = node;

    if (node.type === 'decision') {
      const cfg = isDict(node.config) ? node.config : {};
      const declaresBranches = Array.isArray(cfg.conditions) && cfg.conditions.length > 0;
      if (!declaresBranches && !('mode' in cfg)) {
        const conditioned = edges.filter(
          (e) => e.source === node.id && e.type !== 'fault' && edgeCarriesCondition(e),
        ).length;
        if (conditioned >= DECISION_MODE_INCLUSIVE_MIN_CONDITIONED_EDGES) {
          next = { ...node, config: { ...cfg, mode: 'inclusive' } };
          emit({
            from: `mode unset (${conditioned} conditioned out-edges; every one whose condition held was taken)`,
            to: 'inclusive',
            path: `${nodePath}.config.mode`,
          });
        }
      }
    }

    if (depth < DECISION_MODE_REGION_DEPTH_CEILING) {
      const slots = typeof next.type === 'string' ? FLOW_REGION_SLOTS_BY_TYPE.get(next.type) : undefined;
      if (slots && isDict(next.config)) {
        let nextConfig = next.config;
        for (const slot of slots) {
          const raw = nextConfig[slot.key];
          if (slot.arity === 'many') {
            if (!Array.isArray(raw)) continue;
            let branchesChanged = false;
            const nextBranches = raw.map((branch, bi) => {
              if (!isDict(branch)) return branch;
              const mapped = rewriteDecisionModesInGraph(branch, `${nodePath}.config.${slot.key}[${bi}]`, emit, depth + 1);
              if (mapped !== branch) branchesChanged = true;
              return mapped;
            });
            if (branchesChanged) nextConfig = { ...nextConfig, [slot.key]: nextBranches };
          } else {
            if (!isDict(raw)) continue;
            const mapped = rewriteDecisionModesInGraph(raw, `${nodePath}.config.${slot.key}`, emit, depth + 1);
            if (mapped !== raw) nextConfig = { ...nextConfig, [slot.key]: mapped };
          }
        }
        if (nextConfig !== next.config) next = { ...next, config: nextConfig };
      }
    }

    if (next !== node) changed = true;
    return next;
  });
  return changed ? { ...graph, nodes: nextNodes } : graph;
}

export { flowDecisionModeInclusiveExplicit };
