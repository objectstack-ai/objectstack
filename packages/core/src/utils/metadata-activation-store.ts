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
 * `metadata_type` · `name` · `package_id` · `active`, exactly the four
 * ADR-0126 §4 declares. Three properties are load-bearing and each is pinned on
 * both consumers' sides (`flow-activation-ledger.test.ts`,
 * `action-activation.test.ts` — unchanged by the consolidation, which is what
 * makes them the proof it lost nothing):
 *
 *   - **The ledger is DEPLOYMENT-level, and carries no tenant column at all.**
 *     A row says "this environment switched this managed item off" — a fact no
 *     organization owns. The table briefly declared a nullable tenant column
 *     marked RESERVED and never written, and this module correspondingly
 *     filtered reads to the NULL ones and skipped any row carrying an
 *     organization. Both are gone: a reserved nullable tenant
 *     column is the shape the total-organization-ownership record proposed in
 *     PR #14976 rules out, so the column was dropped before it ever shipped
 *     (17.2.0 predates the table). There is no filter here any more because
 *     there is no column to filter on — `list()` is simply every activation
 *     row of this type. Should a per-organization dimension ever be wanted, it
 *     returns as a separate org-owned object, never as a column here.
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
 *
 * ## The row identity carries the package (ADR-0150 D4, D8 row R4)
 *
 * The object's unique key is `(metadata_type, package_id, name)`: two packages
 * may each hold a row for an item of the same name, one package may not hold
 * two. `package_id` is null for an item no package holds (an environment-
 * authored position, permission set or action), and SQL `UNIQUE` is
 * NULL-distinct, so for those rows the key constrains nothing. A runtime index
 * keeps them to one per `(metadata_type, name)` (`metadata-protocol`'s
 * `activation-ledger-packageless-index.ts`, and `driver-mongodb`'s copy), and
 * this module's read-then-write (`setActive`) keeps to it on every driver,
 * including the memory driver, which has no such index. Rows written before the key carried the package may have a null
 * `package_id` for an item a package holds: {@link backfillActivationLedgerPackages}
 * binds each one to its one holder and reports the rest, never guessing.
 */

/**
 * The ledger table. A NAME, not an import: the object is declared in
 * `@objectstack/platform-objects` and this package must not depend on it.
 */
export const METADATA_ACTIVATION_TABLE = 'sys_metadata_activation';

/**
 * Infrastructure rows, not tenant data — the `sys_metadata_activation` posture.
 * The context of every read, and of a write no caller is named for (a boot-time
 * or in-process flip): such a row names nobody, which is true of it.
 */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The context one ledger WRITE runs under when a caller asked for it: that
 * caller's own execution context, ELEVATED — `{ ...callerContext, isSystem: true }`,
 * the `sudo()`-shaped elevation the engine's own trusted paths use.
 *
 * Both halves are load-bearing:
 *
 *   - **the elevation** — the ledger object is `managedBy: 'engine-owned'` and
 *     declares `apiMethods: ['get', 'list']`, so nothing but an elevated write
 *     reaches it. The door has already judged the caller's authority (ADR-0126
 *     §5); the write itself is the platform's;
 *   - **the caller** — the engine stamps `created_by` / `updated_by` from its
 *     `userId`, and the audit plugin records `user_id` / `actor` from the same
 *     session, so the record of an install-wide switch names the administrator
 *     who threw it. A bare system context names nobody.
 *
 * `isSystem: true` is in the type, so a door cannot hand the caller's bare
 * context down by accident. Runtime doors build it with one shared helper
 * (`activationWriteContext` in `@objectstack/runtime`), so they cannot disagree
 * about who a row names.
 */
export type MetadataActivationWriteContext = { readonly isSystem: true; readonly userId?: string } & Record<string, unknown>;

/** Options for one {@link MetadataActivationStore.setActive} call. */
export interface MetadataActivationWriteOptions {
    /**
     * The caller this write is made on behalf of, already elevated
     * ({@link MetadataActivationWriteContext}). Absent ⇒ the store's own system
     * context, and the row names nobody.
     */
    context?: MetadataActivationWriteContext;
}

/**
 * [ADR-0126 §4] One artifact's install-level activation row.
 *
 * The ledger's own columns are `metadata_type` / `name` / `package_id` /
 * `active`; `metadata_type` is fixed by the store, so it never reaches a
 * consumer's projection.
 */
export interface MetadataActivationRow {
    /** The artifact's declarative machine name (ADR-0126 §4). */
    name: string;
    /**
     * The package that ships the artifact — ABSENT when no package does: a
     * position, permission set or action the environment authored, which the
     * security catalog's and the action's activation doors switch as well as a
     * packaged one. Absent is the only package-less spelling: the store writes
     * no value for it and refuses `''`
     * ({@link ObjectStoreMetadataActivationStore.setActive}), and so does the
     * in-memory double, so no reader can take an environment item for a
     * package named `''`.
     */
    packageId?: string;
    /** Is the artifact armed for this installation. */
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
    /** Every activation row for this type — the ledger is deployment-wide. */
    list(): Promise<MetadataActivationRow[]>;
    /**
     * Insert or update the row for one packaged artifact — written on behalf of
     * `options.context` when a caller asked for it.
     */
    setActive(row: MetadataActivationRow, options?: MetadataActivationWriteOptions): Promise<void>;
}

/**
 * The exact engine slice this store needs: a keyed read, an insert and an
 * update. Deliberately WITHOUT `delete` — re-enabling updates the `active`
 * bit, it never removes the row (see the module header), and demanding only
 * what is used keeps every test double honest about that.
 */
export interface MetadataActivationStoreEngine {
    find(object: string, options?: any): Promise<any[]>;
    insert(object: string, data: any, options?: any): Promise<any>;
    update(object: string, data: any, options?: any): Promise<any>;
}

/**
 * Refuse the empty string as a row's package, before anything is read or
 * written — the ONE refusal both stores apply, so the in-memory double can
 * never accept a row the durable store refuses.
 *
 * `''` is the placeholder a caller reaches for with `?? ''`, and a stored `''`
 * would be one more spelling of "no package" beside the absent one — exactly
 * the ambiguity {@link MetadataActivationRow.packageId} rules out.
 *
 * @param subject how the refusal names the row's artifact (`flow 'x'`, `'x'`).
 */
function refuseEmptyPackageId(row: MetadataActivationRow, subject: string): void {
    if (row.packageId !== '') return;
    throw new TypeError(
        `Activation row for ${subject} names the empty string as its package. ` +
        `Omit packageId for an item no package ships; an empty package id is not a package.`,
    );
}

/**
 * In-memory {@link MetadataActivationStore} — process-lifetime only, for tests
 * and for hosts with no durable plane. What it lacks versus the ObjectStore
 * implementation is DURABILITY, which is exactly the property ADR-0126 §6
 * wall 3 asks for; it is not a sanctioned production off-switch.
 *
 * It refuses exactly the rows the durable store refuses (an empty package id,
 * {@link refuseEmptyPackageId}): it is the flow and action stores' test
 * double, and a double more lenient than what it stands for lets a test pass
 * a write the real ledger refuses.
 *
 * No discriminator: an in-memory map is per-instance, so there is no shared
 * table for a neighbouring type's rows to be in.
 */
export class InMemoryMetadataActivationStore implements MetadataActivationStore {
    private readonly rows = new Map<string, MetadataActivationRow>();

    async list(): Promise<MetadataActivationRow[]> {
        return [...this.rows.values()];
    }

    /** The caller is not recorded: a map has no `created_by` to stamp. */
    async setActive(row: MetadataActivationRow, _options?: MetadataActivationWriteOptions): Promise<void> {
        refuseEmptyPackageId(row, `'${row.name}'`);
        this.rows.set(row.name, { ...row });
    }
}

/**
 * Durable {@link MetadataActivationStore} backed by the
 * `sys_metadata_activation` object (ADR-0126 §4), scoped to one
 * `metadata_type`.
 *
 * All access is elevated: the object is `managedBy: 'engine-owned'` and
 * declares `apiMethods: ['get', 'list']`, i.e. the generic data API cannot
 * write it at all — these rows are written by the ADR-0126 enable/disable
 * doors and by nothing else. Reads use the store's own system context; a write
 * a door makes for a caller runs under that caller's context, elevated, so the
 * row and its audit row name who switched the item
 * ({@link MetadataActivationWriteContext}).
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
     * Every row of this type. Read once at boot to hydrate the consumer's
     * projection.
     *
     * The only scoping is the `metadata_type` discriminator: the ledger is
     * deployment-wide and has no tenant column, so there is no second axis to
     * filter on (see the module header).
     */
    async list(): Promise<MetadataActivationRow[]> {
        const rows = await readActivationLedgerRows(this.engine, { metadata_type: this.metadataType });
        return rows.map(({ metadataType: _type, ...row }) => row);
    }

    /**
     * Insert or update the row for one packaged artifact.
     *
     * Read-then-write rather than a blind upsert because the object's
     * uniqueness is a DECLARED index (`unique: 'global'` over
     * `(metadata_type, package_id, name)`, ADR-0150 D4), not a primary key this
     * store controls: there is no id to collide on, so an insert-and-catch
     * could not tell "already there" from a real store failure.
     *
     * The write still addresses the row by `(metadata_type, name)`: the bare
     * path, kept (ADR-0150 red line 3). This is the ledger's only writer, and it
     * inserts only where that read finds nothing, so it keeps one row per
     * `(metadata_type, name)` and taking the FIRST match is taking the only one.
     * The wider index permits a second package's row of the same name; nothing
     * writes one until a type's own readers consult the ledger by
     * `(package, name)` (that type's ADR-0150 child), so no name-keyed reader
     * ever sees two rows for one name.
     *
     * `packageId` absent writes NO package (`null`), the ledger's spelling for
     * an item no package ships. An empty string is refused before anything is
     * read or written ({@link refuseEmptyPackageId}).
     *
     * `options.context` is the caller the write is made for, elevated
     * ({@link MetadataActivationWriteContext}). The keyed lookup runs under it
     * too, so the read-then-write is one principal's act; absent, both run
     * under the store's system context and the row names nobody.
     */
    async setActive(row: MetadataActivationRow, options?: MetadataActivationWriteOptions): Promise<void> {
        refuseEmptyPackageId(row, `${this.metadataType} '${row.name}'`);
        const context = options?.context ?? SYSTEM_CTX;
        const packageId = row.packageId ?? null;
        const existing = await this.engine.find(METADATA_ACTIVATION_TABLE, {
            where: { metadata_type: this.metadataType, name: row.name },
            context,
        });
        const current = Array.isArray(existing) ? existing[0] : undefined;

        if (current && (current as { id?: unknown }).id != null) {
            await this.engine.update(
                METADATA_ACTIVATION_TABLE,
                { id: (current as { id: unknown }).id, active: row.active, package_id: packageId },
                { context },
            );
            return;
        }

        await this.engine.insert(
            METADATA_ACTIVATION_TABLE,
            {
                metadata_type: this.metadataType,
                name: row.name,
                package_id: packageId,
                active: row.active,
            },
            { context },
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

/**
 * [ADR-0146 D8 item 4] One ledger row as the per-package read reports it: the
 * row of {@link MetadataActivationRow} plus its `metadata_type`, the one column
 * a per-type store keeps to itself.
 */
export interface MetadataActivationLedgerRow extends MetadataActivationRow {
    /** The row's `metadata_type` discriminator (`'flow'`, `'action'`, …). */
    metadataType: string;
}

/**
 * THE ledger read: one `find` on {@link METADATA_ACTIVATION_TABLE} under the
 * store's system context, and the one row parse. Every reader of the ledger
 * goes through it — {@link ObjectStoreMetadataActivationStore.list} with its
 * `metadata_type`, {@link listPackageMetadataActivations} with a package — so
 * the `0`-is-false read and the absent-package spelling have one home.
 */
async function readActivationLedgerRows(
    engine: Pick<MetadataActivationStoreEngine, 'find'>,
    where: Readonly<Record<string, unknown>>,
): Promise<MetadataActivationLedgerRow[]> {
    const rows = await engine.find(METADATA_ACTIVATION_TABLE, { where: { ...where }, context: SYSTEM_CTX });
    if (!Array.isArray(rows)) return [];
    const out: MetadataActivationLedgerRow[] = [];
    for (const row of rows) {
        const r = row as { metadata_type?: unknown; name?: unknown; package_id?: unknown; active?: unknown };
        if (typeof r.name !== 'string' || !r.name) continue;
        out.push({
            metadataType: typeof r.metadata_type === 'string' ? r.metadata_type : '',
            name: r.name,
            // A row with no package — an environment-authored item — reads
            // back with `packageId` absent, the spelling it was written in.
            ...(typeof r.package_id === 'string' && r.package_id !== '' ? { packageId: r.package_id } : {}),
            active: readActiveColumn(r.active),
        });
    }
    return out;
}

/**
 * The one read of a stored `active` column. The column defaults to `true`;
 * only an explicit `false` disarms. A driver that round-trips booleans as 0/1
 * (SQLite/libsql) is read through the same `=== false || === 0` test, so a `0`
 * is not mistaken for `true`.
 */
function readActiveColumn(value: unknown): boolean {
    return !(value === false || value === 0);
}

/**
 * [ADR-0146 D8 item 4, D3] Every ledger row one package's items carry, of every
 * `metadata_type`: the "switched off" half of the per-package customization
 * read (`GET /packages/:id/customizations`), which asks "what of HotCRM did
 * this deployment switch off" across flows, actions and the catalog types at
 * once.
 *
 * Read-only, and the one place the ledger is read across types: a write stays
 * scoped by its store's `metadata_type` (the module header), and no consumer
 * decides anything from `package_id`, which records provenance. The read and
 * the parse are {@link readActivationLedgerRows}'s, so a row reads here exactly
 * as its own type's store reads it. `packageId` must be a non-empty string;
 * anything else answers no rows, never the package-less ones.
 */
export async function listPackageMetadataActivations(
    engine: Pick<MetadataActivationStoreEngine, 'find'>,
    packageId: string,
): Promise<MetadataActivationLedgerRow[]> {
    if (typeof packageId !== 'string' || packageId === '') return [];
    return readActivationLedgerRows(engine, { package_id: packageId });
}

/**
 * [ADR-0150 D8 row R4] Who holds the item one ledger row names, as the
 * backfill asks it of the environment's package-scoped resolver. The resolver
 * lives in `@objectstack/objectql` (`resolvePackageScopedName`), which this
 * package cannot import, so the caller answers through
 * {@link backfillActivationLedgerPackages}'s `holderOf` and this module never
 * re-states the resolution rule.
 *
 *  - `package`: exactly one package holds the name. The row takes it.
 *  - `environment`: the environment's own item, held by no package
 *    (ADR-0150 D1 bucket 4). The row stays null, which is its spelling.
 *  - `ambiguous`: two or more packages hold the name, `candidates` naming
 *    every one. The row stays null and is reported, ⛔ never bound on a guess.
 *  - `unheld`: nothing holds the name any more. The row stays null.
 *  - `unaddressed`: the type is not addressed by package (a position, one
 *    environment-wide slot, ADR-0150 D7). The row stays null.
 */
export type ActivationLedgerHolder =
    | { readonly kind: 'package'; readonly packageId: string }
    | { readonly kind: 'environment' }
    | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] }
    | { readonly kind: 'unheld' }
    | { readonly kind: 'unaddressed' };

/** One ledger row the backfill read with no package: its type and name. */
export interface ActivationLedgerUnboundRow {
    readonly metadataType: string;
    readonly name: string;
}

/** One stored row of an item that holds more than one, as the backfill reports it. */
export interface ActivationLedgerDuplicateRow {
    /** The row's id: what an operator deletes it by. */
    readonly id: string;
    /** The package the row names. Absent when it names none. */
    readonly packageId?: string;
    /** The switch the row records (a driver `0` reads as false). */
    readonly active: boolean;
}

/** What one backfill run did, or would do in a dry run. */
export interface ActivationLedgerBackfillReport {
    /** Rows given the package that holds their item: written, or to be written in a dry run. */
    readonly bound: ReadonlyArray<ActivationLedgerUnboundRow & { readonly packageId: string }>;
    /** Rows left null because two or more packages hold the name: every candidate named. */
    readonly ambiguous: ReadonlyArray<ActivationLedgerUnboundRow & { readonly candidates: readonly string[] }>;
    /** Rows left null with no question to ask: the environment's own item, an unheld name, an unaddressed type. */
    readonly unchanged: ReadonlyArray<ActivationLedgerUnboundRow & { readonly reason: 'environment' | 'unheld' | 'unaddressed' }>;
    /**
     * Items one package holds whose rows are left null because the item has
     * more than one row: two or more naming no package, or one naming no
     * package beside one that already names the holder. Every such row is
     * named, `packageId` is the holder, and none is bound (module doc of
     * {@link backfillActivationLedgerPackages}).
     */
    readonly duplicated: ReadonlyArray<
        ActivationLedgerUnboundRow & { readonly packageId: string; readonly rows: readonly ActivationLedgerDuplicateRow[] }
    >;
    /**
     * Rows whose write was refused or failed: each still names no package,
     * with the error text. Every other row was still handled.
     */
    readonly failed: ReadonlyArray<
        ActivationLedgerUnboundRow & { readonly id: string; readonly packageId: string; readonly error: string }
    >;
}

/** Options for {@link backfillActivationLedgerPackages}. */
export interface ActivationLedgerBackfillOptions {
    /** Report what would be bound and write nothing. */
    readonly dryRun?: boolean;
}

/**
 * [ADR-0150 D8 row R4, D10] Give every ledger row that names no package the
 * package that holds its item, now that the ledger's unique key is
 * `(metadata_type, package_id, name)`.
 *
 * The source is the environment's one holder of `(metadata_type, name)` when
 * the backfill runs (`holderOf`, the package-scoped resolver asked as a caller
 * with no package). Phase 1's boot seal makes that holder unique for its
 * covered types, so a name it left held twice, and a name of an uncovered type
 * two packages hold, is the ambiguous set: the row is left null and reported
 * with every candidate, ⛔ never bound to one of them.
 *
 * ## An item with more than one row is reported, ⛔ never bound
 *
 * A row is bound only when it is the item's ONE row. When the item has two or
 * more rows that name no package, binding one would take it out of the
 * package-less index's reach (`activation-ledger-packageless-index.ts`, which
 * refuses to build while they coexist), so the next boot would build that index
 * over the pair and the duplicate would never be reported again; the second
 * write would also collide with the first under the declared key. When a row
 * names no package beside one that already names the holder, the write would
 * collide. Either way two administrators' switches stand for one item, so the
 * item is reported in `duplicated` with every one of those rows, and none of
 * them is written: the operator deletes the row that should not apply, and the
 * next run binds the one left. Nothing here deletes or picks one.
 *
 * ## Every question is asked before the first write
 *
 * The run reads the ledger and asks `holderOf` for every item first, then
 * writes. A failure there (the read, a resolver that throws) leaves the ledger
 * as it was. A write that is refused or fails is reported in `failed` with its
 * error, and the run goes on to the next row, so one row never stops the rows
 * stored after it.
 *
 * Re-runnable: it reads only rows with no package and writes only the package,
 * so a second run over the same environment finds nothing to bind and writes
 * nothing. It writes no other column (`active` is the administrator's choice
 * and stays as it is), inserts nothing and deletes nothing. A row a package
 * holds already is never read as a candidate, so a run can only add a package
 * to a row, never move one.
 *
 * The read is unscoped by `metadata_type` (it is the one cross-type pass, like
 * {@link listPackageMetadataActivations}); each row is judged by its own type.
 * A row that carries no usable `id` or `name` is left alone: there is nothing
 * to address it by.
 */
export async function backfillActivationLedgerPackages(
    engine: Pick<MetadataActivationStoreEngine, 'find' | 'update'>,
    holderOf: (metadataType: string, name: string) => ActivationLedgerHolder,
    options?: ActivationLedgerBackfillOptions,
): Promise<ActivationLedgerBackfillReport> {
    const bound: Array<ActivationLedgerUnboundRow & { packageId: string }> = [];
    const ambiguous: Array<ActivationLedgerUnboundRow & { candidates: string[] }> = [];
    const unchanged: Array<ActivationLedgerUnboundRow & { reason: 'environment' | 'unheld' | 'unaddressed' }> = [];
    const duplicated: Array<ActivationLedgerUnboundRow & { packageId: string; rows: ActivationLedgerDuplicateRow[] }> = [];
    const failed: Array<ActivationLedgerUnboundRow & { id: string; packageId: string; error: string }> = [];
    const rows = await engine.find(METADATA_ACTIVATION_TABLE, { where: {}, context: SYSTEM_CTX });
    if (!Array.isArray(rows)) return { bound, ambiguous, unchanged, duplicated, failed };

    // Every row of each item, in storage order; items in the order first seen.
    type LedgerRow = { id?: unknown; metadata_type: string; name: string; package_id?: unknown; active?: unknown };
    const items = new Map<string, LedgerRow[]>();
    for (const row of rows) {
        const r = row as { metadata_type?: unknown; name?: unknown };
        if (typeof r.name !== 'string' || r.name === '' || typeof r.metadata_type !== 'string') continue;
        const key = JSON.stringify([r.metadata_type, r.name]);
        const list = items.get(key) ?? [];
        list.push(row as LedgerRow);
        items.set(key, list);
    }
    // Only a row with NO package is a backfill candidate. An empty string is
    // not a spelling the writer produces ({@link refuseEmptyPackageId}), so it
    // is left as it stands rather than read as "no package".
    const namesNoPackage = (r: LedgerRow): boolean => r.package_id === null || r.package_id === undefined;

    // Ask every question first (module doc): nothing below writes.
    const writes: Array<ActivationLedgerUnboundRow & { id: unknown; packageId: string }> = [];
    for (const itemRows of items.values()) {
        const candidates = itemRows.filter((r) => namesNoPackage(r) && r.id != null);
        if (candidates.length === 0) continue;
        const at = { metadataType: candidates[0].metadata_type, name: candidates[0].name };
        const holder = holderOf(at.metadataType, at.name);
        switch (holder.kind) {
            case 'package': {
                const holderRow = (r: LedgerRow) => r.package_id === holder.packageId;
                if (candidates.length > 1 || itemRows.some(holderRow)) {
                    duplicated.push({
                        ...at,
                        packageId: holder.packageId,
                        rows: itemRows
                            .filter((r) => r.id != null && (namesNoPackage(r) || holderRow(r)))
                            .map((r) => ({
                                id: String(r.id),
                                ...(holderRow(r) ? { packageId: holder.packageId } : {}),
                                active: readActiveColumn(r.active),
                            })),
                    });
                    break;
                }
                writes.push({ ...at, id: candidates[0].id, packageId: holder.packageId });
                break;
            }
            case 'ambiguous':
                ambiguous.push(...candidates.map(() => ({ ...at, candidates: [...holder.candidates] })));
                break;
            default: {
                const reason = holder.kind;
                unchanged.push(...candidates.map(() => ({ ...at, reason })));
            }
        }
    }

    for (const { id, ...write } of writes) {
        if (!options?.dryRun) {
            try {
                await engine.update(
                    METADATA_ACTIVATION_TABLE,
                    { id, package_id: write.packageId },
                    { context: SYSTEM_CTX },
                );
            } catch (e: unknown) {
                // Reported to the caller, never swallowed: the row still names
                // no package, which every reader handles, and the next run
                // tries it again.
                failed.push({ ...write, id: String(id), error: e instanceof Error ? e.message : String(e) });
                continue;
            }
        }
        bound.push(write);
    }
    return { bound, ambiguous, unchanged, duplicated, failed };
}
