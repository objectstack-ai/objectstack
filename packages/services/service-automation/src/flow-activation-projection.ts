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
     * packages hold: it overlays neither (a package-less row binds to ONE
     * holder, and there are two). Reported once per name by the projection.
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
    /** The names whose package-less row over two holders has been reported. */
    private readonly packagelessSharedReported = new Set<string>();

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
     * more slots hold switched off? Only its own package's row decides. A row
     * naming no package overlays neither holder (it binds to one, and there
     * are two — {@link bindPackageless} binds it while there is one), and is
     * reported once; a row of another package keys that package's slot.
     */
    private hasShared(name: string, packageId: string | null): boolean {
        const packages = this.rows.get(name);
        if (!packages || packages.size === 0) return false;
        if (packageId !== null && packages.has(packageId)) return packages.get(packageId) === true;
        if (packages.get('') === true && !this.packagelessSharedReported.has(name)) {
            this.packagelessSharedReported.add(name);
            this.readers.reportPackagelessOverShared?.({ name });
        }
        return false;
    }

    /**
     * [#31696, ADR-0150 D4, epic red line 1] Bind the row naming no package
     * to `packageId`, the name's one holder, before a second holder arrives:
     * the row was that holder's switch (D8: a package-less row binds to the
     * one holder), so it stays its switch once the name has two. Answers
     * whether a switched-off row was bound, so the caller can make the bind
     * durable. A holder with a row of its own keeps it, and the package-less
     * row is dropped from the projection either way: under two holders it
     * overlays neither.
     */
    bindPackageless(name: string, packageId: string): boolean {
        const packages: Map<string, boolean> | undefined = this.rows.get(name);
        if (!packages?.has('')) return false;
        const off = packages.get('') === true;
        packages.delete('');
        if (packages.has(packageId)) return false;
        packages.set(packageId, off);
        return off;
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
