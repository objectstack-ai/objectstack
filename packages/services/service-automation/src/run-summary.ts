// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type {
    FlowRunGateSummary,
    FlowRunNodeSummary,
    FlowRunSummary,
} from '@objectstack/spec/automation';
import type { StepLogEntry } from './engine.js';

/**
 * Fold a run's step log into a {@link FlowRunSummary} (#4354).
 *
 * The counters answer the one question no surface could answer before: a
 * scheduled sweep that selects records and writes none looked *identical* to a
 * sweep with nothing to do — both green, both silent, both writing nothing.
 * `selected > 0 && acted === 0` over consecutive runs separates them.
 *
 * Aggregation is a pure fold over the FLAT step log, which is exactly right for
 * structured regions: a `loop` / `parallel` / `try_catch` container returns its
 * body steps as `childSteps` and the engine splices them into the same log, so
 * every iteration is already there — and the container's own step carries no
 * metrics, so nothing is double-counted. Per-node entries fold across
 * executions: a body node that ran 30 times is ONE entry with `runs: 30`.
 *
 * `subflow` is the one exception, and it is deliberate: a child run's steps live
 * in the child's own log, so the `subflow` node reports the child's totals as
 * its own metrics. The parent therefore answers "what did this run cause",
 * including through its subflows — otherwise a sweep that delegates its writes
 * would report `acted: 0` and trip the very detector this exists to feed.
 */
export function summarizeRun(steps: readonly StepLogEntry[]): FlowRunSummary {
    // Mutable accumulators; `status` is decided once the counts are final.
    const nodes = new Map<string, FlowRunNodeSummary>();
    const gates = new Map<string, FlowRunGateSummary>();
    let selected = 0;
    let acted = 0;
    let skipped = 0;

    for (const step of steps) {
        let node = nodes.get(step.nodeId);
        if (!node) {
            node = {
                nodeId: step.nodeId,
                nodeType: step.nodeType,
                ...(step.nodeLabel ? { nodeLabel: step.nodeLabel } : {}),
                status: 'skipped',
                runs: 0,
                failures: 0,
                skipped: 0,
            };
            nodes.set(step.nodeId, node);
        }

        if (step.status === 'skipped') {
            // A gate closed in front of this node — it never ran, so it counts
            // as neither a run nor a failure.
            node.skipped += 1;
            skipped += 1;
            const by = step.skippedBy;
            if (by) {
                // NUL joiner (written as the escape, never the raw byte): an
                // edge id is author-supplied text, so any printable separator
                // could appear inside one and collide two distinct gates.
                const key = `${by.nodeId}\u0000${by.edgeId ?? ''}\u0000${step.nodeId}`;
                const gate = gates.get(key);
                if (gate) {
                    gate.skipped += 1;
                } else {
                    gates.set(key, {
                        nodeId: by.nodeId,
                        targetNodeId: step.nodeId,
                        ...(by.edgeId ? { edgeId: by.edgeId } : {}),
                        ...(by.label ? { label: by.label } : {}),
                        skipped: 1,
                    });
                }
            }
            continue;
        }

        node.runs += 1;
        if (step.status === 'failure') node.failures += 1;

        const metrics = step.metrics;
        if (metrics?.selected !== undefined) {
            node.selected = (node.selected ?? 0) + metrics.selected;
            selected += metrics.selected;
        }
        if (metrics?.acted !== undefined) {
            node.acted = (node.acted ?? 0) + metrics.acted;
            acted += metrics.acted;
        }
    }

    for (const node of nodes.values()) {
        // Worst outcome wins: one failed iteration makes the node's run-level
        // status `failure`, and `runs`/`failures` carry the nuance. A node that
        // only ever got skipped never ran at all.
        node.status = node.failures > 0 ? 'failure' : node.runs > 0 ? 'success' : 'skipped';
    }

    return {
        selected,
        acted,
        skipped,
        nodes: [...nodes.values()],
        gates: [...gates.values()].sort((a, b) => b.skipped - a.skipped),
    };
}

/**
 * The single structured line a terminal run logs (#4354) — the minimum viable
 * version of this feature, and the one that works with no console at all:
 * `grep 'selected=' | grep 'acted=0'` turns an invisible failure into a
 * greppable one.
 *
 * Deliberately flat `key=value` pairs on ONE line: a run summary split across
 * lines cannot be grepped, and a JSON blob cannot be read by eye. The
 * top gate is named inline because "which condition closed" is the first
 * question a `selected>0 acted=0` line provokes.
 */
export function formatRunSummaryLine(
    params: {
        flowName: string;
        runId: string;
        status: string;
        durationMs?: number;
    },
    summary: FlowRunSummary,
): string {
    const parts = [
        '[automation] run',
        `flow=${params.flowName}`,
        `run=${params.runId}`,
        `status=${params.status}`,
    ];
    if (params.durationMs !== undefined) parts.push(`durationMs=${params.durationMs}`);
    parts.push(
        `selected=${summary.selected}`,
        `acted=${summary.acted}`,
        `skipped=${summary.skipped}`,
    );
    const topGate = summary.gates[0];
    if (topGate) {
        parts.push(`gate=${topGate.nodeId}->${topGate.targetNodeId}:${topGate.skipped}`);
    }
    return parts.join(' ');
}
