// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0126 §8 item 2] Durable activation ledger for PACKAGED ACTIONS —
 * `sys_metadata_activation` rows carrying `metadata_type: 'action'`.
 *
 * The maintainer's amendment ruling 3 (2026-08-25, verbatim and untranslated)
 * is the pull this implements:
 *
 * > 「动作 可能是需要开关的，因为有的 action 我不想启用。」
 *
 * ADR-0126 §8 item 2 then says how: *"same `sys_metadata_activation` ledger,
 * same §5 write authority, a consult point at action dispatch"* — the flow leg
 * generalized, ⛔ never a second mechanism. What the action leg does NOT get is
 * the clone half: §8 keeps it pre-chartered until real pull appears, so nothing
 * here copies, designates or links an artifact to another one.
 *
 * ## Row shape — ⛔ this module writes COLUMNS, never schema
 *
 * `metadata_type: 'action'` · `name` · `package_id` · `organization_id` ·
 * `active`, exactly the five ADR-0126 §4 declares (the object itself lives in
 * `packages/platform-objects`, which is why this leg needs zero `packages/spec`
 * surface). Two properties of that shape are load-bearing here:
 *
 *   - **`organization_id` is never written.** It is declared nullable and
 *     RESERVED (§5): every row this line writes is install-level, so the column
 *     stays NULL. The object's `unique: 'organization'` index collapses NULL
 *     through the driver's `COALESCE(organization_id, '__global__')`, so NULL
 *     rows are still unique per `(metadata_type, name)` — which is what lets
 *     {@link ObjectStoreActionActivationStore.setActive} treat "the row for this
 *     action" as at most one row.
 *   - **Absence of a row means ACTIVE.** Nothing here ever writes a row to say
 *     "active by default", and a `list()` returning nothing is the normal
 *     stock-boot state, not an error. Re-enabling updates the row to
 *     `active: true` rather than deleting it, so the ledger records the
 *     administrator's CHOICE instead of erasing it (§6 wall 3).
 *
 * ## What identifies an action here, and the one case it refuses to guess
 *
 * The ledger addresses an artifact by its **machine name** (§4), and ADR-0110
 * D1 says the same thing about actions: *"Identity is always the declarative
 * `name`; which key the handler happens to live under is derived from the
 * already-resolved declaration"*. So a row's `name` is `action.name` — never a
 * handler key, never a `<object>:<action>` composite (that would encode two
 * facts in a column declared to hold one, and the per-object dimension, like
 * the per-org one, is an additive column later if pull ever appears).
 *
 * The consequence is stated rather than hidden: two same-named actions on
 * different objects address ONE row. The write door refuses that case loudly
 * instead of silently disabling both — see `refuseAmbiguousActionActivation`
 * in `@objectstack/runtime`'s `/actions` domain, which is where a caller and a
 * resolvable object set exist to name.
 *
 * ## Relationship to the flow twin — one contract, two implementations, on record
 *
 * `packages/services/service-automation/src/flow-activation-store.ts` is the
 * same store one tier up, landed first (#12296). This module deliberately does
 * NOT import it and is not imported by it: `service-automation` does not depend
 * on `@objectstack/objectql`, and the engine must not depend on a service, so
 * neither direction is available today. What holds the two together is the row
 * contract in ADR-0126 §4 and the pins on both sides; consolidating them onto
 * one implementation (in a package both may depend on) is filed as its own
 * card rather than smuggled into this leg.
 *
 * ## Why the ENGINE holds the projection
 *
 * Because the engine plugin is the one place that is unconditionally present
 * wherever actions can execute — the same reasoning ADR-0110 D5 recorded when
 * it moved the action-governance inventory off `AppPlugin` ("registered
 * CONDITIONALLY … on the platform's own dev loop the inventory never ran").
 * An activation projection that some boots never hydrate is strictly worse
 * than that: a disabled action would ARM. The engine also owns the action
 * handler registry, so the projection sits beside the map it governs.
 */

/**
 * The ledger table. A NAME, not an import: this package does not depend on
 * `@objectstack/platform-objects` (which declares the object) and must not —
 * the same posture the flow twin takes, and the same one this engine already
 * takes for `sys_metadata` / `sys_secret`.
 */
export const ACTION_ACTIVATION_TABLE = 'sys_metadata_activation';
const TABLE = ACTION_ACTIVATION_TABLE;

/**
 * The ledger's `metadata_type` discriminator for this consumer. Every read and
 * write here is scoped by it: the ledger is generic (ADR-0126 §4) and this
 * module never assumes it owns the table — flow rows share it today, permission
 * rows may later.
 */
const METADATA_TYPE = 'action';

/** Infrastructure rows, not tenant data — the `sys_metadata_activation` posture. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * [ADR-0126 §4] One packaged action's install-level activation row, as the
 * engine sees it. The ledger's own columns are `metadata_type` / `name` /
 * `package_id` / `organization_id` / `active`; `metadata_type` is fixed to
 * `'action'` by the store and `organization_id` is never written on this line
 * (§5), so those two never reach the projection.
 */
export interface ActionActivationRow {
    /** The packaged action's declarative machine name (ADR-0110 D1). */
    name: string;
    /** The package that ships the base artifact. */
    packageId: string;
    /** Is the packaged action armed for this installation. */
    active: boolean;
}

/**
 * [ADR-0126 §8] The durable off-switch for packaged actions.
 *
 * Absence of a row means the packaged default — ACTIVE — so an engine with no
 * store attached, or a store with no rows, dispatches exactly as a stock boot
 * always has.
 */
export interface ActionActivationStore {
    /** Every install-level action activation row (`organization_id IS NULL`). */
    list(): Promise<ActionActivationRow[]>;
    /** Insert or update the install-level row for one packaged action. */
    setActive(row: ActionActivationRow): Promise<void>;
}

/**
 * The exact slice of the engine this store needs: a keyed read, an insert and
 * an update. Deliberately WITHOUT `delete` — re-enabling updates the `active`
 * bit, it never removes the row (see the module header), and demanding only
 * what is used keeps every test double honest about that.
 */
export interface ActionActivationStoreEngine {
    find(object: string, options?: any): Promise<any[]>;
    insert(object: string, data: any, options?: any): Promise<any>;
    update(object: string, data: any, options?: any): Promise<any>;
}

/**
 * In-memory {@link ActionActivationStore} — process-lifetime only, for tests
 * and for hosts with no durable plane. It is NOT a sanctioned production
 * off-switch: what it lacks versus the ObjectStore implementation is
 * DURABILITY, which is exactly the property ADR-0126 §6 wall 3 asks for.
 */
export class InMemoryActionActivationStore implements ActionActivationStore {
    private readonly rows = new Map<string, ActionActivationRow>();

    async list(): Promise<ActionActivationRow[]> {
        return [...this.rows.values()];
    }

    async setActive(row: ActionActivationRow): Promise<void> {
        this.rows.set(row.name, { ...row });
    }
}

/**
 * Durable {@link ActionActivationStore} backed by the `sys_metadata_activation`
 * object (ADR-0126 §4).
 *
 * All access uses a system context: the object is `managedBy: 'engine-owned'`
 * and declares `apiMethods: ['get', 'list']`, i.e. the generic data API cannot
 * write it at all — these rows are written by the ADR-0126 enable/disable door
 * and by nothing else.
 */
export class ObjectStoreActionActivationStore implements ActionActivationStore {
    constructor(private readonly engine: ActionActivationStoreEngine) {}

    /**
     * Every install-level action row. Read once at boot to hydrate the
     * projection.
     *
     * Rows carrying an `organization_id` are SKIPPED, not merged: the per-org
     * dimension is reserved and unwritten on this line (§5), so a row with one
     * set was not written by this code. Reading it as install-level would apply
     * one organization's choice to the whole installation — the #10243
     * direction, arrived at from the read side. A future per-org consumer adds
     * its own scoped read; it does not widen this one.
     */
    async list(): Promise<ActionActivationRow[]> {
        const rows = await this.engine.find(TABLE, {
            where: { metadata_type: METADATA_TYPE },
            context: SYSTEM_CTX,
        });
        if (!Array.isArray(rows)) return [];
        const out: ActionActivationRow[] = [];
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
                // test the flow twin uses, so a `0` is not mistaken for `true`.
                active: !(r.active === false || r.active === 0),
            });
        }
        return out;
    }

    /**
     * Insert or update the install-level row for one packaged action.
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
    async setActive(row: ActionActivationRow): Promise<void> {
        const existing = await this.engine.find(TABLE, {
            where: { metadata_type: METADATA_TYPE, name: row.name },
            context: SYSTEM_CTX,
        });
        const current = Array.isArray(existing)
            ? existing.find((r: any) => r?.organization_id == null)
            : undefined;

        if (current && (current as { id?: unknown }).id != null) {
            await this.engine.update(
                TABLE,
                { id: (current as { id: unknown }).id, active: row.active, package_id: row.packageId },
                { context: SYSTEM_CTX },
            );
            return;
        }

        await this.engine.insert(
            TABLE,
            {
                metadata_type: METADATA_TYPE,
                name: row.name,
                package_id: row.packageId,
                active: row.active,
            },
            { context: SYSTEM_CTX },
        );
    }

    /**
     * Read the backing table once so a misconfiguration surfaces at BOOT rather
     * than as a failed toggle later. Throws the driver error verbatim — `no
     * such table: sys_metadata_activation` means the object was never
     * registered (or its schema never synced) in this composition.
     */
    async probe(): Promise<void> {
        await this.engine.find(TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
    }
}

/**
 * [ADR-0126 §8] The engine's local projection of the action activation ledger.
 *
 * ## Why a projection rather than a read per dispatch
 *
 * Every dispatch door already resolves a declaration, gates on ADR-0066 D4 and
 * loads the subject record; adding a datasource round-trip to each invocation
 * would make the off-switch cost proportional to traffic. The projection is
 * written from exactly two places — {@link hydrate} (boot, from the ledger) and
 * {@link setActive} (which writes the durable row FIRST and updates the set only
 * after that write returns) — so it cannot drift into being an independent,
 * process-local off-switch, which is the #10243 mechanism ADR-0126 retires.
 *
 * ⚠️ It is deliberately NOT re-read per `metadata:reloaded`: a reload
 * re-registers HANDLERS, and a re-registered handler must stay disabled. The
 * projection outliving the registry churn is the property the "survives
 * re-register" pin asserts.
 */
export class ActionActivationProjection {
    /** Actions the ledger marks inactive, keyed by declarative name. */
    private readonly disabled = new Set<string>();
    private store: ActionActivationStore | null = null;

    /** Attach the durable ledger. Hosts call this at start(), after ObjectQL is up. */
    attach(store: ActionActivationStore): void {
        this.store = store;
    }

    /** Is a durable ledger attached — i.e. can a flip be made to persist? */
    get durable(): boolean {
        return this.store !== null;
    }

    /**
     * Load the ledger into the projection. Returns the names it switched off so
     * the host can say so in its boot audit.
     *
     * An empty ledger — the stock-boot case — disables nothing, which is
     * ADR-0126 §4's "an empty ledger changes nothing anywhere".
     */
    async hydrate(): Promise<string[]> {
        if (!this.store) return [];
        const rows = await this.store.list();
        const off: string[] = [];
        for (const row of rows) {
            if (row.active) {
                this.disabled.delete(row.name);
                continue;
            }
            this.disabled.add(row.name);
            off.push(row.name);
        }
        return off;
    }

    /**
     * Is this action armed for this installation? Absence of a row means the
     * packaged default — ACTIVE (§4).
     */
    isEnabled(name: string): boolean {
        return !this.disabled.has(name);
    }

    /** Every action name the ledger currently switches off (operability reads). */
    disabledNames(): string[] {
        return [...this.disabled];
    }

    /**
     * Flip one packaged action's activation — THE sanctioned off-switch.
     *
     * The durable row is written FIRST; a store that throws aborts the flip
     * with nothing changed in process, so the engine never reports an
     * activation state the ledger does not carry.
     *
     * ⛔ No in-process fallback. The flow twin degrades to a process-local flip
     * with a warning because `toggleFlow` is a service-contract method a host
     * with no ObjectQL still has to answer; this projection lives INSIDE
     * ObjectQL, so "there is no durable plane" is not a legitimate mode here —
     * it is a deployment whose ledger table was never registered or synced.
     * Reporting a durable install-wide switch that did not persist is the exact
     * failure ADR-0126 §6 wall 3 exists to close, so this throws instead.
     */
    async setActive(row: ActionActivationRow): Promise<void> {
        if (!this.store) {
            throw Object.assign(
                new Error(
                    `Cannot ${row.active ? 'enable' : 'disable'} packaged action '${row.name}' — no activation ledger is ` +
                    `attached to this engine (sys_metadata_activation, ADR-0126 §4), so the flip could not be made durable ` +
                    `and would silently revert on the next restart. Check that the ledger object is registered for this ` +
                    `deployment and that schema sync ran for its datasource.`,
                ),
                // ADR-0112 envelope: code AND status. The capability is absent
                // on this deployment, which is 503's meaning — not the caller's
                // fault, and retryable once the table exists.
                { code: 'SERVICE_UNAVAILABLE', status: 503 },
            );
        }
        await this.store.setActive(row);
        if (row.active) this.disabled.delete(row.name);
        else this.disabled.add(row.name);
    }

    /**
     * The refusal SENTENCE a disabled action is answered with, produced once
     * here so both dispatch doors state it identically (the flow twin's
     * `describeDisabledFlow` shape).
     *
     * It names the ledger, the ADR and the remedies — and ⛔ never a clone:
     * action-clone is not chartered (ADR-0126 §8 item 2), so recommending one
     * would advertise machinery that does not exist. Authoring an ordinary
     * sibling action is open exactly as it is today, and that is what it says.
     */
    describeDisabled(name: string): string {
        return (
            `Action '${name}' is disabled — it is switched off for this installation in the packaged-metadata ` +
            `activation ledger (sys_metadata_activation, ADR-0126 §8). Re-enable the packaged action to arm it again, ` +
            `or author your own action instead.`
        );
    }
}
