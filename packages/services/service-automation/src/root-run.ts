// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0162 Execution item 7, "The root run"] The run a tree of runs was
 * started on, and the run that carries a run's record, handed to every run of
 * the tree at any depth.
 *
 * A child run (a `subflow` body or a `map` item) knows its IMMEDIATE parent
 * only: the engine links it upward by `$parentRunId`, and nothing on the child
 * names the run at the top of the tree. A consumer that has to tell which runs
 * belong to one whole approval (the approvals plugin, which records both runs
 * on every request it opens) cannot walk those links itself: the plugin's
 * reader of a run does not answer a run's context. So the engine stamps both
 * on the run's context, where every node executor receives them:
 *
 *  - **the root run** (`$rootRun`): the run the tree was started on. A run with
 *    no parent is its own root, stamped at start (`execute()` and every retry
 *    attempt of it); a child carries its parent's over, because a `subflow` or
 *    `map` node builds the child's context from its own, and the stamp rides
 *    that copy and every suspension of it;
 *  - **the record run** (`$recordRun`): the highest run, from this run up,
 *    over which the record does not change. It is the root run, or the `map`
 *    item run whose item is itself a record (the `map` node hands that item to
 *    the child as its `record`). A `subflow` child, and a `map` item that is
 *    not a record, inherit their parent's record and so its record run. One
 *    whole approval can carry several records (one per `map` item); the record
 *    run tells them apart, where the root run cannot;
 *  - a run parked before these stamps existed carries neither key, and gets
 *    both when the engine resumes it, derived in one walk of its links to its
 *    parents ({@link deriveRunLinks}).
 *
 * A key present with the value `null` means the engine stamped the run and
 * could not place it (its tree could not be read whole): such a run is not
 * derived again on every resume, and a child it starts inherits the `null`.
 *
 * The keys are plain strings, not symbols: a suspended run's context crosses
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

/**
 * The run that carries a run's record: the highest run, from that run up,
 * over which the record does not change. The root run, or a `map` item run
 * whose item is a record.
 */
export interface RecordRun {
    /** The record run's id. */
    runId: string;
    /** The object of the record it carries, or `null` for a run on no record. */
    object: string | null;
    /** The id of the record it carries, or `null` for a run on no record. */
    recordId: string | null;
}

/** The context key the root run rides on. Engine-owned, like `$parentRunId`. */
export const ROOT_RUN_CONTEXT_KEY = '$rootRun';
/** The context key the record run rides on. Engine-owned, like `$parentRunId`. */
export const RECORD_RUN_CONTEXT_KEY = '$recordRun';

const MAX_DERIVATION_HOPS = 32;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value !== '';
}

function nullableString(value: unknown): value is string | null {
    return value === null || isNonEmptyString(value);
}

/** The root run `context` carries, when it carries a well-formed one. */
export function readRootRun(context: unknown): RootRun | undefined {
    const raw = (context as Record<string, unknown> | undefined)?.[ROOT_RUN_CONTEXT_KEY] as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== 'object') return undefined;
    if (!isNonEmptyString(raw.runId) || !isNonEmptyString(raw.flowName) || !isNonEmptyString(raw.startedAt)) return undefined;
    if (!nullableString(raw.object)) return undefined;
    return { runId: raw.runId, flowName: raw.flowName, object: raw.object, startedAt: raw.startedAt };
}

/** The record run `context` carries, when it carries a well-formed one. */
export function readRecordRun(context: unknown): RecordRun | undefined {
    const raw = (context as Record<string, unknown> | undefined)?.[RECORD_RUN_CONTEXT_KEY] as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== 'object') return undefined;
    if (!isNonEmptyString(raw.runId) || !nullableString(raw.object) || !nullableString(raw.recordId)) return undefined;
    return { runId: raw.runId, object: raw.object, recordId: raw.recordId };
}

/**
 * Whether the engine has stamped `context` at all: `false` only for a run
 * parked before root runs were stamped, whose context carries no key.
 */
export function isRunLinkStamped(context: unknown): boolean {
    return context != null && typeof context === 'object' && ROOT_RUN_CONTEXT_KEY in context;
}

/** Whether `context` is a child run's: linked upward by `$parentRunId`, as the engine's own readers read it. */
export function hasParentRun(context: unknown): boolean {
    return isNonEmptyString((context as { $parentRunId?: unknown } | undefined)?.$parentRunId);
}

/** The record a run's context names: its object and its record's id, each `null` when absent. */
function recordOf(context: unknown): { object: string | null; recordId: string | null } {
    const ctx = context as { object?: unknown; record?: { id?: unknown } } | undefined;
    const id = ctx?.record?.id;
    return {
        object: isNonEmptyString(ctx?.object) ? ctx.object : null,
        recordId: isNonEmptyString(id) ? id : typeof id === 'number' ? String(id) : null,
    };
}

function sameRecord(a: { object: string | null; recordId: string | null }, b: { object: string | null; recordId: string | null }): boolean {
    return a.object === b.object && a.recordId === b.recordId;
}

function recordRunOf(runId: string, context: unknown): RecordRun {
    return { runId, ...recordOf(context) };
}

/**
 * Stamp a starting run's own context (the run context the engine built for
 * it, never the caller's) with its root run and its record run.
 *
 * A run with no parent is its own root and its own record run, whatever an
 * incoming context carried: that context's tree is not this run's. A child
 * keeps the root it inherited from its parent's context, and its parent's
 * record run where it carries the same record, else is its own record run. A
 * child whose parent could not be placed (no root, or a `null` one) is stamped
 * `null` on both: a child is never mistaken for a root.
 */
export function stampRootRun(
    runContext: object,
    self: { runId: string; flowName: string; startedAt: string },
): void {
    const stamped = runContext as Record<string, unknown>;
    if (hasParentRun(runContext)) {
        const inheritedRoot = readRootRun(runContext);
        if (!inheritedRoot) {
            stamped[ROOT_RUN_CONTEXT_KEY] = null;
            stamped[RECORD_RUN_CONTEXT_KEY] = null;
            return;
        }
        stamped[ROOT_RUN_CONTEXT_KEY] = inheritedRoot;
        const inheritedRecord = readRecordRun(runContext);
        stamped[RECORD_RUN_CONTEXT_KEY] = inheritedRecord && sameRecord(inheritedRecord, recordOf(runContext))
            ? inheritedRecord
            : recordRunOf(self.runId, runContext);
        return;
    }
    stamped[ROOT_RUN_CONTEXT_KEY] = {
        runId: self.runId,
        flowName: self.flowName,
        object: recordOf(runContext).object,
        startedAt: self.startedAt,
    } satisfies RootRun;
    stamped[RECORD_RUN_CONTEXT_KEY] = recordRunOf(self.runId, runContext);
}

/** The parked runs {@link deriveRunLinks} reads: a run's id, the key its flow is filed under, its context and its start. */
export interface ParkedRunLink {
    runId: string;
    flowName: string;
    context: AutomationContext;
    startedAt: string;
}

/**
 * What {@link deriveRunLinks} found for a run that carries no stamp.
 *
 *  - `derived`: the root run, read off the top of the run's chain of parents
 *    (or off the first parent that already carries one), and the record run,
 *    the highest run of that chain over which the record does not change;
 *  - `unplaced`: a parent the chain names is not parked, or the chain is
 *    longer than any nesting the engine runs, so the run's tree cannot be
 *    read whole. `reason` says why.
 *
 * A parked run's parent that the store cannot READ is neither: the loader's
 * throw propagates, so the caller can refuse the resume before it consumes
 * anything, and the identical resume can be retried.
 */
export type RunLinkDerivation =
    | { kind: 'derived'; rootRun: RootRun; recordRun: RecordRun }
    | { kind: 'unplaced'; reason: string };

/**
 * Derive the root run and the record run of a parked run that carries no
 * stamp: a run parked before the engine stamped them. One walk of the run's
 * `$parentRunId` links through the parked runs (a parent stays parked at its
 * `subflow` or `map` node while its child is parked). `load` must be the
 * STRICT loader: it answers `null` only for a run that is not parked, and
 * throws when the store cannot be read.
 */
export async function deriveRunLinks(
    run: ParkedRunLink,
    load: (runId: string) => Promise<ParkedRunLink | null>,
): Promise<RunLinkDerivation> {
    let current = run;
    let recordRun: RecordRun | undefined;
    for (let hops = 0; hops <= MAX_DERIVATION_HOPS; hops++) {
        if (hops > 0) {
            const carried = readRootRun(current.context);
            if (carried) {
                return {
                    kind: 'derived',
                    rootRun: carried,
                    recordRun: recordRun ?? readRecordRun(current.context) ?? recordRunOf(current.runId, current.context),
                };
            }
        }
        if (!hasParentRun(current.context)) {
            return {
                kind: 'derived',
                rootRun: {
                    runId: current.runId,
                    flowName: current.flowName,
                    object: recordOf(current.context).object,
                    startedAt: current.startedAt,
                },
                recordRun: recordRun ?? recordRunOf(current.runId, current.context),
            };
        }
        const parentId = (current.context as { $parentRunId: string }).$parentRunId;
        const parent = await load(parentId);
        if (!parent) {
            return { kind: 'unplaced', reason: `its parent run '${parentId}' is not parked` };
        }
        if (recordRun === undefined && !sameRecord(recordOf(current.context), recordOf(parent.context))) {
            recordRun = recordRunOf(current.runId, current.context);
        }
        current = parent;
    }
    return { kind: 'unplaced', reason: `its chain of parent runs is longer than ${MAX_DERIVATION_HOPS} links` };
}
