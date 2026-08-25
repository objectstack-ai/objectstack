// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FlowActivationStore, FlowActivationRow } from './engine.js';

/**
 * [ADR-0126 §4/§7.2] Durable activation ledger for PACKAGED flows —
 * `sys_metadata_activation`, install-level rows.
 *
 * ## What this replaces, and why the replacement is durable
 *
 * The engine used to carry its off-switch in a process-local
 * `flowEnabled` map. #10243 measured what that costs: the bit was NOT a row,
 * so no organization wall scoped it — `toggleFlow` wrote an in-process map
 * keyed by flow NAME only, and the automation service is ONE instance per
 * environment. On a real `isolated` posture a tenant org owner switched a
 * shipped flow off and an unrelated tenant in a DIFFERENT organization read it
 * off. ADR-0126 §7.2 retires that mechanism rather than refining it: the
 * durable ledger row IS the sanctioned off-switch, and this module is how the
 * engine reaches it.
 *
 * ## Row shape (ADR-0126 §4 — ⛔ this module writes columns, never schema)
 *
 * `metadata_type: 'flow'` · `name` · `package_id` · `organization_id` ·
 * `active`. Two properties of that shape are load-bearing here:
 *
 *   - **`organization_id` is never written.** It is declared nullable and
 *     RESERVED (§5): every row this line writes is install-level, so the
 *     column stays NULL. The object's `unique: 'organization'` index collapses
 *     NULL through the driver's `COALESCE(organization_id, '__global__')`, so
 *     NULL rows are still unique per `(metadata_type, name)` — which is why
 *     {@link ObjectStoreFlowActivationStore.setActive} can treat "the row for
 *     this flow" as at most one row.
 *   - **Absence of a row means ACTIVE.** Nothing here ever writes a row to say
 *     "active by default", and {@link FlowActivationStore.list} returning
 *     nothing is the normal stock-boot state, not an error. Re-enabling a flow
 *     updates its row to `active: true` rather than deleting it, so the ledger
 *     records the administrator's choice instead of erasing it (§6 wall 3:
 *     the ledger records CHOICES).
 *
 * Two implementations, mirroring the `sys_flow_dispatch` pair next door:
 *   - {@link InMemoryFlowActivationStore} — tests and hosts with no ObjectQL.
 *   - {@link ObjectStoreFlowActivationStore} — the real `sys_metadata_activation`.
 */

const TABLE = 'sys_metadata_activation';

/**
 * The ledger's `metadata_type` for this consumer. Flows are the first consumer
 * (ADR-0126 §7); the ledger is generic, so every read and write here is scoped
 * by this discriminator and never assumes it owns the table.
 */
const METADATA_TYPE = 'flow';

/** Infrastructure rows, not tenant data — the `sys_flow_dispatch` posture. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The exact ObjectQL slice this store needs: a keyed read, an insert, and an
 * update. Narrower than `SuspendedRunStoreEngine` on purpose, and deliberately
 * WITHOUT `delete`: re-enabling updates the `active` bit, it never removes the
 * row (see the module header), and demanding only what is used keeps every
 * test double honest about that.
 */
export interface FlowActivationStoreEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
}

/**
 * In-memory {@link FlowActivationStore} — process-lifetime only.
 *
 * ⚠️ This is NOT the retired `flowEnabled` map wearing a new name. The
 * difference is the one #10243 turned on: this store is only ever reached
 * through {@link AutomationEngine.toggleFlow}, which is reached from the wire
 * only through a door that refuses a tenant admin in a walled posture
 * (ADR-0126 §5). What it lacks versus the ObjectStore implementation is
 * DURABILITY, not scoping — and a host running without ObjectQL has no
 * durable plane to write to in the first place.
 */
export class InMemoryFlowActivationStore implements FlowActivationStore {
  private readonly rows = new Map<string, FlowActivationRow>();

  async list(): Promise<FlowActivationRow[]> {
    return [...this.rows.values()];
  }

  async setActive(row: FlowActivationRow): Promise<void> {
    this.rows.set(row.name, { ...row });
  }
}

/**
 * Durable {@link FlowActivationStore} backed by the `sys_metadata_activation`
 * object (ADR-0126 §4).
 *
 * All access uses a system context: the object is `managedBy:
 * 'engine-owned'` and declares `apiMethods: ['get', 'list']`, i.e. the generic
 * data API cannot write it at all — these rows are written by the ADR-0126
 * enable/disable action and by nothing else.
 */
export class ObjectStoreFlowActivationStore implements FlowActivationStore {
  constructor(private readonly engine: FlowActivationStoreEngine) {}

  /**
   * Every install-level flow row. Read once at boot to hydrate the engine's
   * projection — see {@link AutomationEngine.hydrateFlowActivations} for why
   * the engine holds a projection at all rather than reading this per
   * `execute()`.
   *
   * Rows carrying an `organization_id` are SKIPPED, not merged: the per-org
   * dimension is reserved and unwritten on this line (§5), so a row with one
   * set was not written by this code. Reading it as install-level would apply
   * one organization's choice to the whole installation — the #10243
   * direction, arrived at from the read side. A future per-org consumer adds
   * its own scoped read; it does not widen this one.
   */
  async list(): Promise<FlowActivationRow[]> {
    const rows = await this.engine.find(TABLE, {
      where: { metadata_type: METADATA_TYPE },
      context: SYSTEM_CTX,
    });
    if (!Array.isArray(rows)) return [];
    const out: FlowActivationRow[] = [];
    for (const row of rows) {
      const r = row as { name?: unknown; package_id?: unknown; active?: unknown; organization_id?: unknown };
      if (r.organization_id != null) continue;
      if (typeof r.name !== 'string' || !r.name) continue;
      out.push({
        name: r.name,
        packageId: typeof r.package_id === 'string' ? r.package_id : '',
        // The column defaults to `true`; only an explicit `false` disarms.
        // A driver that round-trips booleans as 0/1 (SQLite/libsql) is read
        // through the same `!== false`-style test the engine uses, so a `0`
        // is not mistaken for `true` — see the falsy-explicit test below.
        active: !(r.active === false || r.active === 0),
      });
    }
    return out;
  }

  /**
   * Insert or update the install-level row for one packaged flow.
   *
   * Read-then-write rather than a blind upsert because the object's uniqueness
   * is a DECLARED index (`unique: 'organization'`), not a primary key this
   * store controls: there is no id to collide on, so an insert-and-catch would
   * not reliably distinguish "already there" from a real store failure the way
   * `sys_flow_dispatch`'s id-keyed claim can.
   *
   * ⛔ `organization_id` is not in either payload. Omitting it is what leaves
   * it NULL, which is the whole of §5's install-level scope on this line.
   */
  async setActive(row: FlowActivationRow): Promise<void> {
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
   * than as a failed toggle later. Throws the driver error verbatim — `no such
   * table: sys_metadata_activation` means the object was never registered (or
   * its schema never synced).
   */
  async probe(): Promise<void> {
    await this.engine.find(TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
  }
}
