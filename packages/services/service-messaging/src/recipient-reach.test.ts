// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34730 step 2] Fan-out asks a channel that addresses only some people
 * (`reachableRecipients`, the Slack channel's confirmed links) whom it can
 * reach, once per emit, and skips the rest before any row exists: no delivery
 * row, no send, no failure, no `suppressed_channels` entry — the other
 * channels of the same emit are untouched. A channel without the member
 * reaches everyone, and a probe that throws keeps everyone (fail-open).
 */

import { describe, it, expect } from 'vitest';
import { MessagingService } from './messaging-service.js';
import { MemoryNotificationOutbox } from './memory-outbox.js';
import type { MessagingChannel, RecipientReachQuery } from './channel.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function service(reach: (q: RecipientReachQuery) => ReadonlySet<string>) {
    const outbox = new MemoryNotificationOutbox(1);
    const inserts: Array<Record<string, unknown>> = [];
    const svc = new MessagingService({
        logger: silent,
        outbox,
        getData: () => ({ async insert(_o: string, row: Record<string, unknown>) { inserts.push(row); return { id: 'evt_1', ...row }; }, async find() { return []; } }) as never,
    });
    const probes: RecipientReachQuery[] = [];
    const plain = (id: string): MessagingChannel => ({ id, async send() { return { ok: true }; } });
    svc.registerChannel(plain('inbox'));
    svc.registerChannel({ ...plain('slack'), async reachableRecipients(_ctx, q) { probes.push(q); return reach(q); } });
    const emit = (channels = ['inbox', 'slack']) =>
        svc.emit({ topic: 'approval.requested', audience: ['u_ada', 'u_bob'], channels, organizationId: 'org_a', payload: { title: 'Approve PO-7' } });
    const rows = async () => (await outbox.list()).map((r) => `${r.channel}:${r.recipientId}`).sort();
    return { emit, rows, probes, inserts };
}

describe('per-recipient reach at fan-out', () => {
    it('skips the unreached recipient on that channel only, with no row and no suppression, asking once', async () => {
        const t = service(() => new Set(['u_ada']));
        const result = await t.emit();
        expect(await t.rows()).toEqual(['inbox:u_ada', 'inbox:u_bob', 'slack:u_ada']);
        expect(t.probes).toEqual([{ organizationId: 'org_a', recipients: ['u_ada', 'u_bob'] }]);
        expect(result).toMatchObject({ enqueued: 3, failed: 0, suppressed: [] });
        expect(t.inserts[0].suppressed_channels ?? []).toEqual([]);
    });

    it('a probe that throws keeps every recipient', async () => {
        const t = service(() => { throw new Error('link store unreachable'); });
        await t.emit();
        expect(await t.rows()).toEqual(['inbox:u_ada', 'inbox:u_bob', 'slack:u_ada', 'slack:u_bob']);
    });

    it('an emit only that channel can carry, reaching nobody, writes no row', async () => {
        const t = service(() => new Set());
        const result = await t.emit(['slack']);
        expect(await t.rows()).toEqual([]);
        expect(result).toMatchObject({ enqueued: 0, failed: 0 });
    });
});
