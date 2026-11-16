// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The webhook method `GET` is retired (ADR-0049 enforce-or-remove; ADR-0087 D3
 * entry `webhook-method-get-retired`), and a subscription already stored with
 * it is PARKED, never converted.
 *
 * Every webhook delivery sends the event envelope as its request body, and a
 * GET request carries none, so no GET webhook ever delivered: the outbox sent
 * the body, the HTTP client refused a GET with a body, and the row retried
 * until dead. The spec's `WebhookSchema.method` and the `sys_webhook` `method`
 * select both drop `GET`; a row a customer database already holds with `get`
 * keeps loading and goes through the #8069 park path, which writes each
 * matched event as a terminal `dead` row with the reason instead of enqueueing
 * it.
 *
 * The whole chain on a REAL `SqlDriver` under a REAL `ObjectQL`, because the
 * two halves under test live in two different places: the save door is the
 * engine's record validator judging the select's options, and the park is the
 * `AutoEnqueuer` reading the row the driver hands back. Pinned:
 *
 *   1. the save door — an insert and an update with `method: 'get'` are refused
 *      with the validator's own code, and nothing is stored;
 *   2. the park — a stored `get` row writes exactly one `dead` delivery row per
 *      matched event, with 0 attempts, no signature and a reason that names the
 *      method and the fix; nothing reaches `fetch`; the row cannot be
 *      redelivered; the park is said once at `error`;
 *   3. no conversion — the stored method reads `get` after the park, in the
 *      database and through the engine;
 *   4. CONTROL — a `post` row on the same composition delivers a POST with the
 *      envelope as its body.
 */

import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { IRealtimeService, RealtimeEventHandler, RealtimeEventPayload } from '@objectstack/spec/contracts';
import {
    HttpDelivery,
    HttpDispatcher,
    MessagingService,
    SqlHttpOutbox,
    type EnqueueHttpInput,
    type FetchImpl,
} from '@objectstack/service-messaging';
import { AutoEnqueuer } from './auto-enqueuer.js';
import type { DeclaredWebhook, DeclaredWebhookReader } from './declared-webhooks.js';
import { DeclaredWebhookSource } from './declared-webhooks.js';
import { createWebhookRedeliverGuard } from './redeliver-guard.js';
import { SysWebhook } from './sys-webhook.object.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const SYSTEM = { context: { isSystem: true } };

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

async function waitFor(check: () => Promise<boolean>, ms = 3000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, 25));
    }
}

function makeFetch() {
    const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
    const impl: FetchImpl = async (url, init) => {
        calls.push({ url, method: init.method, body: init.body });
        return { ok: true, status: 200, async text() { return 'ok'; } };
    };
    return { impl, calls };
}

/** A `sys_webhook` row as Setup saves it, on `probe_task` creates. */
function webhookRow(name: string, method: string) {
    return {
        name,
        object_name: 'probe_task',
        triggers: ['create'],
        url: `https://receiver.invalid/${name}`,
        method,
        active: true,
        definition_json: '{}',
    };
}

async function boot(opts: { declared?: DeclaredWebhookReader } = {}) {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'probe_task', label: 'Probe Task', fields: { title: { type: 'text', label: 'Title' } } } as any, 'test');
    engine.registry.registerObject(HttpDelivery as any, 'test');
    engine.registry.registerObject(SysWebhook as any, 'test');
    await engine.syncSchemas();
    await installDefaultOrganization(engine);

    const realtime = new FakeRealtime();
    engine.setRealtimeService(realtime);
    const errors: Array<{ message: string; meta: any }> = [];
    const warns: string[] = [];
    const logger = {
        info() {}, debug() {},
        warn: (m: string) => { warns.push(m); },
        error: (m: string, _err?: unknown, meta?: unknown) => { errors.push({ message: m, meta }); },
    };
    const outbox = new SqlHttpOutbox(engine as any, { partitionCount: 1 });
    const messaging = new MessagingService({ logger: { info() {}, warn() {}, error() {}, debug() {} } as any });
    messaging.setHttpOutbox(outbox);
    messaging.registerRedeliverGuard('webhook', createWebhookRedeliverGuard(engine as any));
    const enqueuer = new AutoEnqueuer(engine as any, realtime, (input: EnqueueHttpInput) => messaging.enqueueHttp(input), {
        refreshIntervalMs: 0,
        logger,
        ...(opts.declared ? { declaredWebhooks: opts.declared } : {}),
    });
    const deliveries = async () => (await engine.find('sys_http_delivery', {}, SYSTEM)) as any[];
    const tick = async () => {
        const { impl, calls } = makeFetch();
        await new HttpDispatcher({ nodeId: 'n1', outbox, fetchImpl: impl, partitionCount: 1 }).tick();
        return calls;
    };
    return { driver, engine, enqueuer, messaging, deliveries, tick, errors, warns };
}

/**
 * A row a customer database holds with `get`: saved through the select before
 * the option left. Written as data at rest — inserted as `post`, then the
 * stored value set through the driver, below the save door this release adds.
 */
async function storeGetRow(engine: any, driver: SqlDriver, name: string): Promise<string> {
    const row: any = await engine.insert('sys_webhook', webhookRow(name, 'post'), SYSTEM);
    await driver.update('sys_webhook', row.id, { method: 'get' });
    return String(row.id);
}

describe('webhook method GET retired — the save door (sys_webhook select)', () => {
    it('refuses an insert with method get, with the validator\'s code, and stores nothing', async () => {
        const { driver, engine } = await boot();
        try {
            const refused = await engine.insert('sys_webhook', webhookRow('get_hook', 'get'), SYSTEM).then(
                () => undefined,
                (err: any) => err,
            );
            expect(refused).toBeDefined();
            expect(refused).toMatchObject({ code: 'VALIDATION_FAILED' });
            const fieldErrors = JSON.stringify(refused.details ?? refused.fieldErrors ?? refused);
            expect(fieldErrors).toContain('method');
            expect(fieldErrors).toContain('invalid_option');
            expect(await engine.find('sys_webhook', { where: { name: 'get_hook' } }, SYSTEM)).toEqual([]);

            // CONTROL: the four body-carrying methods save.
            for (const method of ['post', 'put', 'patch', 'delete']) {
                await expect(engine.insert('sys_webhook', webhookRow(`hook_${method}`, method), SYSTEM)).resolves.toBeTruthy();
            }
        } finally {
            await driver.disconnect();
        }
    });

    it('refuses an update to method get, and the stored method is unchanged', async () => {
        const { driver, engine } = await boot();
        try {
            const row: any = await engine.insert('sys_webhook', webhookRow('post_hook', 'post'), SYSTEM);
            const refused = await engine.update('sys_webhook', { method: 'get' }, { where: { id: row.id }, ...SYSTEM }).then(
                () => undefined,
                (err: any) => err,
            );
            expect(refused).toMatchObject({ code: 'VALIDATION_FAILED' });
            const stored: any = await driver.findOne('sys_webhook', { where: { id: row.id } });
            expect(stored.method).toBe('post');
        } finally {
            await driver.disconnect();
        }
    });

    it('offers exactly the four body-carrying methods', () => {
        const options = (SysWebhook.fields.method as { options?: Array<{ value: string }> }).options ?? [];
        expect(options.map((o) => o.value)).toEqual(['post', 'put', 'patch', 'delete']);
    });
});

describe('webhook method GET retired — a stored GET row is parked, never converted', () => {
    it('writes one dead row per event with the reason, sends nothing, refuses redelivery, and leaves the method as stored', async () => {
        const { driver, engine, enqueuer, messaging, deliveries, tick, errors } = await boot();
        try {
            const id = await storeGetRow(engine, driver, 'legacy_get_hook');
            await enqueuer.start();

            await engine.insert('probe_task', { title: 'first' });
            await waitFor(async () => (await deliveries()).length >= 1);
            const rows = await deliveries();
            expect(rows).toHaveLength(1);
            const row = rows[0];
            expect(row.ref_id).toBe(id);
            expect(row.status).toBe('dead');
            expect(Number(row.attempts)).toBe(0);
            expect(row.signature ?? undefined).toBeUndefined();
            expect(row.method).toBe('GET');
            // The reason names the method and the fix.
            expect(row.error).toContain('[VALIDATION_ERROR/400]');
            expect(row.error).toContain("webhook 'legacy_get_hook' is stored with HTTP method GET");
            expect(row.error).toContain('set its method to POST, PUT, PATCH or DELETE');
            expect(JSON.parse(row.payload_json)).toMatchObject({ object: 'probe_task', action: 'created' });

            // Nothing on the wire, and the dead row is not a resend button.
            expect(await tick()).toEqual([]);
            await expect(messaging.redeliverHttp(row.id, { tenantId: undefined })).rejects.toMatchObject({
                code: 'DELIVERY_NEVER_SENT',
            });

            // A second event: a second dead row, and the park is said ONCE.
            await engine.insert('probe_task', { title: 'second' });
            await waitFor(async () => (await deliveries()).length >= 2);
            expect((await deliveries()).map((r) => r.status)).toEqual(['dead', 'dead']);
            const parkedReports = errors.filter((e) => e.message.includes("webhook 'legacy_get_hook' is PARKED"));
            expect(parkedReports).toHaveLength(1);
            expect(parkedReports[0].meta).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, method: 'GET' });

            // No conversion: the method reads exactly as stored.
            const raw: any = await driver.findOne('sys_webhook', { where: { id } });
            expect(raw.method).toBe('get');
            const served: any = await engine.findOne('sys_webhook', { where: { id }, ...SYSTEM });
            expect(served.method).toBe('get');
        } finally {
            await enqueuer.stop();
            await driver.disconnect();
        }
    });

    it('CONTROL: a POST row on the same composition delivers a POST carrying the envelope', async () => {
        const { driver, engine, enqueuer, deliveries, tick, errors } = await boot();
        try {
            const row: any = await engine.insert('sys_webhook', webhookRow('post_hook', 'post'), SYSTEM);
            await enqueuer.start();
            await engine.insert('probe_task', { title: 'control' });
            await waitFor(async () => (await deliveries()).length >= 1);
            const [delivery] = await deliveries();
            expect(delivery.ref_id).toBe(String(row.id));
            expect(delivery.status).toBe('pending');
            expect(delivery.method).toBe('POST');
            expect(delivery.error ?? undefined).toBeUndefined();

            const calls = await tick();
            expect(calls).toHaveLength(1);
            expect(calls[0].method).toBe('POST');
            expect(calls[0].url).toBe('https://receiver.invalid/post_hook');
            expect(JSON.parse(calls[0].body ?? '')).toMatchObject({ object: 'probe_task', action: 'created' });
            expect(errors).toEqual([]);
        } finally {
            await enqueuer.stop();
            await driver.disconnect();
        }
    });
});

describe('webhook method GET retired — a declared GET webhook', () => {
    it('is refused at parse by the declared-webhook reader, so it never reaches the dispatcher', async () => {
        const reader = { list: (type: string) => (type === 'webhook' ? [{ ...webhookRow('declared_get', 'GET'), object: 'probe_task' }] : []) };
        const { driver, engine, enqueuer, deliveries } = await boot();
        const source = new DeclaredWebhookSource(engine, reader);
        try {
            expect(await source.list()).toEqual([]);
            await enqueuer.start();
            await engine.insert('probe_task', { title: 'declared' });
            await new Promise((r) => setTimeout(r, 50));
            expect(await deliveries()).toEqual([]);
        } finally {
            await enqueuer.stop();
            await driver.disconnect();
        }
    });

    it('handed in by a reader that skips the schema anyway, it is parked like a row, with no credentials', async () => {
        const declared: DeclaredWebhook = {
            webhook: {
                name: 'declared_get',
                object: 'probe_task',
                triggers: ['create'],
                url: 'https://receiver.invalid/declared_get',
                method: 'GET' as never,
                secret: 'whsec_declared',
                isActive: true,
                timeoutMs: 30000,
            } as DeclaredWebhook['webhook'],
            active: true,
        } as DeclaredWebhook;
        const reader: DeclaredWebhookReader = {
            list: async () => [declared],
        } as unknown as DeclaredWebhookReader;
        const { driver, engine, enqueuer, deliveries, tick } = await boot({ declared: reader });
        try {
            await enqueuer.start();
            await engine.insert('probe_task', { title: 'declared' });
            await waitFor(async () => (await deliveries()).length >= 1);
            const [row] = await deliveries();
            expect(row.status).toBe('dead');
            expect(row.error).toContain("webhook 'declared_get' is stored with HTTP method GET");
            expect(row.signature ?? undefined).toBeUndefined();
            expect(JSON.stringify(row)).not.toContain('whsec_declared');
            expect(await tick()).toEqual([]);
        } finally {
            await enqueuer.stop();
            await driver.disconnect();
        }
    });
});
