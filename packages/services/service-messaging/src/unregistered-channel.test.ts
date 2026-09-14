// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#18050] The durable (outbox) fan-out refuses a channel nobody registered
// instead of writing a `sys_notification_delivery` row for it.
//
// ## What was wrong
//
// `enqueueDeliveries` had no registration check at all: a `notify` naming a
// channel the composition never mounted produced ONE row per recipient, and the
// dispatcher dead-lettered every one of them on attempt ONE (`processRow` and
// `processDigestGroup` both ack `dead: true` the moment `getChannel()` answers
// nothing). The inline P0 path had checked this since forever; only the durable
// P1 path wrote the rows. That gap is the symptom #17732 opened with, and the
// ruling on #17732 (`isAvailable`) structurally cannot reach it — an
// unregistered channel has no implementation to ask.
//
// ## Why the facts below are pinned on ONE pass
//
// Each alone is satisfied by an implementation broken in a different direction:
//
//   * "the unregistered channel got no row"  — also true of a fan-out that
//     enqueued NOTHING AT ALL.
//   * "the registered channel got its rows"  — also true of the old code.
//   * "the caller was told"                  — also true of an implementation
//     that reports the failure AND writes the row anyway.
//
// Only the conjunction, in one emit over one outbox, says the change
// DISCRIMINATES between the two channels.
//
// ## And the two boundaries that matter more than the feature
//
//   1. ⛔ It is NOT a suppression. `sys_notification.suppressed_channels`
//      answers "why can this TENANT not send on this channel" — a per-tenant
//      configuration fact. An unregistered channel is a COMPOSITION fact,
//      identical for every tenant in the process. Folding it in would also
//      re-open what #18041 settled: the key is written ONLY when something was
//      actually suppressed, so the common path's column set never moves.
//   2. The refusal keeps the shape the INLINE path already used, so "nothing
//      was sent and here is why" reads the same on both paths. Pinned by
//      running the same emit through both and comparing the outcomes.

import { describe, it, expect } from 'vitest';
import { MessagingService } from './messaging-service.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import type { Delivery, MessagingChannel } from './channel.js';

function silentLogger() {
    return { info: () => {}, warn: () => {}, error: () => {} };
}

/**
 * A data engine double that captures the `sys_notification` insert.
 *
 * Deliberately implements only what this path reaches — `insert` for the L2
 * event, `find` for the preference lookup. `emit()` without a `dedupKey` and
 * with plain user-id recipients performs no `findOne`, and no `update` or
 * `delete` at all, so the double carries none.
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

describe('an unregistered channel on the durable fan-out (#18050)', () => {
    it('writes no delivery row for it, still enqueues the registered one, and tells the caller — one pass', async () => {
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);
        // `email` is NEVER registered — the reported composition: a deployment
        // with no email plugin whose flows still notify on ['inbox','email'].

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1', 'user_2'],
            channels: ['inbox', 'email'],
            organizationId: 'org_1',
            payload: { title: 'Deal closed' },
        });

        const rows = await outbox.list();

        // (1) The unregistered channel got NO row — the whole point. Before this
        //     change there were two, both dead on attempt one.
        expect(rows.filter((r) => r.channel === 'email')).toHaveLength(0);
        // (2) … while the registered channel in the SAME fan-out got one per
        //     recipient. Without this, (1) is also satisfied by writing nothing.
        expect(rows.filter((r) => r.channel === 'inbox').map((r) => r.recipientId).sort())
            .toEqual(['user_1', 'user_2']);
        expect(rows).toHaveLength(2);

        // (3) The caller is told, per (recipient × channel), in the failed
        //     `DeliveryOutcome` shape — a two-channel emit reporting two rows is
        //     never indistinguishable from a fan-out bug.
        expect(result.enqueued).toBe(2);
        expect(result.failed).toBe(2);
        expect(
            result.deliveries
                .filter((d) => d.channel === 'email')
                .map((d) => ({ recipient: d.recipient, ok: d.ok, error: d.error }))
                .sort((a, b) => a.recipient.localeCompare(b.recipient)),
        ).toEqual([
            { recipient: 'user_1', ok: false, error: "channel 'email' not registered" },
            { recipient: 'user_2', ok: false, error: "channel 'email' not registered" },
        ]);
    });

    it('⛔ records NO suppression for it — the event row keeps the column set it had', async () => {
        // The #18041 fence, from both sides: `suppressed_channels` is a
        // per-tenant availability answer, and it is written ONLY when something
        // was actually suppressed. An unregistered channel is neither, so the
        // insert must not even NAME the column — a stack whose `sys_notification`
        // predates it would answer INVALID_FIELD and lose the notification.
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const service = new MessagingService({
            logger: silentLogger(),
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['inbox', 'nowhere'],
            payload: { title: 'Deal closed' },
        });

        expect(result.suppressed).toEqual([]);
        expect(data.inserts).toHaveLength(1);
        expect(Object.prototype.hasOwnProperty.call(data.inserts[0].row, 'suppressed_channels')).toBe(false);
        expect(Object.keys(data.inserts[0].row).sort()).toEqual([
            'actor_id', 'created_at', 'dedup_key', 'organization_id',
            'payload', 'severity', 'source_id', 'source_object', 'topic',
        ]);
    });

    it('answers IDENTICALLY on the inline and the durable path — one shape for "nothing was sent and why"', async () => {
        // The cross-path equality, executable. The two paths are different code
        // (`fanOut` vs `enqueueDeliveries`), so only comparing their output
        // proves an operator reading a failure report does not have to know
        // which one produced it.
        const emit = { topic: 'deal.won', audience: ['user_1', 'user_2'], channels: ['nowhere'], payload: { title: 'x' } };

        const inlineData = capturingEngine();
        const inline = new MessagingService({ logger: silentLogger(), getData: () => inlineData.engine });
        inline.registerChannel(channelDouble('inbox').channel);
        const inlineResult = await inline.emit(emit);

        const durableData = capturingEngine();
        const durable = new MessagingService({
            logger: silentLogger(),
            outbox: new MemoryNotificationOutbox(1),
            getData: () => durableData.engine,
        });
        durable.registerChannel(channelDouble('inbox').channel);
        const durableResult = await durable.emit(emit);

        const shape = (r: { deliveries: readonly { channel: string; recipient: string; ok: boolean; error?: string }[] }) =>
            r.deliveries
                .map((d) => ({ channel: d.channel, recipient: d.recipient, ok: d.ok, error: d.error }))
                .sort((a, b) => a.recipient.localeCompare(b.recipient));

        expect(shape(durableResult)).toEqual(shape(inlineResult));
        expect(shape(inlineResult)).toEqual([
            { channel: 'nowhere', recipient: 'user_1', ok: false, error: "channel 'nowhere' not registered" },
            { channel: 'nowhere', recipient: 'user_2', ok: false, error: "channel 'nowhere' not registered" },
        ]);
        // `failed` counts them on both paths; neither reports them as enqueued
        // or delivered, so no summary can claim work that never existed.
        expect([durableResult.failed, durableResult.enqueued, durableResult.delivered]).toEqual([2, 0, 0]);
        expect([inlineResult.failed, inlineResult.enqueued, inlineResult.delivered]).toEqual([2, 0, 0]);
    });

    it('says it ONCE per channel per emit, with the volume — not once per recipient', async () => {
        // The durable path is the high-volume one: a 500-recipient audience on
        // one missing channel must not print 500 identical lines. The count is
        // what sizes the misconfiguration, so it is part of the message.
        const warnings: string[] = [];
        const data = capturingEngine();
        const service = new MessagingService({
            logger: { ...silentLogger(), warn: (...a: unknown[]) => warnings.push(String(a[0])) },
            outbox: new MemoryNotificationOutbox(1),
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);

        await service.emit({
            topic: 'deal.won',
            audience: ['user_1', 'user_2', 'user_3', 'user_4'],
            channels: ['inbox', 'email'],
            payload: { title: 'x' },
        });

        const lines = warnings.filter((w) => w.includes("channel 'email' is not registered"));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain('refused 4 delivery row(s)');
        // Absence must be loud AND actionable: the line names the remedy.
        expect(lines[0]).toContain('Register the channel');
    });

    it('refuses every unregistered channel in one emit, independently', async () => {
        const outbox = new MemoryNotificationOutbox(1);
        const data = capturingEngine();
        const warnings: string[] = [];
        const service = new MessagingService({
            logger: { ...silentLogger(), warn: (...a: unknown[]) => warnings.push(String(a[0])) },
            outbox,
            getData: () => data.engine,
        });
        service.registerChannel(channelDouble('inbox').channel);

        const result = await service.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            channels: ['inbox', 'email', 'sms'],
            payload: { title: 'x' },
        });

        expect((await outbox.list()).map((r) => r.channel)).toEqual(['inbox']);
        expect(result.deliveries.filter((d) => !d.ok).map((d) => d.channel).sort()).toEqual(['email', 'sms']);
        expect(warnings.filter((w) => w.includes('is not registered'))).toHaveLength(2);
    });
});
