// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { FlowEdgeSchema } from '@objectstack/spec/automation';
import {
  applyDecisionBranches,
  syncDecisionEdgesByOrder,
  withBranchTargets,
  edgeBindsBranch,
  type DecisionEdge,
} from './flow-decision-edges';

const DEC = 'dec_1';
const edge = (e: Partial<DecisionEdge> & { target: string }): DecisionEdge => ({ source: DEC, ...e });

describe('withBranchTargets — Target column derivation (#1942)', () => {
  it('pairs branches to bound edges (#1930 matching) regardless of edge order', () => {
    const branches = [
      { label: 'Yes', expression: 'amount > 10' },
      { label: 'No', expression: 'true' },
    ];
    // Edges deliberately out of branch order: default edge first.
    const edges = [edge({ target: 'n_no', isDefault: true }), edge({ target: 'n_yes', condition: 'amount > 10' })];
    expect(withBranchTargets(DEC, branches, edges)).toEqual([
      { label: 'Yes', expression: 'amount > 10', target: 'n_yes' },
      { label: 'No', expression: 'true', target: 'n_no' },
    ]);
  });

  it('matches a `{ dialect, source }` edge condition against the branch expression', () => {
    const branches = [{ label: 'Hot', expression: 'score > 90' }];
    const edges = [edge({ target: 'n1', condition: { dialect: 'cel', source: 'score > 90' } })];
    expect(withBranchTargets(DEC, branches, edges)[0].target).toBe('n1');
  });

  it('falls back to by-order pairing for unbound edges (#1927 legacy flows)', () => {
    const branches = [{ label: 'A', expression: 'a' }, { label: 'B', expression: 'b' }];
    const edges = [edge({ target: 'n1' }), edge({ target: 'n2' })]; // unstamped
    expect(withBranchTargets(DEC, branches, edges).map((b) => b.target)).toEqual(['n1', 'n2']);
  });

  it('skips fault/back edges and other nodes’ edges; leaves surplus branches target-less', () => {
    const branches = [{ label: 'A', expression: 'a' }, { label: 'B', expression: 'b' }];
    const edges = [
      edge({ target: 'n_err', type: 'fault' }),
      edge({ target: 'n_loop', type: 'back' }),
      { source: 'other', target: 'nx' },
      edge({ target: 'n1', condition: 'a' }),
    ];
    const out = withBranchTargets(DEC, branches, edges);
    expect(out[0].target).toBe('n1');
    expect(out[1].target).toBeUndefined();
  });

  it('drops a stale stored `target` key that no edge backs (edges are the source of truth)', () => {
    const branches = [{ label: 'A', expression: 'a', target: 'n_ghost' }];
    expect(withBranchTargets(DEC, branches, [])).toEqual([{ label: 'A', expression: 'a' }]);
  });
});

describe('applyDecisionBranches — commit reconciliation (#1942)', () => {
  it('strips the virtual target column from the stored conditions', () => {
    const { conditions } = applyDecisionBranches(DEC, [{ label: 'A', expression: 'a', target: 'n1' }], [], []);
    expect(conditions).toEqual([{ label: 'A', expression: 'a' }]);
  });

  it('creates the out-edge when the branch has a target but no edge yet', () => {
    const { edges } = applyDecisionBranches(
      DEC,
      [
        { label: 'Yes', expression: 'amount > 10', target: 'n_yes' },
        { label: 'Else', expression: 'true', target: 'n_no' },
      ],
      [],
      [],
    );
    expect(edges).toEqual([
      { id: 'edge_1', source: DEC, target: 'n_yes', label: 'Yes', condition: 'amount > 10' },
      { id: 'edge_2', source: DEC, target: 'n_no', label: 'Else', isDefault: true },
    ]);
  });

  it('mints ids around the ones the flow already uses — and around its own, within one commit (#3202)', () => {
    // `edge_1` belongs to another node's edge, `edge_2` to this decision's own
    // (claimed by branch A); the two created edges must dodge both AND each
    // other — the taken-id set has to grow as this single commit mints.
    const existing = [
      { id: 'edge_1', source: 'other', target: 'n0' },
      edge({ id: 'edge_2', target: 'n1', condition: 'a' }),
    ];
    const { edges } = applyDecisionBranches(
      DEC,
      [
        { label: 'A', expression: 'a', target: 'n1' },
        { label: 'B', expression: 'b', target: 'n2' },
        { label: 'C', expression: 'c', target: 'n3' },
      ],
      existing,
      [{ label: 'A', expression: 'a' }],
    );
    expect(edges.map((e) => e.id)).toEqual(['edge_1', 'edge_2', 'edge_3', 'edge_4']);
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
  });

  it('updates the existing edge in place, carrying condition/label/default', () => {
    // The branch's own edge: the stored branch it replaces owned it (objectui#13138 —
    // a conditioned edge no branch owns is never rewritten, see the addBranch pins).
    const existing = [edge({ id: 'e1', target: 'n1', condition: 'old' })];
    const { edges } = applyDecisionBranches(DEC, [{ label: 'A', expression: 'fresh', target: 'n1' }], existing, [
      { label: 'A', expression: 'old' },
    ]);
    expect(edges).toEqual([{ id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'fresh' }]);
  });

  it('retargets the branch’s bound edge when a different node is picked (edge identity kept)', () => {
    const existing = [edge({ id: 'e1', target: 'n1', condition: 'a', label: 'A' })];
    const { edges } = applyDecisionBranches(DEC, [{ label: 'A', expression: 'a', target: 'n3' }], existing, [
      { label: 'A', expression: 'a' },
    ]);
    expect(edges).toEqual([{ id: 'e1', source: DEC, target: 'n3', label: 'A', condition: 'a' }]);
  });

  it('prefers target+binding matches so twin edges to one node keep their own branches', () => {
    // A moves n1 → n3 while B stays on n1; e2 is B's edge (binds B), e1 is A's.
    const existing = [
      edge({ id: 'eA', target: 'n1', condition: 'a' }),
      edge({ id: 'eB', target: 'n1', condition: 'b' }),
    ];
    const { edges } = applyDecisionBranches(
      DEC,
      [
        { label: 'A', expression: 'a', target: 'n3' },
        { label: 'B', expression: 'b', target: 'n1' },
      ],
      existing,
      [
        { label: 'A', expression: 'a' },
        { label: 'B', expression: 'b' },
      ],
    );
    expect(edges).toEqual([
      { id: 'eA', source: DEC, target: 'n3', label: 'A', condition: 'a' },
      { id: 'eB', source: DEC, target: 'n1', label: 'B', condition: 'b' },
    ]);
  });

  it('clearing a target detaches the branch’s edge — other edges and nodes untouched', () => {
    const existing = [
      edge({ id: 'e1', target: 'n1', condition: 'a' }),
      edge({ id: 'e2', target: 'n2', isDefault: true }),
    ];
    const { edges } = applyDecisionBranches(
      DEC,
      [
        { label: 'A', expression: 'a' }, // target cleared
        { label: 'Else', expression: 'true', target: 'n2' },
      ],
      existing,
      [
        { label: 'A', expression: 'a' },
        { label: 'Else', expression: 'true' },
      ],
    );
    expect(edges).toEqual([{ id: 'e2', source: DEC, target: 'n2', label: 'Else', isDefault: true }]);
  });

  it('never deletes custom / surplus / fault edges bound to no branch', () => {
    const existing = [
      edge({ id: 'custom', target: 'n9', condition: 'hand > written' }),
      edge({ id: 'fault', target: 'n_err', type: 'fault' }),
      edge({ id: 'e1', target: 'n1', condition: 'a' }),
    ];
    const { edges } = applyDecisionBranches(
      DEC,
      [
        { label: 'A', expression: 'a', target: 'n1' },
        { label: 'New', expression: 'n' }, // no target, binds nothing
      ],
      existing,
      [{ label: 'A', expression: 'a' }],
    );
    expect(edges).toEqual(existing.map((e, i) => (i === 2 ? { ...e, label: 'A' } : e)));
  });

  it('falls back to the by-order mirror when no branch carries a target (server-schema form)', () => {
    const existing = [edge({ id: 'e1', target: 'n1' }), edge({ id: 'e2', target: 'n2' })];
    const { conditions, edges } = applyDecisionBranches(
      DEC,
      [
        { label: 'A', expression: 'a' },
        { label: 'Else', expression: 'true' },
      ],
      existing,
      [],
    );
    expect(conditions).toEqual([
      { label: 'A', expression: 'a' },
      { label: 'Else', expression: 'true' },
    ]);
    expect(edges).toEqual([
      { id: 'e1', source: DEC, target: 'n1', label: 'A', condition: 'a' },
      { id: 'e2', source: DEC, target: 'n2', label: 'Else', isDefault: true },
    ]);
  });

  it('round-trips with the FlowEdgeInspector branch picker: apply, then re-derive', () => {
    const committed = [
      { label: 'Yes', expression: 'amount > 10', target: 'n_yes' },
      { label: 'Else', expression: 'true', target: 'n_no' },
    ];
    const { conditions, edges } = applyDecisionBranches(DEC, committed, [], []);
    // The edge the picker (#1930) would select for each branch is the one we
    // wrote — and the display derivation re-injects the exact same targets.
    expect(edges.every((e, i) => edgeBindsBranch(conditions[i], e))).toBe(true);
    expect(withBranchTargets(DEC, conditions, edges)).toEqual(committed);
  });
});

describe('syncDecisionEdgesByOrder — legacy #1927 mirror', () => {
  it('stamps branch i onto the i-th plain out-edge, leaving fault/back/surplus alone', () => {
    const edges = [
      edge({ target: 'n_err', type: 'fault' }),
      edge({ target: 'n1' }),
      edge({ target: 'n2' }),
      edge({ target: 'n3', condition: 'stale' }),
    ];
    const out = syncDecisionEdgesByOrder(
      DEC,
      [
        { label: 'A', expression: 'a' },
        { label: 'Else', expression: 'true' },
      ],
      edges,
      [],
    );
    expect(out).toEqual([
      edges[0],
      { source: DEC, target: 'n1', label: 'A', condition: 'a' },
      { source: DEC, target: 'n2', label: 'Else', isDefault: true },
      edges[3],
    ]);
  });

  it('an empty expression clears both guard and default flag', () => {
    const out = syncDecisionEdgesByOrder(DEC, [{ label: 'A' }], [edge({ target: 'n1', condition: 'x', isDefault: true })], []);
    expect(out).toEqual([{ source: DEC, target: 'n1', label: 'A' }]);
  });
});

/**
 * The gate (objectui#3202, the one #3171 asked for — pointed at the shape that
 * actually fails).
 *
 * Both reconcilers below produce a COMMITTED edge list: it goes to `onPatch` →
 * draft → save, is live-validated against `FlowSchema` in `clientValidation.ts`,
 * and is parsed by the server with this very schema. So "the designer's own
 * output is spec-legal" is not a nicety, it is the contract — and it is
 * checkable in one line, which is why it is checked on EVERY edge of EVERY
 * scenario rather than spot-checked.
 *
 * What it caught when written: `applyDecisionBranches` created branch edges with
 * no `id`, while `FlowEdgeSchema.id` is a required `z.string()` — the designer
 * drawing an edge it then marks red in its own draft validation, for an author
 * who did nothing wrong and has no UI to supply the missing id.
 *
 * Reading a failure: the INPUT edges of every case are spec-clean, so an issue
 * reported here is one these functions minted or mangled, never one they were
 * handed. (`FlowEdgeSchema` is `.strict()`, so a stray extra key on an input
 * fixture would fail as loudly — keep them spec-shaped.)
 */
describe('spec gate — every produced edge satisfies FlowEdgeSchema (#3202)', () => {
  /** Every schema violation across an edge list, addressed for the failure message. */
  const violations = (edges: DecisionEdge[]): string[] =>
    edges.flatMap((e, i) => {
      const parsed = FlowEdgeSchema.safeParse(e);
      return parsed.success
        ? []
        : parsed.error.issues.map((iss) => `edges[${i}].${iss.path.join('.') || '(root)'}: ${iss.message}`);
    });

  const CASES: Array<{ name: string; produce: () => DecisionEdge[] }> = [
    {
      name: 'applyDecisionBranches — creates every edge from scratch (the #3202 repro)',
      produce: () =>
        applyDecisionBranches(
          DEC,
          [
            { label: 'Yes', expression: 'amount > 10', target: 'n_yes' },
            { label: 'Maybe', expression: 'amount > 5', target: 'n_maybe' },
            { label: 'Else', expression: 'true', target: 'n_no' },
          ],
          [],
          [],
        ).edges,
    },
    {
      name: 'applyDecisionBranches — created default edge (no condition, isDefault)',
      produce: () => applyDecisionBranches(DEC, [{ label: 'Else', expression: 'true', target: 'n_no' }], [], []).edges,
    },
    {
      name: 'applyDecisionBranches — mixes creation with update-in-place and retarget',
      produce: () =>
        applyDecisionBranches(
          DEC,
          [
            { label: 'A', expression: 'a', target: 'n9' },
            { label: 'B', expression: 'b', target: 'n2' },
          ],
          [{ id: 'edge_1', source: DEC, target: 'n1', condition: 'a', label: 'A' }],
          [{ label: 'A', expression: 'a' }],
        ).edges,
    },
    {
      name: 'applyDecisionBranches — detaches a cleared branch, keeps unbound edges',
      produce: () =>
        applyDecisionBranches(
          DEC,
          [
            { label: 'A', expression: 'a' },
            { label: 'Else', expression: 'true', target: 'n2' },
          ],
          [
            { id: 'edge_1', source: DEC, target: 'n1', condition: 'a' },
            { id: 'edge_2', source: DEC, target: 'n2', isDefault: true },
            { id: 'edge_3', source: DEC, target: 'n_err', type: 'fault' },
          ],
          [
            { label: 'A', expression: 'a' },
            { label: 'Else', expression: 'true' },
          ],
        ).edges,
    },
    {
      name: 'applyDecisionBranches — carries an authored { dialect, source } envelope through',
      produce: () =>
        applyDecisionBranches(
          DEC,
          [{ label: 'Hot', expression: 'score > 90', target: 'n1' }],
          [{ id: 'edge_1', source: DEC, target: 'n1', condition: { dialect: 'cel', source: 'score > 90' } }],
          [{ label: 'Hot', expression: 'score > 90' }],
        ).edges,
    },
    {
      name: 'applyDecisionBranches — falls back to the by-order mirror (no targets)',
      produce: () =>
        applyDecisionBranches(
          DEC,
          [
            { label: 'A', expression: 'a' },
            { label: 'Else', expression: 'true' },
          ],
          [
            { id: 'edge_1', source: DEC, target: 'n1' },
            { id: 'edge_2', source: DEC, target: 'n2' },
          ],
          [],
        ).edges,
    },
    {
      name: 'syncDecisionEdgesByOrder — stamps guards onto existing edges',
      produce: () =>
        syncDecisionEdgesByOrder(
          DEC,
          [
            { label: 'A', expression: 'a' },
            { label: 'Else', expression: 'true' },
          ],
          [
            { id: 'edge_1', source: DEC, target: 'n_err', type: 'fault' },
            { id: 'edge_2', source: DEC, target: 'n1' },
            { id: 'edge_3', source: DEC, target: 'n2', condition: 'stale', isDefault: false },
            { id: 'edge_4', source: DEC, target: 'n3', type: 'back' },
          ],
          [],
        ),
    },
    {
      name: 'syncDecisionEdgesByOrder — clears guard and default flag on an empty expression',
      produce: () =>
        syncDecisionEdgesByOrder(
          DEC,
          [{ label: 'A' }],
          [{ id: 'edge_1', source: DEC, target: 'n1', condition: 'x', isDefault: true }],
          [],
        ),
    },
  ];

  it.each(CASES)('$name', ({ produce }) => {
    const edges = produce();
    expect(edges.length).toBeGreaterThan(0);
    expect(violations(edges)).toEqual([]);
  });

  it('would have failed before the fix — an id-less edge is a schema violation, not a warning', () => {
    // Pins WHY the gate above bites: this is exactly the edge the old
    // `applyDecisionBranches` pushed, and the schema rejects it outright.
    expect(violations([{ source: DEC, target: 'n_yes', label: 'Yes', condition: 'amount > 10' }])).toEqual([
      'edges[0].id: Invalid input: expected string, received undefined',
    ]);
  });
});
