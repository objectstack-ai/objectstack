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

import { describe, it, expect } from 'vitest';
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

async function fire(schema: Record<string, unknown> | undefined, ctx: HookContext): Promise<AutomationContext> {
    const { engine, hooks } = engineWith(schema);
    const trigger = new RecordChangeTrigger(engine, logger);
    let seen: AutomationContext | undefined;
    trigger.start(binding, async (c) => {
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
});
