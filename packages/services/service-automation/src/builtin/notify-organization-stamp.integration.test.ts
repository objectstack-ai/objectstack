// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MessagingService,
    MemoryNotificationOutbox,
    createInboxChannel,
    INBOX_OBJECT,
    RECEIPT_OBJECT,
    NOTIFICATION_EVENT_OBJECT,
} from '@objectstack/service-messaging';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';
import type { MessagingServiceSurface } from './notify-node.js';

/**
 * [#11303] The `notify` node is the producer that decides whether the whole
 * notification family carries an organization.
 *
 * Maintainer ruling, 2026-08-24, verbatim: 「11303
 * sys_inbox_message/sys_notification/sys_email 应该写 organization_id。」 — a
 * GAP, not a design choice.
 *
 * The measurement that shapes these pins: the messaging chain BELOW `emit()`
 * already threads an organization end to end — `writeEvent` stamps
 * `organization_id` on `sys_notification`, the inbox channel stamps it on
 * `sys_inbox_message` AND on the `delivered` receipt, and the outbox carries it
 * onto the `sys_notification_delivery` row. Every one of those reads
 * `notification.organizationId`, which is `EmitInput.organizationId`. The break
 * is at the ORIGIN: the `notify` node never passes it, so a flow-produced
 * notification lands org-less in four tables at once — which is exactly the
 * 100%-null reading the card reports for all four.
 *
 * ⭐ The organization is THREADED from the run's own acting context
 * (`AutomationContext.tenantId`), never fabricated. There is deliberately no
 * "first organization" / "the current organization" fallback: a wrong
 * `organization_id` is worse than a null, because a null is visibly missing
 * while a wrong value is silently authoritative to every report, export and
 * cleanup script that filters by organization.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** A logger that records every warning line, for the fail-loud pin. */
function recordingLogger(): { logger: any; warnings: string[] } {
    const warnings: string[] = [];
    const l: any = {
        info: () => {},
        warn: (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); },
        error: () => {},
        debug: () => {},
    };
    l.child = () => l;
    return { logger: l, warnings };
}

/** Every row this stack wrote, in insertion order, with the object it landed in. */
interface WrittenRow { object: string; row: Record<string, unknown> }

/**
 * A capturing data engine. Reads answer empty (no preference rows, no dedup
 * hit) so the default always-on `inbox` channel is the one that runs; writes
 * are recorded verbatim, which is the only thing these pins assert on.
 */
function capturingEngine(): { engine: any; written: WrittenRow[] } {
    const written: WrittenRow[] = [];
    let seq = 0;
    const engine = {
        async insert(object: string, row: Record<string, unknown>) {
            written.push({ object, row: { ...row } });
            const id = row.id != null ? String(row.id) : `row_${++seq}`;
            return { ...row, id };
        },
        async find() { return []; },
        async findOne() { return undefined; },
    };
    return { engine, written };
}

/** The four tables the ruling names for the notification family. */
const NOTIFICATION_FAMILY = new Set<string>([
    NOTIFICATION_EVENT_OBJECT,
    INBOX_OBJECT,
    RECEIPT_OBJECT,
]);

/**
 * The identity list this suite asserts on — `object:organization_id` per row,
 * in write order. ⭐ Identities, not a count: an offsetting error (one row
 * gaining an organization while another loses it) holds a count constant while
 * the identity list inverts.
 */
function orgIdentities(written: WrittenRow[]): string[] {
    return written
        .filter((w) => NOTIFICATION_FAMILY.has(w.object))
        .map((w) => `${w.object}:${w.row.organization_id ?? 'NULL'}`);
}

function notifyFlow(): any {
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
                config: {
                    topic: 'deal.won',
                    recipients: ['user_1'],
                    title: 'Renewal due',
                    message: 'Ping',
                    channels: ['inbox'],
                },
            },
            { id: 'end', type: 'end' as const, label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
    };
}

/**
 * The REAL messaging service with the REAL inbox channel behind the notify
 * node — the seam under test is precisely the handoff between them, so a fake
 * that answers `emit()` in one shot could not express it.
 */
function bootInlineStack(logger: any = silentLogger()) {
    const { engine: data, written } = capturingEngine();
    const messaging = new MessagingService({ logger, getData: () => data });
    messaging.registerChannel(createInboxChannel({ getData: () => data }));

    const engine = new AutomationEngine(logger);
    registerNotifyNode(engine, {
        logger,
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as any);
    engine.registerFlow('nudge', notifyFlow());
    return { engine, messaging, written };
}

describe('#11303 — the notify producer stamps organization_id on the notification family', () => {
    it('PIN A: threads the run\'s own organization onto the emit input', async () => {
        const emitted: any[] = [];
        const service: MessagingServiceSurface = {
            async emit(n: any) {
                emitted.push(n);
                return { notificationId: 'evt_1', delivered: n.audience.length, failed: 0 };
            },
        };
        const engine = new AutomationEngine(silentLogger());
        registerNotifyNode(engine, {
            logger: silentLogger(),
            getService: (name: string) => (name === 'messaging' ? service : undefined),
        } as any);
        engine.registerFlow('nudge', notifyFlow());

        const run = await engine.execute('nudge', { tenantId: 'org_pin_alpha' } as any);

        expect(run.success).toBe(true);
        expect(emitted).toHaveLength(1);
        // The named producer pin: the organization reaching `emit()` is the
        // run's acting tenant, verbatim — not a derived or defaulted value.
        expect(emitted[0].organizationId).toBe('org_pin_alpha');
    });

    it('PIN B: a run under an organization writes ZERO org-less rows into the notification family', async () => {
        const { engine, written } = bootInlineStack();

        const run = await engine.execute('nudge', { tenantId: 'org_pin_alpha' } as any);
        expect(run.success).toBe(true);

        // The end-to-end pin the ruling names, asserted as an IDENTITY list so a
        // producer nobody enumerated cannot hide behind a stable count.
        expect(orgIdentities(written)).toEqual([
            `${NOTIFICATION_EVENT_OBJECT}:org_pin_alpha`,
            `${INBOX_OBJECT}:org_pin_alpha`,
            `${RECEIPT_OBJECT}:org_pin_alpha`,
        ]);
        // Said the second way, so the pin still bites if the write ORDER changes:
        // no row of the family may carry NULL.
        expect(orgIdentities(written).filter((i) => i.endsWith(':NULL'))).toEqual([]);
    });

    it('PIN B2: the durable delivery row carries the same organization', async () => {
        const { engine: data } = capturingEngine();
        const outbox = new MemoryNotificationOutbox(1);
        const messaging = new MessagingService({ logger: silentLogger(), getData: () => data, outbox });
        messaging.registerChannel(createInboxChannel({ getData: () => data }));
        const engine = new AutomationEngine(silentLogger());
        registerNotifyNode(engine, {
            logger: silentLogger(),
            getService: (name: string) => (name === 'messaging' ? messaging : undefined),
        } as any);
        engine.registerFlow('nudge', notifyFlow());

        const run = await engine.execute('nudge', { tenantId: 'org_pin_alpha' } as any);
        expect(run.success).toBe(true);

        const rows = await outbox.list();
        expect(rows).toHaveLength(1);
        expect(rows[0].organizationId).toBe('org_pin_alpha');
    });

    it('PIN C (over-denial control): a stack with no organization in scope still delivers', async () => {
        // The control that stops the fix from degenerating into "refuse unless
        // an organization is present". A `single`-posture deployment — and every
        // fresh boot before the first organization exists — has no organization
        // to thread, and a notify there must still emit and still write its rows.
        // ⭐ A suite that only pinned "organization_id is present" would score
        // green on an implementation that breaks exactly this deployment.
        const { engine, written } = bootInlineStack();

        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        expect(orgIdentities(written)).toEqual([
            `${NOTIFICATION_EVENT_OBJECT}:NULL`,
            `${INBOX_OBJECT}:NULL`,
            `${RECEIPT_OBJECT}:NULL`,
        ]);
    });

    it('PIN D (fail-loud, not fail-guess): an unresolvable organization warns audibly', async () => {
        // Fail-LOUD by warning rather than refusing — see PIN C for why a
        // refusal is not available here. The warning is what makes the org-less
        // row a visible event instead of a silent one, and it must name the
        // topic so the operator can find the producer.
        const { logger, warnings } = recordingLogger();
        const { engine } = bootInlineStack(logger);

        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        const line = warnings.find((w) => w.includes('organization'));
        expect(line, `no organization warning in: ${JSON.stringify(warnings)}`).toBeDefined();
        expect(line).toContain('deal.won');
    });
});
