// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2): the `notify` node's per-address
 * email-field send limit counts in the registered `cache` service — registered
 * as a value or as a factory — and falls back to the bounded per-process store
 * only when none is registered, the kernel's own `degraded` stand-in included.
 *
 * The node is registered with the context a REAL `ObjectKernel` hands a plugin,
 * never a hand-built one: a mocked context can carry any member it likes,
 * including one the kernel never hands a plugin.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryCache, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import type { CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { MessagingService, MemoryNotificationOutbox, createEmailChannel, NotificationTemplateStore } from '@objectstack/service-messaging';

import { AutomationEngine } from '../engine.js';
import { resolveKernelCache } from './kernel-cache.js';
import { EMAIL_FIELD_SENDS_PER_WINDOW, registerNotifyNode } from './notify-node.js';

function silentLogger(): any {
    const l: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    l.child = () => l;
    return l;
}

/** A counter-capable cache that keeps what it is handed in a readable map. */
function makeCache(): CounterStore & { readonly store: Map<string, unknown> } {
    const store = new Map<string, unknown>();
    return {
        store,
        async get<T = unknown>(key: string): Promise<T | undefined> { return store.get(key) as T | undefined; },
        async set<T = unknown>(key: string, value: T): Promise<void> { store.set(key, value); },
    };
}

const APPLICANT = { id: 'app_1', name: 'Ann', applicant_email: 'ann@applicant.example' };

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

/** Registers `cache` the way the test asks, plus messaging and data, and keeps the context. */
function hostPlugin(mode: 'factory' | 'value', cache: unknown): Plugin & { ctx?: PluginContext } {
    const plugin: Plugin & { ctx?: PluginContext } = {
        name: `test.host.${mode}`,
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            plugin.ctx = ctx;
            if (mode === 'factory') ctx.registerServiceFactory('cache', () => cache);
            else ctx.registerService('cache', cache);
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

async function boot(mode: 'factory' | 'value', cache: unknown) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true });
    const host = hostPlugin(mode, cache);
    await kernel.use(host);
    await kernel.bootstrap();
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
    } as any);
    return { ctx: host.ctx!, run };
}

const BURST = EMAIL_FIELD_SENDS_PER_WINDOW + 4;

/** The node is exercised one run at a time; the counter's own concurrency rule is plugin-auth's `incrementFixedWindow`. */
async function runSequentially<T>(run: () => Promise<T>): Promise<T[]> {
    const results: T[] = [];
    for (let i = 0; i < BURST; i++) results.push(await run());
    return results;
}

describe('notify email-field limit — counts in the registered cache', () => {
    it('`cache` registered by FACTORY: the per-address counter lives in it', async () => {
        const cache = makeCache();
        const { ctx, run } = await boot('factory', cache);
        await expect(resolveKernelCache(ctx)).resolves.toBe(cache);

        const results = await runSequentially(run);
        expect(results.filter((r) => r.success)).toHaveLength(EMAIL_FIELD_SENDS_PER_WINDOW);
        const keys = [...cache.store.keys()].filter((k) => k.includes(APPLICANT.applicant_email));
        expect(keys).toHaveLength(1);
        expect(JSON.parse(cache.store.get(keys[0]!) as string)).toMatchObject({ n: BURST });
    });

    it("the kernel's own `degraded` stand-in is not counted in: the limit keeps the bounded fallback", async () => {
        const standIn = createMemoryCache();
        const { ctx, run } = await boot('value', standIn);
        await expect(resolveKernelCache(ctx)).resolves.toBeUndefined();

        const results = await runSequentially(run);
        expect(results.filter((r) => r.success)).toHaveLength(EMAIL_FIELD_SENDS_PER_WINDOW);
        expect((await standIn.stats()).keyCount).toBe(0);
    });
});
