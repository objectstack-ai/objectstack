// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, "activation ledger"] The engine's local projection of the
 * activation ledger's `active: false` rows for flows, keyed by
 * `(package, name)`: a switch belongs to the packaged flow it was flipped on.
 *
 * The ledger row has always carried the package (`FlowActivationRow.packageId`,
 * the loader's set's owner the toggle door attributes it to); the projection
 * used to drop it and keep a set of bare names. Now it keeps the pair, and a
 * question about a flow name is answered for the package that ships that name
 * today ({@link FlowActivationProjection.has}).
 *
 * ⛔ It is still a projection, never a source (ADR-0126 §7.2): its only
 * writers are `hydrateFlowActivations` (from the ledger) and `toggleFlow`
 * (after the durable write), exactly as for the set it replaces.
 */
export interface FlowActivationProjectionReaders {
    /**
     * The package that ships the flow `name` today (the engine's
     * `packagedFlowOwner`, the loader's set), or `undefined` when no reader
     * can say.
     */
    readonly holderOf: (name: string) => string | undefined;
    /**
     * Does package `packageId` still hold a flow named `name` of its own?
     * `false` when it cannot be read: the row is then stale, and a stale row
     * still switches the name off (never armed on a guess).
     */
    readonly stillHolds: (name: string, packageId: string) => boolean;
    /**
     * A stale row switched the name's current holder off: reported once per
     * `(name, row package)` by the projection.
     */
    readonly reportStale: (stale: { name: string; rowPackageId: string; holderPackageId: string }) => void;
    /**
     * [#31696] The `(package, name)` slot the engine files under `key`, and
     * whether another slot holds its name too; `undefined` for a key the
     * engine does not file (a bare name it holds no flow of, read as itself).
     * Absent, every key reads as a bare name, as before slots.
     */
    readonly slotOf?: (key: string) => { name: string; packageId: string | null; shared: boolean } | undefined;
    /**
     * [#31696, ADR-0150 D4] A row naming no package switches off a name two
     * packages hold. It binds to ONE holder (D8), and nothing says which, so
     * it keeps every holder's flow off that has no row of its own, until an
     * operator switches each package's flow (that writes its own row).
     * Reported once per name by the projection.
     */
    readonly reportPackagelessOverShared?: (overlay: { name: string }) => void;
}

export class FlowActivationProjection {
    /**
     * Flow name → package → is that package's row `active: false`? `''` is a
     * row naming no package. A package's row is kept in either state, so the
     * holder's own row decides for it.
     */
    private readonly rows = new Map<string, Map<string, boolean>>();
    /** The `(name, row package)` pairs whose stale row has been reported. */
    private readonly staleReported = new Set<string>();
    /**
     * The names whose package-less row has been read while two packages held
     * the name: reported once, and never bound to one of them later
     * ({@link canBindPackageless}). Such a row was never shown to be one
     * holder's switch, so binding it on a later drop to one holder would be a
     * pick decided by arrival order.
     */
    private readonly packagelessSharedReported = new Set<string>();
    /**
     * The names whose package-less row is being bound to the name's first
     * holder ({@link beginBindPackageless}): until the durable write lands,
     * the row keeps every holder off, as any package-less row over two
     * holders does, but it is not reported — it is not ambiguous.
     */
    private readonly packagelessBinding = new Set<string>();

    constructor(private readonly readers: FlowActivationProjectionReaders) {}

    /**
     * Is the flow `name` switched off by a ledger row?
     *
     *  - The row of the package that ships the name decides, in either state.
     *  - Else a row naming no package binds to the name's one holder (ADR-0150
     *    D8: backfilled from the one holder), so it switches the name off.
     *  - A row naming another package that still holds a flow of that name
     *    keys only that package's flow (D4), so it does not switch this one
     *    off.
     *  - A row naming a package that no longer holds the name is stale: it
     *    still switches the name's current holder off, as it did before rows
     *    were keyed, and it is reported once — the remedy is to switch the
     *    flow again, which writes the holder's own row.
     *  - When no reader can say which package ships the name, every
     *    switched-off row of the name switches it off.
     */
    has(key: string): boolean {
        const slot = this.readers.slotOf?.(key);
        if (slot?.shared) return this.hasShared(slot.name, slot.packageId);
        const name = slot?.name ?? key;
        const packages = this.rows.get(name);
        if (!packages || packages.size === 0) return false;
        const holder = this.readers.holderOf(name);
        if (holder !== undefined && packages.has(holder)) return packages.get(holder) === true;
        if (packages.get('') === true) return true;
        for (const [rowPackageId, off] of packages) {
            if (!off || rowPackageId === '') continue;
            if (holder === undefined) return true;
            if (this.readers.stillHolds(name, rowPackageId)) continue;
            const key = JSON.stringify([name, rowPackageId]);
            if (!this.staleReported.has(key)) {
                this.staleReported.add(key);
                this.readers.reportStale({ name, rowPackageId, holderPackageId: holder });
            }
            return true;
        }
        return false;
    }

    /**
     * [#31696, ADR-0150 D4] Is the slot `(packageId, name)` of a name two or
     * more slots hold switched off? Its own package's row decides. Else a row
     * naming no package that switches the name off keeps this slot off too:
     * it binds to one holder and nothing says which, so it fails closed for
     * every holder without a row of its own, and is reported once. A row of
     * another package keys that package's slot only.
     */
    private hasShared(name: string, packageId: string | null): boolean {
        const packages = this.rows.get(name);
        if (!packages || packages.size === 0) return false;
        if (packageId !== null && packages.has(packageId)) return packages.get(packageId) === true;
        if (packages.get('') !== true) return false;
        if (!this.packagelessBinding.has(name) && !this.packagelessSharedReported.has(name)) {
            this.packagelessSharedReported.add(name);
            this.readers.reportPackagelessOverShared?.({ name });
        }
        return true;
    }

    /**
     * [#31696, ADR-0150 D4, epic red line 1] May the row naming no package be
     * bound to `packageId`, the name's one holder, now that a second holder
     * arrives? Only a row that switches the name off, that this projection
     * has only ever read over one holder, and where the holder has no row of
     * its own (that row is its switch; the package-less one then switches
     * nothing).
     */
    canBindPackageless(name: string, packageId: string): boolean {
        const packages = this.rows.get(name);
        if (packages?.get('') !== true || packages.has(packageId)) return false;
        return !this.packagelessSharedReported.has(name) && !this.packagelessBinding.has(name);
    }

    /** The durable bind of {@link canBindPackageless} has begun. */
    beginBindPackageless(name: string): void {
        this.packagelessBinding.add(name);
    }

    /**
     * The durable bind landed: the row naming no package is now
     * `packageId`'s own row, here as in the ledger.
     */
    bindPackageless(name: string, packageId: string): void {
        this.packagelessBinding.delete(name);
        const packages: Map<string, boolean> | undefined = this.rows.get(name);
        if (!packages?.has('')) return;
        const off = packages.get('') === true;
        packages.delete('');
        if (!packages.has(packageId)) packages.set(packageId, off);
    }

    /**
     * The durable bind failed: the row still names no package in the ledger,
     * so it stays as it is here — off for every holder without a row of its
     * own — and is never bound later.
     */
    failBindPackageless(name: string): void {
        this.packagelessBinding.delete(name);
        this.packagelessSharedReported.add(name);
    }

    /** Record a row switching `(packageId, name)` off. */
    add(name: string, packageId?: string): void {
        this.rowsOf(name).set(packageId ?? '', true);
    }

    /**
     * Record that `(packageId, name)` is switched on: its row is active. With
     * no package, the row naming no package is gone.
     */
    delete(name: string, packageId?: string): void {
        if (packageId !== undefined) {
            this.rowsOf(name).set(packageId, false);
            return;
        }
        const packages: Map<string, boolean> | undefined = this.rows.get(name);
        if (!packages) return;
        packages.delete('');
        if (packages.size === 0) this.rows.delete(name);
    }

    private rowsOf(name: string): Map<string, boolean> {
        let packages: Map<string, boolean> | undefined = this.rows.get(name);
        if (!packages) {
            packages = new Map();
            this.rows.set(name, packages);
        }
        return packages;
    }
}
