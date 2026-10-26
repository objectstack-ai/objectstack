// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13138 — "Add branch" on a Decision whose out-edge already carries
 * its own routing (a CEL `condition` written in the connection inspector) must
 * add a branch, not overwrite that edge.
 *
 * The measured failure ran through the two fallbacks of the reconciliation:
 * with no branch naming a target, the objectui#1927 by-order mirror stamped
 * branch 0 onto out-edge 0 (the condition became `isDefault: true`); with a
 * target picked first, the "same target" tier claimed the conditioned edge
 * because it pointed at the same node. Both now pair only with an out-edge
 * that carries no routing of its own, with the edge the branch itself binds,
 * or with an edge the stored branch list owned before the commit.
 *
 * Each scenario replays the editor's commits one cell at a time (a commit is
 * a blur of one cell), feeding each result's edges AND stored conditions into
 * the next commit, the way `FlowNodeInspector.setField` feeds the draft and
 * reads the node's stored `config.conditions` as `prior`.
 */

import { describe, it, expect } from 'vitest';
import { FlowEdgeSchema } from '@objectstack/spec/automation';
import { applyDecisionBranches, withBranchTargets, type DecisionEdge } from './flow-decision-edges';

const DEC = 'decision_1';
/** The connection the author wrote in the connection inspector (card step 3). */
const conditioned = (): DecisionEdge => ({
  id: 'edge_1',
  source: DEC,
  target: 'end',
  condition: { dialect: 'cel', source: '1 == 1' },
});

/** Replay a sequence of Branches-editor commits over the draft's edges and stored branches. */
function replay(commits: unknown[], edges: DecisionEdge[], stored: unknown = []): DecisionEdge[] {
  let current = edges;
  let prior = stored;
  for (const committed of commits) {
    const applied = applyDecisionBranches(DEC, committed, current, prior);
    current = applied.edges;
    prior = applied.conditions;
  }
  return current;
}

const specIssues = (edges: DecisionEdge[]): string[] =>
  edges.flatMap((e, i) => {
    const parsed = FlowEdgeSchema.safeParse(e);
    return parsed.success ? [] : parsed.error.issues.map((iss) => `edges[${i}].${iss.path.join('.')}: ${iss.message}`);
  });

describe('Add branch leaves a conditioned connection alone (objectui#13138)', () => {
  it('(a) a branch with no target never rewrites the existing edge’s condition or adds isDefault', () => {
    const edges = replay(
      [[{ label: 'Otherwise' }], [{ label: 'Otherwise', expression: 'true' }]],
      [conditioned()],
    );
    expect(edges).toEqual([conditioned()]);
  });

  it('(a) the same holds for a single commit carrying both cells', () => {
    const { conditions, edges } = applyDecisionBranches(DEC, [{ label: 'Otherwise', expression: 'true' }], [conditioned()], []);
    expect(edges).toEqual([conditioned()]);
    expect(conditions).toEqual([{ label: 'Otherwise', expression: 'true' }]);
  });

  it('(a) the new branch shows no Target: it is not paired with the conditioned edge', () => {
    expect(withBranchTargets(DEC, [{ label: 'Otherwise', expression: 'true' }], [conditioned()])).toEqual([
      { label: 'Otherwise', expression: 'true' },
    ]);
  });

  it('(b) Target=End first: a new edge to End carries this branch, the original edge is unchanged', () => {
    const edges = replay(
      [
        [{ target: 'end' }],
        [{ label: 'Otherwise', target: 'end' }],
        [{ label: 'Otherwise', expression: 'true', target: 'end' }],
      ],
      [conditioned()],
    );
    expect(edges).toEqual([
      conditioned(),
      { id: 'edge_2', source: DEC, target: 'end', label: 'Otherwise', isDefault: true },
    ]);
    expect(specIssues(edges)).toEqual([]);
  });

  it('(b) the re-derived Target column pairs the branch with its own edge, not the conditioned one', () => {
    const edges = replay([[{ label: 'Otherwise', expression: 'true', target: 'end' }]], [conditioned()]);
    expect(edges).toEqual([
      conditioned(),
      { id: 'edge_2', source: DEC, target: 'end', label: 'Otherwise', isDefault: true },
    ]);
    // A further commit (here: an unchanged re-commit) still touches only edge_2.
    const stored = [{ label: 'Otherwise', expression: 'true' }];
    const again = replay([withBranchTargets(DEC, stored, edges)], edges, stored);
    expect(again).toEqual(edges);
  });

  it('a new branch never detaches a default connection it did not wire', () => {
    // The connection inspector made e2 the default path; no branch owns it.
    // A new, still-empty branch binds the default edge by the #1930 matcher —
    // committing its label must not read as "target cleared".
    const authored: DecisionEdge[] = [
      { id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' },
      { id: 'e2', source: DEC, target: 'n2', isDefault: true },
    ];
    const stored = [{ label: 'A', expression: 'a' }];
    const edges = replay([[{ label: 'A', expression: 'a', target: 'n1' }, { label: 'New' }]], authored, stored);
    expect(edges).toEqual(authored);
  });
});

describe('controls — branches that name their edge still drive it (objectui#1927 / #1942)', () => {
  it('by-order: unrouted out-edges still pair positionally', () => {
    const edges = replay(
      [[{ label: 'A', expression: 'a' }, { label: 'Else', expression: 'true' }]],
      [
        { id: 'e1', source: DEC, target: 'n1' },
        { id: 'e2', source: DEC, target: 'n2' },
      ],
    );
    expect(edges).toEqual([
      { id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' },
      { id: 'e2', source: DEC, target: 'n2', label: 'Else', isDefault: true },
    ]);
  });

  it('by-order: editing a branch’s expression updates its own (stamped) edge', () => {
    const stamped: DecisionEdge[] = [
      { id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' },
      { id: 'e2', source: DEC, target: 'n2', label: 'Else', isDefault: true },
    ];
    const edges = replay([[{ label: 'A', expression: 'b' }, { label: 'Else', expression: 'true' }]], stamped, [
      { label: 'A', expression: 'a' },
      { label: 'Else', expression: 'true' },
    ]);
    expect(edges).toEqual([{ ...stamped[0], condition: 'b' }, stamped[1]]);
  });

  it('by-order: turning a branch into the default path moves its own edge to isDefault', () => {
    const stamped: DecisionEdge[] = [{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' }];
    const edges = replay([[{ label: 'A', expression: 'true' }]], stamped, [{ label: 'A', expression: 'a' }]);
    expect(edges).toEqual([{ id: 'e1', source: DEC, target: 'n1', label: 'A', isDefault: true }]);
  });

  it('by-order: renaming a branch updates the edge its condition binds', () => {
    const stamped: DecisionEdge[] = [{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' }];
    const edges = replay([[{ label: 'Approve', expression: 'a' }]], stamped, [{ label: 'A', expression: 'a' }]);
    expect(edges).toEqual([{ ...stamped[0], label: 'Approve' }]);
  });

  it('targeted: editing a branch’s expression updates its own edge in place', () => {
    const stamped: DecisionEdge[] = [{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'old' }];
    const edges = replay([[{ label: 'A', expression: 'fresh', target: 'n1' }]], stamped, [{ label: 'A', expression: 'old' }]);
    expect(edges).toEqual([{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'fresh' }]);
  });

  it('targeted: a label-less branch’s expression edit keeps driving its own edge (no duplicate)', () => {
    const edges = replay([[{ target: 'n1' }], [{ expression: 'x', target: 'n1' }], [{ expression: 'y', target: 'n1' }]], []);
    expect(edges).toEqual([{ id: 'edge_1', source: DEC, target: 'n1', condition: 'y' }]);
  });

  it('targeted: clearing an owned branch’s target still detaches its edge', () => {
    const stamped: DecisionEdge[] = [{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' }];
    const edges = replay([[{ label: 'A', expression: 'a' }, { label: 'B', expression: 'b', target: 'n2' }]], stamped, [
      { label: 'A', expression: 'a' },
    ]);
    expect(edges).toEqual([{ id: 'edge_1', source: DEC, target: 'n2', label: 'B', condition: 'b' }]);
  });

  it('by-order: a label-less branch’s expression edit keeps driving its own edge', () => {
    const own: DecisionEdge[] = [{ id: 'e1', source: DEC, target: 'n1', condition: 'x' }];
    const edges = replay([[{ expression: 'y' }]], own, [{ expression: 'x' }]);
    expect(edges).toEqual([{ id: 'e1', source: DEC, target: 'n1', condition: 'y' }]);
  });

  it('targeted: picking a target for a branch claims the unrouted edge already drawn to it', () => {
    const drawn: DecisionEdge[] = [{ id: 'e1', source: DEC, target: 'n1' }];
    const edges = replay([[{ label: 'A', expression: 'a', target: 'n1' }]], drawn);
    expect(edges).toEqual([{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' }]);
  });
});
