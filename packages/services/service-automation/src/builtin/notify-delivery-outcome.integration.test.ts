// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MessagingService,
    MemoryNotificationOutbox,
    NotificationDispatcher,
} from '@objectstack/service-messaging';
import type { MessagingChannel } from '@objectstack/service-messaging';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';

/**
 * #7747 — the run summary an operator reads must not claim a delivery that
 * `sys_notification_delivery` records as dead.
 *
 * The QA repro verbatim: boot WITHOUT the `push` channel registered, fire a
 * flow whose notify node targets `['push']`, then read the run summary and the
 * delivery record. This wires the REAL `MessagingService` (outbox-backed, P1)
 * and the REAL `NotificationDispatcher` behind the notify node rather than a
 * fake, because the defect lives in the seam BETWEEN them: `emit()` returns
 * once the row is enqueued and the dispatcher decides the outcome afterwards,
 * so a fake that answers `emit()` in one shot cannot express the disagreement
 * at all.
 *
 * The assertions are deliberately on the two DURABLE operator-facing records —
 * the folded run summary and the outbox row — not on how many times anything
 * was called: the finding is precisely that those two records contradict each
 * other, so an internal call-count assertion would pass while the defect stands.
 *
 * On `origin/main` the first test fails with `acted: 1` — the notify node
 * counts `EmitResult.delivered`, which in outbox mode is an ENQUEUED count.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** A channel that records what it was handed, so a real send is distinguishable. */
function recordingChannel(id: string): { channel: MessagingChannel; sent: unknown[] } {
    const sent: unknown[] = [];
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

/** Wire the notify node against a given messaging service. */
function engineWith(messaging: MessagingService): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    registerNotifyNode(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as any);
    return engine;
}

/**
 * A stack booted the way the repro describes: messaging present and
 * outbox-backed (P1), with only the channels named here registered.
 */
function bootOutboxStack(registered: MessagingChannel[]) {
    const outbox = new MemoryNotificationOutbox(1);
    const messaging = new MessagingService({ logger: silentLogger(), outbox });
    for (const c of registered) messaging.registerChannel(c);

    const dispatcher = new NotificationDispatcher({
        nodeId: 'node-test',
        outbox,
        channels: messaging,
        channelContext: { logger: silentLogger() },
        partitionCount: 1,
        intervalMs: 10_000, // ticks are driven manually
    });

    return { outbox, messaging, dispatcher, engine: engineWith(messaging) };
}

function notifyFlow(channels: string[]) {
    return {
        name: 'nudge',
        label: 'Nudge',
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            {
                id: 'notify',
                type: 'notify' as const,
                label: 'Notify',
                config: { recipients: ['user_1'], title: 'Renewal due', message: 'Ping', channels },
            },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
    };
}

describe('notify run summary vs. the durable delivery record (#7747)', () => {
    it('does not report a countable act for a delivery that dead-letters on an unregistered channel', async () => {
        // 1) Boot without the `push` channel registered.
        const { outbox, dispatcher, engine } = bootOutboxStack([recordingChannel('inbox').channel]);

        // 2) Fire a flow whose notify node targets ['push'].
        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        // 3a) The durable record: the dispatcher dead-letters the row, because
        //     no transport for `push` exists.
        await dispatcher.tick();
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].channel).toBe('push');
        expect(rows[0].status).toBe('dead');
        expect(rows[0].error).toContain("channel 'push' not registered");

        // 3b) The record an operator reads. The run still SUCCEEDS — the flow
        //     did everything it can do synchronously, and failing it would make
        //     a channel that registers a moment later retroactively break the
        //     flow. What must not survive is the claim that it DELIVERED:
        //     `acted` is the count the broken-sweep alert trusts, and the honest
        //     answer at the moment the run settles is "an effect I cannot count
        //     yet" — which the platform already spells `unmeasured`, and which
        //     is not the same as `acted: 0` alone (that would claim the run did
        //     nothing, and trip the alert on every healthy notify).
        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ acted: 0, unmeasured: 1 });

        // The finding itself, as one assertion: the summary must not out-count
        // what the durable record shows was actually delivered (here: nothing).
        const notDead = rows.filter((r) => r.status !== 'dead').length;
        expect(run.summary!.acted).toBeLessThanOrEqual(notDead);
    });

    it('reports the same uncountable effect for a channel that IS registered — the outcome is simply not known yet', async () => {
        // The counterpart that stops the fix from degenerating into "unregistered
        // channels are special": at the moment the run settles, a healthy
        // outbox-backed delivery is equally unsent. What separates the two cases
        // is the outbox row — which is exactly where `unmeasured` points.
        const inbox = recordingChannel('inbox');
        const { outbox, dispatcher, engine } = bootOutboxStack([inbox.channel]);

        engine.registerFlow('nudge', notifyFlow(['inbox']));
        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ acted: 0, unmeasured: 1 });
        // Nothing had been sent when the run settled…
        expect(inbox.sent).toHaveLength(0);
        // …and the delivery lands afterwards, on the record that owns the truth.
        await dispatcher.tick();
        expect(inbox.sent).toHaveLength(1);
        expect((await outbox.list())[0].status).toBe('success');
    });

    it('still reports a countable act when the messaging stack delivers inline (no outbox)', async () => {
        // The inline (P0) path really does know the outcome by the time `emit()`
        // returns, so `acted` stays a measurement there — the fix narrows what
        // `acted` may claim, it does not blanket every notify as unmeasurable.
        const inbox = recordingChannel('inbox');
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.registerChannel(inbox.channel);
        const engine = engineWith(messaging);

        engine.registerFlow('nudge', notifyFlow(['inbox']));
        const run = await engine.execute('nudge');

        expect(inbox.sent).toHaveLength(1);
        expect(run.summary).toMatchObject({ acted: 1, unmeasured: 0 });
    });

    it('an inline send to an unregistered channel is a measured zero, not an unmeasured shrug', async () => {
        // Inline fan-out DOES observe "channel not registered" synchronously, so
        // that run is correctly eligible for the broken-sweep alert.
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.registerChannel(recordingChannel('inbox').channel);
        const engine = engineWith(messaging);

        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        expect(run.summary).toMatchObject({ acted: 0, unmeasured: 0 });
    });
});
