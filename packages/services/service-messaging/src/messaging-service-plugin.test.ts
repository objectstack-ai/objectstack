// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { MessagingServicePlugin } from './messaging-service-plugin.js';
import type { MessagingService } from './messaging-service.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

/**
 * A lightweight fake PluginContext — enough surface for the plugin's init():
 * a logger, a service registry, and a `manifest` service that records objects.
 * Avoids a full kernel bootstrap, mirroring the unit-test style used by the
 * automation builtin-node tests.
 */
function fakeCtx() {
    const services = new Map<string, unknown>();
    const inserts: Array<{ object: string; row: any }> = [];
    const registeredObjects: unknown[] = [];

    services.set('manifest', {
        register(m: { objects?: unknown[] }) {
            registeredObjects.push(...(m.objects ?? []));
        },
    });
    services.set('data', {
        async insert(object: string, row: any) {
            inserts.push({ object, row });
            return { id: `row_${inserts.length}`, ...row };
        },
        async find() { return []; },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
                          assertEngineFindOnePredicate(object, query); return null; },
        async update() { return {}; },
        async delete() { return {}; },
    });

    const ctx = {
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => ctx.logger },
        registerService(name: string, svc: unknown) {
            services.set(name, svc);
        },
        getService<T>(name: string): T {
            return services.get(name) as T;
        },
    } as any;

    return { ctx, services, inserts, registeredObjects };
}

describe('MessagingServicePlugin', () => {
    it('registers the messaging service with the always-on inbox channel', async () => {
        const { ctx, services } = fakeCtx();
        await new MessagingServicePlugin().init(ctx);

        const messaging = services.get('messaging') as MessagingService;
        expect(messaging).toBeDefined();
        expect(messaging.getRegisteredChannels()).toEqual(['inbox']);
    });

    it('registers the sys_inbox_message + sys_notification_receipt objects via the manifest service', async () => {
        const { ctx, registeredObjects } = fakeCtx();
        await new MessagingServicePlugin().init(ctx);

        const names = registeredObjects.map((o: any) => o?.name);
        expect(names).toContain('sys_inbox_message');
        expect(names).toContain('sys_notification_receipt');
    });

    it('end-to-end: emit() writes the L2 event, the inbox row, and the receipt', async () => {
        const { ctx, services, inserts } = fakeCtx();
        await new MessagingServicePlugin().init(ctx);

        const messaging = services.get('messaging') as MessagingService;
        const result = await messaging.emit({
            topic: 'deal.won',
            audience: ['user_1'],
            payload: { title: 'Deal closed', body: 'Acme signed 🎉' },
        });

        expect(result.delivered).toBe(1);
        const objs = inserts.map((i) => i.object);
        expect(objs).toEqual(['sys_notification', 'sys_inbox_message', 'sys_notification_receipt']);

        // The event row id threads through to the materialization + receipt.
        expect(result.notificationId).toBe('row_1');
        const inbox = inserts.find((i) => i.object === 'sys_inbox_message')!;
        expect(inbox.row).toMatchObject({ user_id: 'user_1', title: 'Deal closed', notification_id: 'row_1' });
        const receipt = inserts.find((i) => i.object === 'sys_notification_receipt')!;
        expect(receipt.row).toMatchObject({ notification_id: 'row_1', user_id: 'user_1', channel: 'inbox', state: 'delivered' });
    });

    it('can be constructed without the inbox channel for an empty registry', async () => {
        const { ctx, services } = fakeCtx();
        await new MessagingServicePlugin({ registerInbox: false }).init(ctx);
        const messaging = services.get('messaging') as MessagingService;
        expect(messaging.getRegisteredChannels()).toEqual([]);
    });
});

/**
 * A ctx that supports `kernel:ready` hooks plus an engine modelling the
 * lazy-table behavior: `find()` throws "no such table" until
 * `syncObjectSchema()` has created it. Mirrors the audit-plugin coverage.
 */
function provisionCtx() {
    const tables = new Set<string>();
    const synced: string[] = [];
    const engine = {
        async syncObjectSchema(name: string) { synced.push(name); tables.add(name); },
        async find(object: string) {
            if (!tables.has(object)) throw new Error(`no such table: ${object}`);
            return [] as unknown[];
        },
        async insert() { return {}; },
        async findOne(object: string, query?: EngineFindOneQueryInput) {
                          assertEngineFindOnePredicate(object, query); return null; },
        async update() { return {}; },
        async delete() { return {}; },
    };
    const services = new Map<string, unknown>([
        ['data', engine],
        ['manifest', { register() {} }],
    ]);
    const readyHooks: Array<() => Promise<void> | void> = [];
    const logs: string[] = [];
    const logger = { info(msg: string) { logs.push(String(msg)); }, warn() {}, error() {}, debug() {}, child() { return logger; } };
    const ctx = {
        logger,
        getService(name: string) { return services.get(name); },
        registerService(name: string, svc: unknown) { services.set(name, svc); },
        hook(event: string, fn: () => Promise<void> | void) {
            if (event === 'kernel:ready') readyHooks.push(fn);
        },
    } as any;
    return { ctx, engine, synced, logs, fireReady: async () => { for (const fn of readyHooks) await fn(); } };
}

describe('MessagingServicePlugin — email/sms channel registration (kernel:ready)', () => {
    it('registers the sms channel when an sms service is present', async () => {
        const { ctx, fireReady } = provisionCtx();
        ctx.registerService('sms', { async send() { return { status: 'sent' }; } });
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);

        const messaging: any = ctx.getService('messaging');
        expect(messaging.getRegisteredChannels()).not.toContain('sms');
        await fireReady();
        expect(messaging.getRegisteredChannels()).toContain('sms');
    });

    it('does NOT register the sms channel when no sms service exists', async () => {
        const { ctx, fireReady } = provisionCtx();
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();
        const messaging: any = ctx.getService('messaging');
        expect(messaging.getRegisteredChannels()).not.toContain('sms');
    });

    // [#18050] The two pins above say what the mount answers at `kernel:ready`.
    // These say it is an ANSWER and not a VERDICT: the plugin reads the service
    // registry on every lookup, so a transport that registers after
    // `kernel:ready` — another plugin's own ready handler, `kernel:bootstrapped`,
    // `kernel:listening`, a runtime mount — still gets its channel. Before this,
    // `if (getSms())` ran once and recorded the absence as a permanent
    // non-registration, and every `notify(channels:['sms'])` for the life of the
    // process was refused as "not registered" with the transport sitting right
    // there in the registry.
    it('mounts the sms channel when the sms service arrives AFTER kernel:ready (#18050)', async () => {
        const { ctx, fireReady } = provisionCtx();
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();
        const messaging = ctx.getService('messaging') as MessagingService;
        expect(messaging.getRegisteredChannels()).not.toContain('sms');

        ctx.registerService('sms', { async send() { return { status: 'sent' }; } });

        expect(messaging.getRegisteredChannels()).toContain('sms');
        expect(messaging.getChannel('sms')?.id).toBe('sms');
    });

    it('mounts the email channel when the email service arrives AFTER kernel:ready, and builds it ONCE (#18050)', async () => {
        const { ctx, fireReady, logs } = provisionCtx();
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();
        const messaging = ctx.getService('messaging') as MessagingService;
        expect(messaging.getRegisteredChannels()).not.toContain('email');

        ctx.registerService('email', { async send() { return { id: 'mail_1' }; } });

        const first = messaging.getChannel('email');
        expect(first?.id).toBe('email');
        // The mount is re-decided per lookup; the channel OBJECT is not rebuilt
        // per lookup, so it keeps its identity (and its template-store handle)
        // and announces the bind exactly once however often it is consulted.
        expect(messaging.getChannel('email')).toBe(first);
        expect(messaging.getRegisteredChannels()).toContain('email');
        expect(logs.filter((l) => l.includes('email channel registered'))).toHaveLength(1);
    });
});

describe('MessagingServicePlugin — system table provisioning', () => {
    it('creates the inbox + receipt tables on kernel:ready', async () => {
        const { ctx, engine, synced, fireReady } = provisionCtx();
        // reliableDelivery/retention off so only the provisioning hook runs.
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);

        // Before kernel:ready the inbox read throws the "no such table" the
        // engine logs as `Find operation failed`.
        await expect(engine.find('sys_inbox_message')).rejects.toThrow(/no such table/);

        await fireReady();

        expect(synced).toEqual(
            expect.arrayContaining(['sys_inbox_message', 'sys_notification_receipt']),
        );
        await expect(engine.find('sys_inbox_message')).resolves.toEqual([]);
        await expect(engine.find('sys_notification_receipt')).resolves.toEqual([]);
    });
});

/**
 * [#22984] `skipSchemaSync` / `OS_SKIP_SCHEMA_SYNC=1` declares a deployment's
 * DDL managed out-of-band. The engine's boot honours it, and this service's
 * boot-time provisioning is DDL too, so it honours the same declaration: no
 * DDL, one `info` line naming what it skipped. The wording is not pinned; the
 * level, the count and the named subjects are.
 */
describe('MessagingServicePlugin — boot provisioning honours skipSchemaSync (#22984)', () => {
    const OBJECTS = [
        'sys_notification', 'sys_inbox_message', 'sys_notification_receipt', 'sys_notification_delivery',
        'sys_notification_preference', 'sys_notification_template', 'sys_http_delivery',
    ];
    const SKIP = 'NOT provisioned at boot';

    /** A ctx recording every log level, over whatever engine `data` resolves to. */
    function recordingCtx(engine: unknown) {
        const services = new Map<string, unknown>([['data', engine], ['manifest', { register() {} }]]);
        const readyHooks: Array<() => Promise<void> | void> = [];
        const logs = { info: [] as string[], warn: [] as string[], error: [] as string[] };
        const logger = {
            info(msg: string) { logs.info.push(String(msg)); },
            warn(msg: string) { logs.warn.push(String(msg)); },
            error(msg: string) { logs.error.push(String(msg)); },
            debug() {},
            child() { return logger; },
        };
        const ctx = {
            logger,
            getService(name: string) { return services.get(name); },
            registerService(name: string, svc: unknown) { services.set(name, svc); },
            hook(event: string, fn: () => Promise<void> | void) {
                if (event === 'kernel:ready') readyHooks.push(fn);
            },
        } as any;
        return { ctx, logs, fireReady: async () => { for (const fn of readyHooks) await fn(); } };
    }

    it('flag set: no DDL, the tables stay absent, and ONE info line names the skip', async () => {
        // Only the lazy-table engine is taken from `provisionCtx`; the ctx is this block's.
        const { engine, synced } = provisionCtx();
        Object.assign(engine, { skipSchemaSync: true });
        const { ctx, logs, fireReady } = recordingCtx(engine);
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();

        expect(synced).toEqual([]);
        // The triage pin in this model: a table that was not there stays not there.
        await expect(engine.find('sys_inbox_message')).rejects.toThrow(/no such table/);

        const skip = logs.info.filter((m) => m.includes(SKIP));
        expect(skip).toHaveLength(1);
        for (const name of OBJECTS) expect(skip[0]).toContain(name);
        expect(skip[0]).toContain('OS_SKIP_SCHEMA_SYNC');
        expect(skip[0]).toContain('os migrate apply');
        // `info`, because nothing is degraded: it is not ALSO said louder.
        expect(logs.warn.filter((m) => /provision/.test(m))).toEqual([]);
        expect(logs.error).toEqual([]);
    });

    it('CONTROL: flag published as false, every table is provisioned exactly as before', async () => {
        const { engine, synced } = provisionCtx();
        Object.assign(engine, { skipSchemaSync: false });
        const { ctx, logs, fireReady } = recordingCtx(engine);
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();

        expect(synced).toEqual(OBJECTS);
        await expect(engine.find('sys_inbox_message')).resolves.toEqual([]);
        expect(logs.info.some((m) => m.includes(SKIP))).toBe(false);
    });

    /** Construct under a given `OS_SKIP_SCHEMA_SYNC`, which `ObjectQLPlugin` reads in its constructor. */
    function withSkipEnv<T>(value: string | undefined, build: () => T): T {
        const previous = process.env.OS_SKIP_SCHEMA_SYNC;
        try {
            if (value === undefined) delete process.env.OS_SKIP_SCHEMA_SYNC;
            else process.env.OS_SKIP_SCHEMA_SYNC = value;
            return build();
        } finally {
            if (previous === undefined) delete process.env.OS_SKIP_SCHEMA_SYNC;
            else process.env.OS_SKIP_SCHEMA_SYNC = previous;
        }
    }

    /**
     * The value read is the one the REAL `ObjectQLPlugin` resolved and published
     * on its engine: the producer here is not a stand-in, so the undeclared
     * engine property both sides spell is pinned end to end. The last row
     * discriminates: an explicit `skipSchemaSync: false` beats
     * `OS_SKIP_SCHEMA_SYNC=1`, so a reader that consulted the environment itself
     * would skip there. `registerProtocol: false` only keeps protocol assembly,
     * which this fake context cannot host, out of `init()`.
     */
    it.each([
        { label: 'option true', option: true, env: undefined, skips: true },
        { label: 'option unset, OS_SKIP_SCHEMA_SYNC=1', option: undefined, env: '1', skips: true },
        { label: 'option unset, env unset', option: undefined, env: undefined, skips: false },
        { label: 'option false beats OS_SKIP_SCHEMA_SYNC=1', option: false, env: '1', skips: false },
    ])('real ObjectQLPlugin, $label ⇒ skips: $skips', async ({ option, env, skips }) => {
        const qlPlugin = withSkipEnv(env, () =>
            new ObjectQLPlugin({ registerProtocol: false, ...(option === undefined ? {} : { skipSchemaSync: option }) }),
        );
        const { ctx, logs, fireReady } = recordingCtx(undefined);
        await qlPlugin.init(ctx);
        const engine = ctx.getService('data') as { syncObjectSchema(name: string): Promise<void> };
        const sync = vi.spyOn(engine, 'syncObjectSchema').mockResolvedValue(undefined);

        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        await fireReady();

        const skip = logs.info.filter((m) => m.includes(SKIP));
        if (skips) {
            expect(sync).not.toHaveBeenCalled();
            expect(skip).toHaveLength(1);
        } else {
            for (const name of OBJECTS) expect(sync).toHaveBeenCalledWith(name);
            expect(skip).toEqual([]);
        }
    });
});

/**
 * [#22985] A failed boot provision is a DURABILITY degradation, so it is
 * reported at `error` — once per object, never per write — and the boot is not
 * failed.
 *
 * When an object's DDL throws, the boot still completes and the deployment
 * serves as healthy while the table does not exist; the pipeline tables are
 * written as a side effect of actions (an approval step, an @mention) that
 * complete without them. AGENTS.md "Degradation log levels" sends that class to
 * `error`, with the consequence and the fix in the first line. The wording is
 * not pinned: the pins hold the level, the count, the named object, the named
 * remedy command and the driver's refusal in meta.
 */
describe('MessagingServicePlugin — a failed provision is an error, once per object (#22985)', () => {
    const OBJECTS = [
        'sys_notification', 'sys_inbox_message', 'sys_notification_receipt', 'sys_notification_delivery',
        'sys_notification_preference', 'sys_notification_template', 'sys_http_delivery',
    ];

    /** Every DDL succeeds except the named object's, which the driver refuses. */
    async function boot(refused?: string) {
        const synced: string[] = [];
        const engine = {
            async syncObjectSchema(name: string) {
                if (name === refused) throw new Error(`there is already an index named ${name}`);
                synced.push(name);
            },
        };
        const services = new Map<string, unknown>([['data', engine], ['manifest', { register() {} }]]);
        const readyHooks: Array<() => Promise<void> | void> = [];
        const logs = {
            warn: [] as string[],
            error: [] as Array<{ message: string; error: unknown; meta: Record<string, unknown> | undefined }>,
        };
        const logger = {
            info() {},
            warn(msg: string) { logs.warn.push(String(msg)); },
            error(msg: string, error?: unknown, meta?: Record<string, unknown>) {
                logs.error.push({ message: String(msg), error, meta });
            },
            debug() {},
            child() { return logger; },
        };
        const ctx = {
            logger,
            getService(name: string) { return services.get(name); },
            registerService(name: string, svc: unknown) { services.set(name, svc); },
            hook(event: string, fn: () => Promise<void> | void) {
                if (event === 'kernel:ready') readyHooks.push(fn);
            },
        } as any;
        await new MessagingServicePlugin({ reliableDelivery: false }).init(ctx);
        // The boot is NOT failed: kernel:ready resolves.
        await expect((async () => { for (const fn of readyHooks) await fn(); })()).resolves.toBeUndefined();
        return { logs, synced };
    }

    it.each(OBJECTS)('a refused DDL for %s logs exactly one error line naming it, the remedy and the refusal', async (name) => {
        const { logs, synced } = await boot(name);

        expect(logs.error).toHaveLength(1);
        const [line] = logs.error;
        expect(line.message).toContain(name);
        // ② the fix, by its named subject: the command measured to create it.
        expect(line.message).toContain('os migrate apply');
        // One line: the first line carries both halves.
        expect(line.message).not.toContain('\n');
        // The driver's refusal travels in meta, never interpolated into the line.
        expect(line.meta).toEqual({ object: name, error: `there is already an index named ${name}` });
        // …and it is not ALSO reported at a quieter level.
        expect(logs.warn.filter((m) => m.includes('could not provision'))).toEqual([]);
        // The other seven objects still provisioned.
        expect(synced).toEqual(OBJECTS.filter((o) => o !== name));
    });

    it('CONTROL: a clean provision logs no error at all', async () => {
        const { logs, synced } = await boot();

        expect(logs.error).toEqual([]);
        expect(logs.warn.filter((m) => m.includes('could not provision'))).toEqual([]);
        expect(synced).toEqual(OBJECTS);
    });
});
