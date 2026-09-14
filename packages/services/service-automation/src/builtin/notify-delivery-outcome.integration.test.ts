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
 * At the time #7747 landed, the first test failed with `acted: 1` — the notify
 * node counted `EmitResult.delivered`, which in outbox mode is an ENQUEUED count.
 *
 * ## Amended by #18050 — the first case's durable record is now EMPTY
 *
 * #7747's repro boots without `push` registered, and back then the durable
 * fan-out enqueued a row for it anyway that the dispatcher could only
 * dead-letter. #18050 fixed that at the producer: `enqueueDeliveries` refuses an
 * unregistered channel before it writes, reporting the same failed
 * `DeliveryOutcome` the inline path always did. So the first test's scenario
 * moved buckets — from "an effect I cannot count YET" (`unmeasured: 1`, the
 * dispatcher decides later) to "an effect I have counted and it is zero"
 * (`acted: 0, unmeasured: 0`, refused synchronously).
 *
 * ⛔ That is not this file's invariant weakening. #7747's invariant is "the
 * summary must not out-count what the durable record shows was delivered", and
 * it is asserted below against a bound that went from 0-non-dead-rows to
 * 0-rows-at-all. What changed is the producer, not what is demanded of it.
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
    it('reports a MEASURED zero — not a countable act — for an unregistered channel on the durable path', async () => {
        // 1) Boot without the `push` channel registered.
        const { outbox, dispatcher, engine } = bootOutboxStack([recordingChannel('inbox').channel]);

        // 2) Fire a flow whose notify node targets ['push'].
        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        // 3a) The durable record: NOTHING — and that is the #18050 change.
        //     This assertion used to read `toHaveLength(1)` + `status: 'dead'`:
        //     the durable fan-out enqueued a row for a channel with no transport
        //     and the dispatcher dead-lettered it on attempt ONE. That row was
        //     itself the defect #18050 fixed, so `enqueueDeliveries` now refuses
        //     the channel up front and writes no row at all. The tick is kept
        //     deliberately: it proves nothing APPEARS later either, which is a
        //     strictly stronger statement than the old "a row exists and is dead".
        await dispatcher.tick();
        const rows = await outbox.list();
        expect(rows).toHaveLength(0);

        // 3b) The record an operator reads. The run still SUCCEEDS — the flow
        //     did everything it can do synchronously. What must not survive is
        //     the claim that it DELIVERED.
        //
        //     ⚠️ `unmeasured` moved 1 -> 0 here, and that is the POINT, not a
        //     relaxation. `unmeasuredEffect` means "the count is unknown because
        //     the dispatcher decides later". Since #18050 there is no later: the
        //     refusal is synchronous, so the count is KNOWN and it is zero —
        //     exactly the reading `notify-node.ts` demands ("this count is known
        //     and it is zero; claiming otherwise would take the run OUT of the
        //     broken-sweep filter ... on precisely the run that should be inside
        //     it"). `selected: 1, acted: 0, unmeasured: 0` puts this run INSIDE
        //     the `selected > 0 AND acted = 0 AND unmeasured = 0` alert, which is
        //     where a notify that reached nobody and never will belongs.
        //
        //     It is also what makes the two fan-out paths agree: the inline case
        //     four tests down asserts this same triple and calls it "correctly
        //     eligible for the broken-sweep alert". The durable path is not a
        //     duplicate of it — it is the other side of the seam this file
        //     exists for, and it is the side that used to disagree.
        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ selected: 1, acted: 0, unmeasured: 0 });

        // The #7747 finding itself, unchanged in force: the summary must not
        // out-count what the durable record shows was actually delivered. With
        // no row at all the bound is 0, so this is tighter than it was before.
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
