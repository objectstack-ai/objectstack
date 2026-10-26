// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchFlowRuns, errorText, buildStepTree, regionLabel, groupChildren, parallelBranchIndex } from './FlowRunsPanel';
import type { StepTreeNode } from './FlowRunsPanel';

const RUN = {
  id: 'run-1',
  status: 'completed',
  startedAt: '2026-06-01T10:00:00Z',
  durationMs: 42,
  steps: [{ nodeId: 'start', nodeType: 'start', status: 'success' }],
};

function mockFetch(impl: (url: string) => Promise<Response> | Response) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => impl(String(url))));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchFlowRuns', () => {
  it('parses the dispatcher envelope ({ data: { runs } })', async () => {
    mockFetch(() => new Response(JSON.stringify({ success: true, data: { runs: [RUN] } }), { status: 200 }));
    const runs = await fetchFlowRuns('escalation_flow');
    expect(runs).toEqual([RUN]);
  });

  it('accepts a bare { runs } payload (older backend)', async () => {
    mockFetch(() => new Response(JSON.stringify({ runs: [RUN] }), { status: 200 }));
    expect(await fetchFlowRuns('escalation_flow')).toEqual([RUN]);
  });

  it('URL-encodes the flow name and requests the automation runs route', async () => {
    let requested = '';
    mockFetch((url) => {
      requested = url;
      return new Response(JSON.stringify({ data: { runs: [] } }), { status: 200 });
    });
    await fetchFlowRuns('my flow/v2');
    expect(requested).toContain('/automation/my%20flow%2Fv2/runs');
  });

  it('returns null (degrade, not throw) on 404/501 and on network failure', async () => {
    mockFetch(() => new Response('not found', { status: 404 }));
    expect(await fetchFlowRuns('missing')).toBeNull();

    mockFetch(() => Promise.reject(new Error('offline')));
    expect(await fetchFlowRuns('missing')).toBeNull();
  });

  it('returns null when the payload has no runs array', async () => {
    mockFetch(() => new Response(JSON.stringify({ data: {} }), { status: 200 }));
    expect(await fetchFlowRuns('empty')).toBeNull();
  });
});

describe('errorText', () => {
  it('reads a plain-string error (the engine run-level shape)', () => {
    // Regression: the engine sends `ExecutionLog.error` as a string; the panel
    // previously read `.message` off it and dropped the failure reason.
    expect(errorText("Node 'guarded_push' failed: catch region failed")).toBe(
      "Node 'guarded_push' failed: catch region failed",
    );
  });

  it('reads a { message } object error (the step-level shape)', () => {
    expect(errorText({ code: 'E_BOOM', message: 'kaboom' })).toBe('kaboom');
  });

  it('is empty for no error / empty string / message-less object', () => {
    expect(errorText(undefined)).toBeUndefined();
    expect(errorText(null)).toBeUndefined();
    expect(errorText('')).toBeUndefined();
    expect(errorText({ code: 'E' })).toBeUndefined();
  });
});

// ── #1505: structured-region (loop / parallel / try-catch) step grouping ──

/** Compact a step tree to `nodeId(child,child…)` strings for legible asserts. */
function outline(nodes: StepTreeNode[]): string[] {
  return nodes.map((n) =>
    n.children.length ? `${n.step.nodeId}(${outline(n.children).join(',')})` : n.step.nodeId,
  );
}

describe('buildStepTree', () => {
  it('keeps a flat top-level log flat (no regions)', () => {
    const tree = buildStepTree([
      { nodeId: 'start', status: 'success' },
      { nodeId: 'notify', status: 'success' },
    ]);
    expect(outline(tree)).toEqual(['start', 'notify']);
  });

  it("nests a loop's body steps (across iterations) under the loop node", () => {
    const tree = buildStepTree([
      { nodeId: 'start', status: 'success' },
      { nodeId: 'loop1', nodeType: 'loop', status: 'success' },
      { nodeId: 'send', status: 'success', parentNodeId: 'loop1', iteration: 0, regionKind: 'loop-body' },
      { nodeId: 'log', status: 'success', parentNodeId: 'loop1', iteration: 0, regionKind: 'loop-body' },
      { nodeId: 'send', status: 'success', parentNodeId: 'loop1', iteration: 1, regionKind: 'loop-body' },
      { nodeId: 'log', status: 'success', parentNodeId: 'loop1', iteration: 1, regionKind: 'loop-body' },
    ]);
    expect(outline(tree)).toEqual(['start', 'loop1(send,log,send,log)']);
    // The per-iteration index is preserved on each child (drives the header split).
    expect(tree[1].children.map((c) => c.step.iteration)).toEqual([0, 0, 1, 1]);
  });

  it('nests parallel branch steps under the parallel node', () => {
    const tree = buildStepTree([
      { nodeId: 'par', nodeType: 'parallel', status: 'success' },
      { nodeId: 'a', status: 'success', parentNodeId: 'par', branch: 0, regionKind: 'parallel-branch' },
      { nodeId: 'b', status: 'success', parentNodeId: 'par', branch: 1, regionKind: 'parallel-branch' },
    ]);
    expect(outline(tree)).toEqual(['par(a,b)']);
  });

  it('nests try and catch handler steps under the try_catch node', () => {
    const tree = buildStepTree([
      { nodeId: 'tc', nodeType: 'try_catch', status: 'success' },
      { nodeId: 'risky', status: 'failure', parentNodeId: 'tc', regionKind: 'try' },
      { nodeId: 'recover', status: 'success', parentNodeId: 'tc', regionKind: 'catch' },
    ]);
    expect(outline(tree)).toEqual(['tc(risky,recover)']);
  });

  it('reconstructs nested regions (a loop inside a loop)', () => {
    const tree = buildStepTree([
      { nodeId: 'outer', nodeType: 'loop', status: 'success' },
      { nodeId: 'inner', nodeType: 'loop', status: 'success', parentNodeId: 'outer', iteration: 0, regionKind: 'loop-body' },
      { nodeId: 'body', status: 'success', parentNodeId: 'inner', iteration: 0, regionKind: 'loop-body' },
      { nodeId: 'inner', nodeType: 'loop', status: 'success', parentNodeId: 'outer', iteration: 1, regionKind: 'loop-body' },
      { nodeId: 'body', status: 'success', parentNodeId: 'inner', iteration: 0, regionKind: 'loop-body' },
    ]);
    expect(outline(tree)).toEqual(['outer(inner(body),inner(body))']);
  });

  it('surfaces an orphaned body step (truncated history) at the top level', () => {
    // The loop container step was dropped (e.g. by durable-history compaction);
    // its body step must still show rather than vanish.
    const tree = buildStepTree([
      { nodeId: 'body', status: 'success', parentNodeId: 'gone', iteration: 3, regionKind: 'loop-body' },
    ]);
    expect(outline(tree)).toEqual(['body']);
  });
});

describe('regionLabel', () => {
  it('labels loop iterations 1-based', () => {
    expect(regionLabel({ nodeId: 'x', status: 'success', regionKind: 'loop-body', iteration: 0 })).toBe('Iteration 1');
    expect(regionLabel({ nodeId: 'x', status: 'success', regionKind: 'loop-body', iteration: 4 })).toBe('Iteration 5');
  });
  it('labels parallel branches 1-based', () => {
    expect(regionLabel({ nodeId: 'x', status: 'success', regionKind: 'parallel-branch', branch: 1 })).toBe('Branch 2');
  });
  it('labels try / catch handlers', () => {
    expect(regionLabel({ nodeId: 'x', status: 'success', regionKind: 'try' })).toBe('Try');
    expect(regionLabel({ nodeId: 'x', status: 'success', regionKind: 'catch' })).toBe('Catch');
  });
  it('is null for a top-level step (no region)', () => {
    expect(regionLabel({ nodeId: 'x', status: 'success' })).toBeNull();
  });
});

// ── objectui#7614: `parallel-branch` groups on `branch` ──
//
// objectstack#14414 (ruling A) made `iteration` single-valued — the enclosing
// loop's row — and moved the parallel branch index to its own key, `branch`.
// A record from an engine that predates `branch` is told apart by the record
// itself: a `parallel-branch` step with no `branch` key. Its `iteration` is the
// legacy BRANCH index (see `parallelBranchIndex`).

/** Wrap flat steps as leaf tree nodes, the shape `groupChildren` receives. */
function leaves(steps: Parameters<typeof buildStepTree>[0]): StepTreeNode[] {
  return steps.map((step) => ({ step, children: [] }));
}

/** Compact groups to `label:nodeId,nodeId…` strings for legible asserts. */
function groups(steps: Parameters<typeof buildStepTree>[0]): string[] {
  return groupChildren(leaves(steps)).map((g) => `${g.label}:${g.items.map((i) => i.step.nodeId).join(',')}`);
}

describe('parallel-branch grouping reads `branch` (objectui#7614)', () => {
  it('(a) groups a bare parallel by branch: `branch: 1` is its own group, labelled 1-based', () => {
    expect(
      groups([
        { nodeId: 'a1', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', branch: 0 },
        { nodeId: 'a2', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', branch: 0 },
        { nodeId: 'b1', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', branch: 1 },
      ]),
    ).toEqual(['Branch 1:a1,a2', 'Branch 2:b1']);
  });

  it('(a) stacks the loop row: `branch: 1, iteration: 2` keys on both, and the label names both', () => {
    const step = { nodeId: 'x', status: 'success', regionKind: 'parallel-branch', branch: 1, iteration: 2 };
    expect(parallelBranchIndex(step)).toEqual({ branch: 1, iteration: 2, legacy: false });
    expect(regionLabel(step)).toBe('Branch 2 · Iteration 3');
    expect(regionLabel(step, 'zh-CN')).toBe('分支 2 · 第 3 次迭代');
    // Same row, different branch: two groups (a key on `iteration` alone merges them).
    // Same branch, different row: two groups (a key on `branch` alone merges them).
    expect(
      groups([
        { nodeId: 'p', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', branch: 0, iteration: 2 },
        { nodeId: 'q', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', branch: 1, iteration: 2 },
        { nodeId: 'r', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', branch: 1, iteration: 3 },
      ]),
    ).toEqual(['Branch 1 · Iteration 3:p', 'Branch 2 · Iteration 3:q', 'Branch 2 · Iteration 4:r']);
  });

  it('(b) control: `loop-body` still groups on `iteration`, and ignores a `branch` carried through nesting', () => {
    expect(
      groups([
        { nodeId: 'send', status: 'success', parentNodeId: 'each', regionKind: 'loop-body', iteration: 0 },
        { nodeId: 'log', status: 'success', parentNodeId: 'each', regionKind: 'loop-body', iteration: 0, branch: 1 },
        { nodeId: 'send', status: 'success', parentNodeId: 'each', regionKind: 'loop-body', iteration: 1, branch: 1 },
      ]),
    ).toEqual(['Iteration 1:send,log', 'Iteration 2:send']);
  });

  it('(c) control: `try` / `catch` keep their handler labels and their `iteration` key', () => {
    expect(
      groups([
        { nodeId: 'risky', status: 'failure', parentNodeId: 'tc', regionKind: 'try', iteration: 2, branch: 0 },
        { nodeId: 'risky2', status: 'success', parentNodeId: 'tc', regionKind: 'try', iteration: 2, branch: 0 },
        { nodeId: 'recover', status: 'success', parentNodeId: 'tc', regionKind: 'catch', iteration: 2, branch: 0 },
        { nodeId: 'recover', status: 'success', parentNodeId: 'tc', regionKind: 'catch', iteration: 3, branch: 0 },
      ]),
    ).toEqual(['Try:risky,risky2', 'Catch:recover', 'Catch:recover']);
  });

  it('(d) legacy record (no `branch`): `iteration` is read as the branch index, never as a row', () => {
    const legacy = { nodeId: 'x', status: 'success', regionKind: 'parallel-branch', iteration: 2 };
    expect(parallelBranchIndex(legacy)).toEqual({ branch: 2, legacy: true });
    expect(regionLabel(legacy)).toBe('Branch 3');
    expect(
      groups([
        { nodeId: 'a1', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', iteration: 0 },
        { nodeId: 'a2', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', iteration: 0 },
        { nodeId: 'b1', status: 'success', parentNodeId: 'par', regionKind: 'parallel-branch', iteration: 1 },
      ]),
    ).toEqual(['Branch 1:a1,a2', 'Branch 2:b1']);
  });

  it('(d) legacy record with no index at all stays unnumbered: never defaulted to branch 0', () => {
    const bare = { nodeId: 'x', status: 'success', regionKind: 'parallel-branch' };
    expect(parallelBranchIndex(bare)).toEqual({ branch: undefined, legacy: true });
    expect(regionLabel(bare)).toBe('Branch');
  });
});
