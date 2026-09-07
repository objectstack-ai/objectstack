// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FlowDispatchStore, FlowDispatchOutcome, FlowDispatchClaim } from './engine.js';

/**
 * Durable claim ledger for trigger dispatch idempotency (#10220), and the
 * record of what each claim turned into (#14501).
 *
 * A {@link FlowDispatchStore} answers one question atomically enough for a
 * sweep — "has this dispatch key been claimed before?" — recording the claim in
 * the same call. The time-relative trigger computes a key from the matched
 * window's identity and calls `claim()` before launching; a `false` means some
 * earlier sweep (possibly in a previous process lifetime) already dispatched
 * this exact (flow, record, window). The schedule trigger does the same with a
 * `(flow, tick-window)` key.
 *
 * `claim()` alone cannot answer the second question the #14501 ruling asks —
 * *did that dispatch land?* — because a row's mere existence says only that
 * someone took the key. So a claim is settled after the launch returns
 * ({@link FlowDispatchStore.settle}) and read back before an operator replay
 * ({@link FlowDispatchStore.read}).
 *
 * Two implementations:
 *   - {@link InMemoryFlowDispatchStore} — a Map (tests / explicit
 *     `suspendedRunStore: 'memory'` hosts). Sharable across two engine
 *     instances to simulate a kernel rebuild against one surviving ledger.
 *   - {@link ObjectStoreFlowDispatchStore} — persists to `sys_flow_dispatch`
 *     via the ObjectQL engine, so dedup survives kernel rebuild (the #10220
 *     fix requirement the in-process Map cannot meet).
 */

const TABLE = 'sys_flow_dispatch';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The exact ObjectQL slice this store needs: a keyed read, an insert, and —
 * since #14501 — a keyed update.
 *
 * Narrower than `SuspendedRunStoreEngine` on purpose, and the narrowness is
 * load-bearing: the ledger still never DELETES (the platform Reaper owns
 * deletion via the object's declared retention), and `update` exists for
 * exactly one transition, `outcome`/`settled_at` from unset to terminal. A
 * test double that implements only what is used stays honest about that.
 */
export interface FlowDispatchStoreEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
}

/** Shape both stores write and read back — see {@link FlowDispatchClaim}. */
function toClaim(row: Record<string, any>): FlowDispatchClaim {
  const outcome = row.outcome === 'succeeded' || row.outcome === 'failed' ? row.outcome : null;
  return {
    key: String(row.id),
    claimedAt: typeof row.dispatched_at === 'string' ? row.dispatched_at : null,
    outcome,
    settledAt: typeof row.settled_at === 'string' ? row.settled_at : null,
  };
}

/** In-memory {@link FlowDispatchStore} — process-lifetime dedup only. */
export class InMemoryFlowDispatchStore implements FlowDispatchStore {
  private readonly claims = new Map<string, FlowDispatchClaim>();

  async claim(key: string): Promise<boolean> {
    if (this.claims.has(key)) return false;
    this.claims.set(key, {
      key,
      claimedAt: new Date().toISOString(),
      outcome: null,
      settledAt: null,
    });
    return true;
  }

  async settle(key: string, outcome: FlowDispatchOutcome): Promise<void> {
    const existing = this.claims.get(key);
    if (!existing) return;
    this.claims.set(key, { ...existing, outcome, settledAt: new Date().toISOString() });
  }

  async read(key: string): Promise<FlowDispatchClaim | null> {
    return this.claims.get(key) ?? null;
  }
}

/**
 * Durable {@link FlowDispatchStore} backed by the `sys_flow_dispatch` object.
 *
 * `claim()` is check-and-record: read the key's row, insert it when absent.
 * The key is the row's primary `id`, so a concurrent duplicate insert (two
 * sweeps racing the same key) fails on the id — the loser re-reads and reports
 * the key as already claimed instead of surfacing a store error. All access
 * uses a system context: these are infrastructure rows, not tenant data.
 */
export class ObjectStoreFlowDispatchStore implements FlowDispatchStore {
  constructor(private readonly engine: FlowDispatchStoreEngine) {}

  async claim(key: string): Promise<boolean> {
    const existing = await this.engine.find(TABLE, {
      where: { id: key }, limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(existing) && existing[0]) return false;
    const now = new Date().toISOString();
    try {
      await this.engine.insert(
        TABLE,
        { id: key, dispatched_at: now, created_at: now },
        { context: SYSTEM_CTX },
      );
      return true;
    } catch (err) {
      // The insert may have lost a race with a concurrent claimer (duplicate
      // primary key). Re-read before treating this as a store failure: a row
      // present now means the key IS claimed — by someone else — which is a
      // correct `false`, not an error.
      const again = await this.engine.find(TABLE, {
        where: { id: key }, limit: 1, context: SYSTEM_CTX,
      });
      if (Array.isArray(again) && again[0]) return false;
      throw err;
    }
  }

  /**
   * Record what the claimed dispatch turned into (#14501).
   *
   * Called after the launch returns — a settle failure must never turn a
   * delivered dispatch into a thrown one, so callers treat this as
   * best-effort; the cost of losing it is a row stuck at `outcome: null`,
   * which reads as "not delivered" and lets an operator replay through.
   */
  async settle(key: string, outcome: FlowDispatchOutcome): Promise<void> {
    // `update(object, { id, …fields }, options)` — the id rides in the PAYLOAD,
    // which is the by-id dispatch shape the ObjectQL engine actually takes.
    // ⛔ Not a 4-argument `update(object, id, data, options)`: no engine here
    // dispatches on that, and a double loose enough to accept it is exactly
    // what `pnpm check:engine-double-contract` exists to catch.
    await this.engine.update(
      TABLE,
      { id: key, outcome, settled_at: new Date().toISOString() },
      { context: SYSTEM_CTX },
    );
  }

  /** The claim row for `key`, or `null` when the key was never claimed. */
  async read(key: string): Promise<FlowDispatchClaim | null> {
    const rows = await this.engine.find(TABLE, {
      where: { id: key }, limit: 1, context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : undefined;
    return row ? toClaim(row) : null;
  }

  /**
   * Read the backing table once so a misconfiguration surfaces at BOOT rather
   * than as a per-claim failure at sweep time. Throws the driver error
   * verbatim — `no such table: sys_flow_dispatch` means the object was never
   * registered (or its schema never synced).
   */
  async probe(): Promise<void> {
    await this.engine.find(TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
  }
}
