// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ── The `authz.invalidated` cluster channel (#11968, #11633 §3) ─────────────
 *
 * The cross-node half of the authorization invalidation substrate: one channel
 * name, one payload shape, and the contract statement that governs how both may
 * be read. It carries no cache and no consumer — leg B (#11967) is the first.
 *
 * ## ⭐ THE TTL IS THE CORRECTNESS CONTRACT. THIS CHANNEL IS NOT.
 *
 * A message on this channel is a **hint**, and **a missed message is EXPECTED**.
 * That is not a caveat about an unreliable network; it is the shipped
 * guarantee, measured rather than assumed:
 *
 *   - `content/docs/kernel/cluster.mdx` §4.2, on `at-least-once`:
 *     *"**No shipped driver provides this yet.** The `redis` driver publishes
 *     over plain Redis pub/sub, which is *at-most-once* — fire-and-forget, no
 *     persistence, no replay for a node that was down at publish time."*
 *   - `@objectstack/service-cluster-redis`'s own `publish` docblock:
 *     *"there is no delivery guarantee to subscribers and no replay for a node
 *     that was down or slow at publish time. This is acceptable **only** for
 *     events that are pure cache-invalidation hints, never the source of
 *     truth."*
 *   - The `memory` driver does not cross a process boundary at all
 *     (`service-cluster/src/memory/pubsub.ts`, and the split-brain guard's
 *     `IN_PROCESS_DRIVERS`).
 *
 * So a dropped message on an at-most-once transport is a staleness window with
 * **no upper bound**, and no amount of care at the publish site changes that.
 * What bounds it is the **TTL** every cached authorization answer must carry:
 * a peer that never hears the message still converges when its entry expires.
 *
 * ⇒ **A consumer that would be incorrect if a message were lost is misusing
 * this channel.** The channel exists for one thing: moving the *typical*
 * convergence from "one TTL" down to "one network hop". It never moves the
 * worst case, and it is never the mechanism that makes a cached authorization
 * answer safe.
 *
 * ⚠️ For the same reason this channel is **best-effort at the publish site
 * too**: a publish failure is logged and swallowed, never propagated into the
 * write that triggered it. A grant revocation must not fail because a cache
 * hint could not be delivered — the TTL already covers exactly that case.
 *
 * ⚠️ Known contradiction in the surrounding docs, recorded so nobody resolves it
 * the wrong way: `IPubSub`'s own interface docblock
 * (`@objectstack/spec/contracts`) still says *"At-least-once delivery"*, which
 * no shipped driver provides. `cluster.mdx` §4.2 and the redis driver are the
 * measured statements and are the ones this module follows. Repairing that
 * docblock is a `packages/spec` change and is filed separately, deliberately
 * not made here.
 *
 * ## Why a new channel on the existing bus, and not a new transport
 *
 * `MetadataClusterBridgePlugin` already shows the whole shape — a channel on
 * `IPubSub`, bridged by a plugin that late-binds at `kernel:ready` and does
 * nothing when the services it needs are absent. Reusing it adds no dependency
 * and no new failure mode. The one thing metadata's channel does NOT have to
 * carry is what makes this one different: a missed `metadata.changed` costs a
 * stale schema until reload and loses no data, while a missed
 * `authz.invalidated` would cost a permission honoured past its revocation —
 * which is why the bound lives in the TTL and why the absence of this bridge is
 * stated out loud at boot ({@link ../security/authz-cache-posture.js}).
 */

/**
 * The cluster channel authorization-cache invalidation hints travel on.
 *
 * Named as a fact about authorization, not about any one cache, because a
 * second consumer must reuse this channel rather than mint a parallel one —
 * two channels would be two chances to miss a bridge.
 */
export const AUTHZ_INVALIDATED_CHANNEL = 'authz.invalidated';

/**
 * Why an authorization epoch advanced. Coarse on purpose (#11633 §2.2, Fork 1 →
 * A): the engine seam sees `update`/`delete` expressed as a `where`, from which
 * the affected user or organization is frequently **not derivable without
 * reading the row back**. So the substrate carries "something authorization-
 * relevant changed", never "whose entry to drop", and a consumer retires its
 * whole bucket. Keyed invalidation is gated behind a measurement of a
 * write-heavy tenant and is explicitly not the starting point.
 */
export type AuthzInvalidationReason =
  /** A write (`insert` / `update` / `delete`) passed the engine middleware seam. */
  | 'write'
  /** A metadata change — a permission set can be DECLARED, so no row is written. */
  | 'metadata'
  /** A hint received from a peer node on this channel. */
  | 'remote'
  /** An explicit bump by a host that knows something the seam cannot see. */
  | 'manual';

/**
 * The payload on {@link AUTHZ_INVALIDATED_CHANNEL}.
 *
 * Deliberately tiny and deliberately NOT a description of what to invalidate:
 * see {@link AuthzInvalidationReason} for why the seam cannot supply that. A
 * receiver's only correct response is to retire its authorization cache
 * wholesale — and to remain correct if this message never arrives.
 *
 * ⛔ Not a `packages/spec` contract type. #11633 §5 reserves a declared shape
 * for the invalidation event to the spec seat and does not pre-commit it; this
 * is the runtime shape the substrate publishes today.
 */
export interface AuthzInvalidatedPayload {
  /**
   * Publishing node, for loopback suppression — a node must not act on its own
   * hint. Mirrors `ClusterMetadataChangedPayload.originNode`.
   */
  originNode?: string;
  /** The publisher's local epoch after the bump. Diagnostic only. */
  epoch: number;
  /** What advanced the epoch. Diagnostic only — see the type's doc. */
  reason: AuthzInvalidationReason;
  /** Wall-clock publish time, ms since epoch. Best-effort. */
  at: number;
}
