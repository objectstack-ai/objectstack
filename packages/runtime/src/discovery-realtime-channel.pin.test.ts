// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14646] `/discovery` stops advertising a realtime service that has no
 * mounted surface — the dispatcher producer's half.
 *
 * ## What was wrong, and why flipping a boolean would not have fixed it
 *
 * On a stock boot this document reported the `realtime` slot as
 * `enabled: true` **and** carried the message "In-process event bus only — no
 * HTTP/WS realtime surface is mounted", with no `routes.realtime` entry. Both
 * statements were true: `enabled` meant "the slot is filled". So the field had
 * two meanings, and a console client keying on it to subscribe would subscribe
 * to nothing and silently lose its inbox bell — no error, no red, no signal.
 *
 * Maintainer ruling A (2026-09-04, director summon #14): realtime stays out of
 * open core, discovery stops advertising an unmounted realtime service, and
 * **"what counts as a subscribable channel" becomes ONE explicit definition**.
 * That definition is `isSubscribableChannel` in `@objectstack/spec/api`:
 * `handlerReady: true` AND a connectable `route`. This file pins it from both
 * ends, because a fix pinned only from the negative end is indistinguishable
 * from "never advertise realtime" — which would be a second hardcode, not a
 * definition.
 */

import { describe, it, expect } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import { isSubscribableChannel } from '@objectstack/spec/api';
import type { IRealtimeService } from '@objectstack/spec/contracts';

const PREFIX = '/api/v1';

/**
 * The shape a stock boot registers: an in-process pub/sub bus that names no
 * channel route.
 *
 * ⭐ Deliberately a stand-in rather than an import of the real
 * `InMemoryRealtimeAdapter`, and the reason is structural rather than
 * stylistic. Reaching for the real class made `@objectstack/runtime`
 * type-resolve `@objectstack/service-realtime` through its `dist/*.d.ts`, and
 * three of this repo's own ratchets refuse that from three directions:
 * `check:type-source-resolution` reds on the dist-resolved type import; its
 * registry is SHRINK-ONLY and its re-baseline limb is open only to a change
 * that ONBOARDED the program (this package's `typecheck` script already named
 * `tsconfig.test.json`, so it did not); and the mandated `paths` remedy pulls
 * that package's file graph into a program whose `rootDir` is `./src`, which
 * `tsconfig.test.json` states it will not widen — 13 `TS6059` billed to a
 * ledger `service-realtime` cannot see, the same shape PR #12570 measured.
 *
 * Nothing is lost by declaring it here, because the claim about the SHIPPED
 * occupant is not this file's to make: it is pinned against the real class, in
 * the package that owns it, by
 * `packages/services/service-realtime/src/no-channel-route.pin.test.ts`. That
 * pin plus these compose to the stock-boot reading — this file pins that the
 * PRODUCER derives its answer from whatever the occupant names, and that one
 * pins what the shipped occupant names.
 */
const inProcessBus: IRealtimeService = {
    publish: async () => {},
    subscribe: async () => 'sub_1',
    unsubscribe: async () => {},
};

/** A dispatcher whose kernel resolves exactly the one slot under test. */
function dispatcherWithRealtime(realtime: unknown): HttpDispatcher {
    const kernel = {
        context: { getService: () => null },
        getService: (name: string) => (name === 'realtime' ? realtime : null),
    } as any;
    return new HttpDispatcher(kernel);
}

/**
 * A realtime occupant that really mounts a client-facing channel: it names the
 * path a host has put it at, which is the producer half of the definition
 * (`IRealtimeService.getChannelRoute`). Nothing in the open framework is this
 * — under ruling A nothing ever will be — which is exactly why the positive
 * case has to be composed here.
 */
const mountedChannel: IRealtimeService = {
    ...inProcessBus,
    getChannelRoute: () => `${PREFIX}/realtime`,
};

describe('[#14646] discovery and the one definition of a subscribable channel (dispatcher producer)', () => {
    it('does NOT advertise an in-process realtime bus as a channel', async () => {
        const info = await dispatcherWithRealtime(inProcessBus).getDiscoveryInfo(PREFIX);
        const realtime = info.services.realtime;

        // The retraction the ruling asks for: `enabled` no longer says "the
        // slot is filled" for this slot, it says "there is a channel".
        expect(realtime.enabled).toBe(false);
        // …and the entry stays informative rather than collapsing to
        // `unavailable`: something IS registered, it just serves no wire.
        expect(realtime.status).toBe('degraded');
        expect(realtime.handlerReady).toBe(false);
        expect(realtime.route).toBeUndefined();
        expect(realtime.message).toContain('no HTTP/WS realtime surface is mounted');

        // Nothing to connect to, said in every place the document says it.
        expect(info.routes.realtime).toBeUndefined();
        expect(info.capabilities.websockets.enabled).toBe(false);
    });

    it('DOES advertise a realtime occupant that mounts a channel', async () => {
        const info = await dispatcherWithRealtime(mountedChannel).getDiscoveryInfo(PREFIX);
        const realtime = info.services.realtime;

        expect(realtime.enabled).toBe(true);
        expect(realtime.status).toBe('available');
        expect(realtime.handlerReady).toBe(true);
        expect(realtime.route).toBe(`${PREFIX}/realtime`);
        // The "no surface" sentence is only true while there is no surface.
        expect(realtime.message).toBeUndefined();

        expect(info.routes.realtime).toBe(`${PREFIX}/realtime`);
        expect(info.capabilities.websockets.enabled).toBe(true);
    });

    it('reports an absent realtime slot as unavailable, not as a silent channel', async () => {
        const info = await dispatcherWithRealtime(null).getDiscoveryInfo(PREFIX);

        expect(info.services.realtime.enabled).toBe(false);
        expect(info.services.realtime.status).toBe('unavailable');
        expect(info.routes.realtime).toBeUndefined();
        expect(info.capabilities.websockets.enabled).toBe(false);
    });

    it('answers `enabled` and `capabilities.websockets` with the SAME predicate', async () => {
        // The point of the definition. Two fields answering one question used
        // to be two constants that happened to agree; now both are
        // `isSubscribableChannel` over the same entry, so no composition can
        // make them disagree — including one this file did not think of.
        for (const occupant of [inProcessBus, mountedChannel, null]) {
            const info = await dispatcherWithRealtime(occupant).getDiscoveryInfo(PREFIX);
            const verdict = isSubscribableChannel(info.services.realtime);
            expect(info.services.realtime.enabled, 'services.realtime.enabled').toBe(verdict);
            expect(info.capabilities.websockets.enabled, 'capabilities.websockets').toBe(verdict);
            // ADR-0076 D12's other half: advertise only what is mounted.
            expect(info.routes.realtime !== undefined, 'routes.realtime').toBe(verdict);
        }
    });
});
