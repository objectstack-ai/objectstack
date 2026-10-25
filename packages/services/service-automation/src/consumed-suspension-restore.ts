// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The consumed-suspension restore of {@link AutomationEngine}: how a consumed
 * suspension is journaled and its witnesses are resolved, and how a consumed
 * suspension is restored along its chain or for one run, peeked at or
 * inspected.
 *
 * [#25222] Slices 7 and 8 of the `engine.ts` split, move-only. Each function
 * here is the body of the `AutomationEngine` method of the same name, moved
 * unedited. The class keeps that method (its name, docblock and position are
 * in the published `.d.ts`) and calls the body with a {@link
 * ConsumedSuspensionRestoreHost} literal holding exactly the members the body
 * reads. An async method's stub is no longer `async`: it returns the promise
 * the moved function makes.
 */

import { describeThrownForLog } from './thrown-cause-diagnostics.js';
// The values below (`MAX_CONSUMED_SUSPENSIONS`, `MAX_RESTORE_CHAIN_HOPS`,
// `buildRunTrigger`, `chainEntryOf` and `nestedChildRunId`) are read only
// inside the function bodies, at call time, never while a module is
// evaluating, so the import cycle with ./engine.js is safe under ESM live
// bindings; the tsup bundle is one file and has no cycle.
import {
    MAX_CONSUMED_SUSPENSIONS,
    MAX_RESTORE_CHAIN_HOPS,
    buildRunTrigger,
    chainEntryOf,
    nestedChildRunId,
    type AutomationEngine,
    type ChainRestoreEntry,
    type ConsumedSuspension,
    type ConsumedSuspensionDropNotice,
    type ConsumedSuspensionInspection,
    type RunRecord,
    type SuspendedRun,
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
    readonly restoring: AutomationEngine['restoring'];
    readonly refuseRestore: AutomationEngine['refuseRestore'];
    readonly resuming: AutomationEngine['resuming'];
    readonly getRun: AutomationEngine['getRun'];
    readonly persistSuspendedRun: AutomationEngine['persistSuspendedRun'];
    readonly recordLog: AutomationEngine['recordLog'];
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

/** The body of {@link AutomationEngine.journalConsumedSuspension}, moved unedited; that method's docblock is its contract. */
export function journalConsumedSuspension(
    this: Pick<ConsumedSuspensionRestoreHost, 'store' | 'consumedSuspensions'>,
    run: SuspendedRun,
    stepCountAtPause: number,
    error: string,
    variablesAtPause: SuspendedRun['variables'],
): ConsumedSuspension {
    const consumed: ConsumedSuspension = {
        run: { ...run, steps: run.steps.slice(0, stepCountAtPause), variables: variablesAtPause },
        consumedAt: new Date().toISOString(),
        error,
        // [#13937] `recordLog` settles this when its write settles.
        ...(this.store?.recordTerminal ? { persisted: 'pending' as const } : {}),
    };
    this.consumedSuspensions.set(run.runId, consumed);
    // Oldest first — `Map` iterates in insertion order, and re-`set`ting an
    // existing key keeps its original position, which is what we want: a
    // run that strands twice does not jump the queue ahead of one that has
    // been waiting for an operator longer.
    while (this.consumedSuspensions.size > MAX_CONSUMED_SUSPENSIONS) {
        const oldest = this.consumedSuspensions.keys().next().value;
        if (oldest === undefined) break;
        this.consumedSuspensions.delete(oldest);
    }
    return consumed;
}

/** The body of {@link AutomationEngine.restoreOneConsumedSuspension}, moved unedited; that method's docblock is its contract. */
export async function restoreOneConsumedSuspension(
    this: Pick<ConsumedSuspensionRestoreHost, 'restoring' | 'refuseRestore' | 'resuming' | 'loadSuspendedRunStrict' | 'logger' | 'store' | 'resolveConsumedSuspensionWitnesses' | 'consumedSuspensions' | 'getRun' | 'persistSuspendedRun' | 'recordLog'>,
    runId: string,
    options?: { requestedBy?: string; reason?: string },
    chainRestoreOf?: string,
): Promise<SuspensionRestoreResult> {
    // Synchronously, before the first await — the same shape as `resuming`
    // in `resumeInternal`: a guard set after an await is not a guard.
    if (this.restoring.has(runId)) {
        return this.refuseRestore(
            runId,
            'RESTORE_IN_PROGRESS',
            `Another restore of run '${runId}' is already in progress in this process`,
        );
    }
    // ⚠️ The subtle one. `resuming` is set before `resumeInternal`'s first
    // await and cleared in its `finally`, so this window is exactly
    // "suspension consumed, outcome not yet decided" — which is what a
    // resume IN FLIGHT looks like, and is indistinguishable from the
    // stranded state by any other reading. Re-arming one of these races the
    // live resume: its traversal would finish and record `completed` while
    // a paused row it knows nothing about survives, and the next restart
    // would resume an already-finished run.
    if (this.resuming.has(runId)) {
        return this.refuseRestore(
            runId,
            'RESUME_IN_PROGRESS',
            `Run '${runId}' is being resumed right now — its outcome is not decided yet`,
        );
    }
    this.restoring.add(runId);
    try {
        // Already resumable? STRICT read: an unreadable store must not read
        // as "no suspension" here. That degradation is harmless for a
        // display path and is the one mistake that mints a second pause on
        // this one.
        let live: SuspendedRun | null;
        try {
            live = await this.loadSuspendedRunStrict(runId);
        } catch (err) {
            this.logger.warn(
                `[automation] restoreConsumedSuspension('${runId}') could not read the durable suspended-run ` +
                    `store, so whether this run is still parked is UNKNOWN — the restore was REFUSED rather ` +
                    `than guessed, because reading an outage as "no suspension" is what would put a second ` +
                    `resumable pause on a live run. Nothing was written. Fix the store failure in this ` +
                    `record's meta, then re-issue the restore.`,
                describeThrownForLog(err),
            );
            return this.refuseRestore(
                runId,
                'STORE_UNAVAILABLE',
                `Durable suspended-run store unreachable for run '${runId}' — whether it is still suspended is unknown`,
            );
        }
        if (live) {
            return this.refuseRestore(
                runId,
                'RUN_SUSPENDED',
                `Run '${runId}' is suspended at node '${live.nodeId}' and already resumable — nothing to restore`,
            );
        }

        // [#13937] Two witnesses of one strand, and neither is trusted
        // alone — the read is {@link resolveConsumedSuspensionWitnesses},
        // shared with the read-only {@link inspectConsumedSuspension} so
        // what that verb calls repairable is what this one restores. The
        // durable row is loaded HERE because this verb's posture on an
        // unreadable history is its own: a refusal, never a guess.
        let terminal: RunRecord | null = null;
        if (this.store?.loadTerminal) {
            try {
                terminal = await this.store.loadTerminal(runId);
            } catch (err) {
                this.logger.warn(
                    `[automation] restoreConsumedSuspension('${runId}') could not read the durable run-history ` +
                        `row, so whether a consumed suspension is recoverable for this run is UNKNOWN — the ` +
                        `restore was REFUSED rather than reported as "nothing to restore", which is the answer ` +
                        `an operator would act on by giving up. Nothing was written. Fix the store failure in ` +
                        `this record's meta, then re-issue the restore.`,
                    describeThrownForLog(err),
                );
                return this.refuseRestore(
                    runId,
                    'STORE_UNAVAILABLE',
                    `Durable run-history unreachable for run '${runId}' — whether a consumed suspension survives is unknown`,
                );
            }
        }

        const { consumed, dropped, staleHot } = this.resolveConsumedSuspensionWitnesses(runId, terminal);
        // A hot copy of a pause the run has since LEFT — re-arming it
        // would send the run back through work it already did.
        if (staleHot) this.consumedSuspensions.delete(runId);

        if (!consumed) {
            // Nothing to restore — say WHICH nothing. The remedy differs for
            // every one of these and a single "bad run" refusal would send an
            // operator looking for the wrong thing.
            if (dropped) {
                return this.refuseRestore(
                    runId,
                    'NO_CONSUMED_SUSPENSION',
                    `Run '${runId}' is recorded 'failed' and its consumed suspension (${dropped.bytes} bytes) was over ` +
                        `the store's ${dropped.budget}-byte row budget, so it was not persisted — it can be restored ` +
                        `only by the process that stranded it, while that process is still running`,
                );
            }
            //
            // The durable row, when there is one, is the later word on how
            // the run ended than this process's own log — which may still
            // say `failed` for a run another replica finished.
            if (terminal?.status === 'completed') {
                return this.refuseRestore(
                    runId,
                    'RUN_COMPLETED',
                    `Run '${runId}' completed — there is no unresumable state to exit`,
                );
            }
            const logged = await this.getRun(runId);
            if (!logged) {
                return this.refuseRestore(runId, 'RUN_NOT_FOUND', `No run '${runId}' is known`);
            }
            if (logged.status === 'completed') {
                return this.refuseRestore(
                    runId,
                    'RUN_COMPLETED',
                    `Run '${runId}' completed — there is no unresumable state to exit`,
                );
            }
            if (logged.status === 'cancelled') {
                return this.refuseRestore(
                    runId,
                    'RUN_CANCELLED',
                    `Run '${runId}' was cancelled — restoring it would undo a deliberate decision`,
                );
            }
            // ⛔ Deliberately does not claim WHICH: "it never paused" and
            // "its snapshot is gone" are indistinguishable from here, and
            // guessing would hand an operator a false certainty. The status
            // actually observed is named instead.
            return this.refuseRestore(
                runId,
                'NO_CONSUMED_SUSPENSION',
                `Run '${runId}' is recorded '${logged.status}' and no consumed suspension is available for it ` +
                    `— it never suspended, or its snapshot is no longer held`,
            );
        }

        // Claim, then re-arm. No await between the claim and the write.
        this.consumedSuspensions.delete(runId);
        await this.persistSuspendedRun(consumed.run);

        // The run IS paused again, so the run log has to say so — otherwise
        // the repair is invisible on every surface that reads it and the
        // Runs view keeps calling a resumable run `failed`. This is the
        // SAME record the resume path writes when a run re-suspends at a
        // downstream node (`status: 'paused'`, carrying the variable
        // snapshot, #7639), for the same reason, and `getRun`'s
        // last-entry-wins order is what makes it the answer.
        //
        // ⚠️ Deliberately NOT terminal, so it neither writes a history row
        // nor clears the snapshot the row carries: until this run reaches a
        // real terminal state, "it failed mid-resume and was put back" is
        // the truth, and both halves of it should survive a restart.
        //
        // ⚠️ Measured limitation, stated rather than papered over: after a
        // restart the DURABLE surfaces still read this run `failed`, because
        // `getRun` / `listRuns` deliberately let a terminal row win over a
        // paused one (a paused row can outlive the run it describes). The
        // in-process log entry and the `warn` above are the trace this
        // ships. The #13937 ruling named the condition on the RESULT
        // (`status: 'stranded'`, the resume's catch arm), not on the run
        // row: `ExecutionStatus` carries no such member, so a durable
        // status that survives the restart is a spec-vocabulary decision
        // nobody has taken — the row's discriminator stays the snapshot.
        this.recordLog({
            id: runId,
            flowName: consumed.run.flowName,
            flowVersion: consumed.run.flowVersion,
            status: 'paused',
            startedAt: consumed.run.startedAt,
            durationMs: Date.now() - consumed.run.startTime,
            trigger: buildRunTrigger(consumed.run.context),
            steps: consumed.run.steps,
            variables: consumed.run.variables,
        }, consumed.run.context);

        // ⚠️ Uncontrolled text — the operator's own words and the original
        // thrown message — goes to the STRUCTURED slot, never the message
        // (#6299 family). `warn(message, meta?)`: meta is the SECOND
        // argument; `warn` has no `Error` slot.
        this.logger.warn(
            `[automation] run '${runId}' of flow '${consumed.run.flowName}': an operator RESTORED the ` +
                // [#15222] "consumed at" rather than "its resume had
                // consumed": an ancestor's pause was consumed by a
                // descendant's cascade, not by a resume of its own, and the
                // old wording was false for every member of a chain. Which
                // of the two it was is not guessed here — `failure` in the
                // meta below is the cascade's own text when it was one, and
                // it is durable, where a marker on the journal would not be.
                `suspension consumed at node '${consumed.run.nodeId}', so the run is resumable ` +
                `again. ⚠️ Nothing the failed attempt already did was undone, and the original resume signal ` +
                `was NOT replayed — the continuation must be re-issued. Who asked, why, and the failure this ` +
                `is an exit from are in this record's meta.` +
                (chainRestoreOf === undefined
                    ? ''
                    : ` This run was re-armed as one member of the nested chain repaired by the restore of ` +
                      `run '${chainRestoreOf}' — the continuation is re-issued on THAT run.`),
            {
                runId,
                flowName: consumed.run.flowName,
                nodeId: consumed.run.nodeId,
                nodeType: consumed.run.nodeType,
                correlation: consumed.run.correlation,
                consumedAt: consumed.consumedAt,
                requestedBy: options?.requestedBy ?? 'not recorded',
                restoreReason: options?.reason ?? 'not recorded',
                failure: consumed.error,
                ...(chainRestoreOf === undefined ? {} : { chainRestoreOf }),
            },
        );

        return {
            restored: true,
            runId,
            reason:
                `Restored the suspension run '${runId}' consumed at node '${consumed.run.nodeId}' — the run is ` +
                `resumable again; re-issue the continuation`,
            flowName: consumed.run.flowName,
            nodeId: consumed.run.nodeId,
            consumedAt: consumed.consumedAt,
        };
    } finally {
        this.restoring.delete(runId);
    }
}
