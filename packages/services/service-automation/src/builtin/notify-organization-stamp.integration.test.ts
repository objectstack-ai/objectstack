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
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

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
 *
 * [#23284] A run that carries NO organization — a schedule tick, a record
 * change a system context wrote — takes the organization of the record the
 * notification is about: the declared click-through record, else the run's
 * trigger record, each read back from the STORED row (PIN E–H). Measured on
 * HotCRM at 18.0.0-next.0, every such emit landed `sys_notification` with
 * `organization_id` NULL. A notification about no record, from such a run,
 * reaches `emit()` with no organization and the engine decides its owner
 * (ADR-0131 D9, now that `sys_notification` is admitted): that half is pinned
 * where the rule lives — `tenancy-by-object-classification.test.ts` in
 * `@objectstack/objectql` and `notification-organization-follows-event.integration.test.ts`
 * in `@objectstack/service-messaging`. Here: the node hands it on with no
 * organization (PIN C) and fails the step with the engine's code when the
 * engine refuses it (PIN D).
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** Every row this stack wrote, in insertion order, with the object it landed in. */
interface WrittenRow { object: string; row: Record<string, unknown> }

/** One business record the data engine holds, as it is STORED. */
interface StoredRecord { object: string; row: Record<string, unknown> & { id: string } }

/** One `findOne` the stack issued, verbatim. */
interface ObservedRead { object: string; query: unknown; options: unknown }

/**
 * A capturing data engine. Reads of the notification family answer empty (no
 * preference rows, no dedup hit) so the default always-on `inbox` channel is
 * the one that runs; writes are recorded verbatim, which is what these pins
 * assert on.
 *
 * [#23284] It also holds the business records a notification can be about
 * (`records`), answers `findOne` by id for them, and describes their schema
 * through `getSchema` — the one member the wall-column resolver reads — with
 * the kernel's `organization_id` column, as a registered object carries it.
 * Every `findOne` is recorded, so a pin can say which read happened, and that
 * none did.
 */
function capturingEngine(records: readonly StoredRecord[] = []): { engine: any; written: WrittenRow[]; reads: ObservedRead[] } {
    const written: WrittenRow[] = [];
    const reads: ObservedRead[] = [];
    let seq = 0;
    const engine = {
        async insert(object: string, row: Record<string, unknown>) {
            written.push({ object, row: { ...row } });
            const id = row.id != null ? String(row.id) : `row_${++seq}`;
            return { ...row, id };
        },
        async find() { return []; },
        async findOne(object: string, query?: EngineFindOneQueryInput, options?: unknown) {
            assertEngineFindOnePredicate(object, query);
            reads.push({ object, query, options });
            const id = (query as { where?: { id?: unknown } } | undefined)?.where?.id;
            const hit = records.find((r) => r.object === object && r.row.id === id);
            return hit ? { ...hit.row } : undefined;
        },
        getSchema(object: string) {
            if (!records.some((r) => r.object === object)) return undefined;
            return {
                name: object,
                fields: { name: { type: 'text' }, organization_id: { type: 'lookup', reference: 'sys_organization' } },
            };
        },
    };
    return { engine, written, reads };
}

/** Only the reads a pin is about — the business records, not the family's own lookups. */
function recordReads(reads: readonly ObservedRead[]): ObservedRead[] {
    return reads.filter((r) => !NOTIFICATION_FAMILY.has(r.object));
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

function notifyFlow(about?: { sourceObject: string; sourceId: string }): any {
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
                    ...(about ?? {}),
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
function bootInlineStack(
    logger: any = silentLogger(),
    opts: { records?: readonly StoredRecord[]; about?: { sourceObject: string; sourceId: string } } = {},
) {
    const { engine: data, written, reads } = capturingEngine(opts.records);
    const messaging = new MessagingService({ logger, getData: () => data });
    messaging.registerChannel(createInboxChannel({ getData: () => data }));

    const engine = new AutomationEngine(logger);
    registerNotifyNode(engine, {
        logger,
        getService: (name: string) => (name === 'messaging' ? messaging : name === 'data' ? data : undefined),
    } as any);
    engine.registerFlow('nudge', notifyFlow(opts.about));
    return { engine, messaging, written, reads };
}

/**
 * A notify node over a messaging service that only RECORDS what it is handed
 * (or throws what it is told to), with `data` serving the record reads — for
 * the pins that are about the emit input itself.
 */
function bootRecordingStack(opts: {
    records?: readonly StoredRecord[];
    about?: { sourceObject: string; sourceId: string };
    emitThrows?: unknown;
} = {}) {
    const { engine: data, reads } = capturingEngine(opts.records);
    const emitted: any[] = [];
    const service: MessagingServiceSurface = {
        async emit(n: any) {
            emitted.push(n);
            if (opts.emitThrows !== undefined) throw opts.emitThrows;
            return { notificationId: 'evt_1', delivered: n.audience.length, failed: 0 };
        },
    };
    const engine = new AutomationEngine(silentLogger());
    registerNotifyNode(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? service : name === 'data' ? data : undefined),
    } as any);
    engine.registerFlow('nudge', notifyFlow(opts.about));
    return { engine, emitted, reads };
}

/** The context a schedule tick hands an organization-less flow (`ScheduleTrigger`). */
const SCHEDULE_TICK = {
    event: 'schedule',
    params: { jobId: 'tick-1', flowName: 'nudge', schedule: { type: 'cron', expression: '0 * * * *' } },
    callerParamKeys: [],
} as any;

/** The case a breach notification is about, and the organization it is stored under. */
const CASE = { object: 'crm_case', row: { id: 'case_1', name: 'Breached', organization_id: 'org_case_owner' } };
const ABOUT_CASE = { sourceObject: 'crm_case', sourceId: 'case_1' };

/** The record a system-written record-change run is about. */
const TASK = { object: 'crm_task', row: { id: 'task_1', name: 'Urgent', organization_id: 'org_task_owner' } };

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

    it('PIN C: a notification about no record, from a run with no organization, reaches emit() with none', async () => {
        // [#23284] The owner of what is left is the ENGINE's to decide
        // (ADR-0131 D9): the sole organization under `single`, a refusal where
        // none is derivable — pinned in objectql and service-messaging. What
        // the node owes is to hand it on WITHOUT inventing one: no
        // `organizationId` key at all (absent, not null), and no read, since
        // nothing names a record.
        const { engine, emitted, reads } = bootRecordingStack({ records: [CASE] });

        const run = await engine.execute('nudge', SCHEDULE_TICK);

        expect(run.success).toBe(true);
        expect(emitted).toHaveLength(1);
        expect('organizationId' in emitted[0]).toBe(false);
        expect(recordReads(reads)).toEqual([]);
    });

    it('PIN C2 (over-denial control): an organization-less stack with no engine rule still delivers', async () => {
        // The control that stops the fix from degenerating into "refuse unless
        // an organization is present" inside the NODE: with no rule below it
        // (this capturing engine runs none), an organization-less emit is still
        // emitted and its rows are still written. Refusing is the engine's
        // call, never the node's.
        const { engine, written } = bootInlineStack();

        const run = await engine.execute('nudge');

        expect(run.success).toBe(true);
        expect(orgIdentities(written)).toEqual([
            `${NOTIFICATION_EVENT_OBJECT}:NULL`,
            `${INBOX_OBJECT}:NULL`,
            `${RECEIPT_OBJECT}:NULL`,
        ]);
    });

    it('PIN D: the engine refusing an owner-less notification FAILS the step, naming the engine code', async () => {
        // [#23284] Where ADR-0131 D9 derives no owner the engine refuses the
        // `sys_notification` insert with `ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED`
        // (500). The node must not swallow that into a logged success: the
        // step fails and its failure text carries the code an operator greps.
        const refusal = Object.assign(
            new Error("Insert on 'sys_notification' was REFUSED: a system-context write on a tenant-scoped object must carry an organization"),
            { code: 'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED', status: 500 },
        );
        const { engine, emitted } = bootRecordingStack({ emitThrows: refusal });

        const run = await engine.execute('nudge', SCHEDULE_TICK);

        expect(emitted).toHaveLength(1);
        expect(run.success).toBe(false);
        expect(run.error).toContain('notify failed: ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED: ');
        expect(run.error).toContain("Insert on 'sys_notification' was REFUSED");
    });
});

describe('#23284 — a run with no organization takes the organization of the record the notification is about', () => {
    it('PIN E: a schedule-tick notify about a record stores THAT record\'s organization on all four row kinds', async () => {
        // Inline fan-out: the event, the inbox row, the delivered receipt.
        const inline = bootInlineStack(silentLogger(), { records: [CASE], about: ABOUT_CASE });
        const run = await inline.engine.execute('nudge', SCHEDULE_TICK);
        expect(run.success).toBe(true);
        expect(orgIdentities(inline.written)).toEqual([
            `${NOTIFICATION_EVENT_OBJECT}:org_case_owner`,
            `${INBOX_OBJECT}:org_case_owner`,
            `${RECEIPT_OBJECT}:org_case_owner`,
        ]);
        // The organization is read off the STORED row, by id, elevated — the
        // one read the node issues, projecting only the wall column.
        expect(recordReads(inline.reads)).toEqual([{
            object: 'crm_case',
            query: { where: { id: 'case_1' }, fields: ['id', 'organization_id'] },
            options: { context: { isSystem: true } },
        }]);

        // Durable path: the delivery row.
        const { engine: data } = capturingEngine([CASE]);
        const outbox = new MemoryNotificationOutbox(1);
        const messaging = new MessagingService({ logger: silentLogger(), getData: () => data, outbox });
        messaging.registerChannel(createInboxChannel({ getData: () => data }));
        const durable = new AutomationEngine(silentLogger());
        registerNotifyNode(durable, {
            logger: silentLogger(),
            getService: (name: string) => (name === 'messaging' ? messaging : name === 'data' ? data : undefined),
        } as any);
        durable.registerFlow('nudge', notifyFlow(ABOUT_CASE));
        expect((await durable.execute('nudge', SCHEDULE_TICK)).success).toBe(true);
        const rows = await outbox.list();
        expect(rows.map((r) => r.organizationId)).toEqual(['org_case_owner']);
    });

    it('PIN F: a record change written by a system context takes the TRIGGER record\'s stored organization', async () => {
        // The snapshot the run carries names a different organization on
        // purpose: a trigger door can hand a run a caller-written `record`, so
        // the node reads the stored row and never the snapshot's column.
        const { engine, emitted, reads } = bootRecordingStack({ records: [TASK] });

        const run = await engine.execute('nudge', {
            event: 'on_create',
            object: 'crm_task',
            record: { id: 'task_1', name: 'Urgent', organization_id: 'org_from_the_snapshot' },
        } as any);

        expect(run.success).toBe(true);
        expect(emitted.map((e) => e.organizationId)).toEqual(['org_task_owner']);
        expect(recordReads(reads).map((r) => r.object)).toEqual(['crm_task']);
    });

    it('PIN G: the declared click-through record is asked BEFORE the trigger record', async () => {
        const { engine, emitted, reads } = bootRecordingStack({ records: [CASE, TASK], about: ABOUT_CASE });

        const run = await engine.execute('nudge', { event: 'on_create', object: 'crm_task', record: { id: 'task_1' } } as any);

        expect(run.success).toBe(true);
        expect(emitted.map((e) => e.organizationId)).toEqual(['org_case_owner']);
        // The first anchor answered, so the second was never read.
        expect(recordReads(reads).map((r) => r.object)).toEqual(['crm_case']);
    });

    it('PIN H: a record that names no organization falls through to the next anchor, then to none', async () => {
        const orgless = { object: 'crm_case', row: { id: 'case_1', name: 'Unowned', organization_id: null as unknown as string } };
        const { engine, emitted, reads } = bootRecordingStack({ records: [orgless, TASK], about: ABOUT_CASE });

        await engine.execute('nudge', { event: 'on_create', object: 'crm_task', record: { id: 'task_1' } } as any);
        // A schedule tick about a record that is gone: nothing to read, no organization.
        const gone = bootRecordingStack({ records: [], about: ABOUT_CASE });
        await gone.engine.execute('nudge', SCHEDULE_TICK);

        expect(emitted.map((e) => e.organizationId)).toEqual(['org_task_owner']);
        expect(recordReads(reads).map((r) => r.object)).toEqual(['crm_case', 'crm_task']);
        expect(gone.emitted).toHaveLength(1);
        expect('organizationId' in gone.emitted[0]).toBe(false);
    });

    it('PIN I (user-driven, unchanged): a run that carries an organization emits exactly as before, and reads nothing', async () => {
        // The run's organization wins over every record anchor — here the
        // click-through case lives in ANOTHER organization — and the emit input
        // is the very object the node built before this card, key for key.
        const { engine, emitted, reads } = bootRecordingStack({ records: [CASE], about: ABOUT_CASE });

        const run = await engine.execute('nudge', { tenantId: 'org_pin_alpha', userId: 'user_9' } as any);

        expect(run.success).toBe(true);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]).toStrictEqual({
            topic: 'deal.won',
            audience: ['user_1'],
            payload: { title: 'Renewal due', body: 'Ping', url: undefined },
            severity: undefined,
            source: { object: 'crm_case', id: 'case_1' },
            actorId: undefined,
            organizationId: 'org_pin_alpha',
            channels: ['inbox'],
        });
        expect(recordReads(reads)).toEqual([]);
    });
});
