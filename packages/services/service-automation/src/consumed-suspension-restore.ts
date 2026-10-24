// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The consumed-suspension restore of {@link AutomationEngine}: how a consumed
 * suspension's witnesses are resolved, and how a consumed suspension is
 * restored along its chain, peeked at or inspected.
 *
 * [#25222] Slice 7 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link
 * ConsumedSuspensionRestoreHost} literal holding exactly the members the body
 * reads. An async method's stub is no longer `async`: it returns the promise
 * the moved function makes.
 */

import { describeThrownForLog } from './thrown-cause-diagnostics.js';
// The values below (`MAX_RESTORE_CHAIN_HOPS`, `chainEntryOf` and
// `nestedChildRunId`) are read only inside the function bodies, at call time,
// never while a module is evaluating, so the import cycle with ./engine.js is
// safe under ESM live bindings; the tsup bundle is one file and has no cycle.
import {
    MAX_RESTORE_CHAIN_HOPS,
    chainEntryOf,
    nestedChildRunId,
    type AutomationEngine,
    type ChainRestoreEntry,
    type ConsumedSuspension,
    type ConsumedSuspensionDropNotice,
    type ConsumedSuspensionInspection,
    type RunRecord,
    type SuspensionRestoreResult,
} from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field, including where an async body reads it after an `await`.
 * `store` goes through a getter, because `setSuspendedRunStore` reassigns it:
 * each read in the body reads the engine's current value, as it did through
 * `this`.
 */
export interface ConsumedSuspensionRestoreHost {
    readonly consumedSuspensions: AutomationEngine['consumedSuspensions'];
    readonly rowSupersedesJournal: AutomationEngine['rowSupersedesJournal'];
    readonly resolveRestoreChain: AutomationEngine['resolveRestoreChain'];
    readonly restoreOneConsumedSuspension: AutomationEngine['restoreOneConsumedSuspension'];
    readonly peekConsumedSuspension: AutomationEngine['peekConsumedSuspension'];
    readonly loadSuspendedRunStrict: AutomationEngine['loadSuspendedRunStrict'];
    readonly store: AutomationEngine['store'];
    readonly resolveConsumedSuspensionWitnesses: AutomationEngine['resolveConsumedSuspensionWitnesses'];
    readonly logger: AutomationEngine['logger'];
}

/** The body of {@link AutomationEngine.rowSupersedesJournal}, moved unedited; that method's docblock is its contract. */
export function rowSupersedesJournal(
    hot: ConsumedSuspension,
    rowPause: { nodeId?: string; correlation?: string },
): boolean {
    const samePause =
        hot.run.nodeId === rowPause.nodeId &&
        (hot.run.correlation ?? undefined) === (rowPause.correlation ?? undefined);
    if (samePause) return false;
    return hot.persisted === 'landed';
}

/** The body of {@link AutomationEngine.resolveConsumedSuspensionWitnesses}, moved unedited; that method's docblock is its contract. */
export function resolveConsumedSuspensionWitnesses(
    this: Pick<ConsumedSuspensionRestoreHost, 'consumedSuspensions' | 'rowSupersedesJournal'>,
    runId: string,
    terminal: RunRecord | null,
): {
    consumed?: ConsumedSuspension;
    witness?: 'journal' | 'durable';
    dropped?: ConsumedSuspensionDropNotice;
    /** The hot copy describes a pause the run has since LEFT. */
    staleHot: boolean;
} {
    const hot = this.consumedSuspensions.get(runId);
    if (!terminal) {
        return hot ? { consumed: hot, witness: 'journal', staleHot: false } : { staleHot: false };
    }
    if (terminal.consumedSuspension) {
        const durable: ConsumedSuspension = {
            run: terminal.consumedSuspension,
            consumedAt: terminal.finishedAt ?? terminal.startedAt,
            error: terminal.error ?? '',
        };
        if (hot && !this.rowSupersedesJournal(hot, durable.run)) {
            return { consumed: hot, witness: 'journal', staleHot: false };
        }
        return { consumed: durable, witness: 'durable', staleHot: hot !== undefined };
    }
    if (terminal.consumedSuspensionDropped) {
        const dropped = terminal.consumedSuspensionDropped;
        if (hot && !this.rowSupersedesJournal(hot, dropped)) {
            return { consumed: hot, witness: 'journal', dropped, staleHot: false };
        }
        return { dropped, staleHot: hot !== undefined };
    }
    if (hot && hot.persisted !== 'landed') {
        // The row predates this strand — this process's own write for it
        // never reached the store (in flight, or failed and reported at
        // `error`). The store's silence says nothing.
        return { consumed: hot, witness: 'journal', staleHot: false };
    }
    // A later terminal record with no snapshot and no drop notice:
    // completed, cancelled or cascade-failed after any hot copy was
    // taken. Stale by definition.
    return { staleHot: hot !== undefined };
}

/** The body of {@link AutomationEngine.restoreConsumedSuspension}, moved unedited; that method's docblock is its contract. */
export async function restoreConsumedSuspension(
    this: Pick<ConsumedSuspensionRestoreHost, 'resolveRestoreChain' | 'restoreOneConsumedSuspension'>,
    runId: string,
    options?: { requestedBy?: string; reason?: string },
): Promise<SuspensionRestoreResult> {
    // [#15222] Resolve the nested chain FIRST, read-only. A flat run finds
    // nothing here and takes the per-run call below unchanged — same
    // guards, same answer, and a result with no `chain` key at all.
    //
    // A nested one is the whole of this card: the ancestors' pauses were
    // consumed by the same cascade and journalled by
    // {@link failSuspendedRun}, and re-arming only the run the operator
    // named would put the deployment back in the condition the verb exists
    // to leave — a leaf that completes into an ancestor which never
    // continues. So the chain is one unit of repair, and this is the call
    // that makes it one.
    const { below, above } = await this.resolveRestoreChain(runId);
    if (below.length === 0 && above.length === 0) {
        return this.restoreOneConsumedSuspension(runId, options);
    }
    // DEEPEST FIRST, and the order IS the guarantee: an ancestor becomes
    // resumable only after the run it is parked awaiting is parked again,
    // so a resume arriving mid-repair delegates into a live child instead
    // of continuing past a nested node whose child is terminal.
    //
    // Every member goes through the SAME per-run call — its own
    // `restoring` claim, its own strict live-suspension read, its own
    // two-witness read, its own durable park. So the verb's idempotence
    // and the #14333 advance claim hold PER RUN in the chain rather than
    // once for the chain, and a second chain restore finds every member
    // parked and answers `RUN_SUSPENDED` without minting a second pause
    // anywhere.
    const chain: ChainRestoreEntry[] = [];
    for (const memberId of below) {
        chain.push(chainEntryOf(memberId, await this.restoreOneConsumedSuspension(memberId, options, runId)));
    }
    const own = await this.restoreOneConsumedSuspension(runId, options);
    chain.push(chainEntryOf(runId, own));
    for (const memberId of above) {
        chain.push(chainEntryOf(memberId, await this.restoreOneConsumedSuspension(memberId, options, runId)));
    }
    // The six fields above `chain` keep describing the run the caller
    // NAMED, wherever in the chain it sits — a consumer that never heard
    // of nesting reads exactly what it always read.
    return { ...own, chain };
}

/** The body of {@link AutomationEngine.resolveRestoreChain}, moved unedited; that method's docblock is its contract. */
export async function resolveRestoreChain(this: Pick<ConsumedSuspensionRestoreHost, 'peekConsumedSuspension'>, runId: string): Promise<{ below: string[]; above: string[] }> {
    const below: string[] = [];
    const above: string[] = [];
    const self = await this.peekConsumedSuspension(runId);
    if (!self) return { below, above };

    let cursor = self;
    for (let hops = 0; hops < MAX_RESTORE_CHAIN_HOPS; hops++) {
        const childRunId = nestedChildRunId(cursor.run.correlation);
        if (childRunId === undefined || childRunId === runId || below.includes(childRunId)) break;
        const child = await this.peekConsumedSuspension(childRunId, runId);
        if (!child) break;
        below.unshift(childRunId);
        cursor = child;
    }

    cursor = self;
    for (let hops = 0; hops < MAX_RESTORE_CHAIN_HOPS; hops++) {
        const parentRunId = (cursor.run.context as Record<string, unknown> | undefined)?.$parentRunId;
        if (typeof parentRunId !== 'string' || !parentRunId) break;
        if (parentRunId === runId || above.includes(parentRunId)) break;
        const parent = await this.peekConsumedSuspension(parentRunId, runId);
        if (!parent) break;
        above.push(parentRunId);
        cursor = parent;
    }
    return { below, above };
}

/** The body of {@link AutomationEngine.peekConsumedSuspension}, moved unedited; that method's docblock is its contract. */
export async function peekConsumedSuspension(this: Pick<ConsumedSuspensionRestoreHost, 'loadSuspendedRunStrict' | 'store' | 'resolveConsumedSuspensionWitnesses' | 'logger'>, runId: string, chainOf?: string): Promise<ConsumedSuspension | undefined> {
    try {
        if (await this.loadSuspendedRunStrict(runId)) return undefined;
        const terminal = this.store?.loadTerminal ? await this.store.loadTerminal(runId) : null;
        return this.resolveConsumedSuspensionWitnesses(runId, terminal).consumed;
    } catch (err) {
        if (chainOf !== undefined) {
            // #6299 — the driver's own text rides the structured slot.
            // #4632 verdict: FUNCTIONAL — the repair is visibly short (the
            // `chain` this call returns names only what it reached) and the
            // remedy is to re-issue, which is safe per run.
            this.logger.warn(
                `[automation] restoreConsumedSuspension('${chainOf}') could not read run '${runId}' while ` +
                    `walking its nested chain, so the walk STOPPED there and nothing beyond it was re-armed ` +
                    `— the repair this call reports is partial. Nothing was written for that run. Fix the ` +
                    `store failure in this record's meta, then re-issue the restore: it is idempotent per ` +
                    `run and puts back only what is still missing.`,
                describeThrownForLog(err),
            );
        }
        return undefined;
    }
}

/** The body of {@link AutomationEngine.inspectConsumedSuspension}, moved unedited; that method's docblock is its contract. */
export async function inspectConsumedSuspension(this: Pick<ConsumedSuspensionRestoreHost, 'loadSuspendedRunStrict' | 'store' | 'resolveConsumedSuspensionWitnesses'>, runId: string): Promise<ConsumedSuspensionInspection> {
    // Already resumable? STRICT read — a store outage throws through.
    const live = await this.loadSuspendedRunStrict(runId);
    if (live) return { repairable: false, runId, reason: 'RUN_SUSPENDED', nodeId: live.nodeId };

    let terminal: RunRecord | null = null;
    if (this.store?.loadTerminal) terminal = await this.store.loadTerminal(runId);

    const { consumed, witness, dropped } = this.resolveConsumedSuspensionWitnesses(runId, terminal);
    if (consumed && witness) {
        return {
            repairable: true,
            runId,
            flowName: consumed.run.flowName,
            nodeId: consumed.run.nodeId,
            ...(consumed.run.correlation !== undefined ? { correlation: consumed.run.correlation } : {}),
            witness,
            consumedAt: consumed.consumedAt,
        };
    }
    if (dropped) return { repairable: false, runId, reason: 'SNAPSHOT_DROPPED', dropped };
    return { repairable: false, runId, reason: 'NO_CONSUMED_SUSPENSION' };
}
