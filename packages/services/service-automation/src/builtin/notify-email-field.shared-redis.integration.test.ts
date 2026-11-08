// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0069 D2 for the `notify` node's per-address email-field send limit: a
 * deployment that DECLARES multiple replicas and runs the redis cluster driver
 * enforces ONE limit per address across replicas — not `limit × replicas`.
 *
 * Each replica is a kernel composed the way one really is: the cluster plugin
 * with the redis driver, then `CacheServicePlugin` (which picks its adapter
 * from `OS_CLUSTER_REPLICAS`), then the node registered with the context that
 * kernel hands a plugin. The node counts through `createLazyCounterStore` over
 * `resolveKernelCache` — the resolution every budget counter shares. Nothing
 * here wires the limit to Redis by hand: the shared count is the cache
 * plugin's choice or nothing.
 *
 * The two replicas' `ioredis-mock` clients share one keyspace, the way two
 * replicas' clients share one Redis. The CONTROL beside the shared case runs
 * the same two replicas without the declaration: each keeps a per-process
 * cache and admits the limit on its own. That the two numbers differ is what
 * shows the shared number is the store's doing.
 *
 * Runs alternate between replicas one at a time, so the count is exact; two
 * replicas counting in the same instant can still both be admitted at the
 * boundary (`ICacheService` has no atomic increment), the bounded imprecision
 * ADR-0069 D2 accepts. The cross-PROCESS leg of the same store path, against a
 * real `redis-server`, lives in plugin-auth's
 * `rate-limit-storage.shared-redis.test.ts`.
 */

// @ts-expect-error — ioredis-mock publishes no type declarations
import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { CacheServicePlugin, MemoryCacheAdapter, RedisCacheAdapter } from '@objectstack/service-cache';
import { ClusterServicePlugin } from '@objectstack/service-cluster';
// Registers the `redis` cluster driver with `defineCluster()`.
import '@objectstack/service-cluster-redis';
import { MessagingService, MemoryNotificationOutbox, createEmailChannel, NotificationTemplateStore } from '@objectstack/service-messaging';

import { AutomationEngine } from '../engine.js';
import { EMAIL_FIELD_SENDS_PER_WINDOW, registerNotifyNode } from './notify-node.js';

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

const APPLICANT = { id: 'app_1', name: 'Ann', applicant_email: 'ann@applicant.example' };
const ATTEMPTS = EMAIL_FIELD_SENDS_PER_WINDOW * 2 + 2;

/** A data engine holding the one business record, and accepting the notification rows. */
function dataEngine() {
    let seq = 0;
    return {
        async insert(_object: string, row: Record<string, unknown>) {
            return { ...row, id: row.id != null ? String(row.id) : `row_${++seq}` };
        },
        async find() { return []; },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query);
            if (object !== 'hr_applicant') return undefined;
            const where = (query as { where?: Record<string, unknown> } | undefined)?.where;
            return where?.id === APPLICANT.id ? { ...APPLICANT } : undefined;
        },
    };
}

/** Registers messaging and data — never `cache`: that is `CacheServicePlugin`'s — and keeps the context. */
function hostPlugin(): Plugin & { ctx?: PluginContext } {
    const plugin: Plugin & { ctx?: PluginContext } = {
        name: 'test.host.messaging',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            plugin.ctx = ctx;
            const data = dataEngine();
            const outbox = new MemoryNotificationOutbox(1);
            const messaging = new MessagingService({ logger: silentLogger(), outbox, getData: () => data as any });
            messaging.registerChannel(createEmailChannel({
                getEmail: () => ({ async send() { return { id: 'mail' }; } }),
                getData: () => data as any,
                store: new NotificationTemplateStore({ getData: () => undefined }),
            }));
            ctx.registerService('data', data);
            ctx.registerService('messaging', messaging);
        },
    };
    return plugin;
}

describe('notify email-field limit across replicas — in-process kernels over ioredis-mock', () => {
    const kernels: ObjectKernel[] = [];
    const clients: Array<{ quit(): Promise<unknown> }> = [];

    beforeEach(async () => {
        // The per-address key is the same in every case: start each from an empty Redis.
        const admin = new RedisMock();
        await admin.flushall();
        await admin.quit();
    });

    afterEach(async () => {
        vi.unstubAllEnvs();
        await Promise.all(kernels.splice(0).map((k) => k.shutdown()));
        await Promise.all(clients.splice(0).map((c) => c.quit().catch(() => undefined)));
    });

    async function replica(nodeId: string): Promise<{ kernel: ObjectKernel; run: () => Promise<{ success: boolean }> }> {
        const client = new RedisMock();
        clients.push(client);
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true } as never);
        const host = hostPlugin();
        await kernel.use(new ClusterServicePlugin({ config: { driver: 'redis', nodeId, driverOptions: { client } } }));
        await kernel.use(new CacheServicePlugin());
        await kernel.use(host);
        await kernel.bootstrap();
        kernels.push(kernel);
        const engine = new AutomationEngine(silentLogger());
        registerNotifyNode(engine, host.ctx!);
        engine.registerFlow('applicant_notice', {
            name: 'applicant_notice',
            label: 'Applicant notice',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'notify', type: 'notify', label: 'Notify',
                    config: { title: 'Received: {{ record.name }}', recipients: { emailField: 'applicant_email' }, channels: 'email' },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'notify' },
                { id: 'e2', source: 'notify', target: 'end' },
            ],
        } as any);
        const run = () => engine.execute('applicant_notice', {
            event: 'on_create', object: 'hr_applicant', record: { id: APPLICANT.id }, tenantId: 'org_1',
        } as any) as Promise<{ success: boolean }>;
        return { kernel, run };
    }

    /** Alternate `ATTEMPTS` runs across the replicas, one at a time; answer how many sent. */
    async function admittedAcross(runs: Array<() => Promise<{ success: boolean }>>): Promise<number> {
        let admitted = 0;
        for (let i = 0; i < ATTEMPTS; i++) {
            if ((await runs[i % runs.length]!()).success) admitted++;
        }
        return admitted;
    }

    it('declared multi-node (OS_CLUSTER_REPLICAS=2) over redis: both replicas count in Redis and admit the limit ONCE', async () => {
        vi.stubEnv('OS_CLUSTER_REPLICAS', '2');
        const a = await replica('replica-a');
        const b = await replica('replica-b');
        expect(a.kernel.getService('cache')).toBeInstanceOf(RedisCacheAdapter);
        expect(b.kernel.getService('cache')).toBeInstanceOf(RedisCacheAdapter);
        expect(await admittedAcross([a.run, b.run])).toBe(EMAIL_FIELD_SENDS_PER_WINDOW);
    });

    it('CONTROL — no declaration: each replica keeps a per-process cache and admits the limit on its own', async () => {
        const a = await replica('replica-a');
        const b = await replica('replica-b');
        expect(a.kernel.getService('cache')).toBeInstanceOf(MemoryCacheAdapter);
        expect(b.kernel.getService('cache')).toBeInstanceOf(MemoryCacheAdapter);
        expect(await admittedAcross([a.run, b.run])).toBe(EMAIL_FIELD_SENDS_PER_WINDOW * 2);
    });
});
