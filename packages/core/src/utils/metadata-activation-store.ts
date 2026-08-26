// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §4] THE activation-ledger row contract — one implementation,
 * parameterized by `metadata_type`.
 *
 * ## Why this file exists (#12350)
 *
 * ADR-0126 §4 declares ONE activation ledger for the whole disable+clone
 * family. It briefly had two implementations of that one row contract:
 *
 * | Implementation                    | Package                            | Landed |
 * | :-------------------------------- | :--------------------------------- | :----- |
 * | `ObjectStoreFlowActivationStore`  | `@objectstack/service-automation`  | #12296 |
 * | `ObjectStoreActionActivationStore`| `@objectstack/objectql`            | #12348 |
 *
 * They agreed on every load-bearing detail because the second was written from
 * the first — and nothing structurally held them together. ADR-0126 §8
 * pre-charts `tool`, `skill` and `position` as later consumers, and a third
 * and fourth copy is where the row semantics start drifting: the org-row skip
 * and the `0`-is-false read are exactly the kind of detail a copy loses
 * quietly, in a direction (an artifact silently re-arming) nothing else
 * measures.
 *
 * ## Why the code lives HERE and the object does not
 *
 * Neither consumer could import the other: `@objectstack/service-automation`
 * does not depend on `@objectstack/objectql` (devDependency only), and the
 * engine must not depend on a service — the dependency arrow points the other
 * way. `@objectstack/core` is the package BOTH already depend on, so this is
 * the one home that needs no new edge. ⛔ NOT `@objectstack/platform-objects`,
 * which declares the OBJECT: `objectql` does not depend on it and adding that
 * edge would invert the tiering, since platform-objects is a catalog the
 * engine serves. That is a MODULE-IMPORT question, and it is independent of
 * where the object's REGISTRATION lives (a composition question, ruled
 * separately on #12359 — `PlatformObjectsPlugin`).
 *
 * The table is reached by NAME, never by importing the declaration, exactly as
 * the engine already reaches `sys_metadata` / `sys_secret`.
 *
 * ## The row shape — ⛔ this module writes COLUMNS, never schema
 *
 * `metadata_type` · `name` · `package_id` · `organization_id` · `active`,
 * exactly the five ADR-0126 §4 declares. Four properties are load-bearing and
 * each is pinned on both consumers' sides (`flow-activation-ledger.test.ts`,
 * `action-activation.test.ts` — unchanged by the consolidation, which is what
 * makes them the proof it lost nothing):
 *
 *   - **`organization_id` is never written.** It is declared nullable and
 *     RESERVED (§5): every row written here is install-level, so the column
 *     stays NULL. The object's `unique: 'organization'` index collapses NULL
 *     through the driver's `COALESCE(organization_id, '__global__')`, so NULL
 *     rows are still unique per `(metadata_type, name)` — which is what lets
 *     {@link ObjectStoreMetadataActivationStore.setActive} treat "the row for
 *     this artifact" as at most one row.
 *   - **Rows carrying an organization are SKIPPED on read, not merged.** A row
 *     with one set was not written by this line, and reading it as
 *     install-level would apply one organization's choice to the whole
 *     installation — the #10243 direction, arrived at from the read side. A
 *     future per-org consumer adds its own scoped read; it does not widen
 *     this one.
 *   - **Absence of a row means ACTIVE.** Nothing here ever writes a row to say
 *     "active by default", and `list()` returning nothing is the normal
 *     stock-boot state, not an error. Re-enabling UPDATES the row to
 *     `active: true` rather than deleting it, so the ledger records the
 *     administrator's CHOICE instead of erasing it (§6 wall 3) — which is why
 *     {@link MetadataActivationStoreEngine} deliberately has no `delete`.
 *   - **A driver `0` reads as false.** SQLite/libsql round-trip booleans as
 *     0/1; a `!== false` test alone would read a disabled artifact as armed.
 *
 * ## The discriminator is never optional
 *
 * The ledger is generic and shared — flow rows and action rows live in the
 * same table today, and §8 charts more. Every read and write below is scoped
 * by `metadata_type`, so no consumer can touch a neighbour's state through a
 * table all of them are told to treat as generic. It is a constructor
 * argument, not a per-call one, so a caller cannot forget it at a single site.
 */

/**
 * The ledger table. A NAME, not an import: the object is declared in
 * `@objectstack/platform-objects` and this package must not depend on it.
 */
export const METADATA_ACTIVATION_TABLE = 'sys_metadata_activation';

/** Infrastructure rows, not tenant data — the `sys_metadata_activation` posture. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * [ADR-0126 §4] One packaged artifact's install-level activation row.
 *
 * The ledger's own columns are `metadata_type` / `name` / `package_id` /
 * `organization_id` / `active`; `metadata_type` is fixed by the store and
 * `organization_id` is never written on this line (§5), so neither reaches a
 * consumer's projection.
 */
export interface MetadataActivationRow {
    /** The packaged artifact's declarative machine name (ADR-0126 §4). */
    name: string;
    /** The package that ships the base artifact. */
    packageId: string;
    /** Is the packaged artifact armed for this installation. */
    active: boolean;
}

/**
 * [ADR-0126 §4] The durable off-switch for one class of packaged artifact.
 *
 * Absence of a row means the packaged default — ACTIVE — so a runtime with no
 * store attached, or a store with no rows, behaves exactly as a stock boot
 * always has.
 */
export interface MetadataActivationStore {
    /** Every install-level activation row for this type (`organization_id IS NULL`). */
    list(): Promise<MetadataActivationRow[]>;
    /** Insert or update the install-level row for one packaged artifact. */
    setActive(row: MetadataActivationRow): Promise<void>;
}

/**
 * The exact engine slice this store needs: a keyed read, an insert and an
 * update. Deliberately WITHOUT `delete` — re-enabling updates the `active`
 * bit, it never removes the row (see the module header), and demanding only
 * what is used keeps every test double honest about that.
 */
export interface MetadataActivationStoreEngine {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    find(object: string, options?: any): Promise<any[]>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert(object: string, data: any, options?: any): Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update(object: string, data: any, options?: any): Promise<any>;
}

/**
 * In-memory {@link MetadataActivationStore} — process-lifetime only, for tests
 * and for hosts with no durable plane. What it lacks versus the ObjectStore
 * implementation is DURABILITY, which is exactly the property ADR-0126 §6
 * wall 3 asks for; it is not a sanctioned production off-switch.
 *
 * No discriminator: an in-memory map is per-instance, so there is no shared
 * table for a neighbouring type's rows to be in.
 */
export class InMemoryMetadataActivationStore implements MetadataActivationStore {
    private readonly rows = new Map<string, MetadataActivationRow>();

    async list(): Promise<MetadataActivationRow[]> {
        return [...this.rows.values()];
    }

    async setActive(row: MetadataActivationRow): Promise<void> {
        this.rows.set(row.name, { ...row });
    }
}

/**
 * Durable {@link MetadataActivationStore} backed by the
 * `sys_metadata_activation` object (ADR-0126 §4), scoped to one
 * `metadata_type`.
 *
 * All access uses a system context: the object is `managedBy: 'engine-owned'`
 * and declares `apiMethods: ['get', 'list']`, i.e. the generic data API cannot
 * write it at all — these rows are written by the ADR-0126 enable/disable
 * doors and by nothing else.
 */
export class ObjectStoreMetadataActivationStore implements MetadataActivationStore {
    constructor(
        private readonly engine: MetadataActivationStoreEngine,
        /**
         * The ledger's `metadata_type` discriminator for this consumer —
         * `'flow'`, `'action'`, … Required, and fixed for the store's
         * lifetime: see the module header on why it is never a per-call
         * argument.
         */
        private readonly metadataType: string,
    ) {}

    /**
     * Every install-level row of this type. Read once at boot to hydrate the
     * consumer's projection.
     *
     * Rows carrying an `organization_id` are SKIPPED, not merged — see the
     * module header for why that is a wall and not a filter.
     */
    async list(): Promise<MetadataActivationRow[]> {
        const rows = await this.engine.find(METADATA_ACTIVATION_TABLE, {
            where: { metadata_type: this.metadataType },
            context: SYSTEM_CTX,
        });
        if (!Array.isArray(rows)) return [];
        const out: MetadataActivationRow[] = [];
        for (const row of rows) {
            const r = row as { name?: unknown; package_id?: unknown; active?: unknown; organization_id?: unknown };
            if (r.organization_id != null) continue;
            if (typeof r.name !== 'string' || !r.name) continue;
            out.push({
                name: r.name,
                packageId: typeof r.package_id === 'string' ? r.package_id : '',
                // The column defaults to `true`; only an explicit `false`
                // disarms. A driver that round-trips booleans as 0/1
                // (SQLite/libsql) is read through the same `=== false || === 0`
                // test, so a `0` is not mistaken for `true`.
                active: !(r.active === false || r.active === 0),
            });
        }
        return out;
    }

    /**
     * Insert or update the install-level row for one packaged artifact.
     *
     * Read-then-write rather than a blind upsert because the object's
     * uniqueness is a DECLARED index (`unique: 'organization'`), not a primary
     * key this store controls: there is no id to collide on, so an
     * insert-and-catch could not tell "already there" from a real store
     * failure.
     *
     * ⛔ `organization_id` is not in either payload. Omitting it is what leaves
     * it NULL, which is the whole of §5's install-level scope on this line.
     */
    async setActive(row: MetadataActivationRow): Promise<void> {
        const existing = await this.engine.find(METADATA_ACTIVATION_TABLE, {
            where: { metadata_type: this.metadataType, name: row.name },
            context: SYSTEM_CTX,
        });
        const current = Array.isArray(existing)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ? existing.find((r: any) => r?.organization_id == null)
            : undefined;

        if (current && (current as { id?: unknown }).id != null) {
            await this.engine.update(
                METADATA_ACTIVATION_TABLE,
                { id: (current as { id: unknown }).id, active: row.active, package_id: row.packageId },
                { context: SYSTEM_CTX },
            );
            return;
        }

        await this.engine.insert(
            METADATA_ACTIVATION_TABLE,
            {
                metadata_type: this.metadataType,
                name: row.name,
                package_id: row.packageId,
                active: row.active,
            },
            { context: SYSTEM_CTX },
        );
    }

    /**
     * Read the backing table once so a misconfiguration surfaces at BOOT
     * rather than as a failed toggle later. Throws the driver error verbatim —
     * `no such table: sys_metadata_activation` means the object was never
     * registered (or its schema never synced) in this composition.
     *
     * ⚠️ Unscoped by design: the question is "does the TABLE read at all",
     * which is a property of the composition, not of one `metadata_type`.
     */
    async probe(): Promise<void> {
        await this.engine.find(METADATA_ACTIVATION_TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
    }
}
