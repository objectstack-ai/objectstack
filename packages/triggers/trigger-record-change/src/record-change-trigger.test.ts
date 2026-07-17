// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import {
    RecordChangeTrigger,
    triggerTypeToHookEvent,
    type FlowTriggerBinding,
    type RecordChangeDataEngine,
    type TriggerLogger,
} from './record-change-trigger.js';
import { RecordChangeTriggerPlugin } from './plugin.js';

// ─── Test doubles ───────────────────────────────────────────────────

interface RegisteredHook {
    event: string;
    handler: (ctx: HookContext) => unknown | Promise<unknown>;
    object?: string | string[];
    packageId?: string;
}

/** Fake ObjectQL engine: records registerHook calls + supports unregister. */
function fakeEngine() {
    const hooks: RegisteredHook[] = [];
    const engine: RecordChangeDataEngine = {
        registerHook(event, handler, options) {
            hooks.push({ event, handler, object: options?.object, packageId: options?.packageId });
        },
        unregisterHooksByPackage(packageId: string) {
            const before = hooks.length;
            for (let i = hooks.length - 1; i >= 0; i--) {
                if (hooks[i].packageId === packageId) hooks.splice(i, 1);
            }
            return before - hooks.length;
        },
    };
    return { engine, hooks };
}

function silentLogger(): TriggerLogger {
    return { info: () => {}, warn: () => {}, debug: () => {} };
}

function binding(overrides: Partial<FlowTriggerBinding> = {}): FlowTriggerBinding {
    return {
        flowName: 'task_assigned_notify',
        object: 'showcase_task',
        event: 'record-after-update',
        ...overrides,
    };
}

function hookCtx(overrides: Partial<HookContext> = {}): HookContext {
    return {
        object: 'showcase_task',
        event: 'afterUpdate',
        input: { id: 't1', doc: { status: 'done' } },
        result: { _id: 't1', status: 'done', assignee: 'u2' },
        previous: { _id: 't1', status: 'open', assignee: 'u1' },
        session: { userId: 'u9' },
        ql: {},
        ...overrides,
    } as HookContext;
}

// ─── triggerTypeToHookEvent ─────────────────────────────────────────

describe('triggerTypeToHookEvent', () => {
    it('maps after-create / after-update / after-delete', () => {
        expect(triggerTypeToHookEvent('record-after-create')).toBe('afterInsert');
        expect(triggerTypeToHookEvent('record-after-update')).toBe('afterUpdate');
        expect(triggerTypeToHookEvent('record-after-delete')).toBe('afterDelete');
    });

    it('maps before-* variants', () => {
        expect(triggerTypeToHookEvent('record-before-create')).toBe('beforeInsert');
        expect(triggerTypeToHookEvent('record-before-update')).toBe('beforeUpdate');
        expect(triggerTypeToHookEvent('record-before-delete')).toBe('beforeDelete');
    });

    it('treats record-*-insert as Insert too', () => {
        expect(triggerTypeToHookEvent('record-after-insert')).toBe('afterInsert');
    });

    it('returns null for unsupported / missing tokens', () => {
        expect(triggerTypeToHookEvent(undefined)).toBeNull();
        expect(triggerTypeToHookEvent('schedule')).toBeNull();
        expect(triggerTypeToHookEvent('record-after-frobnicate')).toBeNull();
        expect(triggerTypeToHookEvent('on_update')).toBeNull();
    });
});

// ─── RecordChangeTrigger ────────────────────────────────────────────

describe('RecordChangeTrigger', () => {
    it('registers a hook for the mapped event, filtered to the object', () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding(), async () => {});

        expect(hooks).toHaveLength(1);
        expect(hooks[0].event).toBe('afterUpdate');
        expect(hooks[0].object).toBe('showcase_task');
        expect(hooks[0].packageId).toBe('com.objectstack.trigger.record-change:task_assigned_notify');
    });

    it('does not register a hook for an unsupported trigger event', () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding({ event: 'schedule' }), async () => {});

        expect(hooks).toHaveLength(0);
    });

    it('warns when the flow targets an object the engine does not know (silent-miss guard)', () => {
        // 2026-07-17 third-party eval: a flow whose start-node `objectName`
        // does not match any registered object binds a hook that never fires —
        // with zero log output at any level. The trigger must surface that
        // mismatch loudly at bind time when the engine can be probed.
        const { engine, hooks } = fakeEngine();
        (engine as RecordChangeDataEngine & { getObject?: (n: string) => unknown }).getObject = (n: string) =>
            n === 'showcase_task' ? { name: 'showcase_task' } : undefined;
        const warn = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn, debug: () => {} });

        trigger.start(binding({ object: 'candidate' /* not registered */ }), async () => {});

        // Still binds (the object may legitimately be registered later on a
        // metadata reload), but the mismatch is called out.
        expect(hooks).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toMatch(/unknown object 'candidate'/i);
        expect(String(warn.mock.calls[0][0])).toMatch(/task_assigned_notify/);
    });

    it('does not warn when the target object is registered', () => {
        const { engine } = fakeEngine();
        (engine as RecordChangeDataEngine & { getObject?: (n: string) => unknown }).getObject = (n: string) =>
            n === 'showcase_task' ? { name: 'showcase_task' } : undefined;
        const warn = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn, debug: () => {} });

        trigger.start(binding(), async () => {});

        expect(warn).not.toHaveBeenCalled();
    });

    it('does not warn when the engine cannot be probed for objects', () => {
        // Engines without getObject (older cores, bare fakes) — no false alarm.
        const { engine } = fakeEngine();
        const warn = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn, debug: () => {} });

        trigger.start(binding({ object: 'anything' }), async () => {});

        expect(warn).not.toHaveBeenCalled();
    });

    it('fires the callback with a record context built from the hook ctx', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        const seen: AutomationContext[] = [];

        trigger.start(binding(), async (ctx) => {
            seen.push(ctx);
        });

        await hooks[0].handler(hookCtx());

        expect(seen).toHaveLength(1);
        const ctx = seen[0];
        expect(ctx.object).toBe('showcase_task');
        expect(ctx.event).toBe('record-after-update');
        expect(ctx.userId).toBe('u9');
        // new record = ctx.result
        expect(ctx.record).toEqual({ _id: 't1', status: 'done', assignee: 'u2' });
        // old record = ctx.previous
        expect(ctx.previous).toEqual({ _id: 't1', status: 'open', assignee: 'u1' });
        // record exposed as params too
        expect(ctx.params).toEqual(ctx.record);
    });

    it('falls back to input.doc when result is absent (e.g. before-hooks)', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-before-update' }), async (ctx) => {
            captured = ctx;
        });

        await hooks[0].handler(hookCtx({ event: 'beforeUpdate', result: undefined }));

        expect(captured?.record).toEqual({ status: 'done' });
    });

    it('reads the __previous stash when ctx.previous is absent', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding(), async (ctx) => {
            captured = ctx;
        });

        const ctx = hookCtx({ previous: undefined });
        (ctx as unknown as { __previous: Record<string, unknown> }).__previous = { status: 'old' };
        await hooks[0].handler(ctx);

        expect(captured?.previous).toEqual({ status: 'old' });
    });

    it('isolates flow errors so the CRUD write is never broken', async () => {
        const { engine, hooks } = fakeEngine();
        const warn = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn, debug: () => {} });

        trigger.start(binding(), async () => {
            throw new Error('flow blew up');
        });

        // Must resolve, not reject.
        await expect(hooks[0].handler(hookCtx())).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
    });

    it('stop() unregisters exactly that flow\'s hook', () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding({ flowName: 'flow_a' }), async () => {});
        trigger.start(binding({ flowName: 'flow_b' }), async () => {});
        expect(hooks).toHaveLength(2);

        trigger.stop('flow_a');
        expect(hooks).toHaveLength(1);
        expect(hooks[0].packageId).toBe('com.objectstack.trigger.record-change:flow_b');
    });

    it('re-binding the same flow is idempotent (no duplicate hooks)', () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding(), async () => {});
        trigger.start(binding(), async () => {});

        expect(hooks).toHaveLength(1);
    });

    it('stop() on an unknown flow is a no-op', () => {
        const { engine } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        expect(() => trigger.stop('never_bound')).not.toThrow();
    });
});

// ─── RecordChangeTriggerPlugin ──────────────────────────────────────

describe('RecordChangeTriggerPlugin', () => {
    interface FakeCtx {
        services: Record<string, unknown>;
        readyHandlers: Array<() => Promise<void> | void>;
        ctx: {
            logger: TriggerLogger;
            getService: <T>(name: string) => T;
            hook: (event: string, handler: () => Promise<void> | void) => void;
        };
    }

    function fakePluginCtx(services: Record<string, unknown>): FakeCtx {
        const readyHandlers: Array<() => Promise<void> | void> = [];
        return {
            services,
            readyHandlers,
            ctx: {
                logger: silentLogger() as TriggerLogger,
                getService<T>(name: string): T {
                    if (!(name in services)) throw new Error(`no service '${name}'`);
                    return services[name] as T;
                },
                hook(event: string, handler: () => Promise<void> | void) {
                    if (event === 'kernel:ready') readyHandlers.push(handler);
                },
            },
        };
    }

    it('registers the trigger on the automation service when both services exist', async () => {
        const registerTrigger = vi.fn();
        const { engine } = fakeEngine();
        const fake = fakePluginCtx({ automation: { registerTrigger }, objectql: engine });

        const plugin = new RecordChangeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        expect(registerTrigger).toHaveBeenCalledTimes(1);
        const trigger = registerTrigger.mock.calls[0][0] as RecordChangeTrigger;
        expect(trigger.type).toBe('record_change');
    });

    it('skips gracefully when the automation service is absent', async () => {
        const { engine } = fakeEngine();
        const fake = fakePluginCtx({ objectql: engine });

        const plugin = new RecordChangeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await expect(fake.readyHandlers[0]()).resolves.toBeUndefined();
    });

    it('skips gracefully when the ObjectQL engine is absent', async () => {
        const registerTrigger = vi.fn();
        const fake = fakePluginCtx({ automation: { registerTrigger } });

        const plugin = new RecordChangeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        expect(registerTrigger).not.toHaveBeenCalled();
    });

    it('falls back to the "data" engine alias', async () => {
        const registerTrigger = vi.fn();
        const { engine } = fakeEngine();
        const fake = fakePluginCtx({ automation: { registerTrigger }, data: engine });

        const plugin = new RecordChangeTriggerPlugin();
        await plugin.start(fake.ctx as never);
        await fake.readyHandlers[0]();

        expect(registerTrigger).toHaveBeenCalledTimes(1);
    });
});

// ─── seed / bulk suppression (context.skipTriggers) ─────────────────

describe('RecordChangeTrigger — skipTriggers suppression', () => {
    it('does NOT dispatch the flow when the write session sets skipTriggers (seed replay)', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let fired = 0;
        trigger.start(binding(), async () => { fired += 1; });

        // A seed/bulk write carries session.skipTriggers=true (from
        // ExecutionContext.skipTriggers threaded via buildSession).
        await hooks[0].handler(hookCtx({ session: { userId: 'u9', skipTriggers: true } as any }));
        expect(fired).toBe(0);
    });

    it('DOES dispatch the flow for a normal user write (skipTriggers absent)', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let fired = 0;
        trigger.start(binding(), async () => { fired += 1; });

        await hooks[0].handler(hookCtx());
        expect(fired).toBe(1);
    });
});
