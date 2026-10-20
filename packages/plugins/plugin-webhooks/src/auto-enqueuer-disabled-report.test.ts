// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24910] A kernel with `webhooks` and without `realtime` delivers no declared
 * webhook — and says so ONCE, at `error`, and its declared-webhook reader tells
 * the activation door so.
 *
 * ## The defect
 *
 * The auto-enqueuer's only source of record events is the realtime service: the
 * engine publishes `data.record.*` through it and nothing else feeds the
 * enqueuer. Without it the plugin disabled the enqueuer with one boot `warn`,
 * while every record write still answered 200, the declaration still said the
 * webhook was active, and the activation door answered `enabled: true` for a
 * switch that switched nothing. By AGENTS.md "Degradation log levels" that is
 * the durability class: the system looks normal and a delivery it claims never
 * lands.
 *
 * ## What is pinned, on a real kernel boot
 *
 * A real `LiteKernel` runs the plugin's real `kernel:ready`; the engine is a
 * real `ObjectQL` over a real in-memory `SqlDriver`, the stack's webhook comes
 * from `defineWebhook` through the engine's real manifest decomposition
 * (`registerApp`), and the outbox is messaging's real `MessagingService`. Only
 * the realtime service is a stand-in, and only on the legs that mount one.
 *
 *  1. Declared webhook, no realtime: one `error` naming the webhook, `realtime`
 *     and the fix; no `disabled` warn; the reader's `dispatchUnavailable()`
 *     names `realtime`; and a record write enqueues nothing (the loss itself).
 *  2. CONTROL, the same stack with realtime: no error, the reader answers
 *     `null`, and the same write enqueues one delivery — so leg 1's zero is the
 *     missing service and not a fixture that cannot deliver.
 *  3. No declared webhook, no realtime: the `warn` it always was, no `error`.
 *  4. `autoEnqueue: false`: the host's own choice — nothing reported, and the
 *     reader answers `null` (its redelivery reads the switch).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defineWebhook } from '@objectstack/spec/automation';
import type { IRealtimeService, RealtimeEventHandler, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { MemoryHttpOutbox, MessagingService, type EnqueueHttpInput } from '@objectstack/service-messaging';
import { DeclaredWebhookSource, declaredWebhookRefId } from './declared-webhooks.js';
import { SysWebhook } from './sys-webhook.object.js';
import { WebhookOutboxPlugin, type WebhookOutboxPluginOptions } from './webhook-outbox-plugin.js';

const OBJECT = 'my_app_note';
const HOOK = 'my_app_note_changed';
const silentLogger = { info() {}, warn() {}, error() {}, debug() {} } as any;

/** The webhook the card's reproduction declares, as `defineWebhook` authors it. */
const DECLARED = defineWebhook({
    name: HOOK,
    object: OBJECT,
    triggers: ['create', 'update', 'delete'],
    url: 'http://127.0.0.1:3999/hook',
    method: 'POST',
    isActive: true,
});

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

/** messaging's real outbox, with every enqueue it receives recorded. */
class RecordingOutbox extends MemoryHttpOutbox {
    readonly enqueued: EnqueueHttpInput[] = [];
    override async enqueue(input: EnqueueHttpInput): Promise<string> {
        this.enqueued.push(input);
        return super.enqueue(input);
    }
}

interface BootOptions {
    realtime?: boolean;
    declare?: boolean;
    plugin?: WebhookOutboxPluginOptions;
}

/**
 * Stands in for the plugin's declared dependency
 * (`dependencies = ['com.objectstack.service.messaging']`) and registers what a
 * served boot holds for `requires: ['webhooks']`: the engine, messaging, and
 * realtime only where the case asks.
 */
class FixturePlugin implements Plugin {
    name = 'com.objectstack.service.messaging';
    type = 'standard' as const;
    version = '1.0.0';
    readonly outbox = new RecordingOutbox();
    readonly messaging = new MessagingService({ logger: silentLogger });

    constructor(
        private readonly engine: ObjectQL,
        private readonly realtime: FakeRealtime | undefined,
    ) {
        this.messaging.setHttpOutbox(this.outbox);
    }

    init(ctx: PluginContext): void {
        ctx.registerService('manifest', { register: () => {}, list: () => [] });
        ctx.registerService('objectql', this.engine);
        ctx.registerService('messaging', this.messaging);
        if (this.realtime) ctx.registerService('realtime', this.realtime);
    }
}

/** The real plugin, with what its boot logs observed. */
class ObservedWebhookPlugin extends WebhookOutboxPlugin {
    readonly logs: Array<{ level: string; message: string; meta: unknown }> = [];

    override async init(ctx: PluginContext): Promise<void> {
        for (const level of ['debug', 'info', 'warn', 'error'] as const) {
            vi.spyOn(ctx.logger, level).mockImplementation((message: unknown, ...rest: unknown[]) => {
                this.logs.push({ level, message: String(message), meta: level === 'error' ? rest[1] : rest[0] });
            });
        }
        await super.init(ctx);
    }

    lines(level: string, fragment: string) {
        return this.logs.filter((l) => l.level === level && l.message.includes(fragment));
    }
}

const open: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (open.length) {
        try { await open.pop()?.(); } catch { /* already stopped */ }
    }
    vi.restoreAllMocks();
});

async function boot(options: BootOptions) {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registerApp({
        id: 'my_app',
        namespace: 'my_app',
        version: '0.0.0',
        objects: [{
            name: OBJECT,
            label: 'Note',
            // Owner sharing is not under test here — keep RLS out of the way.
            sharingModel: 'public_read_write',
            fields: { title: { type: 'text', label: 'Title' } },
        }],
        ...(options.declare === false ? {} : { webhooks: [DECLARED] }),
    });
    engine.registry.registerObject(SysWebhook as any, 'test');
    await engine.syncSchemas();
    const realtime = options.realtime ? new FakeRealtime() : undefined;
    if (realtime) engine.setRealtimeService(realtime);

    const fixture = new FixturePlugin(engine, realtime);
    const plugin = new ObservedWebhookPlugin(options.plugin);
    const kernel = new LiteKernel({ logger: { level: 'silent' } as any });
    kernel.use(fixture);
    kernel.use(plugin);
    await kernel.bootstrap();
    open.push(async () => { await kernel.shutdown(); await driver.disconnect(); });

    const reader = kernel.getService<DeclaredWebhookSource>('declaredWebhooks');
    const enqueuerStarted = (() => {
        try { return Boolean(kernel.getService('webhook.autoEnqueuer')); } catch { return false; }
    })();
    /** Insert then update one record, and give fire-and-forget enqueues a moment to land. */
    const writeRecord = async () => {
        const created: any = await engine.insert(OBJECT, { title: 'seed' });
        await engine.update(OBJECT, { title: 'edited' }, { where: { id: created.id } });
        for (let i = 0; i < 20 && fixture.outbox.enqueued.length < 2; i++) await new Promise((r) => setTimeout(r, 25));
    };
    return { plugin, reader, enqueuerStarted, writeRecord, outbox: fixture.outbox };
}

describe('[#24910] the auto-enqueuer disabled on a stack that declares webhooks', () => {
    it('no realtime: ONE error naming the webhook, the missing service and the fix — and a record write enqueues nothing', async () => {
        const { plugin, reader, enqueuerStarted, writeRecord, outbox } = await boot({});

        const errors = plugin.lines('error', '[webhook-auto-enqueuer]');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toContain(HOOK);
        expect(errors[0].message).toContain("add 'realtime' to `requires`");
        expect(errors[0].meta).toMatchObject({ hasEngine: true, hasRealtime: false, hasMessaging: true, declared: [HOOK] });
        expect(plugin.lines('warn', 'auto-enqueuer] disabled')).toEqual([]);

        expect(enqueuerStarted).toBe(false);
        expect(reader).toBeInstanceOf(DeclaredWebhookSource);
        expect(reader.dispatchUnavailable()).toContain("add 'realtime' to `requires`");
        // The reader still answers the declaration — it is only dispatch that is missing.
        expect((await reader.declaredWebhookNamed(HOOK))?.active).toBe(true);

        await writeRecord();
        expect(outbox.enqueued).toEqual([]);
    });

    it('CONTROL — the same stack with realtime: no error, the reader answers null, and the same write is delivered', async () => {
        const { plugin, reader, enqueuerStarted, writeRecord, outbox } = await boot({ realtime: true });

        expect(plugin.lines('error', '[webhook-auto-enqueuer]')).toEqual([]);
        expect(enqueuerStarted).toBe(true);
        expect(reader.dispatchUnavailable()).toBeNull();

        await writeRecord();
        expect(outbox.enqueued.map((d) => [d.refId, d.label])).toEqual([
            [declaredWebhookRefId(HOOK), 'data.record.created'],
            [declaredWebhookRefId(HOOK), 'data.record.updated'],
        ]);
    });

    it('no declared webhook, no realtime: the warn it always was, never the error', async () => {
        const { plugin, reader } = await boot({ declare: false });

        expect(plugin.lines('error', '[webhook-auto-enqueuer]')).toEqual([]);
        const warns = plugin.lines('warn', 'auto-enqueuer] disabled');
        expect(warns).toHaveLength(1);
        expect(warns[0].meta).toMatchObject({ hasEngine: true, hasRealtime: false, hasMessaging: true });
        // Deployment-wide: a webhook declared later still could not be switched on here.
        expect(reader.dispatchUnavailable()).toContain("'realtime'");
    });

    it('`autoEnqueue: false` is the host\'s own composition: nothing reported, and the reader answers null', async () => {
        const { plugin, reader, enqueuerStarted } = await boot({ plugin: { autoEnqueue: false } });

        expect(plugin.lines('error', '[webhook-auto-enqueuer]')).toEqual([]);
        expect(plugin.lines('warn', '[webhook-auto-enqueuer]')).toEqual([]);
        expect(enqueuerStarted).toBe(false);
        expect(reader.dispatchUnavailable()).toBeNull();
    });
});
