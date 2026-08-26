// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AuthzInvalidationReason } from '@objectstack/core';

/**
 * ── Where this plugin's invalidation epoch comes from (#11968) ──────────────
 *
 * The counter behind {@link SecurityPlugin.permissionSetMemo} used to be a
 * private field on the plugin (#10757). #11633 §10.3 hoists that mechanism into
 * the engine — `ObjectQL.writeEpoch` — so a second consumer shares ONE signal
 * instead of minting a parallel one that observes a different set of writes.
 * This module is the plugin's side of that extraction.
 *
 * ⚠️ Duck-typed on purpose. `@objectstack/plugin-security` does not depend on
 * `@objectstack/objectql` (it reaches the engine through the `objectql`
 * SERVICE), so the seam is feature-detected exactly the way
 * `MetadataClusterBridgePlugin` feature-detects `attachClusterPubSub()`.
 *
 * The fallback is not decoration: the plugin is routinely started against test
 * doubles and embeddings whose engine is not `ObjectQL`. Those keep the old
 * behaviour — a local counter advanced by this plugin's own middleware —
 * because the memo's correctness must not depend on which engine is wired.
 */

/** The epoch surface this plugin consumes, whichever side supplies it. */
export interface WriteEpochSource {
  /** Monotonic counter; a memo entry is live only while this has not moved. */
  readonly current: number;
  /** Advance it. A no-op is never acceptable here — see the fallback below. */
  bump(reason: AuthzInvalidationReason): void;
  /**
   * True when the **engine** advances this on every write passing its
   * middleware seam. When true this plugin must NOT bump on writes itself: the
   * engine already did, earlier in the same operation. When false the plugin's
   * middleware is the only thing that will, so it must.
   */
  readonly seamOwnedByEngine: boolean;
}

/** A private counter, for an engine that does not expose the seam. */
export function localWriteEpochSource(): WriteEpochSource {
  let epoch = 0;
  return {
    get current() {
      return epoch;
    },
    bump() {
      epoch += 1;
    },
    seamOwnedByEngine: false,
  };
}

/**
 * Prefer the engine's seam epoch; fall back to a local counter.
 *
 * The engine's is preferred because its bump is strictly EARLIER and strictly
 * WIDER-by-construction: it runs ahead of the whole middleware chain rather
 * than at the head of this one plugin's middleware, and it covers exactly the
 * operations the chain sees, with no second author to keep in step.
 */
export function resolveWriteEpochSource(engine: unknown): WriteEpochSource {
  const candidate = (engine as { writeEpoch?: unknown } | null | undefined)
    ?.writeEpoch as
    | { current?: unknown; bump?: unknown; subscribe?: unknown }
    | undefined;

  if (
    candidate &&
    typeof candidate === 'object' &&
    typeof candidate.current === 'number' &&
    typeof candidate.bump === 'function' &&
    typeof candidate.subscribe === 'function'
  ) {
    const seam = candidate as unknown as {
      readonly current: number;
      bump(reason: AuthzInvalidationReason): number;
    };
    return {
      get current() {
        return seam.current;
      },
      bump(reason) {
        seam.bump(reason);
      },
      seamOwnedByEngine: true,
    };
  }

  return localWriteEpochSource();
}
