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
 * ## Relationship to the flow twin — ONE implementation now (#12350)
 *
 * `packages/services/service-automation/src/flow-activation-store.ts` is the
 * same ledger one tier up, landed first (#12296). The two briefly carried
 * independent copies of the §4 row contract, because neither direction of
 * import exists: `service-automation` does not depend on
 * `@objectstack/objectql`, and the engine must not depend on a service. #12350
 * closed that by moving the contract into `@objectstack/core` — the package
 * BOTH already depend on — as
 * {@link ObjectStoreMetadataActivationStore}.
 *
 * ⚠️ So the row semantics are NOT written in this file any more. Read them in
 * `@objectstack/core`'s `utils/metadata-activation-store.ts`; what stays here
 * is exactly what is ACTION-specific — the discriminator, the engine's
 * projection, and the refusal sentences below. The section headings above that
 * describe the row shape are kept because they are what an action author needs
 * in the file they open, but the code they describe has one home.
 *
 * ⛔ The code home is not the package that declares the OBJECT: `objectql`
 * does not depend on `@objectstack/platform-objects` and adding that edge
 * would invert the tiering. Where the object's REGISTRATION lives is a
 * different question with a different answer (`PlatformObjectsPlugin`, ruled
 * on #12359) — a composition decision, not a module-import one.
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

import {
    InMemoryMetadataActivationStore,
    METADATA_ACTIVATION_TABLE,
    ObjectStoreMetadataActivationStore,
    type MetadataActivationRow,
    type MetadataActivationStore,
    type MetadataActivationStoreEngine,
} from '@objectstack/core';

/**
 * The ledger table. A NAME, not an import: this package does not depend on
 * `@objectstack/platform-objects` (which declares the object) and must not —
 * the same posture the flow twin takes, and the same one this engine already
 * takes for `sys_metadata` / `sys_secret`. Re-exported from `@objectstack/core`
 * so the two consumers cannot spell it differently (#12350).
 */
export const ACTION_ACTIVATION_TABLE = METADATA_ACTIVATION_TABLE;

/**
 * The ledger's `metadata_type` discriminator for this consumer. Every read and
 * write is scoped by it: the ledger is generic (ADR-0126 §4) and this module
 * never assumes it owns the table — flow rows share it today, permission rows
 * may later.
 */
const METADATA_TYPE = 'action';

/**
 * [ADR-0126 §4] One packaged action's install-level activation row, as the
 * engine sees it. The ledger's own columns are `metadata_type` / `name` /
 * `package_id` / `organization_id` / `active`; `metadata_type` is fixed to
 * `'action'` by the store and `organization_id` is never written on this line
 * (§5), so those two never reach the projection.
 *
 * An alias of the shared row (#12350): the ADR declares ONE row shape, so a
 * separate declaration here could only ever drift from it. `name` here is the
 * action's declarative machine name (ADR-0110 D1).
 */
export type ActionActivationRow = MetadataActivationRow;

/**
 * [ADR-0126 §8] The durable off-switch for packaged actions.
 *
 * Absence of a row means the packaged default — ACTIVE — so an engine with no
 * store attached, or a store with no rows, dispatches exactly as a stock boot
 * always has.
 */
export type ActionActivationStore = MetadataActivationStore;

/**
 * The exact slice of the engine this store needs: a keyed read, an insert and
 * an update. Deliberately WITHOUT `delete` — re-enabling updates the `active`
 * bit, it never removes the row (see the module header), and demanding only
 * what is used keeps every test double honest about that.
 */
export type ActionActivationStoreEngine = MetadataActivationStoreEngine;

/**
 * In-memory {@link ActionActivationStore} — process-lifetime only, for tests
 * and for hosts with no durable plane. It is NOT a sanctioned production
 * off-switch: what it lacks versus the ObjectStore implementation is
 * DURABILITY, which is exactly the property ADR-0126 §6 wall 3 asks for.
 */
export class InMemoryActionActivationStore extends InMemoryMetadataActivationStore {}

/**
 * Durable {@link ActionActivationStore} backed by the `sys_metadata_activation`
 * object (ADR-0126 §4).
 *
 * A binding, not an implementation (#12350): it fixes the `metadata_type` and
 * nothing else — the §4 row semantics live once, in `@objectstack/core`. The
 * one-argument constructor is deliberate: a caller that had to pass the
 * discriminator could pass the wrong one, and the action leg has exactly one
 * correct value.
 *
 * All access uses a system context: the object is `managedBy: 'engine-owned'`
 * and declares `apiMethods: ['get', 'list']`, i.e. the generic data API cannot
 * write it at all — these rows are written by the ADR-0126 enable/disable door
 * and by nothing else.
 */
export class ObjectStoreActionActivationStore extends ObjectStoreMetadataActivationStore {
    constructor(engine: ActionActivationStoreEngine) {
        super(engine, METADATA_TYPE);
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
