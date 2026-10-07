// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0100 — the flow's trigger record is served on the generic read path's
 * terms. `RecordChangeTrigger.buildContext` projects BOTH roots it hands a flow
 * (`record` and `previous`, and `params`, which is the same object as
 * `record`) through `omitInternalFieldsFromWriteResponse` with the trigger
 * object's definition: a credential-class field carries `SECRET_MASK` (or
 * `null` when unset), an `internal: true` field is omitted, every other field
 * keeps its value, and the engine's own hook objects are left untouched.
 *
 * Everything downstream of the trigger (the variables map, a paused run's
 * persisted state and its read doors, a resumed run) inherits the projection;
 * the end-to-end half of that is pinned in
 * `packages/qa/dogfood/test/flow-trigger-record-credential-mask.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { AutomationContext } from '@objectstack/spec/contracts';
import type { HookContext } from '@objectstack/spec/data';
import { SECRET_MASK } from '@objectstack/spec/data';
import {
    RecordChangeTrigger,
    type FlowTriggerBinding,
    type RecordChangeDataEngine,
    type TriggerLogger,
} from './record-change-trigger.js';

const VAULT_FIELDS = {
    name: { type: 'text' },
    f_password: { type: 'password' },
    f_secret: { type: 'secret' },
    f_internal: { type: 'text', internal: true },
};

type Hook = { event: string; handler: (ctx: HookContext) => unknown | Promise<unknown> };

function engineWith(schema: Record<string, unknown> | undefined): { engine: RecordChangeDataEngine; hooks: Hook[] } {
    const hooks: Hook[] = [];
    const engine: RecordChangeDataEngine = {
        registerHook(event, handler) {
            hooks.push({ event, handler });
        },
        unregisterHooksByPackage() {
            return 0;
        },
        getObject: (name: string) => (name === 'vault' ? (schema as never) : undefined),
    };
    return { engine, hooks };
}

const logger: TriggerLogger = { info: () => {}, warn: () => {}, debug: () => {} };

const binding: FlowTriggerBinding = { flowName: 'vault_flow', object: 'vault', event: 'record-after-update' };

function updateCtx(): HookContext {
    return {
        object: 'vault',
        event: 'afterUpdate',
        input: { id: 'v1', data: { name: 'renamed', f_password: 'new-plain' } },
        result: { id: 'v1', name: 'renamed', f_password: 'new-plain', f_secret: 'sec_ref_1', f_internal: 'hidden-now' },
        previous: { id: 'v1', name: 'original', f_password: 'old-plain', f_secret: 'sec_ref_0', f_internal: 'hidden-before' },
        session: { userId: 'u1' },
        ql: {},
    } as unknown as HookContext;
}

async function fire(
    schema: Record<string, unknown> | undefined,
    ctx: HookContext,
    on: FlowTriggerBinding = binding,
): Promise<AutomationContext> {
    const { engine, hooks } = engineWith(schema);
    const trigger = new RecordChangeTrigger(engine, logger);
    let seen: AutomationContext | undefined;
    trigger.start(on, async (c) => {
        seen = c;
    });
    expect(hooks).toHaveLength(1);
    await hooks[0].handler(ctx);
    expect(seen, 'the flow callback never ran').toBeDefined();
    return seen!;
}

describe('the trigger record a flow receives carries the credential mask (ADR-0100)', () => {
    it('masks `password` and `secret` on `record` AND `previous`, and omits `internal: true` fields', async () => {
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, updateCtx());
        const record = c.record as Record<string, unknown>;
        const previous = c.previous as Record<string, unknown>;

        expect(record.f_password).toBe(SECRET_MASK);
        expect(record.f_secret).toBe(SECRET_MASK);
        expect('f_internal' in record).toBe(false);

        expect(previous.f_password).toBe(SECRET_MASK);
        expect(previous.f_secret).toBe(SECRET_MASK);
        expect('f_internal' in previous).toBe(false);
    });

    it('an ordinary field still reads its value on both roots', async () => {
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, updateCtx());
        expect((c.record as Record<string, unknown>).name).toBe('renamed');
        expect((c.previous as Record<string, unknown>).name).toBe('original');
        expect((c.record as Record<string, unknown>).id).toBe('v1');
    });

    it('`params` is the same masked object as `record`', async () => {
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, updateCtx());
        expect(c.params).toBe(c.record);
    });

    it('an UNSET credential field reads `null`, never the mask', async () => {
        const ctx = updateCtx();
        (ctx.result as Record<string, unknown>).f_secret = null;
        (ctx.previous as Record<string, unknown>).f_password = null;
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, ctx);
        expect((c.record as Record<string, unknown>).f_secret).toBeNull();
        expect((c.previous as Record<string, unknown>).f_password).toBeNull();
    });

    it("leaves the engine's own hook objects whole — privileged in-process readers are unchanged", async () => {
        const ctx = updateCtx();
        await fire({ name: 'vault', fields: VAULT_FIELDS }, ctx);
        expect(ctx.result).toEqual({
            id: 'v1', name: 'renamed', f_password: 'new-plain', f_secret: 'sec_ref_1', f_internal: 'hidden-now',
        });
        expect(ctx.previous).toEqual({
            id: 'v1', name: 'original', f_password: 'old-plain', f_secret: 'sec_ref_0', f_internal: 'hidden-before',
        });
        expect((ctx.input as { data: Record<string, unknown> }).data.f_password).toBe('new-plain');
    });

    it('masks on an insert too (no prior row: the definition is read regardless of ground truth)', async () => {
        const ctx = {
            object: 'vault',
            event: 'afterInsert',
            input: { data: { name: 'n', f_password: 'p' } },
            result: { id: 'v2', name: 'n', f_password: 'p', f_secret: 'sec_ref_2', f_internal: 'x' },
            session: {},
            ql: {},
        } as unknown as HookContext;
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, ctx);
        const record = c.record as Record<string, unknown>;
        expect(record.f_password).toBe(SECRET_MASK);
        expect(record.f_secret).toBe(SECRET_MASK);
        expect('f_internal' in record).toBe(false);
        expect(record.name).toBe('n');
    });

    it('a `password` field on a better-auth managed object stays clear — the same exemption the read path applies', async () => {
        const c = await fire({ name: 'vault', managedBy: 'better-auth', fields: VAULT_FIELDS }, updateCtx());
        const record = c.record as Record<string, unknown>;
        expect(record.f_password).toBe('new-plain');
        expect(record.f_secret).toBe(SECRET_MASK);
    });

    it('masks on an `afterDelete`, where `record` comes from the prior row', async () => {
        const ctx = {
            object: 'vault',
            event: 'afterDelete',
            input: { id: 'v1' },
            previous: { id: 'v1', name: 'gone', f_password: 'old-plain', f_secret: 'sec_ref_0', f_internal: 'hidden-before' },
            session: { userId: 'u1' },
            ql: {},
        } as unknown as HookContext;
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, ctx, {
            flowName: 'vault_flow', object: 'vault', event: 'record-after-delete',
        });
        const record = c.record as Record<string, unknown>;
        const previous = c.previous as Record<string, unknown>;
        expect(record.name, 'the record is seeded from the prior row').toBe('gone');
        for (const root of [record, previous]) {
            expect(root.f_password).toBe(SECRET_MASK);
            expect(root.f_secret).toBe(SECRET_MASK);
            expect('f_internal' in root).toBe(false);
        }
        expect((ctx.previous as Record<string, unknown>).f_password).toBe('old-plain');
    });

    it('masks on a `beforeUpdate`, where `record` is the payload over the prior row', async () => {
        const ctx = {
            object: 'vault',
            event: 'beforeUpdate',
            input: { id: 'v1', data: { name: 'renamed', f_password: 'new-plain' } },
            previous: { id: 'v1', name: 'original', f_password: 'old-plain', f_secret: 'sec_ref_0', f_internal: 'hidden-before' },
            session: { userId: 'u1' },
            ql: {},
        } as unknown as HookContext;
        const c = await fire({ name: 'vault', fields: VAULT_FIELDS }, ctx, {
            flowName: 'vault_flow', object: 'vault', event: 'record-before-update',
        });
        const record = c.record as Record<string, unknown>;
        const previous = c.previous as Record<string, unknown>;
        expect(record.name).toBe('renamed');
        expect(previous.name).toBe('original');
        for (const root of [record, previous]) {
            expect(root.f_password).toBe(SECRET_MASK);
            expect(root.f_secret).toBe(SECRET_MASK);
            expect('f_internal' in root).toBe(false);
        }
        expect((ctx.input as { data: Record<string, unknown> }).data.f_password).toBe('new-plain');
    });
});

describe('an unresolvable trigger-object definition is logged at error and still dispatches', () => {
    // No `previous` on this update, so the materialisation read (gated on
    // ground truth) is skipped and the definition read for the mask is the
    // only `getObject` call a dispatch makes.
    function noPriorUpdate(): HookContext {
        return {
            object: 'vault',
            event: 'afterUpdate',
            input: { id: 'v1', data: { name: 'renamed' } },
            result: { id: 'v1', name: 'renamed' },
            session: { userId: 'u1' },
            ql: {},
        } as unknown as HookContext;
    }

    const cases: Array<[string, RecordChangeDataEngine['getObject']]> = [
        ['getObject is absent', undefined],
        ['getObject returns nothing', () => undefined],
        [
            'getObject throws',
            () => {
                throw new Error('registry offline');
            },
        ],
    ];

    for (const [label, getObject] of cases) {
        it(`${label}: one error naming the object, the flow still runs on every write`, async () => {
            const hooks: Hook[] = [];
            const engine: RecordChangeDataEngine = {
                registerHook(event, handler) {
                    hooks.push({ event, handler });
                },
                unregisterHooksByPackage() {
                    return 0;
                },
                ...(getObject ? { getObject } : {}),
            };
            const error = vi.fn();
            const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn: () => {}, debug: () => {}, error });
            let runs = 0;
            trigger.start(binding, async () => {
                runs += 1;
            });
            await hooks[0].handler(noPriorUpdate());
            await hooks[0].handler(noPriorUpdate());

            expect(runs, 'dispatch is unchanged: the flow ran for both writes').toBe(2);
            expect(error, 'said once per object, not once per write').toHaveBeenCalledTimes(1);
            expect(String(error.mock.calls[0][0])).toContain("object 'vault'");
        });
    }

    it('a resolved definition logs no error', async () => {
        const { engine, hooks } = engineWith({ name: 'vault', fields: VAULT_FIELDS });
        const error = vi.fn();
        const trigger = new RecordChangeTrigger(engine, { info: () => {}, warn: () => {}, debug: () => {}, error });
        trigger.start(binding, async () => {});
        await hooks[0].handler(updateCtx());
        expect(error).not.toHaveBeenCalled();
    });
});
