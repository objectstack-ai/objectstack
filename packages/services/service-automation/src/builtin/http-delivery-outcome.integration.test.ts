// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MessagingService, MemoryHttpOutbox, HttpDispatcher } from '@objectstack/service-messaging';
import type { FetchImpl } from '@objectstack/service-messaging';
import { AutomationEngine } from '../engine.js';
import { registerHttpNodes } from './http-nodes.js';

/**
 * #7882 — the run summary an operator reads must not claim an HTTP callout that
 * `sys_http_delivery` records as dead.
 *
 * Same defect class as #7747/#7875 at the sibling `notify` node, but the seam
 * sits somewhere else. `MessagingService.emit()` had TWO outcomes behind one
 * call (inline P0 fan-out, which really does know the result, and the P1 outbox,
 * which does not), so that fix had to split `EmitResult.delivered` from
 * `enqueued` inside the messaging service before the node could tell them apart.
 * `enqueueHttp()` has no such ambiguity: it returns a row id and nothing else,
 * and the row it writes is unconditionally `pending`. The two-path structure is
 * in the NODE — `durable: true` enqueues, everything else calls `fetch()` inline
 * — and the inline half already reports honestly. So the whole disagreement is
 * one branch of one node.
 *
 * The assertions are on the two DURABLE operator-facing records — the folded run
 * summary and the `sys_http_delivery` row — never on how many times anything was
 * called: the finding IS that those two records contradict each other, so a
 * call-count assertion would pass while the defect stands. The real
 * `MessagingService` + `MemoryHttpOutbox` + `HttpDispatcher` are wired for the
 * same reason a fake would not do: the outcome is decided AFTER the run settles,
 * which is a fact only a real enqueue/dispatch pair can express.
 *
 * On `origin/main` the two durable-mode tests below fail with `acted: 1`.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** Wire the `http` node against a given messaging service. */
function engineWith(messaging?: MessagingService): AutomationEngine {
    const engine = new AutomationEngine(silentLogger());
    registerHttpNodes(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as any);
    return engine;
}

/**
 * A stack booted the way a durable flow callout runs in production: messaging
 * present with the HTTP outbox wired (ADR-0018 M3), and a dispatcher that is
 * ticked manually so "before dispatch" and "after dispatch" are distinguishable.
 */
function bootOutboxStack(fetchImpl: FetchImpl) {
    const outbox = new MemoryHttpOutbox();
    const messaging = new MessagingService({ logger: silentLogger() });
    messaging.setHttpOutbox(outbox);

    const dispatcher = new HttpDispatcher({
        nodeId: 'node-test',
        outbox,
        partitionCount: 1,
        intervalMs: 10_000, // ticks are driven manually
        fetchImpl,
        logger: silentLogger(),
    });

    return { outbox, messaging, dispatcher, engine: engineWith(messaging) };
}

/** A fetch double for the DISPATCHER (not the node) returning one fixed status. */
function respondWith(status: number): FetchImpl {
    return (async () => ({ ok: status >= 200 && status < 300, status, async text() { return ''; } })) as FetchImpl;
}

function httpFlow(config: Record<string, unknown>) {
    return {
        name: 'callout',
        label: 'Callout',
        type: 'autolaunched' as const,
        nodes: [
            { id: 'start', type: 'start' as const, label: 'Start' },
            { id: 'http', type: 'http' as const, label: 'HTTP', config },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'http' },
            { id: 'e2', source: 'http', target: 'end' },
        ],
    };
}

describe('http run summary vs. the durable sys_http_delivery record (#7882)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('does not report a countable act for a durable delivery that dead-letters', async () => {
        // A 404 is non-retriable, so the dispatcher dead-letters on the first
        // attempt — the terminal disagreement the finding describes.
        const { outbox, dispatcher, engine } = bootOutboxStack(respondWith(404));
        engine.registerFlow('callout', httpFlow({ url: 'https://example.test/hook', durable: true, body: { a: 1 } }));

        const run = await engine.execute('callout');

        // 1) The durable record: the row dead-letters once the dispatcher runs.
        await dispatcher.tick();
        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe('flow');
        expect(rows[0].status).toBe('dead');
        expect(rows[0].responseCode).toBe(404);

        // 2) The record an operator reads. The run still SUCCEEDS — the flow did
        //    everything it can do synchronously, and blocking a flow on a
        //    downstream callout is exactly what the durable mode exists to
        //    avoid. What must not survive is the claim that the callout LANDED:
        //    `acted` is the count the broken-sweep alert trusts, and the honest
        //    answer when the run settles is "an effect I cannot count yet" —
        //    which the platform already spells `unmeasured`, and which is not
        //    the same as a bare `acted: 0` (that would claim the run did
        //    nothing, and trip the alert on every healthy durable callout).
        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ acted: 0, unmeasured: 1 });

        // The finding itself, as one assertion: the summary must not out-count
        // what the durable record shows actually landed (here: nothing).
        const notDead = rows.filter((r) => r.status !== 'dead').length;
        expect(run.summary!.acted).toBeLessThanOrEqual(notDead);
    });

    it('reports the same uncountable effect for a delivery that later succeeds — the outcome is simply not known yet', async () => {
        // The counterpart that stops the fix from degenerating into
        // "dead-lettered deliveries are special": at the moment the run settles,
        // a perfectly healthy durable callout is equally unsent. What separates
        // the two cases is the outbox row — which is where `unmeasured` points.
        const { outbox, dispatcher, engine } = bootOutboxStack(respondWith(200));
        engine.registerFlow('callout', httpFlow({ url: 'https://example.test/hook', durable: true, body: { a: 1 } }));

        const run = await engine.execute('callout');

        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ acted: 0, unmeasured: 1 });
        // Nothing had been attempted when the run settled…
        expect((await outbox.list())[0].status).toBe('pending');
        expect((await outbox.list())[0].attempts).toBe(0);

        // …and the delivery lands afterwards, on the record that owns the truth.
        await dispatcher.tick();
        expect((await outbox.list())[0].status).toBe('success');
    });

    it('still reports a countable act for the inline mode, whose outcome IS terminal at return time', async () => {
        // The node's other path really does know the answer before it returns,
        // so `acted` stays a measurement there — this narrows what `acted` may
        // claim, it does not blanket every HTTP callout as unmeasurable.
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true, status: 201, async json() { return { created: true }; }, async text() { return ''; },
        })));
        const engine = engineWith();
        engine.registerFlow('callout', httpFlow({ url: 'https://api.test/items', method: 'POST', body: { n: 1 } }));

        const run = await engine.execute('callout');

        expect(run.success).toBe(true);
        expect(run.summary).toMatchObject({ acted: 1, unmeasured: 0 });
    });

    it('an inline GET is a measured zero — it cannot write, so the run is eligible for the broken-sweep alert', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true, status: 200, async json() { return { items: [] }; }, async text() { return ''; },
        })));
        const engine = engineWith();
        engine.registerFlow('callout', httpFlow({ url: 'https://api.test/items', method: 'GET' }));

        const run = await engine.execute('callout');

        expect(run.summary).toMatchObject({ acted: 0, unmeasured: 0 });
    });
});
