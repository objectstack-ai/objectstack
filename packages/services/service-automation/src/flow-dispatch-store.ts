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
 * deletion via the object's declared retention), and `update` only ever writes
 * `outcome`/`settled_at`, never a claim column. Two of the three transitions
 * those columns admit reach it — `null → succeeded` and `null → failed` from an
 * ordinary run, and `failed → succeeded` when a replay repairs a window. The
 * third, `succeeded → failed`, is REFUSED by {@link ObjectStoreFlowDispatchStore.settle}
 * and never reaches the engine at all. A test double that implements only what
 * is used stays honest about that.
 */
export interface FlowDispatchStoreEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, data: any, options?: any): Promise<any>;
}

/**
 * The ledger's write rule for `outcome`, in one predicate — **`succeeded` is
 * absorbing** (#14501, seat ruling in the contract review of this change).
 *
 * Three transitions are allowed and one is refused:
 *
 * | from | to | |
 * |:---|:---|:---|
 * | `null` | `succeeded` / `failed` | an ordinary run settling its own claim |
 * | `failed` | `succeeded` | REQUIRED — a replay repaired the window, and the next unforced replay must now be refused |
 * | `succeeded` | `failed` | **refused** |
 *
 * The refusal is not fussiness about monotonicity. The ruling guarantees that
 * a window whose claim succeeded is refused, and "latest attempt wins" erodes
 * exactly that: a FORCED replay that throws would rewrite a delivered window
 * to `failed` and silently reopen the *unforced* re-delivery door — the
 * duplicate-delivery harm this whole card exists to close. An operator whose
 * forced replay failed has to force again, which is louder and safer than a
 * door that reopens itself.
 *
 * `succeeded → succeeded` and `failed → failed` are allowed and simply refresh
 * `settled_at`.
 */
export function isSettleAllowed(
  current: FlowDispatchOutcome | null,
  next: FlowDispatchOutcome,
): boolean {
  return !(current === 'succeeded' && next === 'failed');
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
    if (!isSettleAllowed(existing.outcome, outcome)) return;
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
   *
   * Reads the row first because {@link isSettleAllowed} needs the current
   * outcome: `succeeded` is absorbing, and a downgrade is a silent no-op here
   * rather than a throw — refusing to write is the invariant working, not an
   * error, and reporting it as one would turn the trigger's honest "could not
   * record the outcome" warning into a lie.
   *
   * ⚠️ **The absorbing rule is enforced read-then-write here, so it is not
   * atomic.** Between the read above and the `update` below a concurrent
   * settle on the same key can land: a `succeeded` and a `failed` for one
   * window finishing at the same instant — a replay and a tick, or two
   * replicas — can interleave and leave the row `failed`, which is exactly
   * the reopened unforced-replay door the rule exists to close. The reach is
   * narrow and the engine's by-id `update` shape cannot express a conditional
   * write, so this is named rather than closed. ⛔ Do not read the persisted
   * store as giving the guarantee {@link InMemoryFlowDispatchStore} does,
   * whose check and write share a turn; closing it needs a conditional update
   * the engine does not have yet.
   */
  async settle(key: string, outcome: FlowDispatchOutcome): Promise<void> {
    const current = await this.read(key);
    if (!current) return; // never claimed — settling does not create rows
    if (!isSettleAllowed(current.outcome, outcome)) return;
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
