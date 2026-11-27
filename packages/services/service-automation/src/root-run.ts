// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0162 Execution item 7, "The root run"] The run a tree of runs was
 * started on, handed to every run of the tree at any depth.
 *
 * A child run (a `subflow` body or a `map` item) knows its IMMEDIATE parent
 * only: the engine links it upward by `$parentRunId`, and nothing on the child
 * names the run at the top of the tree. A consumer that has to tell which runs
 * belong to one whole approval (the approvals plugin, which records the root
 * run on every request it opens) cannot walk those links itself: the plugin's
 * reader of a run does not answer a run's context. So the engine stamps the
 * root run on the run's context, where every node executor receives it:
 *
 *  - a run with no parent is its own root, stamped at start (`execute()` and
 *    every retry attempt of it);
 *  - a child run carries its parent's root over, because a `subflow` or `map`
 *    node builds the child's context from its own, and the stamp rides that
 *    copy and every suspension of it;
 *  - a run parked before this stamp existed carries none, and gets one when
 *    the engine resumes it, derived from its links to its parents
 *    ({@link deriveRootRun}).
 *
 * The key is a plain string, not a symbol: a suspended run's context crosses
 * JSON on its way to the durable store and back, and a symbol does not.
 */

import type { AutomationContext } from '@objectstack/spec/contracts';

/**
 * The run a tree of runs was started on. Every member is the root run's own,
 * whichever run of the tree reads it.
 */
export interface RootRun {
    /** The root run's id. Equal to the reading run's own id on the root run itself. */
    runId: string;
    /** The key the engine files the root run's flow under (its slot key, `SuspendedRun.flowName`). */
    flowName: string;
    /**
     * The object of the root run's record, or `null` for a root run started
     * on no record (a batch sign-off that hands a `map` its items). Never a
     * `map` item's object: an item run's own `object` names its item.
     */
    object: string | null;
    /** When the root run started (ISO 8601), as its run history records it. */
    startedAt: string;
}

/** The context key the root run rides on. Engine-owned, like `$parentRunId`. */
export const ROOT_RUN_CONTEXT_KEY = '$rootRun';

const MAX_DERIVATION_HOPS = 32;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

/** The root run `context` carries, when it carries a well-formed one. */
export function readRootRun(context: unknown): RootRun | undefined {
    const raw = (context as Record<string, unknown> | undefined)?.[ROOT_RUN_CONTEXT_KEY] as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') return undefined;
    if (!isNonEmptyString(raw.runId) || !isNonEmptyString(raw.flowName) || !isNonEmptyString(raw.startedAt)) return undefined;
    if (raw.object !== null && !isNonEmptyString(raw.object)) return undefined;
    return { runId: raw.runId, flowName: raw.flowName, object: raw.object, startedAt: raw.startedAt };
}

/** Whether `context` is a child run's: linked upward by `$parentRunId`, as the engine's own readers read it. */
export function hasParentRun(context: unknown): boolean {
    return isNonEmptyString((context as { $parentRunId?: unknown } | undefined)?.$parentRunId);
}

/** The object a run's context names, as a root run records it: a non-empty string, else `null`. */
function objectOf(context: unknown): string | null {
    const object = (context as { object?: unknown } | undefined)?.object;
    return isNonEmptyString(object) ? object : null;
}

/**
 * Stamp a starting run's own context (the run context the engine built for
 * it, never the caller's) with its root run.
 *
 * A run with no parent is its own root, whatever root an incoming context
 * carried: that context's tree is not this run's. A child run keeps the root
 * it inherited from its parent's context. A child whose parent carried none
 * (its derivation failed, see {@link deriveRootRun}) gets none: a child is
 * never mistaken for a root.
 */
export function stampRootRun(
    runContext: object,
    self: { runId: string; flowName: string; startedAt: string },
): void {
    const stamped = runContext as Record<string, unknown>;
    if (hasParentRun(runContext)) {
        const inherited = readRootRun(runContext);
        if (inherited) stamped[ROOT_RUN_CONTEXT_KEY] = inherited;
        else delete stamped[ROOT_RUN_CONTEXT_KEY];
        return;
    }
    stamped[ROOT_RUN_CONTEXT_KEY] = {
        runId: self.runId,
        flowName: self.flowName,
        object: objectOf(runContext),
        startedAt: self.startedAt,
    } satisfies RootRun;
}

/** The parked runs {@link deriveRootRun} reads: a run's id, the key its flow is filed under, its context and its start. */
export interface ParkedRunLink {
    runId: string;
    flowName: string;
    context: AutomationContext;
    startedAt: string;
}

/**
 * What {@link deriveRootRun} found for a run that carries no root run.
 *
 *  - `derived`: the root run, read off the top of the run's chain of parents
 *    (or off the first parent that already carries one);
 *  - `unplaced`: a parent the chain names is not parked, or the chain is
 *    longer than any nesting the engine runs, so the run's tree cannot be
 *    read whole. The run continues with no root run; `reason` says why.
 *
 * A parked run's parent that the store cannot READ is neither: the loader's
 * throw propagates, so the caller can refuse the resume before it consumes
 * anything, and the identical resume can be retried.
 */
export type RootRunDerivation =
    | { kind: 'derived'; rootRun: RootRun }
    | { kind: 'unplaced'; reason: string };

/**
 * Derive the root run of a parked run that carries none: a run parked before
 * the engine stamped root runs. Walks the run's `$parentRunId` links through
 * the parked runs (a parent stays parked at its `subflow` or `map` node while
 * its child is parked), and reads the root off the run at the top. `load`
 * must be the STRICT loader: it answers `null` only for a run that is not
 * parked, and throws when the store cannot be read.
 */
export async function deriveRootRun(
    run: ParkedRunLink,
    load: (runId: string) => Promise<ParkedRunLink | null>,
): Promise<RootRunDerivation> {
    let current = run;
    for (let hops = 0; hops <= MAX_DERIVATION_HOPS; hops++) {
        if (hops > 0) {
            const carried = readRootRun(current.context);
            if (carried) return { kind: 'derived', rootRun: carried };
        }
        if (!hasParentRun(current.context)) {
            return {
                kind: 'derived',
                rootRun: {
                    runId: current.runId,
                    flowName: current.flowName,
                    object: objectOf(current.context),
                    startedAt: current.startedAt,
                },
            };
        }
        const parentId = (current.context as { $parentRunId: string }).$parentRunId;
        const parent = await load(parentId);
        if (!parent) {
            return { kind: 'unplaced', reason: `its parent run '${parentId}' is not parked` };
        }
        current = parent;
    }
    return { kind: 'unplaced', reason: `its chain of parent runs is longer than ${MAX_DERIVATION_HOPS} links` };
}
