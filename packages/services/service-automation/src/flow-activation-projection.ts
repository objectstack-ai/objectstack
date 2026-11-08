// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, "activation ledger"] The engine's local projection of the
 * activation ledger's `active: false` rows for flows, keyed by
 * `(package, name)`: a switch belongs to the packaged flow it was flipped on,
 * never to whatever item bears that name later.
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
export class FlowActivationProjection {
    /** Flow name → the packages whose row switches it off; `''` is a row naming no package. */
    private readonly rows = new Map<string, Set<string>>();

    /**
     * @param holderOf - the package that ships the flow `name` today (the
     *   engine's `packagedFlowOwner`, the loader's set), or `undefined` when
     *   no reader can say.
     */
    constructor(private readonly holderOf: (name: string) => string | undefined) {}

    /**
     * Is the flow `name` switched off by a ledger row? A row naming no package
     * binds to the name's one holder (ADR-0150 D8: backfilled from the one
     * holder), so it switches the name off as before. A row naming a package
     * switches off that package's flow of the name, and only it: a row of
     * another package, kept for a flow this deployment no longer ships under
     * it, never switches off a different package's same-named flow. When no
     * reader can say which package ships the name, every row of the name
     * still switches it off — the projection never arms a flow on a guess.
     */
    has(name: string): boolean {
        const packages = this.rows.get(name);
        if (!packages || packages.size === 0) return false;
        if (packages.has('')) return true;
        const holder = this.holderOf(name);
        return holder === undefined ? true : packages.has(holder);
    }

    /** Record a row switching `(packageId, name)` off. */
    add(name: string, packageId?: string): void {
        let packages = this.rows.get(name);
        if (!packages) {
            packages = new Set();
            this.rows.set(name, packages);
        }
        packages.add(packageId ?? '');
    }

    /** Record that `(packageId, name)` is switched on (its row is active, or gone). */
    delete(name: string, packageId?: string): void {
        const packages = this.rows.get(name);
        if (!packages) return;
        packages.delete(packageId ?? '');
        if (packages.size === 0) this.rows.delete(name);
    }
}
