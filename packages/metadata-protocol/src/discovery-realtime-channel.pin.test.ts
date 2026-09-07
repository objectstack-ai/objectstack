// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14646] `/discovery` stops advertising a realtime service that has no
 * mounted surface — the `getDiscovery()` producer's half. This is the producer
 * behind `GET /api/v1/discovery` on a REST host (`registerDiscoveryEndpoints`
 * in `@objectstack/rest`), i.e. the document the showcase boot actually served
 * when the defect was measured; `packages/runtime` carries the same pins for
 * the dispatcher producer.
 *
 * The reported document said `enabled: true` for `realtime` and, in the same
 * entry, "In-process event bus only — no HTTP/WS realtime surface is mounted".
 * Both were true: `enabled` meant "the slot is filled", which for an in-process
 * pub/sub bus says nothing about whether anything is listening on the wire. A
 * client keying on it subscribes to nothing and silently loses the feature it
 * subscribed for.
 *
 * Maintainer ruling A (2026-09-04): realtime stays out of open core, discovery
 * retracts the claim, and "what counts as a subscribable channel" becomes ONE
 * explicit definition — `isSubscribableChannel` (`@objectstack/spec/api`):
 * `handlerReady: true` AND a connectable `route`. Both directions are pinned
 * here on purpose: a fix pinned only from the negative end would be
 * indistinguishable from "never advertise realtime", which is another hardcode
 * rather than a definition.
 */

import { describe, it, expect } from 'vitest';
import { isSubscribableChannel } from '@objectstack/spec/api';
import type { IRealtimeService } from '@objectstack/spec/contracts';
import { ObjectStackProtocolImplementation } from './index.js';

/** Same minimal engine `discovery-schema-conformance.test.ts` uses. */
function makeImpl(services: Map<string, any>) {
  const engine = {
    registry: { getObject: (_n: string) => undefined, getRegisteredTypes: () => [] },
  };
  return new ObjectStackProtocolImplementation(engine as any, () => services);
}

/**
 * The shape `RealtimeServicePlugin` registers: an in-process pub/sub bus that
 * names no channel route. (The authoritative reading — that the SHIPPED
 * `InMemoryRealtimeAdapter` really names none — is pinned in
 * `@objectstack/service-realtime`'s own suite and, against the real adapter, in
 * `packages/runtime`; this package cannot import it without a dependency
 * inversion.)
 */
const inProcessBus: IRealtimeService = {
  publish: async () => {},
  subscribe: async () => 'sub_1',
  unsubscribe: async () => {},
};

/** An occupant that really mounts a client-facing channel and says where. */
const mountedChannel: IRealtimeService = {
  ...inProcessBus,
  getChannelRoute: () => '/api/v1/realtime',
};

describe('[#14646] discovery and the one definition of a subscribable channel (getDiscovery producer)', () => {
  it('does NOT advertise an in-process realtime bus as a channel', async () => {
    const discovery: any = await makeImpl(new Map([['realtime', inProcessBus]])).getDiscovery();
    const realtime = discovery.services.realtime;

    expect(realtime.enabled).toBe(false);
    // Informative, not collapsed to `unavailable`: something IS registered and
    // works in-process — it just serves no wire (contrast the kernel-internal
    // slots, whose in-process contract IS the whole capability, #4318).
    expect(realtime.status).toBe('degraded');
    expect(realtime.handlerReady).toBe(false);
    expect(realtime.route).toBeUndefined();
    expect(realtime.message).toContain('no HTTP/WS realtime surface is mounted');

    expect(discovery.routes.realtime).toBeUndefined();
    expect(discovery.capabilities.websockets.enabled).toBe(false);
  });

  it('DOES advertise a realtime occupant that mounts a channel', async () => {
    const discovery: any = await makeImpl(new Map([['realtime', mountedChannel]])).getDiscovery();
    const realtime = discovery.services.realtime;

    expect(realtime.enabled).toBe(true);
    expect(realtime.status).toBe('available');
    expect(realtime.handlerReady).toBe(true);
    expect(realtime.route).toBe('/api/v1/realtime');
    expect(realtime.message).toBeUndefined();

    expect(discovery.routes.realtime).toBe('/api/v1/realtime');
    expect(discovery.capabilities.websockets.enabled).toBe(true);
  });

  it('reports an absent realtime slot as unavailable', async () => {
    const discovery: any = await makeImpl(new Map()).getDiscovery();

    expect(discovery.services.realtime.enabled).toBe(false);
    expect(discovery.services.realtime.status).toBe('unavailable');
    expect(discovery.routes.realtime).toBeUndefined();
    expect(discovery.capabilities.websockets.enabled).toBe(false);
  });

  it('answers `enabled`, `routes.realtime` and `capabilities.websockets` with the SAME predicate', async () => {
    for (const occupant of [inProcessBus, mountedChannel, undefined]) {
      const services = new Map<string, any>();
      if (occupant) services.set('realtime', occupant);
      const discovery: any = await makeImpl(services).getDiscovery();

      const verdict = isSubscribableChannel(discovery.services.realtime);
      expect(discovery.services.realtime.enabled, 'services.realtime.enabled').toBe(verdict);
      expect(discovery.capabilities.websockets.enabled, 'capabilities.websockets').toBe(verdict);
      expect(discovery.routes.realtime !== undefined, 'routes.realtime').toBe(verdict);
    }
  });

  it('leaves the kernel-internal slots alone — no route is not the same as no channel', async () => {
    // The predicate is applied per slot, deliberately. `cache` delivers its
    // whole contract in-process (#4318), so it stays honestly `enabled` with no
    // route; only a slot whose advertised capability IS a channel answers
    // `enabled` with `isSubscribableChannel`. Without this, "make discovery
    // truthful" would have read as "enabled means a route exists" and quietly
    // retracted three working services.
    const discovery: any = await makeImpl(new Map([['cache', { get: async () => undefined }]])).getDiscovery();

    expect(discovery.services.cache.enabled).toBe(true);
    expect(discovery.services.cache.handlerReady).toBe(false);
    expect(discovery.services.cache.route).toBeUndefined();
    expect(isSubscribableChannel(discovery.services.cache)).toBe(false);
  });
});
