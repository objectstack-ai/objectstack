// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11968] The `authz.invalidated` bridge — the cross-node half of the ruled
 * #11633 substrate (§3, Fork 2 → B, accepted 2026-08-25).
 *
 * ⭐ The property under test is NOT "the message arrives". It is that **a lost
 * message costs nothing but latency**: no shipped driver delivers better than
 * at-most-once (`cluster.mdx` §4.2), so the bridge must stay out of the write
 * path entirely — a publish that rejects, throws, or never happens leaves the
 * local epoch already advanced and the write already done. A test suite that
 * only asserted delivery would pass on a bridge that awaited the network inside
 * a grant revocation, which is the failure this file exists to forbid.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IPubSub, PubSubHandler, PubSubMessage } from '@objectstack/spec/contracts';
import { AUTHZ_INVALIDATED_CHANNEL, type AuthzInvalidatedPayload } from '@objectstack/core';
import { WriteEpoch } from './write-epoch.js';
import { bridgeAuthzInvalidation } from './authz-invalidation-bridge.js';

/** An in-memory `IPubSub` double that records what was published. */
function makeBus(publishImpl?: (channel: string, payload: unknown) => Promise<void>) {
  const handlers = new Map<string, Set<PubSubHandler<any>>>();
  const published: Array<{ channel: string; payload: any }> = [];
  let unsubscribeCalls = 0;

  const bus: IPubSub = {
    async publish<T>(channel: string, payload: T): Promise<void> {
      published.push({ channel, payload });
      if (publishImpl) return publishImpl(channel, payload);
    },
    subscribe<T>(channel: string, handler: PubSubHandler<T>) {
      let set = handlers.get(channel);
      if (!set) {
        set = new Set();
        handlers.set(channel, set);
      }
      set.add(handler as PubSubHandler<any>);
      return () => {
        unsubscribeCalls += 1;
        set!.delete(handler as PubSubHandler<any>);
      };
    },
    async close(): Promise<void> {},
  };

  /** Deliver a message as a peer would. */
  const deliver = (payload: AuthzInvalidatedPayload, fromNode?: string) => {
    const msg: PubSubMessage<AuthzInvalidatedPayload> = {
      channel: AUTHZ_INVALIDATED_CHANNEL,
      payload,
      publishedAt: Date.now(),
      ...(fromNode ? { fromNode } : {}),
    };
    for (const h of handlers.get(AUTHZ_INVALIDATED_CHANNEL) ?? []) h(msg);
  };

  return {
    bus,
    published,
    deliver,
    subscriberCount: () => (handlers.get(AUTHZ_INVALIDATED_CHANNEL) ?? new Set()).size,
    unsubscribeCalls: () => unsubscribeCalls,
  };
}

describe('[#11968] outbound — a local bump becomes one hint', () => {
  it('publishes on the authz.invalidated channel, stamped with this node', () => {
    const { bus, published } = makeBus();
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    epoch.bump('write');

    expect(published).toHaveLength(1);
    expect(published[0].channel).toBe(AUTHZ_INVALIDATED_CHANNEL);
    expect(published[0].payload).toMatchObject({
      originNode: 'node-a',
      epoch: 1,
      reason: 'write',
    });
    expect(typeof published[0].payload.at).toBe('number');
  });

  it('a metadata bump is published too — a declared permission set writes no row', () => {
    const { bus, published } = makeBus();
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    epoch.bump('metadata');

    expect(published).toHaveLength(1);
    expect(published[0].payload.reason).toBe('metadata');
  });
});

describe('[#11968] inbound — a peer hint advances the local epoch', () => {
  it('a hint from another node bumps locally, exactly once', () => {
    const { bus, deliver } = makeBus();
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    deliver({ originNode: 'node-b', epoch: 42, reason: 'write', at: Date.now() });

    expect(epoch.current).toBe(1);
  });

  it('the local epoch does NOT adopt the peer value — the counters are independent', () => {
    // Adopting a peer's number would make the counter non-monotonic on this
    // node the first time a peer restarted, and the memo key it feeds compares
    // equality. "Something changed" is the whole payload; 42 is diagnostic.
    const { bus, deliver } = makeBus();
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    deliver({ originNode: 'node-b', epoch: 9999, reason: 'write', at: Date.now() });

    expect(epoch.current).toBe(1);
  });

  it('ignores its OWN hint — loopback would double-count every write', () => {
    const { bus, deliver } = makeBus();
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    deliver({ originNode: 'node-a', epoch: 1, reason: 'write', at: Date.now() });

    expect(epoch.current).toBe(0);
  });

  it('a remote-caused bump is NOT re-published — two nodes would trade one write forever', () => {
    const { bus, published, deliver } = makeBus();
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    deliver({ originNode: 'node-b', epoch: 1, reason: 'write', at: Date.now() });

    expect(epoch.current).toBe(1);
    expect(published).toHaveLength(0);
  });
});

describe('[#11968] ⭐ a lost hint costs latency, never correctness', () => {
  it('a rejecting publish is swallowed; the epoch already advanced', async () => {
    const debug = vi.fn();
    const { bus } = makeBus(async () => {
      throw new Error('redis is down');
    });
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a', logger: { debug } });

    expect(() => epoch.bump('write')).not.toThrow();
    expect(epoch.current).toBe(1);

    // A macrotask turn, not a fixed number of microtask ticks: the rejection
    // travels through an async function's ADOPTION of the driver's promise
    // before the bridge's own `.catch` runs, and counting those ticks is how a
    // timing-fragile assertion gets written.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0][0]).toMatch(/TTL bounds it/);
  });

  it('a SYNCHRONOUSLY throwing publish is swallowed too', () => {
    const debug = vi.fn();
    const handlers = new Map<string, Set<PubSubHandler<any>>>();
    const bus: IPubSub = {
      publish(): Promise<void> {
        throw new Error('driver threw before returning a promise');
      },
      subscribe<T>(channel: string, handler: PubSubHandler<T>) {
        let set = handlers.get(channel);
        if (!set) {
          set = new Set();
          handlers.set(channel, set);
        }
        set.add(handler as PubSubHandler<any>);
        return () => set!.delete(handler as PubSubHandler<any>);
      },
      async close(): Promise<void> {},
    };
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a', logger: { debug } });

    expect(() => epoch.bump('write')).not.toThrow();
    expect(epoch.current).toBe(1);
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it('with no logger at all, a failing publish is still not an error', async () => {
    const { bus } = makeBus(async () => {
      throw new Error('redis is down');
    });
    const epoch = new WriteEpoch();
    bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    expect(() => epoch.bump('write')).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(epoch.current).toBe(1);
  });
});

describe('[#11968] teardown', () => {
  it('the disposer unsubscribes both directions, and is idempotent', () => {
    const bus = makeBus();
    const epoch = new WriteEpoch();
    const detach = bridgeAuthzInvalidation({
      epoch,
      pubsub: bus.bus,
      nodeId: 'node-a',
    });

    expect(bus.subscriberCount()).toBe(1);
    expect(epoch.listenerCount).toBe(1);

    detach();
    detach();

    expect(bus.subscriberCount()).toBe(0);
    expect(epoch.listenerCount).toBe(0);
    expect(bus.unsubscribeCalls()).toBe(1);

    // And nothing is published after detach.
    epoch.bump('write');
    expect(bus.published).toHaveLength(0);
  });

  it('a driver whose unsubscribe throws does not strand the local listener', () => {
    const handlers = new Set<PubSubHandler<any>>();
    const bus: IPubSub = {
      async publish(): Promise<void> {},
      subscribe<T>(_channel: string, handler: PubSubHandler<T>) {
        handlers.add(handler as PubSubHandler<any>);
        return () => {
          throw new Error('driver unsubscribe exploded');
        };
      },
      async close(): Promise<void> {},
    };
    const epoch = new WriteEpoch();
    const detach = bridgeAuthzInvalidation({ epoch, pubsub: bus, nodeId: 'node-a' });

    expect(() => detach()).not.toThrow();
    expect(epoch.listenerCount).toBe(0);
  });
});
