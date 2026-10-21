// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24835] An insert and a by-id update, on a REAL `SqlDriver` under a REAL
 * `ObjectQL` engine, with an active declared webhook, each store one
 * `sys_http_delivery` row whose `payload_json` is plain JSON.
 *
 * ## Why the whole chain on a real driver
 *
 * The loss this pins was invisible to every fake in this package. The driver's
 * `update()` used to stamp `updated_at` into the CALLER'S patch object, and
 * ObjectQL publishes that same object as `DataEvent.changes`. On PostgreSQL and
 * MySQL the stamp is a knex `Raw` holding the client, its pool and a Node
 * `Timeout`, so the outbox's `JSON.stringify(payload)` threw and no delivery
 * row was written for ANY record update — the record write still answered 200
 * and the webhook still read active. A fake driver never stamps, and a fake
 * outbox never serialises, so only this composition can see it:
 * `ObjectQL` → `SqlDriver` → realtime → `AutoEnqueuer` →
 * `MessagingService.enqueueHttp` → `SqlHttpOutbox` → `sys_http_delivery`.
 *
 * SQLite here. On SQLite the stamp was an ISO string, so the row WAS written,
 * and the assertion that would have caught the PG/MySQL loss is the plain-JSON
 * round trip below. The same body was run against a throwaway local
 * PostgreSQL 16 cluster when this landed (before: 1 row, the update lost;
 * after: 2 rows); no live-PG lane runs on pull requests, so that run is not
 * committed.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IRealtimeService, RealtimeEventHandler, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { HttpDelivery, MessagingService, SqlHttpOutbox, type EnqueueHttpInput } from '@objectstack/service-messaging';
import { AutoEnqueuer } from './auto-enqueuer.js';
import { DeclaredWebhookSource, declaredWebhookRefId } from './declared-webhooks.js';
import { SysWebhook } from './sys-webhook.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { context: { isSystem: true } };

function driverUnderTest(): SqlDriver {
    return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
}

class FakeRealtime implements IRealtimeService {
    private subs = new Map<string, { handler: RealtimeEventHandler; opts?: any }>();
    private n = 0;
    async publish(event: RealtimeEventPayload): Promise<void> {
        for (const sub of this.subs.values()) {
            if (sub.opts?.object && event.object !== sub.opts.object) continue;
            await sub.handler(event);
        }
    }
    async subscribe(_channel: string, handler: any, opts?: any): Promise<string> {
        const id = `s-${++this.n}`;
        this.subs.set(id, { handler, opts });
        return id;
    }
    async unsubscribe(id: string): Promise<void> { this.subs.delete(id); }
}

/** A declared webhook, as `defineStack({ webhooks })` would author it — active by default. */
const DECLARED = {
    name: 'probe_task_changed',
    object: 'probe_task',
    triggers: ['create', 'update'],
    url: 'https://receiver.invalid/hook',
    method: 'POST',
};

/** True when `value` is made only of what JSON can carry. */
function isPlainJson(value: unknown): boolean {
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true;
    if (Array.isArray(value)) return value.every(isPlainJson);
    if (typeof value !== 'object') return false;
    if (Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Object.values(value as Record<string, unknown>).every(isPlainJson);
}

async function waitFor(check: () => Promise<boolean>, ms = 3000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 25));
    }
}

describe('#24835 — a webhook delivery is stored for an update on a real SqlDriver', () => {
    it('an insert and a by-id update each store one delivery row whose payload_json is plain JSON', async () => {
        const driver = driverUnderTest();
        const engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject({ name: 'probe_task', label: 'Probe Task', fields: { title: { type: 'text', label: 'Title' } } } as any, 'test');
        engine.registry.registerObject(HttpDelivery as any, 'test');
        engine.registry.registerObject(SysWebhook as any, 'test');
        await engine.syncSchemas();
        // A real `single` install's Default Organization: the system writes below
        // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
        await installDefaultOrganization(engine);

        const realtime = new FakeRealtime();
        engine.setRealtimeService(realtime);
        const lost: string[] = [];
        const logger = {
            info() {}, debug() {},
            warn: (m: string) => { lost.push(m); },
            error: (m: string) => { lost.push(m); },
        };
        const messaging = new MessagingService({ logger: { info() {}, warn() {}, error() {}, debug() {} } as any });
        messaging.setHttpOutbox(new SqlHttpOutbox(engine as any, { partitionCount: 1 }));
        const enqueuer = new AutoEnqueuer(engine as any, realtime, (input: EnqueueHttpInput) => messaging.enqueueHttp(input), {
            refreshIntervalMs: 0,
            declaredWebhooks: new DeclaredWebhookSource(engine, { list: (type: string) => (type === 'webhook' ? [DECLARED] : []) }),
            logger,
        });
        const deliveries = async () => (await engine.find('sys_http_delivery', {}, SYSTEM)) as any[];

        try {
            await enqueuer.start();
            const created: any = await engine.insert('probe_task', { title: 'seed' });
            await waitFor(async () => (await deliveries()).length >= 1);
            const patch = { title: 'webhook probe' };
            await engine.update('probe_task', patch, { where: { id: created.id } });
            await waitFor(async () => (await deliveries()).length >= 2);

            const rows = await deliveries();
            expect(rows.map((r) => r.label).sort()).toEqual(['data.record.created', 'data.record.updated']);
            for (const row of rows) {
                expect(row.ref_id).toBe(declaredWebhookRefId('probe_task_changed'));
                expect(typeof row.payload_json).toBe('string');
                const parsed = JSON.parse(row.payload_json);
                expect(isPlainJson(parsed)).toBe(true);
                expect(JSON.stringify(parsed)).toBe(row.payload_json);
                expect(parsed).toMatchObject({ object: 'probe_task', recordId: created.id });
            }
            const updated = JSON.parse(rows.find((r) => r.label === 'data.record.updated').payload_json);
            expect(updated.action).toBe('updated');
            expect(updated.changes.title).toBe('webhook probe');
            expect(lost).toEqual([]);
        } finally {
            await enqueuer.stop();
            await driver.disconnect();
        }
    });
});
