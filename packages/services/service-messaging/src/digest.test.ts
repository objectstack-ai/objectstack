// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import { NotificationDispatcher } from './dispatcher.js';
import { renderDigest } from './digest-render.js';
import type { NotificationDeliveryRecord } from './outbox.js';
import type { MessagingChannel, Notification } from './channel.js';

function row(over: Partial<NotificationDeliveryRecord>): NotificationDeliveryRecord {
    return {
        id: 'd', notificationId: 'n', recipientId: 'u1', channel: 'inbox',
        payload: {}, partitionKey: 0, status: 'pending', attempts: 0,
        createdAt: 0, updatedAt: 0, ...over,
    };
}

describe('renderDigest (P3b-2)', () => {
    it('collapses a group into one message with a per-item list', () => {
        const out = renderDigest([
            row({ notificationId: 'a', payload: { title: 'Task A assigned', body: 'do A' }, topic: 'task.assigned' }),
            row({ notificationId: 'b', payload: { title: 'Task B assigned' }, topic: 'task.assigned' }),
            row({ notificationId: 'c', payload: { title: 'Mentioned in C' }, topic: 'mention' }),
        ]);
        expect(out.count).toBe(3);
        expect(out.title).toBe('You have 3 notifications');
        expect(out.body).toBe('• Task A assigned\n• Task B assigned\n• Mentioned in C');
        expect(out.items.map((i) => i.notificationId)).toEqual(['a', 'b', 'c']);
        expect(out.severity).toBe('info');
    });

    it('uses the single item’s title when the window holds one notification', () => {
        const out = renderDigest([row({ payload: { title: 'Just one' } })]);
        expect(out.count).toBe(1);
        expect(out.title).toBe('Just one');
    });

    it('falls back to the topic when an item has no title', () => {
        const out = renderDigest([row({ payload: {}, topic: 'system.alert' })]);
        expect(out.items[0].title).toBe('system.alert');
    });
});

describe('MemoryNotificationOutbox — digest claim separation', () => {
    it('claim() skips batched rows; claimDigest() returns only them', async () => {
        const outbox = new MemoryNotificationOutbox(1, () => 1000);
        await outbox.enqueue({ notificationId: 'imm', recipientId: 'u1', channel: 'inbox', payload: {} });
        await outbox.enqueue({ notificationId: 'g1', recipientId: 'u1', channel: 'inbox', payload: {}, digestKey: 'u1|inbox|w', notBefore: 500 });

        const normal = await outbox.claim({ nodeId: 'n', limit: 10, claimTtlMs: 1000 });
        expect(normal.map((r) => r.notificationId)).toEqual(['imm']);

        const digest = await outbox.claimDigest({ nodeId: 'n', limit: 10, claimTtlMs: 1000 });
        expect(digest.map((r) => r.notificationId)).toEqual(['g1']);
    });

    it('claimDigest() defers a batched row until its window opens', async () => {
        let now = 100;
        const outbox = new MemoryNotificationOutbox(1, () => now);
        await outbox.enqueue({ notificationId: 'g', recipientId: 'u1', channel: 'inbox', payload: {}, digestKey: 'u1|inbox|w', notBefore: 1000 });
        expect(await outbox.claimDigest({ nodeId: 'n', limit: 10, claimTtlMs: 1000 })).toHaveLength(0);
        now = 1000;
        expect(await outbox.claimDigest({ nodeId: 'n', limit: 10, claimTtlMs: 1000 })).toHaveLength(1);
    });
});

/** A channel that records every notification it is asked to send. */
function recordingChannel(id: string): { channel: MessagingChannel; sent: Notification[] } {
    const sent: Notification[] = [];
    const channel: MessagingChannel = {
        id,
        async send(_ctx, req) { sent.push(req.notification); return { ok: true }; },
        classifyError: () => 'retryable',
    };
    return { channel, sent };
}

function dispatcher(outbox: MemoryNotificationOutbox, channels: MessagingChannel[], now: () => number) {
    return new NotificationDispatcher({
        nodeId: 'node-test',
        outbox,
        channels: { getChannel: (cid: string) => channels.find((c) => c.id === cid) },
        channelContext: { logger: { info() {}, warn() {}, error() {} } },
        rng: () => 0.5,
        now,
        partitionCount: 1,
        intervalMs: 10_000,
    });
}

describe('NotificationDispatcher — digest collapse (P3b-2)', () => {
    it('collapses a window into one message at window time and sends normal rows immediately', async () => {
        let now = Date.UTC(2026, 0, 1, 9, 0);
        const windowAt = Date.UTC(2026, 0, 2, 0, 0);
        const outbox = new MemoryNotificationOutbox(1, () => now);
        const key = 'u1|inbox|2026-01-01';
        for (let i = 0; i < 3; i++) {
            await outbox.enqueue({ notificationId: `n${i}`, recipientId: 'u1', channel: 'inbox', payload: { title: `Item ${i}` }, digestKey: key, notBefore: windowAt });
        }
        await outbox.enqueue({ notificationId: 'imm', recipientId: 'u1', channel: 'inbox', payload: { title: 'Immediate' } });

        const rec = recordingChannel('inbox');
        const d = dispatcher(outbox, [rec.channel], () => now);

        // Before the window: only the immediate row sends; the batch waits.
        await d.tick();
        expect(rec.sent.map((n) => n.title)).toEqual(['Immediate']);

        // At the window: the 3 batched rows collapse into one message.
        now = windowAt;
        await d.tick();
        expect(rec.sent).toHaveLength(2);
        const digest = rec.sent[1];
        expect(digest.title).toBe('You have 3 notifications');
        expect(digest.payload?.digest).toBe(true);
        expect(digest.payload?.count).toBe(3);

        // All three batched rows are acked success by the single send.
        const success = await outbox.list({ status: 'success' });
        expect(success.filter((r) => r.digestKey === key)).toHaveLength(3);
    });

    it('re-defers the whole group when the digest send fails', async () => {
        let now = 1000;
        const outbox = new MemoryNotificationOutbox(1, () => now);
        const key = 'u1|inbox|w';
        for (let i = 0; i < 2; i++) {
            await outbox.enqueue({ notificationId: `n${i}`, recipientId: 'u1', channel: 'inbox', payload: { title: `Item ${i}` }, digestKey: key, notBefore: 1000 });
        }
        const failing: MessagingChannel = { id: 'inbox', async send() { return { ok: false, error: 'boom' }; }, classifyError: () => 'retryable' };
        const d = dispatcher(outbox, [failing], () => now);

        await d.tick();
        // Both rows go back to pending with a future next_attempt_at (retry), not success.
        const pending = await outbox.list({ status: 'pending' });
        expect(pending.filter((r) => r.digestKey === key)).toHaveLength(2);
        expect(pending.every((r) => (r.nextAttemptAt ?? 0) > now)).toBe(true);
    });
});

/**
 * #16974 — the dispatcher's leg of the actor's journey, with its own control.
 *
 * `processRow` reads the actor back off the delivery row's snapshot;
 * `processDigestGroup` deliberately does NOT, because a collapsed group has no
 * single actor and "you caused this" must not be asserted of a message that
 * also carries other people's events. Both halves are pinned in one test on
 * purpose: an absence is only evidence when the same tick shows the presence.
 */
describe('NotificationDispatcher — actor read-back (#16974)', () => {
    it('restores the actor on an immediate row and leaves a digest group without one', async () => {
        let now = Date.UTC(2026, 0, 1, 9, 0);
        const windowAt = Date.UTC(2026, 0, 2, 0, 0);
        const outbox = new MemoryNotificationOutbox(1, () => now);
        const key = 'u1|inbox|2026-01-01';
        for (let i = 0; i < 2; i++) {
            await outbox.enqueue({
                notificationId: `n${i}`, recipientId: 'u1', channel: 'inbox',
                payload: { title: `Item ${i}`, actorId: `user_${i}` },
                digestKey: key, notBefore: windowAt,
            });
        }
        await outbox.enqueue({
            notificationId: 'imm', recipientId: 'u1', channel: 'inbox',
            payload: { title: 'Immediate', actorId: 'user_9' },
        });

        const rec = recordingChannel('inbox');
        const d = dispatcher(outbox, [rec.channel], () => now);

        // CONTROL — the immediate row's actor survives the outbox round trip.
        await d.tick();
        expect(rec.sent.map((n) => n.title)).toEqual(['Immediate']);
        expect(rec.sent[0].actorId).toBe('user_9');

        // SUBJECT — the collapsed group carries no actor, though every row in
        // it has one. Null by construction, not by a missing snapshot.
        now = windowAt;
        await d.tick();
        const digest = rec.sent[1];
        expect(digest.title).toBe('You have 2 notifications');
        expect(digest.actorId).toBeUndefined();
    });

    it('ignores a non-string actor on the snapshot rather than passing it through', async () => {
        const now = () => 1000;
        const outbox = new MemoryNotificationOutbox(1, now);
        await outbox.enqueue({
            notificationId: 'n', recipientId: 'u1', channel: 'inbox',
            // A payload is a stored JSON column: a legacy or hand-edited row can
            // hold anything. The seam is typed `string | undefined`, so a
            // non-string must not reach it (and `actor_id` then materializes null).
            payload: { title: 'T', actorId: 42 as unknown as string },
        });

        const rec = recordingChannel('inbox');
        await dispatcher(outbox, [rec.channel], now).tick();

        expect(rec.sent).toHaveLength(1);
        expect(rec.sent[0].actorId).toBeUndefined();
    });
});
