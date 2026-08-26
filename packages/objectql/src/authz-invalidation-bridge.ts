// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  AUTHZ_INVALIDATED_CHANNEL,
  type AuthzInvalidatedPayload,
} from '@objectstack/core';
import type { IPubSub } from '@objectstack/spec/contracts';
import type { WriteEpochLike } from './write-epoch.js';

/**
 * ── Bridging the engine-seam write epoch onto `authz.invalidated` ───────────
 *
 * The wiring half of the substrate: local epoch bumps go out on the channel,
 * peers' hints come back in and advance the local epoch. Shaped after
 * `MetadataClusterBridgePlugin` deliberately — a channel on the existing
 * `IPubSub`, a loopback guard on `originNode`, and no new transport.
 *
 * ⭐ **A missed message is EXPECTED, and this bridge is written to survive it.**
 * Read `authz-invalidation-channel.ts` in `@objectstack/core` before changing
 * anything here: no shipped driver delivers better than at-most-once
 * (`cluster.mdx` §4.2), so the TTL on the consuming cache — never this bridge —
 * is what bounds staleness. Two consequences are load-bearing in the code
 * below and are not incidental defensiveness:
 *
 *   1. **A publish failure is logged and swallowed.** It must never propagate
 *      into the write that triggered it: failing a grant revocation because a
 *      cache *hint* could not be delivered would trade a bounded staleness
 *      window for an unbounded outage. The TTL already covers the miss.
 *   2. **The publish is not awaited by the writer.** The epoch has already
 *      advanced locally by the time this runs, so the local node is correct
 *      regardless of what the network does next.
 *
 * ⚠️ Attach this only when a cache is actually enabled. It publishes one small
 * message per write, which buys nothing if nothing is caching — and the
 * substrate's own acceptance criterion is that runtime behaviour is unchanged
 * while there are no consumers.
 */
export interface AuthzInvalidationBridgeOptions {
  /** The engine's epoch — the local source of truth for "something changed". */
  epoch: WriteEpochLike;
  /** The cluster bus. Its delivery guarantee is at-most-once; see above. */
  pubsub: IPubSub;
  /** This node's cluster id, used for loopback suppression. */
  nodeId: string;
  /** Optional sink for publish failures and attach/detach notes. */
  logger?: {
    debug?(message: string, meta?: Record<string, unknown>): void;
    warn?(message: string, meta?: Record<string, unknown>): void;
  };
}

/**
 * Wire `epoch` to `pubsub` in both directions.
 *
 * @returns a disposer that unsubscribes both directions. Idempotent.
 */
export function bridgeAuthzInvalidation(
  options: AuthzInvalidationBridgeOptions,
): () => void {
  const { epoch, pubsub, nodeId, logger } = options;

  const unsubscribeRemote = pubsub.subscribe<AuthzInvalidatedPayload>(
    AUTHZ_INVALIDATED_CHANNEL,
    (msg) => {
      const payload = msg?.payload;
      // Loopback guard — never act on a hint this node published.
      if (payload?.originNode && payload.originNode === nodeId) return;
      // Coarse by construction: the payload says something changed, never what
      // to drop, so the only correct response is to advance the local epoch and
      // let consumers retire everything they hold.
      epoch.bump('remote');
    },
  );

  const unsubscribeLocal = epoch.subscribe((current, reason) => {
    // A bump caused by a peer's hint must not be echoed back onto the bus —
    // two bridged nodes would otherwise trade one write forever.
    if (reason === 'remote') return;

    const payload: AuthzInvalidatedPayload = {
      originNode: nodeId,
      epoch: current,
      reason,
      at: Date.now(),
    };

    // Fire-and-forget, both branches on purpose — see the module doc.
    try {
      void Promise.resolve(
        pubsub.publish<AuthzInvalidatedPayload>(
          AUTHZ_INVALIDATED_CHANNEL,
          payload,
        ),
      ).catch((err: unknown) => {
        logger?.debug?.('authz.invalidated publish failed (hint lost; TTL bounds it)', {
          channel: AUTHZ_INVALIDATED_CHANNEL,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    } catch (err) {
      logger?.debug?.('authz.invalidated publish threw (hint lost; TTL bounds it)', {
        channel: AUTHZ_INVALIDATED_CHANNEL,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    try {
      unsubscribeRemote();
    } catch {
      // A driver whose disposer throws must not strand the other direction.
    }
    unsubscribeLocal();
  };
}
