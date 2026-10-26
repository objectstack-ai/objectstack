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
 * [#25758] An address WRITTEN OUT in `recipients` is the author's constant
 * (ruling 6386629237 letter B), and only the email channel sends to an address
 * itself. The inbox keys a message by a user id, and the sms channel texts a
 * user's number or a literal phone number. So on a node whose `channels` do
 * not include `email`, an address no user holds reaches nobody: the inbox used
 * to write a `sys_inbox_message` row whose `user_id` was the address, which no
 * inbox reads, and the node reported success.
 *
 * Such a node now fails, naming the node, the recipient and the fix; nothing
 * is written, and the node never adds the email channel it did not declare.
 *
 * Wired through the REAL `MessagingService` (inline fan-out) and the REAL
 * inbox and email channels, over a data engine that stores the directory and
 * records every row the stack writes.
 *
 *  A. A written-out address no user holds, on a node that does not name
 *     `email`, fails the node and writes nothing.
 *  B. A written-out address a user holds reaches that user's inbox, as before.
 *  C. A node whose `channels` include `email` sends the address as written.
 *  D. With no directory to check it, the address is not sent.
 */

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

interface Row { [key: string]: unknown; id: string }

/** A data engine holding the users, and recording every row the stack writes. */
function dataEngine(users: Row[]) {
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
function boot(opts: { withData?: boolean } = {}) {
    const { engine: data, written } = dataEngine([EXEC]);
    const getData = () => (opts.withData === false ? undefined : (data as any));
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

async function runOnce(stack: ReturnType<typeof boot>, config: Record<string, unknown>) {
    stack.engine.registerFlow('escalation', notifyFlow(config));
    const run = await stack.engine.execute('escalation', { tenantId: 'org_1' } as any);
    const runs = await stack.engine.listRuns('escalation');
    const step = runs[0]?.steps.find((s) => s.nodeId === 'alert_exec');
    return { run, step };
}

const rowsOf = (stack: ReturnType<typeof boot>, object: string) =>
    stack.written.filter((w) => w.object === object).map((w) => w.row);

describe('#25758 — a written-out address on a node that does not name email', () => {
    it.each([
        ['names no channel (inbox, the default)', { recipients: 'exec@example.com' }, 'exec@example.com'],
        ['names inbox only', { recipients: ['exec@example.com'], channels: ['inbox'] }, 'exec@example.com'],
        ['names sms only', { recipients: ['exec@example.com'], channels: 'sms' }, 'exec@example.com'],
        ['writes it as user:ADDRESS', { recipients: ['user:exec@example.com'] }, 'user:exec@example.com'],
        ['writes a user\'s address as user:ADDRESS', { recipients: ['user:exec@company.example'] }, 'user:exec@company.example'],
    ])('A: a node that %s fails, naming the node, the recipient and the fix, and writes nothing', async (_label, config, recipient) => {
        const stack = boot();
        const { run, step } = await runOnce(stack, config);
        expect(run.success).toBe(false);
        const message = step?.error?.message ?? '';
        expect(message).toContain('`alert_exec`');
        expect(message).toContain(`\`${recipient}\``);
        expect(message).toContain('`channels`');
        expect(message).toContain('user id');
        expect(rowsOf(stack, NOTIFICATION_EVENT_OBJECT)).toHaveLength(0);
        expect(rowsOf(stack, INBOX_OBJECT)).toHaveLength(0);
        // Never re-routed to the channel the author did not declare.
        expect(stack.mailed).toHaveLength(0);
    });

    it('A: names every such recipient of a list, not just the first', async () => {
        const stack = boot();
        const { run, step } = await runOnce(stack, { recipients: ['usr_exec', 'exec@example.com', 'cfo@example.com'] });
        expect(run.success).toBe(false);
        expect(step?.error?.message).toContain('`exec@example.com`');
        expect(step?.error?.message).toContain('`cfo@example.com`');
        expect(rowsOf(stack, INBOX_OBJECT)).toHaveLength(0);
    });

    it('B: a written-out address a user holds reaches that user\'s inbox, as before', async () => {
        const stack = boot();
        const { run } = await runOnce(stack, { recipients: 'exec@company.example' });
        expect(run.success).toBe(true);
        expect(rowsOf(stack, INBOX_OBJECT).map((r) => r.user_id)).toEqual(['usr_exec']);
    });

    it.each([
        ['email only', 'email'],
        ['inbox and email', ['inbox', 'email']],
    ])('C: a node whose channels are %s sends the address as written', async (_label, channels) => {
        const stack = boot();
        const { run } = await runOnce(stack, { recipients: ['exec@example.com'], channels });
        expect(run.success).toBe(true);
        expect(stack.mailed).toEqual(['exec@example.com']);
    });

    it('D: with no directory to check it, a written-out address on an inbox node is not sent', async () => {
        const stack = boot({ withData: false });
        const { run, step } = await runOnce(stack, { recipients: 'exec@example.com' });
        expect(run.success).toBe(false);
        expect(step?.error?.message).toContain('`exec@example.com`');
        expect(stack.mailed).toHaveLength(0);
    });
});
