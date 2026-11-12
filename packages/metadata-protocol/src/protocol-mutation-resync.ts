// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `metadata.mutated` lane's resync after a cluster outage: what
 * `ObjectStackProtocolImplementation#resyncMetadataMutationPubSub` runs when the
 * cluster driver reconnects (`cluster.resync`, raised by `@objectstack/service-cluster`
 * and relayed by its `MetadataClusterBridgePlugin`).
 *
 * ## The gap
 *
 * The lane is at-most-once, like every `IPubSub` lane: a hint published while
 * the shared store is unreachable is gone. Lane 2's hint is what makes a PEER
 * re-run the ObjectQL registry write-through for an object authored on another
 * replica, so a lost hint left every other replica answering
 * `OBJECT_NOT_FOUND` for it (or serving its old body, or still serving it after
 * a delete) until restart.
 *
 * ## What a resync re-reads, and why not everything
 *
 * One read of `sys_metadata`'s active rows — their address and `checksum`
 * only, never a body — names every item a lost hint could have touched. Only
 * those are re-converged, each through the delivered-hint applier itself
 * (`applyRemoteMetadataMutation`): the replica re-reads the item's row from its
 * OWN `sys_metadata` and re-runs the write-through, or, when no active row is
 * left, runs the same heal walk a delivered delete runs. Nothing travels on the
 * wire, and the database stays the source of truth.
 *
 * An item is re-converged when any of these holds:
 *
 *  - its row's `checksum` differs from the one this replica last converged on
 *    (a lost save or publish);
 *  - this replica last converged on it, and it has no active row now (a lost
 *    delete);
 *  - a hint or a local write named it since the last convergence (its stored
 *    checksum then says nothing about what the registry holds: a revert to an
 *    earlier body brings an earlier checksum back).
 *
 * Re-converging EVERY row instead would be correct too, and it is what the
 * ledger falls back to when it has no baseline. It is not the default because
 * each convergence replays the item into this replica's local mutation
 * listeners, and several of them re-sync a whole family per event (authored
 * hooks and actions), so an unchanged catalog would pay one full re-sync per
 * stored row on every reconnect. A since-timestamp re-read is not used either:
 * a delete leaves no active row to carry a timestamp, and the writers' clocks
 * are not this replica's.
 *
 * ## The baseline
 *
 * Seeded when the lane attaches (one read, only on a replica whose cluster
 * driver crosses a process boundary — the bridge never attaches on the
 * in-process driver), then kept by every convergence. A write or hint that
 * lands while a resync runs leaves its item marked, so the next resync re-reads
 * it.
 *
 * ## A read that fails is never a delete
 *
 * When the active-row read fails, the resync throws and changes nothing: every
 * registry entry stays as this replica holds it, and the next resync re-reads.
 * When one item's re-read fails, that item is kept as it is, stays marked for
 * the next resync, and the failures are logged once per resync. A row that is
 * really gone follows the delivered-hint path's own delete semantics, because
 * it is the delivered-hint applier that runs.
 *
 * Not re-exported: the class method is the public surface.
 */

import { canonicalMetaType } from './protocol-meta-type-schema.js';
import type { MetadataMutationEvent } from './protocol-mutation-events.js';
import { boundPackageOf } from './protocol-package-bindings.js';
import { inboundMutationPackage } from './protocol-mutation-package.js';

/** What one {@link MetadataMutationResyncLedger.resync} did. */
export interface MetadataMutationResyncReport {
    /** Active rows the one `sys_metadata` read returned. */
    readonly rows: number;
    /** Items re-converged from an active row (a lost save or publish, or a marked item). */
    readonly converged: number;
    /** Items with no active row left, run through the delete's heal walk. */
    readonly deleted: number;
    /** Items whose re-read failed: kept as this replica holds them, and re-read on the next resync. */
    readonly kept: number;
    /** Items left alone because their row did not move since this replica last converged on it. */
    readonly unchanged: number;
    /** True when no baseline was in hand, so every active row was re-converged. */
    readonly full: boolean;
}

/** The two seams a resync runs through, both the protocol's own. */
export interface MetadataMutationResyncIo {
    /** `sys_metadata`'s active rows for this environment, address and checksum at least. */
    readActiveRows(): Promise<ReadonlyArray<Record<string, unknown>>>;
    /** The delivered-hint applier: re-read the item's row and converge the registry on it. */
    converge(evt: MetadataMutationEvent): Promise<void>;
}

/**
 * The columns the active-row read asks for: the address and the checksum, never
 * the body. [#32451, ADR-0150 D4] The address includes the row's package.
 */
export const RESYNC_ROW_FIELDS: readonly string[] = ['id', 'type', 'name', 'bundle_member', 'package_id', 'checksum'];

interface ItemAddress {
    readonly type: string;
    readonly name: string;
    readonly member?: string;
    /**
     * [#32451] The package the row is bound to, `null` for none. Two packages'
     * rows of one name are two items here, as they are two rows.
     */
    readonly packageId: string | null;
}

/** `undefined` = marked: re-converge on the next resync whatever the row's checksum says. */
type ConvergedChecksum = string | null | undefined;

function keyOf(address: ItemAddress): string {
    return JSON.stringify([address.type, address.name, address.member ?? null, address.packageId]);
}

/** The `(type, name, member)` half of a key: what a touch naming no package marks. */
function itemOf(address: Pick<ItemAddress, 'type' | 'name' | 'member'>): string {
    return JSON.stringify([address.type, address.name, address.member ?? null]);
}

function addressOfRow(row: Record<string, unknown>): ItemAddress | undefined {
    if (typeof row.type !== 'string' || typeof row.name !== 'string' || row.name === '') return undefined;
    const member = typeof row.bundle_member === 'string' && row.bundle_member !== '' ? row.bundle_member : undefined;
    return {
        type: canonicalMetaType(row.type),
        name: row.name,
        ...(member !== undefined ? { member } : {}),
        packageId: boundPackageOf(row.package_id) ?? null,
    };
}

function checksumOfRow(row: Record<string, unknown>): string | null {
    return typeof row.checksum === 'string' ? row.checksum : null;
}

function describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Per replica, per attached lane: which stored row each registry entry was last
 * converged on. Created by `attachMetadataMutationPubSub`, dropped by its detach.
 */
export class MetadataMutationResyncLedger {
    private readonly converged = new Map<string, ConvergedChecksum>();
    private readonly addresses = new Map<string, ItemAddress>();
    /** Keys a hint or a local write named while the running resync was in flight. */
    private touchedDuringResync: Set<string> | undefined;
    /** False until a seed or a resync has read every active row once. */
    private hasBaseline = false;
    private seeding: Promise<void> | undefined;
    private queue: Promise<unknown> = Promise.resolve();

    /**
     * Take the baseline from one active-row read. A failure is reported once
     * and leaves no baseline, so the first resync re-converges every row.
     */
    seed(readActiveRows: MetadataMutationResyncIo['readActiveRows']): void {
        this.seeding = (async () => {
            try {
                const rows = await readActiveRows();
                for (const row of rows) {
                    const address = addressOfRow(row);
                    if (!address) continue;
                    const key = keyOf(address);
                    // A hint or write that landed during the read has marked it already.
                    if (this.converged.has(key)) continue;
                    this.converged.set(key, checksumOfRow(row));
                    this.addresses.set(key, address);
                }
                this.hasBaseline = true;
            } catch (err) {
                console.warn(
                    '[Protocol] the metadata.mutated lane could not read sys_metadata to take its resync baseline: '
                    + `${describe(err)}. The next cluster resync re-converges every stored item instead, and a row `
                    + 'deleted on a peer while its hint was lost is retired only by a delivered hint or a restart until then.',
                );
            }
        })();
    }

    /**
     * A hint was received or a local write was announced: re-converge this item
     * on the next resync. [#32451] A hint naming no package (a writer that
     * predates `packageId`) marks every package's entry of `(type, name, member)`.
     */
    touch(evt: Pick<MetadataMutationEvent, 'type' | 'name' | 'member' | 'packageId'>): void {
        if (typeof evt.type !== 'string' || typeof evt.name !== 'string' || evt.name === '') return;
        const item = {
            type: canonicalMetaType(evt.type),
            name: evt.name,
            ...(evt.member !== undefined ? { member: evt.member } : {}),
        };
        const packageId = inboundMutationPackage(evt);
        if (packageId === undefined) {
            const wanted = itemOf(item);
            for (const [key, address] of this.addresses) {
                if (itemOf(address) !== wanted) continue;
                this.converged.set(key, undefined);
                this.touchedDuringResync?.add(key);
            }
            return;
        }
        const address: ItemAddress = { ...item, packageId };
        const key = keyOf(address);
        this.converged.set(key, undefined);
        this.addresses.set(key, address);
        this.touchedDuringResync?.add(key);
    }

    /** Re-converge every item a lost hint could have touched. Resyncs run one at a time. */
    resync(io: MetadataMutationResyncIo): Promise<MetadataMutationResyncReport> {
        const run = this.queue.then(() => this.resyncOnce(io));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async resyncOnce(io: MetadataMutationResyncIo): Promise<MetadataMutationResyncReport> {
        await this.seeding;
        const full = !this.hasBaseline;
        const touched = new Set<string>();
        this.touchedDuringResync = touched;
        try {
            let rows: ReadonlyArray<Record<string, unknown>>;
            try {
                rows = await io.readActiveRows();
            } catch (err) {
                throw new Error(
                    `the metadata.mutated resync could not read sys_metadata (${describe(err)}); every registry `
                    + 'entry is kept as this replica holds it, and the next cluster resync re-reads.',
                );
            }

            const current = new Map<string, { address: ItemAddress; checksum: string | null }>();
            for (const row of rows) {
                const address = addressOfRow(row);
                if (address) current.set(keyOf(address), { address, checksum: checksumOfRow(row) });
            }

            const due: Array<{ key: string; address: ItemAddress; checksum: string | null; gone: boolean }> = [];
            let unchanged = 0;
            for (const [key, { address, checksum }] of current) {
                if (this.converged.has(key) && this.converged.get(key) === checksum) unchanged++;
                else due.push({ key, address, checksum, gone: false });
            }
            for (const key of this.converged.keys()) {
                if (current.has(key)) continue;
                const address = this.addresses.get(key);
                if (address) due.push({ key, address, checksum: null, gone: true });
            }

            let converged = 0;
            let deleted = 0;
            const failures: string[] = [];
            let firstFailure: unknown;
            for (const item of due) {
                const { type, name, member, packageId } = item.address;
                try {
                    await io.converge({
                        type,
                        name,
                        state: item.gone ? 'deleted' : 'active',
                        organizationId: null,
                        ...(member !== undefined ? { member } : {}),
                        // [#32451] The row's package, or for a gone item the
                        // package it was converged on.
                        packageId,
                    });
                } catch (err) {
                    // Not a delete: the entry stays as this replica holds it, marked for the next resync.
                    this.converged.set(item.key, undefined);
                    failures.push(`${type}/${name}${member !== undefined ? `[${member}]` : ''}${packageId !== null ? ` (package '${packageId}')` : ''}`);
                    if (firstFailure === undefined) firstFailure = err;
                    continue;
                }
                if (item.gone) deleted++;
                else converged++;
                // A hint or a write named it meanwhile: leave it marked.
                if (touched.has(item.key)) continue;
                if (item.gone) {
                    this.converged.delete(item.key);
                    this.addresses.delete(item.key);
                } else {
                    this.converged.set(item.key, item.checksum);
                    this.addresses.set(item.key, item.address);
                }
            }
            this.hasBaseline = true;

            if (failures.length > 0) {
                console.error(
                    `[Protocol] the metadata.mutated resync could not re-read ${failures.length} stored item(s) `
                    + `(${failures.slice(0, 5).join(', ')}${failures.length > 5 ? ', …' : ''}): this replica keeps serving `
                    + 'each as it held it, which may differ from sys_metadata, and keeps looking healthy. They are re-read '
                    + 'on the next cluster resync; to converge them now, re-save each item or restart this replica. '
                    + `First cause: ${describe(firstFailure)}`,
                );
            }
            return { rows: rows.length, converged, deleted, kept: failures.length, unchanged, full };
        } finally {
            if (this.touchedDuringResync === touched) this.touchedDuringResync = undefined;
        }
    }
}
