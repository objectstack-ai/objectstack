// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AuthzInvalidationReason } from '@objectstack/core';

/**
 * ── The engine-seam write epoch (#11968, #11633 §2.1) ───────────────────────
 *
 * A monotonic counter that advances whenever something happens that could
 * change the answer to an authorization question. Cache-shaped consumers read
 * it, remember the value they resolved at, and treat an entry as retired the
 * moment the counter has moved.
 *
 * This is a generalisation of the private `writeEpoch` field
 * `@objectstack/plugin-security` has carried since #10757. The mechanism was
 * always the engine's; only the counter lived in one plugin. Moving it here is
 * what lets a second consumer share ONE invalidation signal instead of minting
 * a parallel one that observes a different set of writes.
 *
 * ## ⭐ Why a SEAM, and never a list of call sites
 *
 * The alternative shape — "the places that must remember to invalidate" — is a
 * permanent maintenance obligation whose failure mode is **silent
 * over-permission**: a new grant-granting path forgets to invalidate, and the
 * only symptom is a permission served after it was revoked. The engine seam
 * cannot be forgotten, because writing through the engine is the only way to
 * write at all — including better-auth's own adapter, which routes membership
 * changes, bans and session revocation straight through
 * `insert`/`update`/`delete` (`plugin-auth/src/objectql-adapter.ts`).
 *
 * That is the "declared = enforced" shape, and it is the property to protect
 * when changing this file: any edit that turns the seam back into an opt-in
 * call is a regression even if every existing test stays green.
 *
 * ## What it deliberately does NOT carry
 *
 * Nothing about *which* entry to drop. For an `update`/`delete` expressed as a
 * `where`, the affected `user_id` / `organization_id` is frequently not
 * derivable without reading the row back, so a consumer that tried to key on it
 * would be guessing (#11633 §2.2). Coarse is the ruled baseline (Fork 1 → A):
 * any write retires everything, and keyed invalidation must first be justified
 * by a measurement of a write-heavy tenant.
 *
 * ## Not, by itself, a licence to cache
 *
 * The epoch bounds nothing on its own. It observes writes **this process**
 * sees; another node's grant revocation is invisible to it. A cached
 * authorization answer needs the TTL as well — see
 * `authz-invalidation-channel.ts` in `@objectstack/core` for why the bus is a
 * narrowing and never the bound.
 */

/** A listener called after each bump. Never called with the pre-bump value. */
export type WriteEpochListener = (
  epoch: number,
  reason: AuthzInvalidationReason,
) => void;

/** Disposer returned by {@link WriteEpoch.subscribe}. Idempotent. */
export type WriteEpochUnsubscribe = () => void;

/**
 * The structural shape a consumer needs. Declared separately so packages that
 * do NOT depend on `@objectstack/objectql` — `@objectstack/plugin-security`
 * among them — can feature-detect the engine's epoch without an import, the
 * same way the metadata cluster bridge feature-detects `attachClusterPubSub()`.
 */
export interface WriteEpochLike {
  readonly current: number;
  bump(reason: AuthzInvalidationReason): number;
  subscribe(listener: WriteEpochListener): WriteEpochUnsubscribe;
}

/** True when `value` carries the {@link WriteEpochLike} surface. */
export function isWriteEpochLike(value: unknown): value is WriteEpochLike {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<WriteEpochLike>;
  return (
    typeof v.current === 'number' &&
    typeof v.bump === 'function' &&
    typeof v.subscribe === 'function'
  );
}

export class WriteEpoch implements WriteEpochLike {
  private epoch = 0;
  private readonly listeners = new Set<WriteEpochListener>();

  /** The current epoch. Starts at `0` and only ever increases. */
  get current(): number {
    return this.epoch;
  }

  /**
   * Advance the epoch and notify subscribers. Returns the new value.
   *
   * ⚠️ Listener errors are swallowed on purpose. A subscriber is a cache or a
   * bus bridge; neither may fail the write that triggered the bump. The counter
   * has already advanced by the time any listener runs, so an exploding
   * listener leaves the invalidation itself intact — over-invalidating in the
   * worst case, which is the safe direction.
   */
  bump(reason: AuthzInvalidationReason): number {
    this.epoch += 1;
    if (this.listeners.size > 0) {
      const at = this.epoch;
      for (const listener of [...this.listeners]) {
        try {
          listener(at, reason);
        } catch {
          // Deliberately ignored — see the docblock above.
        }
      }
    }
    return this.epoch;
  }

  /** Observe every subsequent bump. Call the returned disposer to stop. */
  subscribe(listener: WriteEpochListener): WriteEpochUnsubscribe {
    this.listeners.add(listener);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.listeners.delete(listener);
    };
  }

  /** How many listeners are attached. Diagnostics and tests. */
  get listenerCount(): number {
    return this.listeners.size;
  }
}

/**
 * The engine operations that advance the epoch.
 *
 * ⚠️ Read operations are deliberately absent, and adding one would not be a
 * tightening: an epoch that moved on reads would retire every entry on every
 * request, which reads as "the cache never hits" rather than as a failure.
 */
export const WRITE_EPOCH_OPERATIONS = new Set(['insert', 'update', 'delete']);

/** True when `operation` is a write the seam counts. */
export function isWriteEpochOperation(operation: unknown): boolean {
  return typeof operation === 'string' && WRITE_EPOCH_OPERATIONS.has(operation);
}
