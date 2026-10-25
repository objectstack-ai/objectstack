// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MessagingService,
    MemoryNotificationOutbox,
    NotificationDispatcher,
    NotificationTemplateStore,
    createEmailChannel,
    NOTIFICATION_EVENT_OBJECT,
} from '@objectstack/service-messaging';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { AutomationEngine } from '../engine.js';
import { EMAIL_FIELD_SENDS_PER_WINDOW, registerNotifyNode } from './notify-node.js';

/**
 * [#25571, ruling 6377887204 letter B] A `notify` node mails a person who is
 * not a user through an email-field recipient, `{ emailField }`: the address
 * in an `email`-typed field of the record that triggered the flow, templated,
 * limited per address, and logged. [#25647, ruling 6386629237 letter B] Any
 * other address a value envelope COMPUTES must be a user's.
 *
 * Wired through the REAL `MessagingService` (outbox-backed), the REAL
 * `NotificationDispatcher` and the REAL email channel, over a data engine
 * that stores the business record, the directory and the notification rows:
 * the acceptance is a send visible in the messaging log, so the assertions
 * read the log's two records — the `sys_notification` event and the
 * `sys_notification_delivery` row — and what the email service was handed.
 *
 *  A. The address is read from the STORED record and mailed, with the title
 *     rendered; the event and a `success` delivery row record it.
 *  B. Everything that is not one address in the field fails the node and
 *     sends nothing.
 *  C. No trigger record, a record not stored, an empty field: the node fails,
 *     naming which.
 *  D. At most `EMAIL_FIELD_SENDS_PER_WINDOW` sends per address per window.
 *  E. A computed address no user holds fails the node pointing to
 *     `{ emailField }`; a computed address a user holds resolves to that user;
 *     an address written out in the flow is sent as written.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

interface Row { [key: string]: unknown; id: string }

/** A data engine holding the business records and users, and recording every row the stack writes. */
function dataEngine(opts: { records?: Record<string, Row[]>; users?: Row[] } = {}) {
    const written: Array<{ object: string; row: Record<string, unknown> }> = [];
    let seq = 0;
    const tables: Record<string, Row[]> = { ...(opts.records ?? {}), sys_user: opts.users ?? [] };
    const engine = {
        async insert(object: string, row: Record<string, unknown>) {
            const stored = { ...row, id: row.id != null ? String(row.id) : `row_${++seq}` };
            written.push({ object, row: stored });
            return stored;
        },
        async find() { return []; },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query);
            const where = (query as { where?: Record<string, unknown> } | undefined)?.where ?? {};
            // Equality on plain fields only: a combinator or operator is refused, never read as a field name.
            const hit = (tables[object] ?? []).find((r) => Object.entries(where).every(([k, v]) => {
                if (k.startsWith('$') || (typeof v === 'object' && v !== null)) {
                    throw new Error(`this double matches equality on plain fields only: ${JSON.stringify(where)}`);
                }
                return r[k] === v;
            }));
            return hit ? { ...hit } : undefined;
        },
    };
    return { engine, written };
}

/** The whole stack: messaging + outbox + dispatcher + email channel, and the notify node over them. */
function boot(opts: { records?: Record<string, Row[]>; users?: Row[] } = {}) {
    const { engine: data, written } = dataEngine(opts);
    const mailed: Array<{ to: unknown; subject: string }> = [];
    const outbox = new MemoryNotificationOutbox(1);
    const messaging = new MessagingService({ logger: silentLogger(), outbox, getData: () => data as any });
    messaging.registerChannel(createEmailChannel({
        getEmail: () => ({
            async send(input) {
                mailed.push({ to: input.to, subject: input.subject });
                return { id: `mail_${mailed.length}` };
            },
        }),
        getData: () => data as any,
        store: new NotificationTemplateStore({ getData: () => undefined }),
    }));
    const dispatcher = new NotificationDispatcher({
        nodeId: 'node-test',
        outbox,
        channels: messaging,
        channelContext: { logger: silentLogger() },
        partitionCount: 1,
        intervalMs: 10_000, // ticks are driven manually
    });
    const engine = new AutomationEngine(silentLogger());
    registerNotifyNode(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : name === 'data' ? data : undefined),
    } as any);
    return { engine, outbox, dispatcher, mailed, written };
}

const CEL = (source: string) => ({ dialect: 'cel', source });

function notifyFlow(config: Record<string, unknown>): any {
    return {
        name: 'applicant_notice',
        label: 'Applicant notice',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'notify', type: 'notify', label: 'Notify', config: { title: 'Received: {{ record.name }}', ...config } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
    };
}

const EMAIL_FIELD = { recipients: { emailField: 'applicant_email' }, channels: 'email' };

/** The context a record-change trigger hands a run about `id`. */
function onCreate(id: string, record: Record<string, unknown> = {}): any {
    return { event: 'on_create', object: 'hr_applicant', record: { id, ...record }, tenantId: 'org_1' };
}

async function runOnce(stack: ReturnType<typeof boot>, config: Record<string, unknown>, context: any) {
    stack.engine.registerFlow('applicant_notice', notifyFlow(config));
    const run = await stack.engine.execute('applicant_notice', context);
    const runs = await stack.engine.listRuns('applicant_notice');
    const step = runs[0]?.steps.find((s) => s.nodeId === 'notify');
    return { run, step };
}

const APPLICANT = { id: 'app_1', name: 'Ann', applicant_email: 'ann@applicant.example' };

describe('#25571 — a notify node mails the address in an email field of the trigger record', () => {
    it('A: reads the STORED address, renders the title, and the send is in the messaging log', async () => {
        const stack = boot({ records: { hr_applicant: [APPLICANT] } });
        // The run's snapshot carries a different address: the stored row decides.
        const { run } = await runOnce(stack, EMAIL_FIELD, onCreate('app_1', { name: 'Ann', applicant_email: 'other@elsewhere.example' }));
        expect(run.success).toBe(true);

        const events = stack.written.filter((w) => w.object === NOTIFICATION_EVENT_OBJECT);
        expect(events).toHaveLength(1);
        const [pending] = await stack.outbox.list();
        expect(pending).toMatchObject({ channel: 'email', recipientId: 'ann@applicant.example', status: 'pending' });

        await stack.dispatcher.tick();
        expect(stack.mailed).toEqual([{ to: 'ann@applicant.example', subject: 'Received: Ann' }]);
        const [delivered] = await stack.outbox.list();
        expect(delivered).toMatchObject({ channel: 'email', recipientId: 'ann@applicant.example', status: 'success' });
        expect(delivered.notificationId).toBe(events[0].row.id);
    });

    it.each([
        ['a list', 'ann@applicant.example,bob@applicant.example'],
        ['two addresses separated by a semicolon', 'ann@applicant.example;bob@applicant.example'],
        ['a display name', 'Ann <ann@applicant.example>'],
        ['a comma in the local part', 'ann,bob@applicant.example'],
        ['an audience prefix', 'role:admin@applicant.example'],
        ['a header break', 'ann@applicant.example\r\nBcc: bob@applicant.example'],
        ['no domain dot', 'ann@localhost'],
        ['a number', 42],
    ])('B: fails the node and sends nothing when the field holds %s', async (_label, value) => {
        const stack = boot({ records: { hr_applicant: [{ ...APPLICANT, applicant_email: value }] } });
        const { run, step } = await runOnce(stack, EMAIL_FIELD, onCreate('app_1'));
        expect(run.success).toBe(false);
        expect(step?.error?.message).toContain("`recipients: { emailField: 'applicant_email' }`");
        expect(step?.error?.message).toContain('does not hold one email address');
        expect(step?.error?.message).not.toContain(String(value));
        expect(await stack.outbox.list()).toHaveLength(0);
        expect(stack.written.filter((w) => w.object === NOTIFICATION_EVENT_OBJECT)).toHaveLength(0);
    });

    it.each([
        ['the run has no trigger record', undefined, 'this run has no trigger record'],
        ['the record is not stored', onCreate('app_gone'), "hr_applicant 'app_gone' is not stored"],
        ['the field is empty', onCreate('app_blank'), "`applicant_email` on hr_applicant 'app_blank' is empty"],
    ])('C: fails the node when %s', async (_label, context, expected) => {
        const stack = boot({ records: { hr_applicant: [APPLICANT, { id: 'app_blank', name: 'B', applicant_email: '' }] } });
        const { run, step } = await runOnce(stack, EMAIL_FIELD, context);
        expect(run.success).toBe(false);
        expect(step?.error?.message).toContain(expected as string);
        expect(await stack.outbox.list()).toHaveLength(0);
    });

    it(`D: admits ${EMAIL_FIELD_SENDS_PER_WINDOW} sends to one address per window and refuses the next`, async () => {
        const stack = boot({
            records: {
                hr_applicant: [
                    APPLICANT,
                    { id: 'app_2', name: 'Ann again', applicant_email: 'ANN@Applicant.Example' },
                    { id: 'app_3', name: 'Cid', applicant_email: 'cid@applicant.example' },
                ],
            },
        });
        stack.engine.registerFlow('applicant_notice', notifyFlow(EMAIL_FIELD));
        for (let i = 0; i < EMAIL_FIELD_SENDS_PER_WINDOW; i++) {
            expect((await stack.engine.execute('applicant_notice', onCreate('app_1'))).success).toBe(true);
        }
        // The same mailbox in other case is the same address.
        const refused = await stack.engine.execute('applicant_notice', onCreate('app_2'));
        expect(refused.success).toBe(false);
        const runs = await stack.engine.listRuns('applicant_notice');
        const step = runs.find((r) => r.status === 'failed')?.steps.find((s) => s.nodeId === 'notify');
        expect(step?.error?.message).toContain(`per-address limit of ${EMAIL_FIELD_SENDS_PER_WINDOW} emails`);
        expect(step?.error?.message).toContain('nothing was sent');
        expect(await stack.outbox.list()).toHaveLength(EMAIL_FIELD_SENDS_PER_WINDOW);
        // Another address keeps its own budget.
        expect((await stack.engine.execute('applicant_notice', onCreate('app_3'))).success).toBe(true);
        expect(await stack.outbox.list()).toHaveLength(EMAIL_FIELD_SENDS_PER_WINDOW + 1);
    });
});

describe('#25647 — a computed recipient address must be a user', () => {
    const LEAD = { id: 'lead_1', name: 'Lead', contact_text: 'stranger@outside.example', owner_email: 'owen@company.example' };
    const OWEN = { id: 'usr_owen', email: 'owen@company.example' };

    function bootLead() {
        return boot({ records: { hr_applicant: [LEAD] }, users: [OWEN] });
    }

    it('E1: an envelope that evaluates to an address no user holds fails the node, pointing to { emailField }', async () => {
        const stack = bootLead();
        const { run, step } = await runOnce(
            stack,
            { recipients: [CEL('record.contact_text')], channels: 'email' },
            onCreate('lead_1', LEAD),
        );
        expect(run.success).toBe(false);
        expect(step?.error?.message).toContain('recipients[0] evaluated to an email address — source: `record.contact_text`');
        expect(step?.error?.message).toContain('no user holds it');
        expect(step?.error?.message).toContain("`recipients: { emailField: 'FIELD' }`");
        expect(await stack.outbox.list()).toHaveLength(0);
    });

    it('E2: an envelope that evaluates to a user\'s address resolves to that user', async () => {
        const stack = bootLead();
        const { run } = await runOnce(
            stack,
            { recipients: CEL('record.owner_email'), channels: 'email' },
            onCreate('lead_1', LEAD),
        );
        expect(run.success).toBe(true);
        const [row] = await stack.outbox.list();
        expect(row).toMatchObject({ channel: 'email', recipientId: 'usr_owen' });
    });

    it('E3: an address written out in the flow is the author\'s constant and is sent as written', async () => {
        const stack = bootLead();
        const { run } = await runOnce(
            stack,
            { recipients: ['ops@company.example'], channels: 'email' },
            onCreate('lead_1', LEAD),
        );
        expect(run.success).toBe(true);
        await stack.dispatcher.tick();
        expect(stack.mailed.map((m) => m.to)).toEqual(['ops@company.example']);
    });

    it('E4: with no data engine to check it, a computed address is not sent', async () => {
        const emitted: unknown[] = [];
        const engine = new AutomationEngine(silentLogger());
        registerNotifyNode(engine, {
            logger: silentLogger(),
            getService: (name: string) => (name === 'messaging'
                ? { async emit(n: unknown) { emitted.push(n); return { notificationId: 'evt_1', delivered: 1, failed: 0 }; } }
                : undefined),
        } as any);
        engine.registerFlow('applicant_notice', notifyFlow({ recipients: [CEL('record.contact_text')], channels: 'email' }));
        const run = await engine.execute('applicant_notice', onCreate('lead_1', LEAD));
        expect(run.success).toBe(false);
        expect(emitted).toHaveLength(0);
    });
});
