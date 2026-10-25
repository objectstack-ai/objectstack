// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dispatch and suspension claims of {@link AutomationEngine}: how a
 * dispatch is claimed, in the durable store or in process, then settled and
 * read back; how the expired in-process claims are pruned; how a run id is
 * minted; how a degraded advance claim is announced; and how a suspension is
 * released.
 *
 * [#25222] Slices 7 and 8 of the `engine.ts` split, move-only. Each function
 * here is the body of the `AutomationEngine` method of the same name, moved
 * unedited. The class keeps that method (its name, docblock and position are
 * in the published `.d.ts`) and calls the body with a {@link
 * DispatchClaimsHost} literal holding exactly the members the body reads. An
 * async method's stub is no longer `async`: it returns the promise the moved
 * function makes.
 */

import { describeThrownForLog } from './thrown-cause-diagnostics.js';
// The value below (`IN_PROCESS_DISPATCH_CLAIM_TTL_MS`) is read only inside the
// function bodies, at call time, never while a module is evaluating, so the
// import cycle with ./engine.js is safe under ESM live bindings; the tsup
// bundle is one file and has no cycle.
import {
    IN_PROCESS_DISPATCH_CLAIM_TTL_MS,
    type AutomationEngine,
    type FlowDispatchClaim,
    type FlowDispatchOutcome,
    type SuspendedRun,
    type SuspensionReleaseReason,
} from './engine.js';

/**
 * The `AutomationEngine` members the moved bodies read, each typed as the class
 * member itself, so a renamed or respelled member is a compile error. Each
 * function takes the `Pick` of the members its own body reads, and the class
 * passes exactly those. Methods go as late-bound closures, so a spy or test
 * double set on the instance is still the one called. A field the class assigns
 * only at its declaration or in its constructor goes by value, so the value
 * passed is the field, including where an async body reads it after an `await`.
 * `flowDispatchStore` goes through a getter, because `setFlowDispatchStore`
 * reassigns it: each read in the body reads the engine's current value, as it
 * did through `this`. Three warned-once flags go through a get/set pair
 * (#25508), because a moved body sets each: `dispatchClaimDegradationWarned`
 * (`claim`), `dispatchOutcomeDegradationWarned` (`readDispatch`) and
 * `advanceClaimDegradationWarned` (`warnAdvanceClaimDegraded`). Each write
 * lands on the engine, as it did through `this`.
 */
export interface DispatchClaimsHost {
    readonly flowDispatchStore: AutomationEngine['flowDispatchStore'];
    readonly logger: AutomationEngine['logger'];
    readonly claimInProcess: AutomationEngine['claimInProcess'];
    dispatchClaimDegradationWarned: AutomationEngine['dispatchClaimDegradationWarned'];
    readonly pruneInProcessDispatchClaims: AutomationEngine['pruneInProcessDispatchClaims'];
    readonly inProcessDispatchClaims: AutomationEngine['inProcessDispatchClaims'];
    dispatchOutcomeDegradationWarned: AutomationEngine['dispatchOutcomeDegradationWarned'];
    advanceClaimDegradationWarned: AutomationEngine['advanceClaimDegradationWarned'];
    readonly resolveSuspendedNodeType: AutomationEngine['resolveSuspendedNodeType'];
    readonly nodeExecutors: AutomationEngine['nodeExecutors'];
}

/** The body of {@link AutomationEngine.claim}, moved unedited; that method's docblock is its contract. */
export async function claim(this: Pick<DispatchClaimsHost, 'flowDispatchStore' | 'logger' | 'claimInProcess' | 'dispatchClaimDegradationWarned'>, key: string): Promise<boolean> {
    if (this.flowDispatchStore) {
        try {
            return await this.flowDispatchStore.claim(key);
        } catch (err) {
            this.logger.warn(
                `[automation] flow-dispatch claim '${key}' failed against the persisted ledger — ` +
                    `falling back to in-process dedup for this key (availability over strict-once: ` +
                    `the dispatch proceeds unless this process already made it; a kernel rebuild may re-dispatch it). ` +
                    `The store failure is in this record's meta.`,
                describeThrownForLog(err),
            );
            return this.claimInProcess(key);
        }
    }
    if (!this.dispatchClaimDegradationWarned) {
        this.dispatchClaimDegradationWarned = true;
        this.logger.warn(
            '[automation] no persisted flow-dispatch ledger (no ObjectQL engine, or sys_flow_dispatch not registered) — ' +
                'trigger dispatch dedup is IN-PROCESS ONLY and will NOT survive a kernel rebuild: ' +
                'the same record/window can be re-dispatched after a restart.',
        );
    }
    return this.claimInProcess(key);
}

/** The body of {@link AutomationEngine.claimInProcess}, moved unedited; that method's docblock is its contract. */
export function claimInProcess(this: Pick<DispatchClaimsHost, 'pruneInProcessDispatchClaims' | 'inProcessDispatchClaims'>, key: string): boolean {
    const now = Date.now();
    this.pruneInProcessDispatchClaims(now);
    if (this.inProcessDispatchClaims.has(key)) return false;
    this.inProcessDispatchClaims.set(key, { at: now, outcome: null });
    return true;
}

/** The body of {@link AutomationEngine.settleDispatch}, moved unedited; that method's docblock is its contract. */
export async function settleDispatch(this: Pick<DispatchClaimsHost, 'flowDispatchStore' | 'logger' | 'inProcessDispatchClaims'>, key: string, outcome: FlowDispatchOutcome): Promise<void> {
    const store = this.flowDispatchStore;
    if (store && typeof store.settle === 'function') {
        try {
            await store.settle(key, outcome);
            return;
        } catch (err) {
            this.logger.warn(
                `[automation] flow-dispatch settle '${key}' → '${outcome}' failed against the persisted ledger — ` +
                    `the claim stays UNSETTLED, which reads as 'not delivered': a later replay of this window is ` +
                    `allowed through rather than refused. The store failure is in this record's meta.`,
                describeThrownForLog(err),
            );
        }
    }
    const existing = this.inProcessDispatchClaims.get(key);
    // Same write rule as the persisted ledger: `succeeded` is absorbing, so
    // the fallback cannot reopen a re-delivery door the durable path keeps
    // shut. Kept here rather than imported so the engine stays free of a
    // dependency on the store module it merely drives.
    if (existing && !(existing.outcome === 'succeeded' && outcome === 'failed')) {
        this.inProcessDispatchClaims.set(key, { ...existing, outcome });
    }
}

/** The body of {@link AutomationEngine.readDispatch}, moved unedited; that method's docblock is its contract. */
export async function readDispatch(this: Pick<DispatchClaimsHost, 'flowDispatchStore' | 'logger' | 'dispatchOutcomeDegradationWarned' | 'pruneInProcessDispatchClaims' | 'inProcessDispatchClaims'>, key: string): Promise<FlowDispatchClaim | null> {
    const store = this.flowDispatchStore;
    if (store && typeof store.read === 'function') {
        try {
            return await store.read(key);
        } catch (err) {
            this.logger.warn(
                `[automation] flow-dispatch read '${key}' failed against the persisted ledger — ` +
                    `reporting the key as UNCLAIMED (availability over strict-once: a replay proceeds rather ` +
                    `than being refused on a reading we could not make). The store failure is in this record's meta.`,
                describeThrownForLog(err),
            );
            return null;
        }
    }
    if (store && !this.dispatchOutcomeDegradationWarned) {
        this.dispatchOutcomeDegradationWarned = true;
        // The ledger predates the outcome half of the claim contract.
        this.logger.warn(
            '[automation] the attached flow-dispatch ledger has no read() — this message describes the ' +
                'ledger that has no read()/settle() AT ALL, where dispatch claims are still deduplicated ' +
                'and the in-process fallback still records outcomes and still refuses WITHIN one process ' +
                'lifetime, but nothing outlives a restart. A ledger that has settle() but no read() is ' +
                'weaker still: outcomes are written durably and never read back, so no replay is ever ' +
                'refused, in this lifetime or any other.',
        );
    }
    this.pruneInProcessDispatchClaims(Date.now());
    const rec = this.inProcessDispatchClaims.get(key);
    if (!rec) return null;
    return {
        key,
        claimedAt: new Date(rec.at).toISOString(),
        outcome: rec.outcome,
        settledAt: null,
    };
}

/** The body of {@link AutomationEngine.nextRunId}, moved unedited; that method's docblock is its contract. */
export function nextRunId(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    const rand = g.crypto?.randomUUID
        ? g.crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `run_${rand}`;
}

/** The body of {@link AutomationEngine.warnAdvanceClaimDegraded}, moved unedited; that method's docblock is its contract. */
export function warnAdvanceClaimDegraded(this: Pick<DispatchClaimsHost, 'advanceClaimDegradationWarned' | 'logger'>, cause: string): void {
    if (this.advanceClaimDegradationWarned) return;
    this.advanceClaimDegradationWarned = true;
    this.logger.warn(
        `[automation] no cross-replica advance guarantee (${cause}) — resume idempotency is ` +
            `IN-PROCESS ONLY: two decisions on one run arriving at the same moment on two replicas ` +
            `can both advance it, running every downstream side effect twice. Attach a suspended-run ` +
            `store that implements claimSuspension() to close it.`,
    );
}

/** The body of {@link AutomationEngine.releaseSuspension}, moved unedited; that method's docblock is its contract. */
export async function releaseSuspension(this: Pick<DispatchClaimsHost, 'resolveSuspendedNodeType' | 'nodeExecutors' | 'logger'>, run: SuspendedRun, reason: SuspensionReleaseReason): Promise<void> {
    const nodeType = this.resolveSuspendedNodeType(run);
    const executor = nodeType ? this.nodeExecutors.get(nodeType) : undefined;
    if (!executor?.onSuspensionReleased) return;
    try {
        await executor.onSuspensionReleased({
            runId: run.runId,
            flowName: run.flowName,
            nodeId: run.nodeId,
            correlation: run.correlation,
            reason,
        });
    } catch (err) {
        // #6499 — the thrown text is PLUGIN-SUPPLIED (the node executor's
        // own teardown), so it goes to the structured slot; see
        // `forgetSuspendedRun`'s catch above for the full mechanism
        // (#6299). The message keeps the correlation handle — that is the
        // thing an operator cleans up by hand.
        //
        // #4632 verdict: FUNCTIONAL — stays `warn`, per the docblock: the
        // run continued and nothing claimed-persisted failed to land; the
        // leftover is whatever the node armed on entry (a misleading
        // `sys_job` row, not a broken run). `warn(message, meta?)` — meta
        // is the SECOND argument; `warn` has no `Error` slot.
        this.logger.warn(
            `[automation] run '${run.runId}': '${nodeType}' node '${run.nodeId}' failed to release its suspension ` +
                `(reason: ${reason}, correlation: ${run.correlation ?? 'none'}) — the run continued; whatever the ` +
                `node armed on entry may still be scheduled. The executor's own failure is in this record's meta.`,
            describeThrownForLog(err),
        );
    }
}

/** The body of {@link AutomationEngine.pruneInProcessDispatchClaims}, moved unedited; that method's docblock is its contract. */
export function pruneInProcessDispatchClaims(this: Pick<DispatchClaimsHost, 'inProcessDispatchClaims'>, now: number): void {
    const cutoff = now - IN_PROCESS_DISPATCH_CLAIM_TTL_MS;
    for (const [k, rec] of this.inProcessDispatchClaims) {
        if (rec.at < cutoff) this.inProcessDispatchClaims.delete(k);
    }
}
