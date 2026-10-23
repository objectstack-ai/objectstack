// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The run history of {@link AutomationEngine}: how a run's log entry is
 * recorded and a refused run is finished, and how runs, one run and the
 * suspended runs are read back.
 *
 * [#25222] Slice 5 of the `engine.ts` split, move-only. Each function here is
 * the body of the `AutomationEngine` method of the same name, moved unedited.
 * The class keeps that method (its name, docblock and position are in the
 * published `.d.ts`) and calls the body with a {@link RunHistoryHost} literal
 * holding exactly the members the body reads. An async method's stub is no
 * longer `async`: it returns the promise the moved function makes.
 */

import type { ExecutionStatus, FlowParsed } from '@objectstack/spec/automation';
import type { AutomationContext, AutomationResult, RunListResult } from '@objectstack/spec/contracts';
import { summarizeRun, formatRunSummaryLine } from './run-summary.js';
import { describeThrownForLog } from './thrown-cause-diagnostics.js';
// The values below (`buildRunTrigger` and `isTerminalRunStatus`) are read only
// inside the function bodies, at call time, never while a module is evaluating,
// so the import cycle with ./engine.js is safe under ESM live bindings; the
// tsup bundle is one file and has no cycle.
import {
    buildRunTrigger,
    isTerminalRunStatus,
    type AutomationEngine,
    type ExecutionLogEntry,
    type RunRecord,
    type StepLogEntry,
    type SuspendedRun,
} from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field, including where an async body reads it after an
 * `await`. `store` goes through a getter, because `setSuspendedRunStore`
 * replaces it: each read in the body reads the engine's current store, as it
 * did through `this`.
 */
export interface RunHistoryHost {
    readonly listRunsPage: AutomationEngine['listRunsPage'];
    readonly executionLogs: AutomationEngine['executionLogs'];
    readonly store: AutomationEngine['store'];
    readonly suspendedRunToLogEntry: AutomationEngine['suspendedRunToLogEntry'];
    readonly logger: AutomationEngine['logger'];
    readonly runRecordToLogEntry: AutomationEngine['runRecordToLogEntry'];
    readonly suspendedRuns: AutomationEngine['suspendedRuns'];
    readonly cacheOnlySuspensions: AutomationEngine['cacheOnlySuspensions'];
    readonly evictConsumedSuspension: AutomationEngine['evictConsumedSuspension'];
    readonly maxLogSize: AutomationEngine['maxLogSize'];
    readonly runSummaryLog: AutomationEngine['runSummaryLog'];
    readonly compactStepsForHistory: AutomationEngine['compactStepsForHistory'];
    readonly consumedSuspensions: AutomationEngine['consumedSuspensions'];
    readonly recordLog: AutomationEngine['recordLog'];
}

/** The body of {@link AutomationEngine.listRuns}, moved unedited; that method's docblock is its contract. */
export async function listRuns(
    this: Pick<RunHistoryHost, 'listRunsPage'>,
    flowName: string,
    options?: { limit?: number; status?: ExecutionStatus },
): Promise<ExecutionLogEntry[]> {
    // [#19543] ONE implementation, two projections — `listRunsPage` is the
    // whole method and this is its `runs` half. ⛔ Never re-derive the
    // listing here: a second copy of the merge/filter/sort would be the
    // fork the route-ownership rule refuses, and it is the half that would
    // rot, because the page method is the one the REST door calls.
    return (await this.listRunsPage(flowName, options)).runs;
}

/** The body of {@link AutomationEngine.listRunsPage}, moved unedited; that method's docblock is its contract. */
export async function listRunsPage(
    this: Pick<RunHistoryHost, 'executionLogs' | 'store' | 'suspendedRunToLogEntry' | 'logger' | 'runRecordToLogEntry'>,
    flowName: string,
    options?: { limit?: number; status?: ExecutionStatus },
): Promise<RunListResult> {
    const limit = options?.limit ?? 20;
    const inMem = this.executionLogs.filter(l => l.flowName === flowName);

    // [#8050] Durable PAUSED rows — the arm this merge was missing.
    //
    // `sys_automation_run` holds TWO disjoint row families: the terminal
    // history rows `recordTerminal` writes (id `run_` + runId, status
    // completed/failed) and the LIVE suspension rows `save` writes (id =
    // the raw runId, status `paused`). The history arm below reads the
    // first family; nothing here read the second. Before a restart that is
    // invisible, because a paused run is still in `executionLogs` — so
    // every in-process test of this method passes. After a restart the ring
    // is empty and the paused rows had no reader at all, which is the
    // defect: an operator who restarts the process can enumerate what
    // FINISHED and what is IN FLIGHT vanishes — the strictly more urgent
    // half. It also structurally emptied #7359's just-enforced
    // `?status=paused`: with no producer of a `paused` entry after a
    // restart, that filter could never match a row, and the one query
    // reached for here always answered "nothing pending".
    //
    // Read-side only, by construction: this rehydrates the row the suspend
    // path already writes. No column, prefix or lifecycle changes — the
    // paused row is NOT reshaped into a history row, because the two have
    // different lifetimes (a paused row is live resumable state, deleted on
    // completion and exempt from the age sweep; a history row is a
    // tombstone). Unifying them would trade an observability gap for a
    // persistence-semantics change.
    //
    // Skipped when the caller filters for a status a paused row can never
    // have: `suspendedRunToLogEntry` always yields `paused`, and a run that
    // has since finished is answered by the fresher history/ring entry that
    // outranks it in the merge below — so the arm cannot change the result
    // of `?status=failed`, only its cost. `store.list()` is a table scan of
    // every paused row in the deployment (see its own contract), so not
    // paying it on the monitoring queries is worth the one-line guard.
    const wantsPaused = options?.status === undefined || options.status === 'paused';
    let durablePaused: ExecutionLogEntry[] = [];
    if (this.store && wantsPaused) {
        try {
            const rows = await this.store.list();
            durablePaused = rows
                .filter(r => r.flowName === flowName)
                .map(r => this.suspendedRunToLogEntry(r));
        } catch (err) {
            // #6499 — driver text to the structured slot; `warn(message,
            // meta?)`, meta SECOND (no `Error` slot on `warn`).
            //
            // #4632 verdict: FUNCTIONAL — `warn`, for the same reason as
            // the history arm below and `listSuspendedRunsDurable`. Nothing
            // claimed-persisted failed to land: the paused rows are intact
            // and still resumable by id (`resume` reads them through
            // `loadSuspendedRun`, a different door that is unaffected by
            // this failure). What degrades is this observability read, back
            // to exactly the pre-#8050 answer.
            this.logger.warn(
                `[Automation] paused-run read failed for '${flowName}' — the Runs listing DEGRADES to the ` +
                    `in-memory ring buffer plus terminal history, so runs parked by a previous process are ` +
                    `missing and '?status=paused' can report an empty result for a flow that has runs ` +
                    `waiting. The rows themselves are untouched and still resumable by id. Fix the store ` +
                    `failure in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }

    // Merge durable run history so the "Runs" view survives a restart and
    // ring-buffer eviction. In-memory entries are the freshest (they carry
    // full step detail); durable rows backfill runs the process no longer
    // holds. Best-effort: a history-read failure degrades to in-memory only.
    let durable: ExecutionLogEntry[] = [];
    if (this.store?.listHistory) {
        try {
            // [#19543] `limit + 1`, not `limit` — the over-read that makes
            // `hasMore` answerable at all. Asking for exactly `limit` makes a
            // saturated window and a complete one identical; one extra row
            // tells them apart, and `.slice(0, limit)` below drops it again
            // so nothing on the wire widens.
            const rows = await this.store.listHistory(flowName, limit + 1);
            durable = rows.map(r => this.runRecordToLogEntry(r));
        } catch (err) {
            // #6499 — the datasource driver's text to the structured slot;
            // see `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299). `warn(message, meta?)` — meta is the SECOND
            // argument; `warn` has no `Error` slot.
            //
            // #4632 verdict: FUNCTIONAL — stays `warn`, the same reasoning
            // as `listSuspendedRunsDurable` below: nothing
            // claimed-persisted failed to land — the history rows are
            // intact — and this read feeds only the observability Runs
            // view, which degrades to the in-memory ring buffer. The
            // record says the shortfall out loud (#5186's invented-answer
            // shape; its propagation remedy is a return-contract change
            // outside #6499).
            this.logger.warn(
                `[Automation] run-history read failed for '${flowName}' — the Runs listing DEGRADES to the ` +
                    `in-memory ring buffer alone, so terminal runs from before the last restart (or evicted ` +
                    `from the buffer) are missing and the caller cannot tell a short list from a complete ` +
                    `one. The rows themselves are untouched. Fix the store failure in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }
    // Dedupe by run id, weakest source first — the same run legitimately
    // appears in more than one of these (#8050):
    //
    //   1. durable PAUSED  — the run parked, and the row is still there.
    //   2. durable HISTORY — the run reached a terminal state.
    //   3. in-memory ring  — this process executed it.
    //
    // The order is a precedence claim, not an accident. Paused loses to
    // both because it is the only one that can be STALE while the others
    // cannot: `forgetSuspendedRun` deletes the paused row on completion,
    // but that delete is best-effort (a store outage swallows it), so a
    // finished run can leave its paused row behind. A terminal row or a
    // terminal ring entry for the same id is therefore strictly later
    // evidence, and letting the paused row win would report a completed run
    // as still waiting — the exact defect `run-history.test.ts`'s "latest
    // entry wins" block pins for `getRun`. There is no symmetric hazard:
    // within a process the ring is written in the same breath as the paused
    // row (`persistSuspendedRun` then `recordLog`, and again on re-suspend),
    // so it is never the older of the two; across a restart the ring is
    // empty and cannot mask anything.
    const byId = new Map<string, ExecutionLogEntry>();
    for (const e of durablePaused) byId.set(e.id, e);
    for (const e of durable) byId.set(e.id, e);
    for (const e of inMem) byId.set(e.id, e); // freshest wins

    // [#7359] The wire has always declared `?status=`, but it reached
    // neither the contract nor this method, so the filter was dropped at
    // the HTTP boundary and every run came back as if it matched — a
    // monitoring caller paging for failures read the first `limit` runs of
    // any status and concluded those were the failures.
    //
    // Filtering HERE, after the merge, is load-bearing in two ways:
    //
    //  1. It covers BOTH stores at once — the in-memory ring buffer and the
    //     durable rows. Narrowing only the buffer would answer "no
    //     failures" for a flow whose failures are all in durable history
    //     (i.e. after any restart, which is exactly when someone asks);
    //     narrowing only the durable rows would hide the live ones. Half a
    //     filter is the same class of confident wrong answer as none.
    //  2. It reads each run's RESOLVED status. `executionLogs` holds more
    //     than one entry per run id — a run that pauses and later finishes
    //     appends 'paused' and then its terminal entry — and the merge above
    //     is what collapses them to the freshest. Filtering the two arms
    //     BEFORE that collapse would drop the terminal entry for
    //     `?status=paused` and let the stale 'paused' one survive, so every
    //     approval / screen / wait run that had since completed would report
    //     itself as still paused. That is the exact defect
    //     `run-history.test.ts`'s "latest entry wins" block pins for
    //     `getRun`, re-introduced one method over.
    //
    // The durable arm's window is still the store's newest `limit` rows —
    // `listHistory(flowName, limit)` has no status slot, so the filter is
    // applied to what comes back rather than pushed down. A status filter
    // therefore narrows WITHIN that window and can return fewer than
    // `limit` matches while older ones exist. That is the merge's
    // pre-existing shape (durable was already capped at `limit` before the
    // sort-and-slice) and closing it is a store-contract change, not this
    // card's. What it never does is return a run of another status.
    const status = options?.status;
    const merged = status === undefined
        ? [...byId.values()]
        : [...byId.values()].filter(e => e.status === status);
    const ordered = merged
        .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
    // [#19543] The comparison is against the ORDERED, FILTERED set, not
    // against what any single source returned: a row can reach `ordered`
    // from the ring or the paused arm without the history arm knowing, and
    // a `?status=` filter can drop the over-read row specifically. Reading
    // the overflow here — after every arm has contributed and after the
    // filter has run — is what makes the answer true of the response
    // actually being sent.
    return { runs: ordered.slice(0, limit), hasMore: ordered.length > limit };
}

/** The body of {@link AutomationEngine.runRecordToLogEntry}, moved unedited; that method's docblock is its contract. */
export function runRecordToLogEntry(r: RunRecord): ExecutionLogEntry {
    return {
        id: r.runId,
        flowName: r.flowName,
        flowVersion: r.flowVersion,
        // [#15223] All four {@link TERMINAL_RUN_STATUSES} members, each a
        // valid `ExecutionLog` status — the schema has declared the whole
        // vocabulary since before this row existed, and it was the
        // persistence layer, not the contract, that reported only two.
        status: r.status,
        startedAt: r.startedAt,
        completedAt: r.finishedAt,
        durationMs: r.durationMs,
        // #7533 — the persisted trigger attribution, so a run rehydrated
        // after a restart still says what fired it and (for a record
        // change) which record. `type` falls back to `''` ONLY for rows
        // written before those columns existed: the field is required by
        // `ExecutionLogSchema`, and `''` is the same "not recorded" this
        // method already returned for every row. It is a legacy-row
        // default, not an alias — a row written today always carries a
        // real type.
        trigger: {
            type: r.triggerType ?? '',
            userId: r.userId ?? undefined,
            object: r.triggerObject,
            recordId: r.triggerRecordId,
        },
        steps: r.steps ?? [],
        error: r.error,
        // [#15788] The persisted refusal text, so the run a caller opens
        // after a restart still says WHY it refused. Without this line the
        // status survives the round-trip and its reason does not, which is
        // the worst of the two halves to lose: `refused` with no message is
        // indistinguishable from a refusal nobody authored.
        refusalMessage: r.refusalMessage,
        // #4354 — the PERSISTED summary, never re-folded from `r.steps`:
        // those are compacted (200 max), so recomputing here would report a
        // 5000-row sweep as having acted on a couple of hundred.
        summary: r.summary,
    };
}

/** The body of {@link AutomationEngine.suspendedRunToLogEntry}, moved unedited; that method's docblock is its contract. */
export function suspendedRunToLogEntry(run: SuspendedRun): ExecutionLogEntry {
    return {
        id: run.runId,
        flowName: run.flowName,
        flowVersion: run.flowVersion,
        status: 'paused',
        startedAt: run.startedAt,
        trigger: buildRunTrigger(run.context),
        steps: run.steps ?? [],
        variables: run.variables ?? {},
    };
}

/** The body of {@link AutomationEngine.getRun}, moved unedited; that method's docblock is its contract. */
export async function getRun(this: Pick<RunHistoryHost, 'executionLogs' | 'store' | 'runRecordToLogEntry' | 'logger' | 'suspendedRunToLogEntry'>, runId: string): Promise<ExecutionLogEntry | null> {
    // LAST entry wins, not the first: a run that pauses and later finishes
    // records TWO entries under the same run id ('paused', then
    // 'completed'/'failed'/'cancelled'). Scanning forwards returned the stale
    // 'paused' one, so every suspend-then-finish run — i.e. every approval,
    // screen and wait flow — reported itself as still paused forever, both on
    // the Runs surface and to the approvals dead-run sweep (#3456).
    let inMem: ExecutionLogEntry | undefined;
    for (let i = this.executionLogs.length - 1; i >= 0; i--) {
        if (this.executionLogs[i].id === runId) { inMem = this.executionLogs[i]; break; }
    }
    if (inMem) return inMem;
    // Durable fallback: after a restart (or ring-buffer eviction) the run's
    // terminal history row still answers "what happened, at which node?".
    // Best-effort — a store failure degrades to "not found", never throws.
    if (this.store?.loadTerminal) {
        try {
            const rec = await this.store.loadTerminal(runId);
            if (rec) return this.runRecordToLogEntry(rec);
        } catch (err) {
            // #6499 — driver text to the structured slot; see
            // `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299).
            //
            // #4632 verdict: FUNCTIONAL — stays `warn`. Nothing
            // claimed-persisted failed to land: the terminal row, if one
            // exists, is intact — this read degrades to `null`. What IS
            // wrong is #5186's shape: `null` is also this method's honest
            // "no such run", so a caller cannot tell an unreadable store
            // from a run that never ran (plugin-approvals'
            // `inspectStrandedRequests` counts a THROWN getRun as
            // `undetermined` — a distinction this swallow denies it). The
            // remedy is propagation, a return-contract change outside
            // #6499's scope, so the record says the degradation out loud.
            this.logger.warn(
                `[Automation] durable run lookup failed for '${runId}' — this read DEGRADES to null, so ` +
                    `the caller sees exactly what it would see if the run had never run and cannot tell ` +
                    `the two apart. The terminal row, if one exists, is untouched. Fix the store failure ` +
                    `in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }
    // [#8050] …and the PAUSED fallback, so run-detail and `listRuns` answer
    // out of one story. The card measured both surfaces failing together
    // after a restart — list returning zero rows AND this method 404ing —
    // and fixing only the list would have swapped a visible gap for an
    // inconsistency between two reads of the same run.
    //
    // AFTER the terminal probe, matching the merge order in `listRuns`: a
    // paused row can outlive the run it describes (the delete on completion
    // is best-effort), so a terminal row for the same id is later evidence
    // and must win. Trying this first would resurrect #3456's "paused
    // forever" for any run whose cleanup delete was lost.
    //
    // This does NOT make a nonexistent run findable: `store.load` answers
    // `null` for an unknown id exactly as `loadTerminal` does, so the route
    // above still returns its 404 `RESOURCE_NOT_FOUND` envelope for one.
    if (this.store) {
        try {
            const suspended = await this.store.load(runId);
            if (suspended) return this.suspendedRunToLogEntry(suspended);
        } catch (err) {
            // #6499 / #4632: same verdict as the terminal probe above —
            // FUNCTIONAL, so `warn`. The suspension row is intact and the
            // run stays parked and resumable; what degrades is this read.
            this.logger.warn(
                `[Automation] durable paused-run lookup failed for '${runId}' — this read DEGRADES to null, ` +
                    `so a run that is parked and resumable reports as if it had never run, and the caller ` +
                    `cannot tell the two apart. The suspension row is untouched. Fix the store failure in ` +
                    `this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }
    return null;
}

/** The body of {@link AutomationEngine.listSuspendedRuns}, moved unedited; that method's docblock is its contract. */
export function listSuspendedRuns(this: Pick<RunHistoryHost, 'suspendedRuns'>): Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }> {
    return [...this.suspendedRuns.values()].map(r => ({
        runId: r.runId,
        flowName: r.flowName,
        nodeId: r.nodeId,
        correlation: r.correlation,
    }));
}

/** The body of {@link AutomationEngine.readSuspendedRuns}, moved unedited; that method's docblock is its contract. */
export async function readSuspendedRuns(
    this: Pick<RunHistoryHost, 'store' | 'logger' | 'suspendedRuns' | 'cacheOnlySuspensions' | 'evictConsumedSuspension'>,
    onEnumerationFailure: 'degrade' | 'throw',
    flowNames?: ReadonlySet<string>,
): Promise<Array<{ runId: string; flowName: string; nodeId: string; correlation?: string }>> {
    const byId = new Map<string, { runId: string; flowName: string; nodeId: string; correlation?: string }>();
    // [#15832] Did the ENUMERATION answer? The reconcile below is allowed
    // only when it did — see the merge comment for why a failed listing is
    // silence rather than evidence.
    let enumerated = false;
    if (this.store) {
        try {
            const stored = flowNames === undefined
                ? await this.store.list()
                : this.store.listByFlow
                    ? await this.store.listByFlow([...flowNames])
                    : (await this.store.list()).filter((r) => flowNames.has(r.flowName));
            for (const r of stored) {
                byId.set(r.runId, { runId: r.runId, flowName: r.flowName, nodeId: r.nodeId, correlation: r.correlation });
            }
            enumerated = true;
        } catch (err) {
            // A write-deciding caller is told, and decides nothing: see
            // {@link readSuspendedRuns}. Everything below is the LISTING's
            // posture.
            if (onEnumerationFailure === 'throw') throw err;
            // #6299 — driver text to the structured slot, message one line,
            // same as the two seams above. The SLOT differs: the `Logger`
            // contract declares `warn(message, meta?)`, so `meta` is the
            // SECOND argument here — `warn` has no `Error` slot, and a
            // `meta` passed third to it is silently ignored.
            //
            // #4632 verdict: FUNCTIONAL — the level deliberately STAYS
            // `warn`, and this is the one of #6299's three sites where that
            // is the answer. Nothing the system claims to have persisted
            // failed to land: the durable rows are intact, still resumable
            // by id, and the next boot's `rearmSuspendedWaitTimers` still
            // re-arms them off its OWN `store.list()` — which builtin/
            // wait-node.ts grades `error` precisely because THAT failure
            // breaks the promise to resume them. This one breaks no promise,
            // so #4632's judgment question ("does something the system
            // claims is persisted fail to land while it keeps looking
            // healthy?") answers NO.
            //
            // What IS wrong here is the shape #5186 owns: an answer INVENTED
            // for a read that failed — a silently SHORT list. That rule's
            // remedy is propagation (rethrow, or a discriminated result),
            // which changes this method's return contract and is outside
            // #6299's scope, so the record has to say the shortfall out loud
            // instead. Its scan roots (`packages/metadata`,
            // `metadata-protocol`, `objectql`) do not reach this package, so
            // `check:durability-log-level` reports neither rule here.
            // Reachability is also the weakest of the three: this method is
            // not on the `AutomationService` spec contract (only the
            // synchronous `listSuspendedRuns` is); the in-repo caller that
            // would ADMIT a write on what this list lacks — the §7.3
            // disable guard — takes the `'throw'` posture above and never
            // reaches this line, and plugin-approvals' restored-
            // continuation proof refuses on an absent entry, so a short
            // list costs it a retry. Raising it to `error` would alarm for
            // the duration of an outage on a read no caller acts on
            // wrongly — #4632's mirror-image misuse, the trap #6230
            // avoided.
            this.logger.warn(
                `[automation] the durable suspended-run store could not be listed — this listing DEGRADES to the ` +
                    `in-memory cache alone, so every run parked by a previous process is missing from the result ` +
                    `and the caller cannot tell a short list from a complete one (after a restart the cache is ` +
                    `empty, so this answers []). The runs themselves are untouched — still stored, still resumable ` +
                    `by id. Fix the store failure in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }
    // [#14332] The DURABLE row wins a collision. The comment this replaces
    // said the opposite — "In-memory entries win — they are the freshest
    // copy" — which is true of exactly one deployment shape, a single
    // process. Put several replicas over one store and this map is a
    // per-replica snapshot of the node a run was parked at THE LAST TIME
    // THIS REPLICA TOUCHED IT, with no invalidation channel to it at all
    // (the mechanism is in {@link loadSuspendedRunStrict}), so preferring it
    // reported a run at a node it had already left.
    //
    // Map entries the durable list does not carry are still appended, and
    // that is NOT the strict loader's rule being softened: a LIST is not a
    // per-id answer. `store.list()` is a capped, best-effort enumeration
    // (`ObjectStoreSuspendedRunStore` reads at most 1000 `paused` rows) and
    // this line is also reached on the DEGRADED path above, where the
    // enumeration failed outright and `byId` is empty. So "absent from the
    // list" is not the evidence "the store answered and has no row" is,
    // which is what {@link loadSuspendedRunStrict} rests on when it lets
    // only {@link cacheOnlySuspensions} answer out of the map. Applying that
    // qualifier here would let a truncated or failed enumeration silently
    // drop live runs from an operability listing.
    //
    // [#15832] What that reasoning leaves open is a run this process parked
    // and ANOTHER replica has since consumed: absent from the durable list
    // because it is finished, appended here, and published as suspended by
    // a listing that also backs the cache-only one. The paragraph above is
    // right that list-absence is not evidence — so this asks for the
    // evidence instead. `store.load` is the same definitive per-id read
    // {@link loadSuspendedRunStrict} rests on, and it is bought only for the
    // entries that look suspicious: a healthy process, whose map entries all
    // appear in the durable list, buys none. A read that THROWS leaves the
    // entry standing (unknown is not gone), and a store that could not be
    // enumerated at all is not probed row by row — an outage would answer
    // for every live run in the process.
    //
    // [#20725] A scoped read takes only the named flows' entries — the hot
    // map holds every run this process parked, uncapped, so it answers the
    // scoped question completely for this process — and probes only those.
    for (const r of [...this.suspendedRuns.values()]) {
        if (flowNames !== undefined && !flowNames.has(r.flowName)) continue;
        if (byId.has(r.runId)) continue;
        if (enumerated && !this.cacheOnlySuspensions.has(r.runId)) {
            let stored: SuspendedRun | null;
            try {
                stored = await this.store!.load(r.runId);
            } catch {
                // Unknown, not gone — keep the entry and publish it, exactly
                // as this method did before the reconcile existed.
                stored = r;
            }
            if (stored === null) {
                this.evictConsumedSuspension(r.runId);
                continue;
            }
        }
        byId.set(r.runId, { runId: r.runId, flowName: r.flowName, nodeId: r.nodeId, correlation: r.correlation });
    }
    return [...byId.values()];
}

/** The body of {@link AutomationEngine.recordLog}, moved unedited; that method's docblock is its contract. */
export function recordLog(
    this: Pick<RunHistoryHost, 'executionLogs' | 'maxLogSize' | 'runSummaryLog' | 'logger' | 'store' | 'compactStepsForHistory' | 'consumedSuspensions'>,
    entry: ExecutionLogEntry,
    context?: AutomationContext,
    consumedSuspension?: SuspendedRun,
): ExecutionLogEntry {
    // #4354 — fold the run's outcome BEFORE anything downstream trims the
    // step log. History compaction keeps 200 steps; the summary must count
    // all 5000, or a long sweep's `acted` would shrink with its step log and
    // the broken-sweep detector would read a bounded artefact as truth.
    entry.summary = summarizeRun(entry.steps);

    this.executionLogs.push(entry);
    // Evict oldest logs when exceeding max size
    if (this.executionLogs.length > this.maxLogSize) {
        this.executionLogs.splice(0, this.executionLogs.length - this.maxLogSize);
    }
    // Durable run history (observability): mirror every TERMINAL run to the
    // store so "did it run / fail, and why?" survives a restart and the
    // in-memory ring-buffer eviction. Best-effort + fire-and-forget: a
    // history write must NEVER block or break the run that produced it.
    // [#15223] ONE vocabulary, not a fourth copy of the list: this
    // predicate decides both WHETHER a history row is written and WHAT its
    // `status` says. Keeping the narrowed value in a `const` is what makes
    // the record below type-check without a cast — and a cast is precisely
    // how the fold this card is about survived four members for two.
    const terminalStatus = isTerminalRunStatus(entry.status) ? entry.status : undefined;
    const terminal = terminalStatus !== undefined;

    // The MVP of #4354, and the half that needs no console: one structured
    // line per terminal run. `selected=30 acted=0` in a log file is the
    // difference between an invisible failure and a greppable one. Only
    // terminal runs — a `paused` run has not finished doing its work yet.
    if (terminal && this.runSummaryLog !== 'off') {
        const line = formatRunSummaryLine(
            {
                flowName: entry.flowName,
                runId: entry.id,
                status: entry.status,
                durationMs: entry.durationMs,
            },
            entry.summary,
        );
        const meta = {
            flow: entry.flowName,
            runId: entry.id,
            status: entry.status,
            durationMs: entry.durationMs,
            selected: entry.summary.selected,
            acted: entry.summary.acted,
            skipped: entry.summary.skipped,
            unmeasured: entry.summary.unmeasured,
            // #14456 — the structured half of the `failed=` token the line
            // above now carries, so a log pipeline that reads `meta` and
            // never parses the message sees the same fact.
            failed: entry.summary.failed,
            gates: entry.summary.gates,
        };
        if (this.runSummaryLog === 'debug') this.logger.debug(line, meta);
        else this.logger.info(line, meta);
    }

    if (terminalStatus && this.store?.recordTerminal) {
        const lastStep = entry.steps[entry.steps.length - 1];
        const record: RunRecord = {
            runId: entry.id,
            flowName: entry.flowName,
            flowVersion: entry.flowVersion,
            // [#15223] The status the run actually reached. This used to be
            // `entry.status === 'completed' ? 'completed' : 'failed'` — a
            // fold applied at WRITE time, so a cancelled or timed-out run's
            // distinction was not merely unshown, it was never stored and
            // could not be recovered afterwards. ⛔ Never re-introduce a
            // conditional here: whatever the terminal predicate above
            // admits is what the row must carry.
            status: terminalStatus,
            startedAt: entry.startedAt,
            finishedAt: entry.completedAt,
            durationMs: entry.durationMs,
            error: entry.error,
            // [#15788] The rendered refusal, carried onto the durable row
            // beside `status: 'refused'`. Set by exactly one producer
            // ({@link AutomationEngine.finishRefusedRun}) and `undefined`
            // on every other terminal record, so the store writes an
            // explicit NULL there — an upsert must CLEAR it, or a run id
            // reused by a restore would keep a refusal it no longer has.
            refusalMessage: entry.refusalMessage,
            userId: entry.trigger?.userId,
            // [#10101] The two organization-attribution inputs, from the
            // run context (see the `recordLog` doc): the acting tenant is
            // the ruled FALLBACK, the trigger-record snapshot is what the
            // store resolves the SUBJECT organization from — the same
            // snapshot the paused row resolves from, so the two rows of
            // one run agree by construction.
            organizationId: context?.tenantId ?? null,
            triggerRecord: context?.record,
            // #7533 — the rest of the trigger block, not just its userId.
            // The information exists at this exact point (the in-memory log
            // entry one line up carries it); it was simply not copied onto
            // the record handed to the store, which is where the durable
            // history lost the answer to "what fired this run?".
            triggerType: entry.trigger?.type || undefined,
            triggerObject: entry.trigger?.object,
            triggerRecordId: entry.trigger?.recordId,
            // [#13937] On a stranded run's record the PAUSE node, not the
            // node that threw: the object store rebuilds the snapshot's
            // node from this one column, and a restore from the row used
            // to re-arm the run at the failed node — whose next resume
            // then SKIPPED it and reported the run completed. The throwing
            // node is the last entry of `steps` below, and `error`.
            nodeId: consumedSuspension?.nodeId ?? lastStep?.nodeId,
            steps: this.compactStepsForHistory(entry.steps),
            summary: entry.summary,
            // [#13909] Present only on the resume-consumed-then-failed
            // path. On every other terminal record it is `undefined`, and
            // the store writes explicit NULLs for it — so a run that is
            // restored and then finishes CLEARS its own snapshot instead of
            // leaving a stale one an operator could restore a second time.
            consumedSuspension,
        };
        // [#13937] The journal entry this record describes, when it is a
        // strand's: `journalConsumedSuspension` ran just above in the
        // same arm, so the entry under this run id is the one built from
        // `consumedSuspension` — checked by identity, because a later
        // strand of the same run replaces the entry and must not inherit
        // this write's outcome.
        const journal = consumedSuspension ? this.consumedSuspensions.get(entry.id) : undefined;
        const write = this.store.recordTerminal(record);
        if (journal && journal.run === consumedSuspension) {
            void write.then(
                () => { journal.persisted = 'landed'; },
                () => { journal.persisted = 'failed'; },
            );
        }
        void write.catch((err) => {
            // #6499 — driver text to the structured slot; see
            // `forgetSuspendedRun`'s catch above for the full mechanism
            // (#6299).
            //
            // #4632 verdict: DURABILITY — RAISED from `warn` to `error`.
            // This is the WRITE half of the run-history claim whose read
            // halves (`listRuns` / `getRun` above) stay `warn`: a TERMINAL
            // run's history row failed to land while the run itself
            // completed and every caller reads healthy — fire-and-forget,
            // nothing retries it, nothing upstream is told. After the next
            // restart the run is invisible to the Runs surfaces, and the
            // approvals sweeps read exactly that hole: `inspectStranded-
            // Requests` (#3456) treats "no suspension + no terminal row"
            // as a STRANDED request, so a run that actually completed is
            // reported as lost, and `releasePendingForTerminalRuns`
            // (#4469) treats "no terminal row" as still-alive, so a
            // finished run's leftover pending approvals are never
            // auto-released. A write that claims to persist did not, while
            // the system keeps looking healthy — #4632's judgment question
            // answers YES. `check:durability-log-level` cannot see it
            // (`SuspendedRunStore.recordTerminal` is not in its callee
            // vocabulary), so the level is pinned by a test instead.
            //
            // THIRD argument per `error(message, error?, meta?)`; the
            // `Error` slot stays empty on purpose (#5575).
            this.logger.error(
                `[Automation] run-history persist failed for terminal run '${entry.id}' of flow ` +
                    `'${entry.flowName}' — the run finished and reads healthy everywhere, but its history ` +
                    `row never landed and nothing retries the write, so after the next restart this run is ` +
                    `invisible to the Runs surfaces and the approvals sweeps read it as never-finished. ` +
                    `Fix the store failure in this record's meta.`,
                undefined,
                describeThrownForLog(err),
            );
        });
    }
    return entry;
}

/** The body of {@link AutomationEngine.finishRefusedRun}, moved unedited; that method's docblock is its contract. */
export function finishRefusedRun(this: Pick<RunHistoryHost, 'recordLog' | 'logger'>, args: {
    runId: string;
    flowName: string;
    flowVersion?: number;
    startedAt: string;
    durationMs: number;
    steps: StepLogEntry[];
    /** Read for its `isOutput` variable declarations — see `output` below. */
    flow: FlowParsed;
    variables: Map<string, unknown>;
    refusalMessage?: string;
    context?: AutomationContext;
}): AutomationResult {
    // The run's declared outputs, collected exactly as the three completion
    // exits collect them. A refusal is terminal, and the nodes BEFORE the
    // refusing `end` really ran — withholding what they produced would make
    // the caller's answer depend on how the run ended rather than on what
    // the flow declared.
    const output: Record<string, unknown> = {};
    if (args.flow.variables) {
        for (const v of args.flow.variables) {
            if (v.isOutput) output[v.name] = args.variables.get(v.name);
        }
    }
    let logged: ExecutionLogEntry | undefined;
    try {
        logged = this.recordLog({
            id: args.runId,
            flowName: args.flowName,
            flowVersion: args.flowVersion,
            status: 'refused',
            refusalMessage: args.refusalMessage,
            startedAt: args.startedAt,
            completedAt: new Date().toISOString(),
            durationMs: args.durationMs,
            trigger: buildRunTrigger(args.context),
            steps: args.steps,
            output,
        }, args.context);
    } catch (bookkeeping) {
        // #4632 verdict: DURABILITY, so `error` — the same judgement and
        // the same consequence as the completion sites', with one word
        // changed: the caller is told the truthful thing (the run refused),
        // which is exactly what makes the rest invisible from outside.
        // Said ONCE per run. THIRD argument per `error(message, error?,
        // meta?)`; the `Error` slot stays empty on purpose (#5575).
        this.logger.error(
            `[Automation] run '${args.runId}' of flow '${args.flowName}' REFUSED (an 'end' node with ` +
                `outcome: 'refused', or a node whose child run refused) but its run-history bookkeeping ` +
                `threw, so its terminal history row ` +
                `never landed — nothing retries it, the caller is told the run refused, and after the next ` +
                `restart this run is invisible to the Runs surfaces while the approvals sweeps read it as ` +
                `never-finished. The run itself is TERMINAL and must NOT be re-run, retried or resumed. ` +
                `Fix the history failure in this record's meta.`,
            undefined,
            describeThrownForLog(bookkeeping),
        );
    }
    return {
        success: true,
        status: 'refused',
        refusalMessage: args.refusalMessage,
        flowLabel: args.flow.label,
        output,
        durationMs: args.durationMs,
        summary: logged?.summary ?? summarizeRun(args.steps),
    };
}
