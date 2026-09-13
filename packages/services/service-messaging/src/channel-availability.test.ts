// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#17732] Fan-out consults per-tenant channel availability before it writes
// anything — ruling `5644350987` on #17732 (director seat, 2026-09-12).
//
// ## What was wrong
//
// Every `(recipient × channel)` pair got a `sys_notification_delivery` row, and
// a channel the tenant has no transport for produced rows that could only ever
// dead-letter. #17611's C capped how LONG those rows live; this is the cause.
//
// ## Why the three facts below are pinned on ONE pass
//
// Each of them alone is passed by an implementation that is badly broken in a
// different direction, so a suite that separates them proves nothing:
//
//   * "the unavailable channel got no row"  — also true of a fan-out that
//     wrote NOTHING AT ALL.
//   * "the available channel got its row"   — also true of the old code.
//   * "the suppression was recorded"        — also true of an implementation
//     that records a suppression it never actually performed.
//
// Only the conjunction — in one emit, over one outbox — says the fix
// DISCRIMINATES between the two channels rather than acting on all of them.
//
// ## And the control that matters more than the feature
//
// The ruling's item 1 is load-bearing: the member is OPTIONAL, and "a channel
// that does not implement it is treated as available (today's behaviour)". An
// implementation that inverted that default would pass every suppression test
// in this file while silently muting every channel — ours and every third
// party's — that has not been updated. That is a far worse bug than the one
// being fixed, so it gets its own pin, from both sides.

import { describe, it, expect } from 'vitest';
import { SysNotification } from '@objectstack/platform-objects/audit';
import { MessagingService } from './messaging-service.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { CHANNEL_UNAVAILABLE_REASONS } from './channel.js';
import type {
    ChannelAvailability,
    ChannelAvailabilityQuery,
    Delivery,
    MessagingChannel,
} from './channel.js';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

/**
 * A data engine double that captures the `sys_notification` insert.
 *
 * Deliberately implements only what this path reaches — `insert` for the L2
 * event, `find` for the preference lookup. `emit()` without a `dedupKey` and
 * with plain user-id recipients performs no `findOne`, and no `update` or
 * `delete` at all, so the double carries none: an engine double is only ever
 * as wide as the calls it has to answer.
 */
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

/** A channel that records what it is handed and, optionally, answers availability. */
function channelDouble(
    id: string,
    availability?: ChannelAvailability | (() => ChannelAvailability),
): { channel: MessagingChannel; sent: Delivery[]; probes: ChannelAvailabilityQuery[] } {
    const sent: Delivery[] = [];
    const probes: ChannelAvailabilityQuery[] = [];
    const channel: MessagingChannel = {
        id,
        async send(_ctx, delivery) {
            sent.push(delivery);
            return { ok: true };
        },
    };
    if (availability !== undefined) {
        (channel as { isAvailable?: unknown }).isAvailable = (
            _ctx: unknown,
            query: ChannelAvailabilityQuery,
        ): ChannelAvailability => {
            probes.push(query);
            return typeof availability === 'function' ? availability() : availability;
        };
    }
    return { channel, sent, probes };
}

const UNAVAILABLE: ChannelAvailability = { available: false, reason: 'transport_not_configured' };

describe('channel availability at fan-out (#17732)', () => {
    it('suppresses the unavailable channel, still enqueues the available one, and records the reason — one pass', async () => {
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });

        // `inbox` implements NO availability member — the ruling's default, and
        // the production shape of the always-available channel.
        const inbox = channelDouble('inbox');
        // `email` answers that this tenant has no transport.
        const email = channelDouble('email', UNAVAILABLE);
        service.registerChannel(inbox.channel);
        service.registerChannel(email.channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1', 'user_2'],
            channels: ['inbox', 'email'],
            organizationId: 'org_1',
            payload: { title: 'Deal closed' },
        });

        const rows = await outbox.list();

        // (1) The unavailable channel got NO delivery row …
        expect(rows.filter((r) => r.channel === 'email')).toHaveLength(0);
        // (2) … while the available channel in the SAME fan-out got one per
        //     recipient. Without this, (1) is also satisfied by writing nothing.
        expect(rows.filter((r) => r.channel === 'inbox').map((r) => r.recipientId).sort())
            .toEqual(['user_1', 'user_2']);
        expect(rows).toHaveLength(2);
        expect(result.enqueued).toBe(2);
        expect(result.failed).toBe(0);

        // (3) The suppression is recorded on the L2 event, with its reason — in
        //     the SAME insert that created the event, so the feature costs no
        //     second write.
        expect(data.inserts).toHaveLength(1);
        expect(data.inserts[0].object).toBe('sys_notification');
        expect(data.inserts[0].row.suppressed_channels)
            .toEqual([{ channel: 'email', reason: 'transport_not_configured' }]);

        // …and the caller is told, so a two-channel emit reporting one row is
        // never indistinguishable from a fan-out bug.
        expect(result.suppressed).toEqual([{ channel: 'email', reason: 'transport_not_configured' }]);
    });

    it('THE CONTROL: a channel that does not implement isAvailable still gets its delivery row', async () => {
        // The whole point of the optional member. An implementation that treated
        // "no isAvailable" as unavailable would pass every other test in this
        // file and silently mute every channel nobody has updated.
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);
        service.registerChannel(channelDouble('sms').channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['inbox', 'sms'],
            payload: { title: 'Deal closed' },
        });

        const rows = await outbox.list();
        expect(rows.map((r) => r.channel).sort()).toEqual(['inbox', 'sms']);
        expect(result.enqueued).toBe(2);
        expect(result.suppressed).toEqual([]);
        // NULL, not `[]` — the column stays empty on the common path, so a
        // non-null value always means something really was dropped.
        expect(data.inserts[0].row.suppressed_channels).toBeNull();
    });

    it('THE CONTROL, other side: the same channel suppressed once it DOES answer unavailable', async () => {
        // Pairs with the test above on one variable — the presence of the
        // member — so "it got its row" cannot be read as "suppression never
        // works here".
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);
        service.registerChannel(channelDouble('sms', UNAVAILABLE).channel);

        await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['inbox', 'sms'],
            payload: { title: 'Deal closed' },
        });

        expect((await outbox.list()).map((r) => r.channel)).toEqual(['inbox']);
        expect(data.inserts[0].row.suppressed_channels)
            .toEqual([{ channel: 'sms', reason: 'transport_not_configured' }]);
    });

    it('asks each channel ONCE per emit and hands it the tenant — not once per recipient', async () => {
        // The cost claim, pinned. Availability is a property of (tenant ×
        // channel), so a probe that ran per delivery would multiply whatever it
        // costs by the audience size — the thing the ruling asked to be measured.
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        const email = channelDouble('email', { available: true });
        service.registerChannel(email.channel);

        await service.emit({
            topic: 'deal.won',
            audience: ['user_1', 'user_2', 'user_3', 'user_4'],
            channels: ['email'],
            organizationId: 'org_7',
            payload: { title: 'Deal closed' },
        });

        expect((await outbox.list())).toHaveLength(4);
        expect(email.probes).toEqual([{ organizationId: 'org_7' }]);
    });

    it('fails OPEN: a throwing availability probe delivers exactly as before', async () => {
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const warnings: string[] = [];
        const service = new MessagingService({
            logger: { ...silentLogger(), warn: (...a: unknown[]) => warnings.push(String(a[0])) },
            outbox,
            getData: () => data.engine,
        });
        const broken: MessagingChannel = {
            id: 'email',
            async send() { return { ok: true }; },
            isAvailable() { throw new Error('probe exploded'); },
        };
        service.registerChannel(broken);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['email'],
            payload: { title: 'Deal closed' },
        });

        expect((await outbox.list()).map((r) => r.channel)).toEqual(['email']);
        expect(result.suppressed).toEqual([]);
        expect(warnings.join('\n')).toContain('probe exploded');
    });

    it('writes the event but no delivery rows when EVERY requested channel is unavailable', async () => {
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('email', UNAVAILABLE).channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['email'],
            payload: { title: 'Deal closed' },
        });

        // The event happened, so it is recorded — with the reason it produced
        // no work. The audit trail is what replaces the dead rows.
        expect(data.inserts).toHaveLength(1);
        expect(data.inserts[0].row.suppressed_channels)
            .toEqual([{ channel: 'email', reason: 'transport_not_configured' }]);
        expect(await outbox.list()).toHaveLength(0);
        expect(result.enqueued).toBe(0);
        expect(result.failed).toBe(0);
        expect(result.notificationId).toBeTruthy();
    });

    it('skips send() for an unavailable channel on the inline (P0) path too', async () => {
        const data = capturingEngine();
        const service = new MessagingService({ logger: silentLogger(), getData: () => data.engine });
        const inbox = channelDouble('inbox');
        const email = channelDouble('email', UNAVAILABLE);
        service.registerChannel(inbox.channel);
        service.registerChannel(email.channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['inbox', 'email'],
            payload: { title: 'Deal closed' },
        });

        expect(inbox.sent.map((d) => d.channel)).toEqual(['inbox']);
        expect(email.sent).toHaveLength(0);
        expect(result.delivered).toBe(1);
        expect(result.failed).toBe(0);
        expect(result.suppressed).toEqual([{ channel: 'email', reason: 'transport_not_configured' }]);
        // The surviving channel list is what the materialization is told about —
        // a suppressed channel is not advertised to the ones that did run.
        expect(inbox.sent[0].notification.channels).toEqual(['inbox']);
    });

    it('leaves an UNREGISTERED channel on its existing path — ⛔ not folded into suppression', async () => {
        // Out of the ruling's scope on purpose: an unregistered channel has no
        // implementation to ask, so it keeps today's behaviour exactly. Pinned
        // so the boundary is deliberate rather than accidental.
        const data = capturingEngine();
        const service = new MessagingService({ logger: silentLogger(), getData: () => data.engine });
        service.registerChannel(channelDouble('inbox').channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['inbox', 'nowhere'],
            payload: { title: 'Deal closed' },
        });

        expect(result.suppressed).toEqual([]);
        expect(data.inserts[0].row.suppressed_channels).toBeNull();
        expect(result.deliveries.find((d) => d.channel === 'nowhere'))
            .toMatchObject({ ok: false, error: "channel 'nowhere' not registered" });
    });

    it('the object inlines exactly the closed reason vocabulary the seam declares', async () => {
        // `packages/platform-objects` is a lower layer and cannot import
        // `CHANNEL_UNAVAILABLE_REASONS`, so the enum is inlined there. This is
        // what keeps the two copies equal — a comment would not.
        const field = (SysNotification as { fields: Record<string, { description?: string }> })
            .fields.suppressed_channels;
        expect(field, 'sys_notification must declare the suppression key').toBeTruthy();
        const described = String(field.description);
        const marker = 'closed set: ';
        expect(described).toContain(marker);
        const inlined = described.slice(described.indexOf(marker) + marker.length)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        expect(inlined).toEqual([...CHANNEL_UNAVAILABLE_REASONS]);
    });
});
