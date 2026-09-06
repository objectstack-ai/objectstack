// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14646] The shipped realtime occupant names NO channel route — the fact
 * discovery reports.
 *
 * `realtime` is a channel slot (`CHANNEL_SURFACE_SLOTS`, `@objectstack/spec/api`):
 * both discovery producers derive `services.realtime.enabled`, its
 * `route`/`handlerReady` and `capabilities.websockets` from
 * `isSubscribableChannel` over the route the occupant names via
 * `IRealtimeService.getChannelRoute()`. This adapter is an in-process pub/sub
 * bus with no wire surface, so it names none and discovery advertises no
 * channel — the retraction maintainer ruling A (2026-09-04) asks for, computed
 * from this implementation instead of hardcoded in two builders.
 *
 * ⛔ This pin is what makes that a decision rather than an omission. Adding
 * `getChannelRoute()` here would flip `/discovery` to advertising a realtime
 * channel platform-wide — and under the ruling realtime stays out of open core,
 * so a route named here with nothing serving it is exactly the
 * `declared ≠ enforced` defect the card closed. If a transport ever ships, this
 * pin is the place the decision is re-taken, in the open.
 */

import { describe, it, expect } from 'vitest';
import { isSubscribableChannel, readChannelRoute } from '@objectstack/spec/api';
import { InMemoryRealtimeAdapter } from './in-memory-realtime-adapter.js';

describe('[#14646] the in-process realtime bus advertises no subscribable channel', () => {
  it('names no channel route', () => {
    const adapter = new InMemoryRealtimeAdapter();

    expect(typeof (adapter as { getChannelRoute?: unknown }).getChannelRoute).not.toBe('function');
    expect(readChannelRoute(adapter)).toBeUndefined();
  });

  it('is therefore not a subscribable channel in discovery terms', () => {
    const route = readChannelRoute(new InMemoryRealtimeAdapter());

    // Exactly the entry a producer would build from this occupant.
    expect(isSubscribableChannel({ handlerReady: route !== undefined, route })).toBe(false);
  });

  it('serves no HTTP upgrade either — no transport, by ADR-0096 D4 as well', () => {
    // `handleUpgrade` is deliberately unimplemented platform-wide until the
    // identity-admission requirement on `IRealtimeService` is satisfied
    // (#2992). Both facts point one way; the channel route is the one
    // discovery reads, because SSE mounts a plain GET and never upgrades.
    const adapter = new InMemoryRealtimeAdapter();
    expect(typeof (adapter as { handleUpgrade?: unknown }).handleUpgrade).not.toBe('function');
  });
});
