// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import { ExpressionEngine } from '@objectstack/formula';
import {
    RecordChangeTrigger,
    triggerTypeToHookEvent,
    triggerTypeToHookEvents,
    type FlowTriggerBinding,
    type RecordChangeDataEngine,
    type TriggerLogger,
} from './record-change-trigger.js';
import { RecordChangeTriggerPlugin } from './plugin.js';

/** CEL-evaluate `source` against `record` — the SAME engine the automation
 *  service and rule-validator use, so a `record.a != null` fault/pass here is
 *  the real fault a flow's start/edge condition would hit, not a stand-in. */
function evalCel(source: string, ctx: { record?: Record<string, unknown>; previous?: Record<string, unknown> }) {
    return ExpressionEngine.evaluate<boolean>({ dialect: 'cel', source }, ctx);
}

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
        // `data` is what every engine write path actually builds — see the
        // objectql pin `hook-input-shape-contract.test.ts` (#5273). The old
        // spelling here was `doc`, a key no producer ever wrote (#5671).
        input: { id: 't1', data: { status: 'done' } },
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

    it('returns null for the multi-event write token (use triggerTypeToHookEvents)', () => {
        // `write` maps to TWO events, which the singular mapper cannot express —
        // it returns null rather than silently dropping one binding.
        expect(triggerTypeToHookEvent('record-after-write')).toBeNull();
        expect(triggerTypeToHookEvent('record-before-write')).toBeNull();
    });
});

// ─── triggerTypeToHookEvents ────────────────────────────────────────

describe('triggerTypeToHookEvents', () => {
    it('maps single-lifecycle tokens to a one-element list', () => {
        expect(triggerTypeToHookEvents('record-after-create')).toEqual(['afterInsert']);
        expect(triggerTypeToHookEvents('record-after-update')).toEqual(['afterUpdate']);
        expect(triggerTypeToHookEvents('record-before-delete')).toEqual(['beforeDelete']);
        expect(triggerTypeToHookEvents('record-after-insert')).toEqual(['afterInsert']);
    });

    it('expands `write` into the create-OR-update union (#3427)', () => {
        expect(triggerTypeToHookEvents('record-after-write')).toEqual(['afterInsert', 'afterUpdate']);
        expect(triggerTypeToHookEvents('record-before-write')).toEqual(['beforeInsert', 'beforeUpdate']);
    });

    it('returns an empty list for unsupported / missing tokens', () => {
        expect(triggerTypeToHookEvents(undefined)).toEqual([]);
        expect(triggerTypeToHookEvents('schedule')).toEqual([]);
        expect(triggerTypeToHookEvents('record-after-frobnicate')).toEqual([]);
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

    it('rejects an array-form trigger event with a targeted message, not bound (#3481)', () => {
        // Multi-event arrays are unsupported (#3457). The engine forwards the raw
        // array via config (with a joined `event` string that maps to no hook), so
        // the trigger can steer the author to the supported alternatives instead of
        // the generic "unsupported trigger event" line.
        const { engine, hooks } = fakeEngine();
        const warn = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn, debug: () => {} });

        trigger.start(
            binding({
                event: 'record-after-create,record-after-delete',
                config: { triggerType: ['record-after-create', 'record-after-delete'] },
            }),
            async () => {},
        );

        expect(hooks).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg).toMatch(/task_assigned_notify/);
        expect(msg).toMatch(/array/i);
        expect(msg).toMatch(/record-after-write/);
        expect(msg).toMatch(/#3457/);
    });

    it('keeps the generic unsupported-event warning for a non-array bad token', () => {
        const { engine, hooks } = fakeEngine();
        const warn = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn, debug: () => {} });

        trigger.start(binding({ event: 'record-after-updated' }), async () => {});

        expect(hooks).toHaveLength(0);
        expect(warn).toHaveBeenCalledTimes(1);
        const msg = String(warn.mock.calls[0][0]);
        expect(msg).toMatch(/unsupported trigger event/i);
        expect(msg).toMatch(/record-after-updated/);
    });

    it('binds BOTH afterInsert and afterUpdate for record-after-write (create OR update, #3427)', () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding({ event: 'record-after-write' }), async () => {});

        // One start node → both lifecycle hooks, same object, same packageId
        // (so a single stop() tears both down).
        expect(hooks).toHaveLength(2);
        expect(hooks.map((h) => h.event).sort()).toEqual(['afterInsert', 'afterUpdate']);
        expect(hooks.every((h) => h.object === 'showcase_task')).toBe(true);
        expect(new Set(hooks.map((h) => h.packageId)).size).toBe(1);
        expect(hooks[0].packageId).toBe('com.objectstack.trigger.record-change:task_assigned_notify');
    });

    it('a record-after-write flow fires on both the insert hook and the update hook', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let fired = 0;

        trigger.start(binding({ event: 'record-after-write' }), async () => {
            fired += 1;
        });

        const insertHook = hooks.find((h) => h.event === 'afterInsert')!;
        const updateHook = hooks.find((h) => h.event === 'afterUpdate')!;

        // Insert: no previous row.
        await insertHook.handler(hookCtx({ event: 'afterInsert', previous: undefined }));
        // Update: previous row present.
        await updateHook.handler(hookCtx({ event: 'afterUpdate' }));

        expect(fired).toBe(2);
    });

    it('stop() tears down BOTH hooks of a record-after-write flow', () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding({ event: 'record-after-write' }), async () => {});
        expect(hooks).toHaveLength(2);

        trigger.stop('task_assigned_notify');
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

    // [#5671] `input.data` is the ONE key a write hook's payload arrives under.
    // objectql's `hook-input-shape-contract.test.ts` measures that on the engine
    // ("insert carries `data` — never `doc`"); these two pin that this consumer
    // reads exactly that key and nothing else. The pair is deliberate: the
    // positive case alone would stay green if the deleted `doc` alias limb were
    // put back (`data` sits first in the read, so it wins either way), so the
    // NEGATIVE case is the one carrying the weight — it goes red the moment any
    // alias limb returns.
    //
    // [#4953, services half] The expected object grew an `_id` and `assignee`
    // that `hookCtx()`'s default `previous` carries and `data` does not touch —
    // a before-hook's `record` now layers the prior row as its BASE (so an
    // untouched declared field keeps its real persisted value instead of going
    // missing/`null`), and `data`'s own `status` still wins over `previous`'s
    // stale one. That `status` win is what this test still pins: the payload
    // key read is `data`, never `doc`.
    it('seeds the record from input.data OVER previous when result is absent (e.g. before-hooks)', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-before-update' }), async (ctx) => {
            captured = ctx;
        });

        await hooks[0].handler(hookCtx({ event: 'beforeUpdate', result: undefined }));

        expect(captured?.record).toEqual({ _id: 't1', status: 'done', assignee: 'u1' });
    });

    it('does NOT read a `doc` alias off input — no engine path produces that key', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-before-update' }), async (ctx) => {
            captured = ctx;
        });

        // `previous` is dropped too, so the seed can only come from the payload:
        // with `doc` unread there is nothing left and the record is empty.
        await hooks[0].handler(
            hookCtx({
                event: 'beforeUpdate',
                result: undefined,
                previous: undefined,
                input: { id: 't1', doc: { status: 'done' } } as HookContext['input'],
            }),
        );

        expect(captured?.record).toEqual({});
        expect((captured?.record as Record<string, unknown>).status).toBeUndefined();
    });

    // [#6978] The `ctx.__previous` stash limb, deleted — same family as the `doc`
    // alias above, same negative-pin treatment. `plugin-audit`'s `captureBefore`
    // was the stash's ONLY producer and #6656 retired it, leaving the fallback
    // with zero producers; ADR-0049 enforce-or-remove says it goes.
    //
    // This case REPLACES the one that used to live here ("reads the __previous
    // stash when ctx.previous is absent"), which synthesised the key in its own
    // body — the #4984 shape: a fixture spelling a key no producer emits, keeping
    // a dead limb looking live. A positive case can never carry the weight here
    // either, because the canonical key sits FIRST in the read and wins whether or
    // not the limb exists. So the pin is inverted: restore the limb and this case
    // goes red on both assertions (`previous` becomes `{ status: 'old' }`, and the
    // record seeds from it instead of staying empty).
    it('does NOT read the `__previous` stash — no producer emits that key (#6978)', async () => {
        const { engine, hooks } = fakeEngine();
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding(), async (ctx) => {
            captured = ctx;
        });

        // Every declared source of a pre-image is dropped, so the stash is the only
        // thing left that could answer — and it must not.
        const ctx = hookCtx({ result: undefined, previous: undefined, input: { id: 't1' } });
        (ctx as unknown as { __previous: Record<string, unknown> }).__previous = { status: 'old' };
        await hooks[0].handler(ctx);

        expect(captured?.previous).toBeUndefined();
        expect(captured?.record).toEqual({});
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

// ─── computed-field hydration (#3426) ───────────────────────────────

describe('RecordChangeTrigger computed-field hydration (#3426)', () => {
    interface FindOneCall {
        object: string;
        options: { where?: Record<string, unknown>; fields?: string[]; context?: unknown };
    }

    /** fakeEngine + a `findOne` that records its calls and returns `row`. */
    function fakeEngineWithRead(row: Record<string, unknown> | null | undefined) {
        const base = fakeEngine();
        const calls: FindOneCall[] = [];
        const engine: RecordChangeDataEngine = {
            ...base.engine,
            async findOne(object, options) {
                calls.push({ object, options });
                return row;
            },
        };
        return { engine, hooks: base.hooks, calls };
    }

    it('hydrates a formula field the raw hook row lacks (after-create)', async () => {
        // The re-read returns the formula virtual `full_name` (absent from the
        // written row) plus a field only the read path carries. After the merge
        // the flow sees the formula, and raw scalars still win.
        const { engine, hooks, calls } = fakeEngineWithRead({
            id: 'r1',
            first_name: 'Ada',
            last_name: 'Lovelace',
            full_name: 'Ada Lovelace',
            company: 'Analytical Engines',
        });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(
            binding({ object: 'crm_lead', event: 'record-after-create' }),
            async (ctx) => { captured = ctx; },
        );
        await hooks[0].handler(
            hookCtx({ event: 'afterInsert', result: { id: 'r1', first_name: 'Ada', last_name: 'Lovelace' } }),
        );

        // Formula virtual is now resolvable on the seeded record…
        expect((captured?.record as Record<string, unknown>).full_name).toBe('Ada Lovelace');
        expect((captured?.record as Record<string, unknown>).company).toBe('Analytical Engines');
        // …and params mirrors the same hydrated record.
        expect((captured?.params as Record<string, unknown>)?.full_name).toBe('Ada Lovelace');
        // Re-read was a system-elevated findOne scoped to the written row.
        expect(calls).toHaveLength(1);
        expect(calls[0].object).toBe('crm_lead');
        expect(calls[0].options.where).toEqual({ id: 'r1' });
        expect((calls[0].options.context as { isSystem?: boolean }).isSystem).toBe(true);
    });

    it('lets raw hook fields win over the re-read (trigger-time fidelity + #1872)', async () => {
        // A concurrent read could observe a newer scalar or drop a multi-lookup
        // array the driver echoed into the raw row; the raw value must survive.
        const { engine, hooks } = fakeEngineWithRead({
            id: 'r1',
            status: 'stale',
            target_channels: undefined,
            full_name: 'Ada Lovelace',
        });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ object: 'crm_lead', event: 'record-after-update' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(
            hookCtx({ event: 'afterUpdate', result: { id: 'r1', status: 'fresh', target_channels: ['ch_1'] } }),
        );

        const rec = captured?.record as Record<string, unknown>;
        expect(rec.status).toBe('fresh'); // raw wins
        expect(rec.target_channels).toEqual(['ch_1']); // #1872 array preserved
        expect(rec.full_name).toBe('Ada Lovelace'); // formula added
    });

    it('does not re-read for before-* events (row not yet persisted)', async () => {
        const { engine, hooks, calls } = fakeEngineWithRead({ id: 'r1', full_name: 'x' });
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding({ object: 'crm_lead', event: 'record-before-update' }), async () => {});
        await hooks[0].handler(hookCtx({ event: 'beforeUpdate', result: { id: 'r1' } }));

        expect(calls).toHaveLength(0);
    });

    it('does not re-read for after-delete (row is gone)', async () => {
        const { engine, hooks, calls } = fakeEngineWithRead({ id: 'r1', full_name: 'x' });
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding({ object: 'crm_lead', event: 'record-after-delete' }), async () => {});
        await hooks[0].handler(hookCtx({ event: 'afterDelete', result: { id: 'r1' } }));

        expect(calls).toHaveLength(0);
    });

    it('does not re-read when the record has no id', async () => {
        const { engine, hooks, calls } = fakeEngineWithRead({ id: 'r1', full_name: 'x' });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ object: 'crm_lead', event: 'record-after-create' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(hookCtx({ event: 'afterInsert', result: { first_name: 'Ada' } }));

        expect(calls).toHaveLength(0);
        expect((captured?.record as Record<string, unknown>).first_name).toBe('Ada');
    });

    it('falls back to the raw record when the re-read throws', async () => {
        const base = fakeEngine();
        const engine: RecordChangeDataEngine = {
            ...base.engine,
            async findOne() { throw new Error('db down'); },
        };
        const debug = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn: () => {}, debug });
        let captured: AutomationContext | undefined;

        trigger.start(binding({ object: 'crm_lead', event: 'record-after-create' }), async (ctx) => { captured = ctx; });
        await base.hooks[0].handler(hookCtx({ event: 'afterInsert', result: { id: 'r1', first_name: 'Ada' } }));

        // Flow still runs with the raw record; the failure is a debug note only.
        expect((captured?.record as Record<string, unknown>).first_name).toBe('Ada');
        expect((captured?.record as Record<string, unknown>).full_name).toBeUndefined();
        expect(debug).toHaveBeenCalled();
    });

    it('is a no-op on engines with no findOne surface (older cores)', async () => {
        const { engine, hooks } = fakeEngine(); // no findOne
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ object: 'crm_lead', event: 'record-after-create' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(hookCtx({ event: 'afterInsert', result: { id: 'r1', first_name: 'Ada' } }));

        expect((captured?.record as Record<string, unknown>).first_name).toBe('Ada');
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

// ─── Computed-field hydration guards (#3426 follow-up, #8482) ───────
//
// The hydration re-read (#3426, #3445) is gated two ways: skipped when the
// object declares no `formula` field, and memoized so N flows on one write
// share a single re-read. These drive a fakeEngine with findOne/getObject
// spies and a hook ctx whose result carries a real `id` (the default hookCtx
// uses `_id`, so hydration's `record.id` is undefined and never re-reads).
//
// `getObject` — not a separate `getObjectConfig` — is the schema-gate
// accessor since #8482: it is the ONE object-schema accessor the concrete
// ObjectQL engine actually implements (confirmed by
// `record-change-integration.test.ts`'s "hydration schema gate — real
// ObjectQL engine findOne count" block below, which runs this exact gate
// against a REAL engine rather than a hand-attached mock — the vacuity these
// fakeEngine tests alone cannot rule out).

describe('RecordChangeTrigger computed-field hydration guards (#3426 follow-up, #8482)', () => {
    /** A hook ctx whose after-row has a real `id`, so hydration proceeds. */
    function idCtx(overrides: Partial<HookContext> = {}): HookContext {
        return hookCtx({ event: 'afterUpdate', result: { id: 't1', status: 'done' }, ...overrides });
    }

    it('skips the re-read when the object declares no formula field (schema gate)', async () => {
        const { engine, hooks } = fakeEngine();
        const findOne = vi.fn().mockResolvedValue({ id: 't1', full_name: 'X' });
        const getObject = vi.fn().mockReturnValue({ fields: { title: { type: 'text' } } });
        Object.assign(engine, { findOne, getObject });
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding(), async () => {});
        await hooks[0].handler(idCtx());

        expect(getObject).toHaveBeenCalledWith('showcase_task');
        expect(findOne).not.toHaveBeenCalled();
    });

    it('re-reads and hydrates when the object declares a formula field', async () => {
        const { engine, hooks } = fakeEngine();
        const findOne = vi.fn().mockResolvedValue({ id: 't1', status: 'done', full_name: 'Ada Lovelace' });
        const getObject = vi.fn().mockReturnValue({ fields: { full_name: { type: 'formula' } } });
        Object.assign(engine, { findOne, getObject });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let seen: AutomationContext | undefined;

        trigger.start(binding(), async (ctx) => { seen = ctx; });
        await hooks[0].handler(idCtx());

        expect(findOne).toHaveBeenCalledTimes(1);
        expect(findOne).toHaveBeenCalledWith('showcase_task', expect.objectContaining({ where: { id: 't1' } }));
        // Formula virtual is now visible to the flow; raw scalar still wins.
        expect((seen?.record as Record<string, unknown>).full_name).toBe('Ada Lovelace');
        expect((seen?.record as Record<string, unknown>).status).toBe('done');
    });

    it('re-reads unconditionally when the engine has no getObject (prior behavior)', async () => {
        const { engine, hooks } = fakeEngine();
        const findOne = vi.fn().mockResolvedValue({ id: 't1', full_name: 'X' });
        Object.assign(engine, { findOne }); // no getObject surface
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding(), async () => {});
        await hooks[0].handler(idCtx());

        expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('memoizes the re-read across N flows sharing one write (single findOne)', async () => {
        const { engine, hooks } = fakeEngine();
        const findOne = vi.fn().mockResolvedValue({ id: 't1', full_name: 'X' });
        const getObject = vi.fn().mockReturnValue({ fields: { full_name: { type: 'formula' } } });
        Object.assign(engine, { findOne, getObject });
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        // Two flows on the same object/event → two hooks, one trigger instance.
        trigger.start(binding({ flowName: 'flow_a' }), async () => {});
        trigger.start(binding({ flowName: 'flow_b' }), async () => {});
        expect(hooks).toHaveLength(2);

        // The engine passes ONE ctx ref to every handler for a single write.
        const ctx = idCtx();
        await hooks[0].handler(ctx);
        await hooks[1].handler(ctx);

        expect(findOne).toHaveBeenCalledTimes(1);
    });

    it('re-reads again for a DIFFERENT write (distinct ctx, not cross-write cached)', async () => {
        const { engine, hooks } = fakeEngine();
        const findOne = vi.fn().mockResolvedValue({ id: 't1', full_name: 'X' });
        const getObject = vi.fn().mockReturnValue({ fields: { full_name: { type: 'formula' } } });
        Object.assign(engine, { findOne, getObject });
        const trigger = new RecordChangeTrigger(engine, silentLogger());

        trigger.start(binding(), async () => {});
        await hooks[0].handler(idCtx());
        await hooks[0].handler(idCtx()); // a fresh ctx object = a new write

        expect(findOne).toHaveBeenCalledTimes(2);
    });
});

// ─── declared-field materialization (#4953, services half) ──────────
//
// Measured mechanism (matches the issue's own repro, run here through the
// SAME `@objectstack/formula` CEL engine the automation service and
// rule-validator use — not a stand-in):
//
//   evalCel('record.a != null', { record: { a: null } })  → { ok: true,  value: false }
//   evalCel('record.a != null', { record: {} })            → { ok: false, error: 'No such key: a' }
//
// So whether a declared field is a present key (even holding `null`) decides
// whether a flow's `record.x != null` start/edge condition evaluates at all.
describe('RecordChangeTrigger materializes declared fields (#4953, services half)', () => {
    /** fakeEngine + a `getObject` returning the given field map (the ONE
     *  method actually wired on the real ObjectQL engine — `getObjectConfig`
     *  is not, see the interface doc on `RecordChangeDataEngine`). */
    function fakeEngineWithSchema(fields: Record<string, unknown>) {
        const base = fakeEngine();
        const getObject = vi.fn().mockReturnValue({ fields });
        const engine: RecordChangeDataEngine = { ...base.engine, getObject };
        return { engine, hooks: base.hooks, getObject };
    }

    it('RED before the fix, reproduced directly: the OLD raw merge faults on an untouched declared field', () => {
        // What `buildContext` used to hand CEL for this exact scenario — the
        // driver's after-row + payload, with NO prior-row fold-in and no
        // materialization. `a` is declared on the object but this write never
        // mentions it and the driver didn't echo it back.
        const oldShapeRecord = { ...{ b: 'new' }, ...{ id: 'r1', b: 'new' } }; // { id, b } — no `a`
        const res = evalCel('record.a != null', { record: oldShapeRecord });
        expect(res.ok).toBe(false);
        expect(String((res as { error?: { message?: string } }).error?.message)).toMatch(/no such key/i);
    });

    it('GREEN after the fix: an untouched declared field resolves to its REAL persisted value, not null (no fabrication)', async () => {
        const { engine, hooks } = fakeEngineWithSchema({ a: { type: 'text' }, b: { type: 'text' } });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-after-update' }), async (ctx) => { captured = ctx; });
        // Update touches only `b`. The driver's after-row echoes `id` + `b`
        // ONLY (the #1872 gap) — but `a`'s real value ('orig') is known from
        // `previous`, the row the engine fetched ahead of dispatch (#7867).
        await hooks[0].handler(hookCtx({
            event: 'afterUpdate',
            input: { id: 'r1', data: { b: 'new' } },
            result: { id: 'r1', b: 'new' },
            previous: { id: 'r1', a: 'orig', b: 'old' },
        }));

        const record = captured?.record as Record<string, unknown>;
        // Folded from `previous`, NOT materialized to null — materialization
        // only fills what is GENUINELY unknown, never overrides a known value.
        expect(record.a).toBe('orig');
        expect(record.b).toBe('new'); // the write's own value still wins

        const res = evalCel('record.a != null', { record });
        expect(res).toEqual({ ok: true, value: true });
    });

    it('GREEN after the fix: a field never set anywhere materializes to null (has() true, != null false — no fault)', async () => {
        const { engine, hooks } = fakeEngineWithSchema({ a: { type: 'text' }, b: { type: 'text' }, c: { type: 'text' } });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-after-update' }), async (ctx) => { captured = ctx; });
        // Neither `previous` nor this write ever mentions `c` — it genuinely
        // has no value, so `null` here is a materialised absence, not a
        // fabrication.
        await hooks[0].handler(hookCtx({
            event: 'afterUpdate',
            input: { id: 'r1', data: { b: 'new' } },
            result: { id: 'r1', b: 'new' },
            previous: { id: 'r1', a: 'x', b: 'old' },
        }));

        const record = captured?.record as Record<string, unknown>;
        expect(record.c).toBeNull();
        expect(evalCel('record.c != null', { record })).toEqual({ ok: true, value: false });
        // The documented, PINNED consequence (#4649 contract, unchanged here):
        // has() on a declared field is uniformly true once materialised — it
        // guards an undeclared KEY, never an empty value.
        expect(evalCel('has(record.c)', { record })).toEqual({ ok: true, value: true });
    });

    it('does NOT materialize on update when the prior row is unavailable (no fabrication without ground truth)', async () => {
        const { engine, hooks } = fakeEngineWithSchema({ a: { type: 'text' }, b: { type: 'text' } });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-after-update' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(hookCtx({
            event: 'afterUpdate',
            input: { id: 'r1', data: { b: 'new' } },
            result: { id: 'r1', b: 'new' },
            previous: undefined, // prior row not in hand
        }));

        const record = captured?.record as Record<string, unknown>;
        expect('a' in record).toBe(false); // left sparse, not fabricated
        const res = evalCel('record.a != null', { record });
        expect(res.ok).toBe(false); // fails closed, same policy as the validation seam
    });

    it('materializes unconditionally on insert (absence genuinely means "no value")', async () => {
        const { engine, hooks } = fakeEngineWithSchema({ a: { type: 'text' }, b: { type: 'text' } });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-after-create' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(hookCtx({
            event: 'afterInsert',
            input: { data: { b: 'new' } },
            result: { id: 'r1', b: 'new' },
            previous: undefined,
        }));

        const record = captured?.record as Record<string, unknown>;
        expect(record.a).toBeNull();
        expect(evalCel('record.a != null', { record })).toEqual({ ok: true, value: false });
    });

    it('materializes the `previous` root too, WITHOUT mutating the shared ctx.previous (no cross-binding leakage)', async () => {
        const { engine, hooks } = fakeEngineWithSchema({ a: { type: 'text' }, b: { type: 'text' } });
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;
        // The SAME object the engine would hand to every OTHER flow binding
        // sharing this write's HookContext.
        const sharedPrevious: Record<string, unknown> = { id: 'r1', b: 'old' }; // `a` never set

        trigger.start(binding({ event: 'record-after-update' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(hookCtx({
            event: 'afterUpdate',
            input: { id: 'r1', data: { b: 'new' } },
            result: { id: 'r1', b: 'new' },
            previous: sharedPrevious,
        }));

        expect((captured?.previous as Record<string, unknown>).a).toBeNull();
        // The shared object itself must be untouched — a second binding on the
        // same write must not see a materialised null it never asked for.
        expect('a' in sharedPrevious).toBe(false);
    });

    it('is a no-op when the engine has no getObject (structural fallback, no crash)', async () => {
        const { engine, hooks } = fakeEngine(); // no getObject surface at all
        const trigger = new RecordChangeTrigger(engine, silentLogger());
        let captured: AutomationContext | undefined;

        trigger.start(binding({ event: 'record-after-update' }), async (ctx) => { captured = ctx; });
        await hooks[0].handler(hookCtx({
            event: 'afterUpdate',
            input: { id: 'r1', data: { b: 'new' } },
            result: { id: 'r1', b: 'new' },
            previous: { id: 'r1', a: 'orig', b: 'old' },
        }));

        const record = captured?.record as Record<string, unknown>;
        // previous is still folded in as the base layer (that part doesn't
        // need field declarations) — only the null-fill step is skipped.
        expect(record.a).toBe('orig');
    });
});
