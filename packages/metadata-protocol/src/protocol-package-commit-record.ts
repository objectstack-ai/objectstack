// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 cut 33] The ADR-0067 commit row that groups a turn's published
 * artifacts, from `ObjectStackProtocolImplementation`, moved out of
 * `protocol.ts` whole: `recordPackageCommit` and the named INSERT it calls,
 * `persistPackageCommitRow` (named so the durability log-level rule can
 * declare it).
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `ObjectStackProtocolImplementation` method of the same name as it stood,
 * re-indented one level and otherwise unedited.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), as `protocol-batch-data.ts` applies it.
 * The class keeps each method — the published `dist/*.d.ts` lists its name,
 * docblock and declared signature — and its body is one literal of exactly
 * the {@link PackageCommitRecordHost} members it reads, plus a `.call`; a
 * body that reads no member is called as a plain function. The `engine` field
 * and the noted-once flag are handed over as getters (and the flag as a
 * setter), so each read and write reaches the class field as it stands at
 * call time; the call to `persistPackageCommitRow` is a closure, so it still
 * reaches the class method. Every caller keeps calling the class methods.
 *
 * What the bodies read from elsewhere, they import from where `protocol.ts`
 * imports it. Nothing re-exports this module, so the published surface does
 * not move.
 */

import { isMissingTableError } from '@objectstack/metadata/errors';
import type { CommitPlanItem, ObjectStackProtocolImplementation } from './protocol.js';

/**
 * The `ObjectStackProtocolImplementation` members the functions below read —
 * every one of them, and no other; each function's `this` is the `Pick` of
 * the members it reads. Each is typed AS the class member (an indexed access
 * on the class), so a change to a member's signature on the class is a change
 * here too, and naming a member the class does not have is a compile error.
 */
export interface PackageCommitRecordHost {
    commitStoreUnprovisionedNoted: ObjectStackProtocolImplementation['commitStoreUnprovisionedNoted'];
    readonly engine: ObjectStackProtocolImplementation['engine'];
    readonly persistPackageCommitRow: ObjectStackProtocolImplementation['persistPackageCommitRow'];
}

/** The body of `ObjectStackProtocolImplementation#persistPackageCommitRow`; the method's docblock there is its contract. */
export async function persistPackageCommitRow(this: Pick<PackageCommitRecordHost, 'engine'>, row: Record<string, unknown>): Promise<void> {
    // [#21911] The explicit system opt-in — see recordMetadataAudit.
    await this.engine.insert('sys_metadata_commit', row, { context: { isSystem: true } });
}

/** The body of `ObjectStackProtocolImplementation#recordPackageCommit`; the method's docblock there is its contract. */
export async function recordPackageCommit(this: Pick<PackageCommitRecordHost, 'commitStoreUnprovisionedNoted' | 'persistPackageCommitRow'>, args: {
    packageId: string;
    operation: 'apply' | 'revert';
    message?: string;
    actor?: string;
    aiModel?: string;
    parentCommitId?: string;
    items: CommitPlanItem[];
    eventSeqStart?: number;
    eventSeqEnd?: number;
}): Promise<{ commitId: string } | null> {
    try {
        const commitId = 'cmt_' + (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `${args.eventSeqEnd ?? 0}-${args.items.length}-${args.packageId}`);
        await this.persistPackageCommitRow({
            id: commitId,
            package_id: args.packageId,
            operation: args.operation,
            ...(args.message ? { message: args.message } : {}),
            ...(args.actor ? { actor: args.actor } : {}),
            ...(args.aiModel ? { ai_model: args.aiModel } : {}),
            ...(args.parentCommitId ? { parent_commit_id: args.parentCommitId } : {}),
            ...(args.eventSeqStart !== undefined ? { event_seq_start: args.eventSeqStart } : {}),
            ...(args.eventSeqEnd !== undefined ? { event_seq_end: args.eventSeqEnd } : {}),
            items: JSON.stringify(args.items),
            item_count: args.items.length,
            created_at: new Date().toISOString(),
        });
        return { commitId };
    } catch (error) {
        // [#9066] The publish keeps its outcome — `null` still comes back
        // and the caller still reports success — but the silence is over.
        //
        // BENIGN: `sys_metadata_commit` was never provisioned. That is a
        // real deployment state (a first boot, or an env kernel composed
        // without the commit log — the exact case
        // `@objectstack/metadata`'s plugin note records), and it is a
        // CONFIGURATION fact, not a store that broke: it is the same on
        // every publish and it is fixed in one place. Stated once per
        // instance, at `info`, per this card's ruling that an unprovisioned
        // commit store stays silent or informational.
        //
        // EVERYTHING ELSE — a connection drop, a timeout, a permission
        // denial, schema drift on that one table — is a write that was
        // supposed to land and did not, while the publish it describes DID.
        // `error`, per AGENTS.md "Degradation log levels", and the line
        // owes the two things that rule requires: the CONSEQUENCE (this
        // turn is not revertible, and the system will keep looking healthy)
        // and the FIX (repair write access to the commit store).
        //
        // NOT rethrown, and not surfaced to the caller: the artifacts are
        // already live and unwinding them over a missing history row would
        // be strictly worse than losing the row. Telling the CALLER that
        // the turn is unrevertible is a separate question (a response-field
        // change the #8896 ruling forbids for this family) and deliberately
        // NOT decided here.
        if (isMissingTableError(error, 'sys_metadata_commit')) {
            if (!this.commitStoreUnprovisionedNoted) {
                this.commitStoreUnprovisionedNoted = true;
                console.info(
                    '[Protocol] sys_metadata_commit is not provisioned — publishes and reverts '
                    + 'succeed but record no ADR-0067 commit row, so no turn can be reverted '
                    + '(the revert plan of every turn is dropped). Fix: provision the commit '
                    + 'store — it is registered alongside sys_metadata_history by '
                    + "@objectstack/metadata's plugin; run schema sync. Said once per protocol instance.",
                );
            }
            return null;
        }
        const reason = (error as { message?: string } | undefined)?.message ?? String(error);
        console.error(
            `[Protocol] sys_metadata_commit write FAILED for package '${args.packageId}' `
            + `(${args.operation}, ${args.items.length} item(s)): ${reason}. `
            + 'The publish itself SUCCEEDED and reports success, so nothing looks broken — but '
            + "this turn's revert plan was not persisted: the turn is absent from the package "
            + 'commit timeline and can never be reverted, and every further publish loses its '
            + 'own the same way until this is repaired. Fix: restore write access to '
            + 'sys_metadata_commit (connectivity, permissions, or schema drift on that table).',
        );
        return null;
    }
}
