// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FlowDispatchStore } from './engine.js';

/**
 * Durable claim ledger for trigger dispatch idempotency (#10220).
 *
 * A {@link FlowDispatchStore} answers exactly one question, atomically enough
 * for a sweep: "has this dispatch key been claimed before?" — recording the
 * claim in the same call. The time-relative trigger computes a key from the
 * matched window's identity and calls `claim()` before launching the flow; a
 * `false` means some earlier sweep (possibly in a previous process lifetime)
 * already dispatched this exact (flow, record, window).
 *
 * Two implementations:
 *   - {@link InMemoryFlowDispatchStore} — a Set (tests / explicit
 *     `suspendedRunStore: 'memory'` hosts). Sharable across two engine
 *     instances to simulate a kernel rebuild against one surviving ledger.
 *   - {@link ObjectStoreFlowDispatchStore} — persists to `sys_flow_dispatch`
 *     via the ObjectQL engine, so dedup survives kernel rebuild (the #10220
 *     fix requirement the in-process Set cannot meet).
 */

const TABLE = 'sys_flow_dispatch';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The exact ObjectQL slice `claim()` needs: a keyed read and an insert.
 * Narrower than `SuspendedRunStoreEngine` on purpose — the ledger never
 * updates or deletes (rows are immutable claims; the platform Reaper owns
 * deletion via the object's declared retention), and demanding only what is
 * used keeps every test double honest about that.
 */
export interface FlowDispatchStoreEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
}

/** In-memory {@link FlowDispatchStore} — process-lifetime dedup only. */
export class InMemoryFlowDispatchStore implements FlowDispatchStore {
  private readonly keys = new Set<string>();

  async claim(key: string): Promise<boolean> {
    if (this.keys.has(key)) return false;
    this.keys.add(key);
    return true;
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
   * Read the backing table once so a misconfiguration surfaces at BOOT rather
   * than as a per-claim failure at sweep time. Throws the driver error
   * verbatim — `no such table: sys_flow_dispatch` means the object was never
   * registered (or its schema never synced).
   */
  async probe(): Promise<void> {
    await this.engine.find(TABLE, { where: {}, limit: 1, context: SYSTEM_CTX });
  }
}
