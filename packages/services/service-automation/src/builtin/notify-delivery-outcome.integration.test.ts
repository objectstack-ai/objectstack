// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MessagingService,
    MemoryNotificationOutbox,
    NotificationDispatcher,
} from '@objectstack/service-messaging';
import type { MessagingChannel } from '@objectstack/service-messaging';
import { FlowRunSummarySchema } from '@objectstack/spec/automation';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';
import { registerLoopNode } from './loop-node.js';

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

/**
 * A notify step that delivered nothing says so on its own run-history row.
 *
 * The step stays a `success` and the run keeps going: a failing result would
 * abort the run or route it down a `fault` edge, which would change what every
 * flow with a refused channel does. The reason rides on the step's advisory
 * `warnings`, the channel the Runs surface shows, and names the refused channel.
 */
describe('notify step names a refused channel on its run-history row', () => {
    async function notifyStep(engine: AutomationEngine) {
        const runs = await engine.listRuns('nudge');
        expect(runs).toHaveLength(1);
        return runs[0].steps.find((s) => s.nodeId === 'notify')!;
    }

    it('durable path, the only channel unregistered: the step warns and names the channel, and the run still completes', async () => {
        const { engine } = bootOutboxStack([recordingChannel('inbox').channel]);
        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        expect(run.success, 'flow control is unchanged: the run is not aborted').toBe(true);
        const step = await notifyStep(engine);
        expect(step.status).toBe('success');
        expect(step.warnings).toHaveLength(1);
        expect(step.warnings![0]).toContain("'push'");
        expect(run.summary).toMatchObject({ selected: 1, acted: 0, unmeasured: 0 });
    });

    it('inline path, the only channel unregistered: the same warning', async () => {
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.registerChannel(recordingChannel('inbox').channel);
        const engine = engineWith(messaging);
        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        const step = await notifyStep(engine);
        expect(step.status).toBe('success');
        expect(step.warnings).toHaveLength(1);
        expect(step.warnings![0]).toContain("'push'");
    });

    it('CONTROL: a registered channel leaves a clean success step with no warning', async () => {
        const { engine } = bootOutboxStack([recordingChannel('inbox').channel]);
        engine.registerFlow('nudge', notifyFlow(['inbox']));
        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        const step = await notifyStep(engine);
        expect(step.status).toBe('success');
        expect(step.warnings).toBeUndefined();
    });

    it('partial delivery: one channel refused beside one enqueued, the warning names only the refused one', async () => {
        const { engine } = bootOutboxStack([recordingChannel('inbox').channel]);
        engine.registerFlow('nudge', notifyFlow(['inbox', 'push']));
        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        const step = await notifyStep(engine);
        expect(step.status).toBe('success');
        expect(step.warnings).toHaveLength(1);
        expect(step.warnings![0]).toContain("'push'");
        expect(step.warnings![0]).not.toContain("'inbox'");
    });
});

/**
 * The run's own answer names the refused channel too, not only its step.
 *
 * The trigger door serves the engine's result verbatim (`deps.success(result)`
 * in the runtime's automation domain), so `run.summary` below IS the `summary`
 * a `POST /automation/:name/trigger` caller reads. The notify row in
 * `summary.nodes[]` used to be a plain `success` with `acted: 0` and no reason:
 * a caller reading the summary could not tell "nothing to send" from "the only
 * channel was refused". The row now carries the step's advisory `warnings`, in
 * the step's own shape (a list of strings), and the run still completes: flow
 * control is unchanged.
 *
 * Each case parses the summary through the spec's `FlowRunSummarySchema`, the
 * schema a client validates the response with: an undeclared member is stripped
 * there, so a warning the contract does not declare would not reach the caller.
 */
describe('the trigger response summary row of a notify step carries its refused-channel warning', () => {
    function notifyRow(run: { summary?: unknown }) {
        const summary = FlowRunSummarySchema.parse(run.summary);
        const row = summary.nodes.find((n) => n.nodeId === 'notify');
        expect(row, 'the notify node has a summary row').toBeDefined();
        return row!;
    }

    it('durable path, the only channel unregistered: the row warns, names the channel, and equals the step warning', async () => {
        const { engine } = bootOutboxStack([recordingChannel('inbox').channel]);
        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        expect(run.success, 'flow control is unchanged: the run is not aborted').toBe(true);
        const row = notifyRow(run);
        expect(row).toMatchObject({ status: 'success', runs: 1, acted: 0 });
        expect(row.warnings).toHaveLength(1);
        expect(row.warnings![0]).toContain("'push'");
        const [history] = await engine.listRuns('nudge');
        const step = history.steps.find((s) => s.nodeId === 'notify')!;
        expect(row.warnings, 'the row carries the step warning verbatim').toEqual(step.warnings);
    });

    it('inline path, the only channel unregistered: the same warning on the row', async () => {
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.registerChannel(recordingChannel('inbox').channel);
        const engine = engineWith(messaging);
        engine.registerFlow('nudge', notifyFlow(['push']));
        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        const row = notifyRow(run);
        expect(row.warnings).toHaveLength(1);
        expect(row.warnings![0]).toContain("'push'");
    });

    it('partial delivery: the row names only the refused channel', async () => {
        const { engine } = bootOutboxStack([recordingChannel('inbox').channel]);
        engine.registerFlow('nudge', notifyFlow(['inbox', 'push']));
        const run = await engine.execute('nudge');

        const row = notifyRow(run);
        expect(row.warnings).toHaveLength(1);
        expect(row.warnings![0]).toContain("'push'");
        expect(row.warnings![0]).not.toContain("'inbox'");
    });

    it('CONTROL: a registered channel leaves the row with no warnings member at all', async () => {
        const { engine } = bootOutboxStack([recordingChannel('inbox').channel]);
        engine.registerFlow('nudge', notifyFlow(['inbox']));
        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        const row = notifyRow(run);
        expect(row.status).toBe('success');
        expect('warnings' in row, 'absent, never an empty list').toBe(false);
    });
});

/**
 * A `notify` in a loop whose fan-out varies per iteration raises ONE warning
 * text per cause, so the summary row's distinct-text fold reads it as one
 * entry. The text used to carry the per-execution delivery count, so three
 * iterations with one, two and three recipients produced three texts for one
 * refused channel and filled the row's capped list with near-duplicates. The
 * counts stay on each execution's own node output (`failed`, `delivered`,
 * `enqueued`).
 */
describe('a looped notify whose fan-out varies folds into one summary warning', () => {
    function loopedNotifyFlow() {
        return {
            name: 'nudge',
            label: 'Nudge',
            type: 'autolaunched' as const,
            variables: [{ name: 'rows', type: 'list' as const, isInput: true }],
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                {
                    id: 'each',
                    type: 'loop' as const,
                    label: 'For each row',
                    config: {
                        collection: { dialect: 'cel', source: 'rows' },
                        iteratorVariable: 'row',
                        body: {
                            nodes: [{
                                id: 'notify',
                                type: 'notify',
                                label: 'Notify',
                                config: {
                                    recipients: [{ dialect: 'cel', source: 'row' }],
                                    title: 'Renewal due',
                                    message: 'Ping',
                                    channels: ['push'],
                                },
                            }],
                            edges: [],
                        },
                    },
                },
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'each' },
                { id: 'e2', source: 'each', target: 'end' },
            ],
        };
    }

    it('three iterations with 1, 2 and 3 refused deliveries: one text on every step, one entry on the row', async () => {
        const messaging = new MessagingService({ logger: silentLogger() });
        messaging.registerChannel(recordingChannel('inbox').channel);
        const engine = engineWith(messaging);
        registerLoopNode(engine, { logger: silentLogger(), getService: () => undefined } as any);
        // Records each emit's own failed count: the control that the fan-out
        // really did vary from one iteration to the next.
        const failedPerEmit: number[] = [];
        const emit = messaging.emit.bind(messaging);
        messaging.emit = (async (...args: Parameters<typeof emit>) => {
            const result = await emit(...args);
            failedPerEmit.push(result.failed);
            return result;
        }) as typeof messaging.emit;
        engine.registerFlow('nudge', loopedNotifyFlow() as never);

        const run = await engine.execute('nudge', {
            params: { rows: [['user_1'], ['user_1', 'user_2'], ['user_1', 'user_2', 'user_3']] },
        });
        expect(run.success).toBe(true);

        const [history] = await engine.listRuns('nudge');
        const steps = history.steps.filter((s) => s.nodeId === 'notify');
        expect(steps).toHaveLength(3);
        expect(failedPerEmit, 'the fan-out varied: 1, 2 and 3 refused deliveries').toEqual([1, 2, 3]);
        expect(new Set(steps.map((s) => s.warnings?.[0])).size, 'one text for one cause').toBe(1);

        const summary = FlowRunSummarySchema.parse(run.summary);
        const row = summary.nodes.find((n) => n.nodeId === 'notify')!;
        expect(row).toMatchObject({ runs: 3, status: 'success' });
        expect(row.warnings).toEqual([steps[0].warnings![0]]);
        expect(row.warnings![0]).toContain("'push'");
    });
});
