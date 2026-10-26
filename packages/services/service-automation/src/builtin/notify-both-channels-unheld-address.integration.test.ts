// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
    MessagingService,
    NotificationTemplateStore,
    createEmailChannel,
    createInboxChannel,
    INBOX_OBJECT,
    NOTIFICATION_EVENT_OBJECT,
} from '@objectstack/service-messaging';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { AutomationEngine } from '../engine.js';
import { registerNotifyNode } from './notify-node.js';

/**
 * [#25990] On a node whose `channels` name `email` AND another channel, an
 * address written out in `recipients` that no user holds is mailed as written
 * (ruling 6386629237 letter B). The other channels deliver to a user: the inbox
 * keys its row by the recipient as a user id. So the address goes to the email
 * channel only, and the inbox writes no row for it; before, it wrote a
 * `sys_inbox_message` row whose `user_id` was the address, which no inbox reads.
 *
 * The node still succeeds when the email delivery succeeds, and an address a
 * user holds keeps reaching that user's inbox and is mailed as before.
 *
 * Wired through the REAL `MessagingService` (inline fan-out) and the REAL
 * inbox and email channels, over a data engine that stores the directory and
 * records every row the stack writes.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

interface Row { [key: string]: unknown; id: string }

/** A data engine holding the users, and recording every row the stack writes. */
function dataEngine(users: Row[], opts: { failUserLookup?: boolean } = {}) {
    const written: Array<{ object: string; row: Record<string, unknown> }> = [];
    let seq = 0;
    const tables: Record<string, Row[]> = { sys_user: users };
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
            if (opts.failUserLookup && object === 'sys_user' && 'email' in where) throw new Error('directory offline');
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

const EXEC = { id: 'usr_exec', email: 'exec@company.example' };

/** The stack: messaging with the inbox and email channels, and the notify node over them. */
function boot(opts: { failUserLookup?: boolean } = {}) {
    const { engine: data, written } = dataEngine([EXEC], opts);
    const getData = () => data as any;
    const mailed: unknown[] = [];
    const messaging = new MessagingService({ logger: silentLogger(), getData });
    messaging.registerChannel(createInboxChannel({ getData }));
    messaging.registerChannel(createEmailChannel({
        getEmail: () => ({
            async send(input) {
                mailed.push(input.to);
                return { id: `mail_${mailed.length}` };
            },
        }),
        getData,
        store: new NotificationTemplateStore({ getData: () => undefined }),
    }));
    const engine = new AutomationEngine(silentLogger());
    registerNotifyNode(engine, {
        logger: silentLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : name === 'data' ? getData() : undefined),
    } as any);
    return { engine, written, mailed };
}

function notifyFlow(config: Record<string, unknown>): any {
    return {
        name: 'escalation',
        label: 'Escalation',
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'alert_exec', type: 'notify', label: 'Alert Exec', config: { title: 'Critical', ...config } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'alert_exec' },
            { id: 'e2', source: 'alert_exec', target: 'end' },
        ],
    };
}

async function runOnce(stack: ReturnType<typeof boot>, config: Record<string, unknown>, record?: Record<string, unknown>) {
    stack.engine.registerFlow('escalation', notifyFlow(config));
    const context = record ? { tenantId: 'org_1', object: 'crm_lead', record } : { tenantId: 'org_1' };
    const run = await stack.engine.execute('escalation', context as any);
    const runs = await stack.engine.listRuns('escalation');
    const step = runs[0]?.steps.find((s) => s.nodeId === 'alert_exec');
    return { run, step };
}

const rowsOf = (stack: ReturnType<typeof boot>, object: string) =>
    stack.written.filter((w) => w.object === object).map((w) => w.row);

const BOTH = ['inbox', 'email'];

describe('#25990 — a written-out address no user holds, on a node naming inbox and email', () => {
    it.each([
        ['bare', 'exec@example.com'],
        ['as user:ADDRESS', 'user:exec@example.com'],
        ['as user:ADDRESS of an address a user holds', 'user:exec@company.example'],
    ])('is mailed as written and writes no inbox row (%s)', async (_label, recipient) => {
        const stack = boot();
        const { run } = await runOnce(stack, { recipients: [recipient], channels: BOTH });
        expect(run.success).toBe(true);
        expect(stack.mailed).toEqual([recipient.replace(/^user:/, '')]);
        expect(rowsOf(stack, INBOX_OBJECT)).toEqual([]);
        // The one recipient, and the one delivery a channel accepted: its mail.
        expect(run.summary).toMatchObject({ selected: 1, acted: 1 });
    });

    it('beside a user, the user still gets the inbox row and the mail; the address only the mail', async () => {
        const stack = boot();
        const { run } = await runOnce(stack, { recipients: ['usr_exec', 'stranger@example.com'], channels: BOTH });
        expect(run.success).toBe(true);
        expect(rowsOf(stack, INBOX_OBJECT).map((r) => r.user_id)).toEqual(['usr_exec']);
        expect([...stack.mailed].sort()).toEqual(['exec@company.example', 'stranger@example.com']);
        // Both recipients are counted, and every delivery a channel accepted:
        // the user's inbox row and mail, and the address's mail.
        expect(run.summary).toMatchObject({ selected: 2, acted: 3 });
        // The address's mail is its own notification, on the email channel alone.
        expect(rowsOf(stack, NOTIFICATION_EVENT_OBJECT)).toHaveLength(2);
    });

    it('a written-out address a user holds keeps reaching that user\'s inbox and is mailed, as before', async () => {
        const stack = boot();
        const { run } = await runOnce(stack, { recipients: ['exec@company.example'], channels: BOTH });
        expect(run.success).toBe(true);
        expect(rowsOf(stack, INBOX_OBJECT).map((r) => r.user_id)).toEqual(['usr_exec']);
        expect(stack.mailed).toEqual(['exec@company.example']);
    });

    it('when the directory cannot say who holds it, the address is still mailed and never keys an inbox row', async () => {
        const stack = boot({ failUserLookup: true });
        const { run } = await runOnce(stack, { recipients: ['exec@example.com'], channels: BOTH });
        expect(run.success).toBe(true);
        expect(stack.mailed).toEqual(['exec@example.com']);
        expect(rowsOf(stack, INBOX_OBJECT)).toEqual([]);
    });

    it('a computed address a user holds reaches that user\'s inbox on a both-channels node', async () => {
        const stack = boot();
        const { run } = await runOnce(
            stack,
            { recipients: { dialect: 'cel', source: 'record.owner_email' }, channels: BOTH },
            { id: 'lead_1', owner_email: 'exec@company.example' },
        );
        expect(run.success).toBe(true);
        expect(rowsOf(stack, INBOX_OBJECT).map((r) => r.user_id)).toEqual(['usr_exec']);
        expect(stack.mailed).toEqual(['exec@company.example']);
    });
});
