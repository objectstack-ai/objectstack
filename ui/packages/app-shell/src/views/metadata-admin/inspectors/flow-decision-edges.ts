// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-decision-edges — pure branch↔edge reconciliation for decision nodes
 * (#1927 / #1930 / #1942).
 *
 * A decision's routing lives on its outgoing EDGES (`edge.condition` /
 * `edge.label` / `edge.isDefault`) — that is what the engine and the simulator
 * evaluate. `node.config.conditions` is only the node-local branch list
 * (`{ label, expression }`, per the spec decision shape). The Branches editor
 * additionally shows a per-branch **Target** column (#1942): its value is
 * DERIVED from the current edges here (never persisted on the branch — edges
 * stay the single source of truth, so it round-trips with the per-edge Branch
 * picker in `FlowEdgeInspector`, #1930), and committing the editor applies the
 * chosen targets back onto the edges:
 *
 *   • branch has a target and a matching out-edge → update it in place
 *     (retargeting when the author picked a different node);
 *   • branch has a target but no edge            → create the out-edge;
 *   • branch's target was cleared                → remove ("detach") the edge
 *     that was bound to that branch — never the node it pointed at;
 *   • edges bound to NO branch (custom per-edge guards authored in
 *     `FlowEdgeInspector`, fault/back edges, surplus canvas wiring) are never
 *     touched or deleted.
 *
 * A commit in which NO branch carries a target (the engine-published
 * configSchema form has no Target column, and older flows) falls back to the
 * #1927 by-order mirror.
 *
 * objectui#13138 — every fallback pairing (the by-order mirror, the derived
 * Target column, and "same target node" when a target is picked) only pairs a
 * branch with an out-edge that carries NO routing of its own (no `condition`,
 * `label` or `isDefault`), or with one the branch list already owned before
 * this commit (`prior`: the stored `config.conditions` the commit replaces —
 * so a one-cell edit of a branch keeps driving its own edge even when the
 * edit leaves nothing that names it). An edge no branch owns — a connection
 * whose routing was written in the connection inspector — is driven only by
 * a branch that binds it; a new branch that binds no edge stays a branch with
 * no edge until its target is chosen, and then gets its own edge; and only an
 * owned edge is ever detached. Before this, "Add branch" on a decision whose
 * connection held a condition stamped the new branch over that edge and the
 * condition was gone.
 *
 * "Bound to a branch" follows the same matching the `FlowEdgeInspector`
 * Branch picker uses: a default-ish branch (expression empty or `true`) binds
 * the `isDefault` edge; otherwise match by condition text, then by label.
 */

import { conditionText, type FlowDesignerEdge } from '../previews/flow-canvas-layout.js';
import { uniqueId } from './unique-id.js';

/**
 * The edge this module mirrors decision branches onto — the canvas's own edge,
 * ALIASED rather than restated (objectui#6287).
 *
 * It used to be a fourth hand-written copy of that shape whose `condition` was
 * still `unknown`, months after objectui#3202 narrowed the designer's edge to
 * the spec's `ExpressionInput` — the over-wide read type that describes an
 * envelope `FlowEdgeSchema` rejects and that got objectui#3171 filed against a
 * defect which does not reproduce. The copy's own `condText` helper existed
 * only to cast its way back to the narrow type on every read, which is the
 * clearest statement available that the looseness was never wanted here: the
 * one value this module ever WRITES to `condition` is a bare CEL string, which
 * `ExpressionInput` has always admitted.
 */
export type DecisionEdge = FlowDesignerEdge;

const condText = (c: FlowDesignerEdge['condition']): string | undefined => conditionText(c);

/** A branch row as committed by the editor (freeform per the spec config). */
export type DecisionBranch = Record<string, unknown>;

const branchExpr = (b: DecisionBranch): string =>
  typeof b.expression === 'string' ? b.expression.trim() : '';
const branchName = (b: DecisionBranch): string =>
  typeof b.label === 'string' ? b.label.trim() : '';
const branchTarget = (b: DecisionBranch): string =>
  typeof b.target === 'string' ? b.target.trim() : '';
/** Default/else branch: an empty or literal-`true` expression (#1930 matcher). */
const isDefaultish = (b: DecisionBranch): boolean => {
  const e = branchExpr(b);
  return e === '' || e === 'true';
};

export function asBranchArray(conditions: unknown): DecisionBranch[] {
  return Array.isArray(conditions)
    ? (conditions.filter((c) => c && typeof c === 'object' && !Array.isArray(c)) as DecisionBranch[])
    : [];
}

/**
 * Whether an edge is BOUND to a branch — mirrors `FlowEdgeInspector`'s
 * branch-picker matching so the two editors agree on which edge is which
 * branch: default-ish branch ↔ the `isDefault` edge, else condition text,
 * else (non-empty) label.
 */
export function edgeBindsBranch(branch: DecisionBranch, edge: DecisionEdge): boolean {
  if (isDefaultish(branch)) return edge.isDefault === true;
  const expr = branchExpr(branch);
  const cond = condText(edge.condition);
  if (expr && cond === expr) return true;
  const name = branchName(branch);
  return name !== '' && edge.label === name;
}

/**
 * The reconciliation's claim: the #1930 binding above, or the branch's label
 * naming the edge. The label is what the mirror stamps on every edge it writes,
 * so it is what still names the branch's own edge after a one-cell edit of the
 * expression — including an edit into the default path, which the
 * default-ish half of `edgeBindsBranch` alone would not follow.
 */
function edgeClaimedByBranch(branch: DecisionBranch, edge: DecisionEdge): boolean {
  if (edgeBindsBranch(branch, edge)) return true;
  const name = branchName(branch);
  return name !== '' && edge.label === name;
}

/**
 * objectui#13138 — an out-edge that carries routing of its own: a guard, a
 * label or the default flag. Only a branch that claims it may rewrite it; no
 * positional or same-target fallback pairs with it.
 */
function carriesRouting(edge: DecisionEdge): boolean {
  const cond = condText(edge.condition);
  return (
    (cond !== undefined && cond.trim() !== '') ||
    (typeof edge.label === 'string' && edge.label.trim() !== '') ||
    edge.isDefault === true
  );
}

/**
 * objectui#13138 — the out-edges the branch list owned before this commit:
 * those `prior` (the stored branches the commit replaces) pairs with.
 */
function ownedEdges(decisionId: string, prior: unknown, edges: DecisionEdge[]): Set<number> {
  return new Set(pairBranchesWithEdges(decisionId, asBranchArray(prior), edges).values());
}

/** The decision's plain out-edges (fault / back edges never carry branches). */
const isCandidate = (decisionId: string) => (e: DecisionEdge): boolean =>
  e.source === decisionId && e.type !== 'fault' && e.type !== 'back';

/**
 * Stamp a branch's routing onto an edge (the #1927 mirror rules): a non-`true`
 * expression becomes the guard, a literal `true` marks the default/else path,
 * an empty expression clears both; the label follows the branch label.
 */
function mirrorBranchOntoEdge(edge: DecisionEdge, branch: DecisionBranch): DecisionEdge {
  const expr = branchExpr(branch);
  const label = branchName(branch);
  const next: DecisionEdge = { ...edge };
  if (label) next.label = label;
  else delete next.label;
  if (expr && expr !== 'true') {
    next.condition = expr;
    delete next.isDefault;
  } else if (expr === 'true') {
    next.isDefault = true;
    delete next.condition;
  } else {
    delete next.condition;
    delete next.isDefault;
  }
  return next;
}

/**
 * Pair each branch with an out-edge (branch index → edge index): first every
 * branch with the edge it claims, then the remaining branches, in order, with
 * the remaining out-edges that carry no routing of their own, or that are in
 * `owned` (the #1927 by-order pairing, narrowed by objectui#13138). A branch
 * left unpaired has no edge.
 */
function pairBranchesWithEdges(
  decisionId: string,
  branches: DecisionBranch[],
  edges: DecisionEdge[],
  owned: ReadonlySet<number> = new Set(),
): Map<number, number> {
  const candidates = edges
    .map((_, i) => i)
    .filter((i) => isCandidate(decisionId)(edges[i]));
  const claimed = new Set<number>();
  const pairing = new Map<number, number>();
  branches.forEach((b, bi) => {
    const ei = candidates.find((i) => !claimed.has(i) && edgeClaimedByBranch(b, edges[i]));
    if (ei !== undefined) {
      claimed.add(ei);
      pairing.set(bi, ei);
    }
  });
  branches.forEach((_, bi) => {
    if (pairing.has(bi)) return;
    const ei = candidates.find((i) => !claimed.has(i) && (owned.has(i) || !carriesRouting(edges[i])));
    if (ei !== undefined) {
      claimed.add(ei);
      pairing.set(bi, ei);
    }
  });
  return pairing;
}

/**
 * The legacy #1927 by-order mirror: each branch stamps the out-edge it is
 * paired with (`pairBranchesWithEdges`) — the edge it binds, else the next
 * plain out-edge that carries no routing or that `prior` (the stored branches
 * this commit replaces) owned. Used when no committed branch carries an
 * explicit target (see module doc).
 */
export function syncDecisionEdgesByOrder(
  decisionId: string,
  conditions: unknown,
  edges: DecisionEdge[],
  prior: unknown,
): DecisionEdge[] {
  const branches = asBranchArray(conditions);
  const branchOfEdge = new Map<number, DecisionBranch>();
  pairBranchesWithEdges(decisionId, branches, edges, ownedEdges(decisionId, prior, edges)).forEach((ei, bi) =>
    branchOfEdge.set(ei, branches[bi]),
  );
  return edges.map((e, i) => {
    const branch = branchOfEdge.get(i);
    return branch ? mirrorBranchOntoEdge(e, branch) : e;
  });
}

/**
 * Derive the Target column for display: pair each branch with the out-edge
 * bound to it (#1930 matching), then pair the remainder by order with the
 * out-edges that carry no routing (the #1927 mirror keeps unannotated flows
 * aligned that way; objectui#13138 keeps a branch from showing — and then
 * committing — the target of an edge it does not name). Returns the branches with
 * `target` injected from the paired edge — and any stale stored `target` key
 * dropped, since edges are the source of truth.
 */
export function withBranchTargets(
  decisionId: string,
  conditions: unknown,
  edges: DecisionEdge[],
): DecisionBranch[] {
  const branches = asBranchArray(conditions);
  if (branches.length === 0) return branches;
  const pairing = pairBranchesWithEdges(decisionId, branches, edges);
  return branches.map((b, bi) => {
    const { target: _stale, ...rest } = b;
    const ei = pairing.get(bi);
    return ei !== undefined ? { ...rest, target: edges[ei].target } : rest;
  });
}

/**
 * objectui#13138 — the decision's plain out-edges (indices into `edges`) that
 * no branch of `conditions` is paired with, by the same pairing the Target
 * column reads. These are connections the branch list does not show: the
 * Branches editor lists them beside its rows so the author still sees what
 * the decision routes after adding a branch.
 */
export function unpairedDecisionEdges(
  decisionId: string,
  conditions: unknown,
  edges: DecisionEdge[],
): Set<number> {
  const paired = new Set(pairBranchesWithEdges(decisionId, asBranchArray(conditions), edges).values());
  const out = new Set<number>();
  edges.forEach((e, i) => {
    if (isCandidate(decisionId)(e) && !paired.has(i)) out.add(i);
  });
  return out;
}

/**
 * Apply a Branches-editor commit: returns the spec-clean `conditions` to store
 * (the virtual `target` column stripped) and the reconciled `edges`.
 *
 * With no targets anywhere the edge pass is the legacy by-order mirror.
 * Otherwise branches claim edges in three deterministic tiers — exact target
 * AND binding, exact target on an edge that carries no routing of its own or
 * that `prior` owned (objectui#13138: never a conditioned / labelled / default
 * edge the connection inspector wrote), binding alone (a retarget keeps the
 * edge's identity and extra keys) — unmatched targeted branches create a fresh
 * edge, and a target-less branch detaches (removes) the edge still bound to
 * it, provided `prior` owned that edge (a new branch never deletes one).
 *
 * `prior` is the stored branch list this commit replaces (the node's
 * `config.conditions`, spec-clean): it is what tells "this branch's own edge,
 * edited" apart from "a connection no branch has ever routed".
 *
 * Every created edge carries an `id` (objectui#3202). This output is a
 * COMMITTED state — it goes straight to `onPatch` → draft → save — and the
 * spec's `FlowEdgeSchema.id` is required, so an id-less edge here is one the
 * designer draws, marks red in its own live draft validation, and then has the
 * server reject with a 422, for an author who did nothing wrong. Ids come from
 * `uniqueId('edge', …)`, the same helper every other edge-creating path in this
 * designer uses (`FlowCanvas.addNode` / `insertOnEdge` / the revise loop), over
 * the ids already in the flow PLUS the ones minted earlier in this same commit
 * — a multi-branch apply creates several edges at once and must not mint the
 * same id twice.
 */
export function applyDecisionBranches(
  decisionId: string,
  committed: unknown,
  edges: DecisionEdge[],
  prior: unknown,
): { conditions: DecisionBranch[]; edges: DecisionEdge[] } {
  const branches = asBranchArray(committed);
  const conditions = branches.map((b) => {
    const { target: _t, ...rest } = b;
    return rest;
  });

  if (!branches.some((b) => branchTarget(b) !== '')) {
    return { conditions, edges: syncDecisionEdgesByOrder(decisionId, conditions, edges, prior) };
  }

  const owned = ownedEdges(decisionId, prior, edges);

  const candidates = edges
    .map((_, i) => i)
    .filter((i) => isCandidate(decisionId)(edges[i]));
  const claimed = new Set<number>();
  const pairing = new Map<number, number>();

  const tiers: Array<(b: DecisionBranch, e: DecisionEdge, i: number) => boolean> = [
    (b, e) => e.target === branchTarget(b) && edgeClaimedByBranch(b, e),
    (b, e, i) => e.target === branchTarget(b) && (owned.has(i) || !carriesRouting(e)),
    (b, e) => edgeClaimedByBranch(b, e),
  ];
  for (const matches of tiers) {
    branches.forEach((b, bi) => {
      if (pairing.has(bi) || branchTarget(b) === '') return;
      const ei = candidates.find((i) => !claimed.has(i) && matches(b, edges[i], i));
      if (ei !== undefined) {
        claimed.add(ei);
        pairing.set(bi, ei);
      }
    });
  }

  const updated = new Map<number, DecisionEdge>();
  const created: DecisionEdge[] = [];
  const removed = new Set<number>();
  // Ids already spoken for: every edge in the flow (not just this decision's —
  // an id is unique per flow), grown with each id minted below.
  const takenEdgeIds: Array<string | undefined> = edges.map((e) => e.id);
  branches.forEach((b, bi) => {
    const target = branchTarget(b);
    if (target === '') {
      // Explicitly unbound: detach the edge still bound to this branch (never
      // a claimed edge, never an edge bound to no branch at all, and never one
      // the branch list did not own — objectui#13138: a new, empty branch
      // binds the default edge by the #1930 matcher, but it never wired it).
      const ei = candidates.find((i) => !claimed.has(i) && owned.has(i) && edgeBindsBranch(b, edges[i]));
      if (ei !== undefined) {
        claimed.add(ei);
        removed.add(ei);
      }
      return;
    }
    const ei = pairing.get(bi);
    if (ei !== undefined) {
      updated.set(ei, mirrorBranchOntoEdge({ ...edges[ei], target }, b));
      return;
    }
    const id = uniqueId('edge', takenEdgeIds);
    takenEdgeIds.push(id);
    created.push(mirrorBranchOntoEdge({ id, source: decisionId, target }, b));
  });

  const nextEdges = edges
    .map((e, i) => (removed.has(i) ? null : updated.get(i) ?? e))
    .filter((e): e is DecisionEdge => e !== null)
    .concat(created);
  return { conditions, edges: nextEdges };
}
