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
 * #7546 added a fourth source of body steps — the FAILED attempts of a
 * `try_catch` try region, which used to be discarded — and the fold needs no
 * special case for them, which is worth stating because the obvious worry is
 * that it does. A try-region node that failed twice before succeeding now folds
 * to `runs: 3, failures: 2, status: 'failure'`, and every one of those numbers
 * is the truth: the node really did execute three times and really did fail
 * twice. That is the same "worst outcome wins, `runs`/`failures` carry the
 * nuance" rule a `loop` body has always folded under (see below) — a retry
 * ladder is just another way for one node to run more than once. The node-level
 * `failure` does NOT propagate to the run, whose status is decided elsewhere
 * from the run's own outcome, so a container that recovered still yields a
 * completed run.
 *
 * The `selected` / `acted` metrics get strictly MORE accurate, not less: a node
 * that wrote rows and then threw carries its counts on its `failure` step
 * (#4354), so a partial write inside an abandoned attempt now reaches the run's
 * totals instead of vanishing — and a partial write that really happened is
 * exactly what `acted` is supposed to count.
 *
 * `subflow` is the one exception, and it is deliberate: a child run's steps live
 * in the child's own log, so the `subflow` node reports the child's totals as
 * its own metrics. The parent therefore answers "what did this run cause",
 * including through its subflows — otherwise a sweep that delegates its writes
 * would report `acted: 0` and trip the very detector this exists to feed.
 *
 * #14456 adds the run-level `failed` counter — `Σ nodes[].failures` — which is
 * the count a GREEN run hides. `loop { body: [ try_catch { try, catch } ] }` is
 * the containment spelling for a per-iteration failure that must not end the
 * sweep (maintainer ruling 2026-08-31, branch B): the failure is caught, the
 * loop goes on and the run completes. Until this counter existed the run row
 * said nothing about it — the caught failure was in the step log and in
 * `nodes[].failures`, but no run-level number carried it, so a run that lost
 * two rows out of five was indistinguishable from one that lost none.
 *
 * It is folded from the per-node array rather than accumulated alongside it,
 * so the run-level count can never disagree with the breakdown it summarizes;
 * `unmeasured` above is a genuinely independent tally and stays one.
 */
export function summarizeRun(steps: readonly StepLogEntry[]): FlowRunSummary {
    // Mutable accumulators; `status` is decided once the counts are final.
    const nodes = new Map<string, FlowRunNodeSummary>();
    const gates = new Map<string, FlowRunGateSummary>();
    let selected = 0;
    let acted = 0;
    let skipped = 0;
    let unmeasured = 0;

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
        if (metrics?.unmeasuredEffect) {
            // Counted per EXECUTION, like `runs` — a connector call in a 30-item
            // loop leaves 30 unmeasured effects, and the alert has to see that
            // the run's `acted` covers none of them.
            node.unmeasured = (node.unmeasured ?? 0) + 1;
            unmeasured += 1;
        }
    }

    // #14456 — `failed = Σ nodes[].failures`, stated as a fold over the SAME
    // array the summary publishes rather than as a second accumulator in the
    // step loop above. Two counters over one fact drift; one addition cannot.
    let failed = 0;
    for (const node of nodes.values()) {
        // Worst outcome wins: one failed iteration makes the node's run-level
        // status `failure`, and `runs`/`failures` carry the nuance. A node that
        // only ever got skipped never ran at all.
        node.status = node.failures > 0 ? 'failure' : node.runs > 0 ? 'success' : 'skipped';
        failed += node.failures;
    }

    return {
        selected,
        acted,
        skipped,
        unmeasured,
        // Every node execution that failed, contained or fatal. A summary this
        // function produced ALWAYS carries it, `0` included; the declared
        // `undefined` case belongs to rows persisted before the counter
        // existed, and means "not tracked", never "nothing failed".
        failed,
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
    // Only when non-zero, like `gate=`: its absence is the common case and its
    // PRESENCE is the thing a reader must not miss — `acted=0` on a line that
    // also says `unmeasured=3` means "cannot tell", not "did nothing".
    // #14456 — printed whenever PRESENT, `failed=0` included, which is the
    // opposite of the `unmeasured` rule directly above and deliberately so.
    // `unmeasured` is a qualifier on `acted`: absent, the zero beside it is
    // trustworthy. `failed` answers a question the line otherwise cannot be
    // asked at all — a completed run says nothing about the rows it lost — so
    // the token has to be there to be read, and `failed=0` is the reading
    // "nothing failed" as against a line with no token at all, which is the
    // older "not tracked". A run summarized by `summarizeRun` always carries
    // it; only a summary persisted before this existed prints nothing here.
    if (summary.failed !== undefined) parts.push(`failed=${summary.failed}`);
    if (summary.unmeasured) parts.push(`unmeasured=${summary.unmeasured}`);
    const topGate = summary.gates[0];
    if (topGate) {
        parts.push(`gate=${topGate.nodeId}->${topGate.targetNodeId}:${topGate.skipped}`);
    }
    return parts.join(' ');
}
