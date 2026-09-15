// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#18050] A channel MOUNT is resolved per lookup — it is not a verdict
// recorded once while the service registry was still filling.
//
// ## What was wrong
//
// `messaging-service-plugin.ts` registered the email and SMS channels inside a
// `kernel:ready` hook, behind `if (getEmail())` / `if (getSms())`. The comment
// above that guard reasoned "the dispatcher looks channels up dynamically, so
// registering after it is fine" — true of the dispatcher, and contradicted by
// the guard beneath it: the `if` ran exactly ONCE and nothing revisited it. A
// transport that registered a moment later — a plugin ordered after this one
// registering from its own `kernel:ready` handler, `kernel:bootstrapped`,
// `kernel:listening`, or any runtime mount — never got its channel, and every
// `notify` naming it was refused as "not registered" for the life of the
// process. That is the three-part shape AGENTS.md's "Startup registry reads"
// section names, and `registerChannelProvider` is its first cure applied here:
// resolve where it is USED, not where you start.
//
// ## Why the facts below are pinned on ONE pass
//
// Each alone is satisfied by an implementation broken in a different direction:
//
//   * "the late transport delivered"      — also true of an implementation that
//     mounts every named channel unconditionally, which would turn a typo into
//     a silently no-opping channel.
//   * "the absent transport was refused"  — also true of the OLD code, which is
//     the state this file exists to leave behind.
//   * "the rows reached the dispatcher"   — also true of a fan-out that wrote
//     rows the dispatcher could only dead-letter, i.e. the #18050 defect the
//     durable path already fixed.
//
// Only the conjunction — one service, one outbox, one dispatcher tick, the
// transport arriving BETWEEN two emits — says the mount tracks the transport
// rather than a snapshot of it.
//
// ## The boundary this must not move
//
// ⛔ An unmounted channel is still REFUSED, never suppressed. Whether a MOUNTED
// channel can send for a tenant is `isAvailable`'s question and lands in
// `sys_notification.suppressed_channels`; whether a channel is mounted at all
// is a COMPOSITION fact and lands in a failed `DeliveryOutcome` with no row and
// no column (#18041's settlement, pinned from the other side in
// `unregistered-channel.test.ts` and `channel-availability.test.ts`). The
// second and third tests below hold that line while the mount moves.

import { describe, it, expect } from 'vitest';
import { MessagingService } from './messaging-service.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { NotificationDispatcher } from './dispatcher.js';
import type { Delivery, MessagingChannel } from './channel.js';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

/** A data engine double that captures the `sys_notification` insert — see `unregistered-channel.test.ts`. */
function capturingEngine() {
    const inserts: Array<{ object: string; row: Record<string, unknown> }> = [];
    return {
        inserts,
        engine: {
            async insert(object: string, row: Record<string, unknown>) {
                inserts.push({ object, row });
                return { id: `evt_${inserts.length}`, ...row };
            },
            async find() {
                return [];
            },
        } as never,
    };
}

function channelDouble(id: string): { channel: MessagingChannel; sent: Delivery[] } {
    const sent: Delivery[] = [];
    return {
        sent,
        channel: {
            id,
            async send(_ctx, delivery) {
                sent.push(delivery);
                return { ok: true };
            },
        },
    };
}

const EMIT = {
    topic: 'deal.won',
    audience: ['user_1', 'user_2'],
    channels: ['inbox', 'email'],
    organizationId: 'org_1',
    payload: { title: 'Deal closed' },
};

describe('a channel mounted through a provider (#18050)', () => {
    it('mounts the moment its transport appears — mid-process, between two emits — and the dispatcher DELIVERS those rows', async () => {
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);

        // The transport this composition has not registered YET — the plugin's
        // `getEmail()` in miniature, and the only moving part in this test.
        let transport: MessagingChannel | undefined;
        service.registerChannelProvider('email', () => transport);

        // (1) While it is absent the answer is the one a composition that never
        //     registers it has always produced: refused, no row written, so
        //     there is nothing for the dispatcher to dead-letter.
        const before = await service.emit(EMIT);
        expect((await outbox.list()).filter((r) => r.channel === 'email')).toHaveLength(0);
        expect(
            before.deliveries
                .filter((d) => d.channel === 'email')
                .map((d) => ({ recipient: d.recipient, ok: d.ok, error: d.error }))
                .sort((a, b) => a.recipient.localeCompare(b.recipient)),
        ).toEqual([
            { recipient: 'user_1', ok: false, error: "channel 'email' not registered" },
            { recipient: 'user_2', ok: false, error: "channel 'email' not registered" },
        ]);

        // (2) The transport registers LATER than `kernel:ready`. Under the old
        //     one-shot guard this moment was unreachable: the mount decision had
        //     already been taken and recorded as a non-registration.
        const email = channelDouble('email');
        transport = email.channel;

        const after = await service.emit(EMIT);
        expect(after.deliveries.filter((d) => d.channel === 'email').every((d) => d.ok)).toBe(true);
        expect(
            (await outbox.list()).filter((r) => r.channel === 'email').map((r) => r.recipientId).sort(),
        ).toEqual(['user_1', 'user_2']);

        // (3) …and those rows are DELIVERED, not dead-lettered on attempt one.
        //     The dispatcher resolves through the SAME lookup this service
        //     answers (`ChannelRegistry.getChannel`), so the old guard's claim —
        //     "the dispatcher looks channels up dynamically" — is finally true
        //     end to end rather than contradicted by the code beneath it.
        const dispatcher = new NotificationDispatcher({
            nodeId: 'node-test',
            outbox,
            channels: service,
            channelContext: { logger: silentLogger() },
            intervalMs: 10_000,
        });
        await dispatcher.tick();

        const settled = (await outbox.list()).filter((r) => r.channel === 'email');
        expect(settled.map((r) => r.status)).toEqual(['success', 'success']);
        expect(settled.map((r) => r.attempts)).toEqual([1, 1]);
        expect(email.sent.map((d) => d.recipient).sort()).toEqual(['user_1', 'user_2']);
    });

    it('unmounts again when the transport goes away — the same refusal, not a new failure mode', async () => {
        // Symmetry is the point: a provider is a question asked every time, so
        // the answer has to be allowed to change back. An implementation that
        // memoised the PRESENCE (rather than the channel object) would pass the
        // test above and fail this one, having simply moved the one-shot verdict
        // to a later moment.
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({ logger: silentLogger(), outbox, getData: () => data.engine });
        service.registerChannel(channelDouble('inbox').channel);

        const email = channelDouble('email');
        let transport: MessagingChannel | undefined = email.channel;
        service.registerChannelProvider('email', () => transport);

        expect(service.getRegisteredChannels()).toContain('email');
        expect(service.getChannel('email')).toBe(email.channel);

        transport = undefined;

        expect(service.getRegisteredChannels()).not.toContain('email');
        expect(service.getChannel('email')).toBeUndefined();

        const result = await service.emit(EMIT);
        expect((await outbox.list()).filter((r) => r.channel === 'email')).toHaveLength(0);
        expect(result.deliveries.filter((d) => d.channel === 'email').map((d) => d.error)).toEqual([
            "channel 'email' not registered",
            "channel 'email' not registered",
        ]);
    });

    it('⛔ records NO suppression while unmounted — the event row keeps the column set it had', async () => {
        // #18041's settlement, held while the mount became dynamic: an absent
        // mount is a COMPOSITION fact, identical for every tenant in the
        // process, so it must not enter a per-tenant availability column. A
        // stack whose `sys_notification` predates that column would answer
        // INVALID_FIELD and lose the notification outright.
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({ logger: silentLogger(), outbox, getData: () => data.engine });
        service.registerChannel(channelDouble('inbox').channel);
        service.registerChannelProvider('email', () => undefined);

        const result = await service.emit({ ...EMIT, audience: ['user_1'] });

        expect(result.suppressed).toEqual([]);
        expect(data.inserts).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(data.inserts[0].row, 'suppressed_channels')).toBe(false);
    });

    it('treats a provider that THROWS as not mounted, says so once, and keeps asking', async () => {
        // A resolver reaching a service registry can throw (`getService` does,
        // for an unregistered name). Fail-closed on the mount, fail-quiet on the
        // log — and ⛔ never record the failure as a verdict: the very next
        // lookup asks again, which is how a transport that recovers gets its
        // channel back without a restart.
        const warnings: string[] = [];
        const service = new MessagingService({
            logger: { ...silentLogger(), warn: (...a: unknown[]) => warnings.push(String(a[0])) },
            getData: () => undefined,
        });
        const email = channelDouble('email');
        let broken = true;
        service.registerChannelProvider('email', () => {
            if (broken) throw new Error('email service exploded');
            return email.channel;
        });

        expect(service.getChannel('email')).toBeUndefined();
        expect(service.getChannel('email')).toBeUndefined();
        const lines = warnings.filter((w) => w.includes("channel provider 'email' threw"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('email service exploded');

        broken = false;
        expect(service.getChannel('email')).toBe(email.channel);
    });

    it('a directly registered channel and a provider replace each other under one id', async () => {
        // Both registries answer the same `getChannel`, so an id can only mean
        // one thing at a time — otherwise a stale direct registration would
        // shadow the provider that replaced it, which is the one-shot verdict
        // again wearing a different hat.
        const warnings: string[] = [];
        const service = new MessagingService({
            logger: { ...silentLogger(), warn: (...a: unknown[]) => warnings.push(String(a[0])) },
            getData: () => undefined,
        });
        const direct = channelDouble('email');
        const lazy = channelDouble('email');

        service.registerChannel(direct.channel);
        service.registerChannelProvider('email', () => lazy.channel);
        expect(service.getChannel('email')).toBe(lazy.channel);
        expect(service.getRegisteredChannels().filter((id) => id === 'email')).toHaveLength(1);

        service.registerChannel(direct.channel);
        expect(service.getChannel('email')).toBe(direct.channel);

        service.unregisterChannel('email');
        expect(service.getChannel('email')).toBeUndefined();
        expect(warnings.filter((w) => w.includes("already registered; replacing"))).toHaveLength(2);
    });
});
