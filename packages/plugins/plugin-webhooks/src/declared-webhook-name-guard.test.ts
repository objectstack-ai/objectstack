// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6 regime C] No `sys_webhook` row may take a declared webhook's
 * name.
 *
 * The dispatcher withholds a declaration whenever a `sys_webhook` row holds
 * its name (`heldByRow`, `auto-enqueuer.ts`), and it does so for the whole
 * deployment. Under a wall one organization's same-name row would therefore
 * silence a deployment-wide declaration for every organization. So an insert
 * of a declared name, and a rename onto one, are refused with 409
 * `RESOURCE_CONFLICT` — the shape `bindDeclaredRuleNameGuard` gives the
 * declared sharing rules.
 *
 * Each refusal below carries its discriminating control: an undeclared name,
 * an update that keeps its name (a row that held the name before a package
 * declared it), a system write — so a guard that refused everything goes red too.
 */

import { describe, expect, it } from 'vitest';
import { HttpStatusErrorCodeMap } from '@objectstack/spec/api';
import {
    DECLARED_WEBHOOK_NAME_GUARD_PACKAGE,
    DeclaredWebhookSource,
    bindDeclaredWebhookNameGuard,
} from './declared-webhooks.js';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';

const LEDGER = 'sys_metadata_activation';

interface HookEntry {
    event: string;
    handler: (ctx: any) => any;
    object?: string;
    packageId?: string;
}

function declaredWebhook(over: Record<string, any> = {}): any {
    return {
        name: 'task_changed',
        label: 'Task Changed',
        object: 'showcase_task',
        triggers: ['create', 'update'],
        url: 'https://hooks.example/task',
        method: 'POST',
        isActive: true,
        ...over,
    };
}

/**
 * The engine surface the guard and the reader touch: the hook registry, a
 * `find` over an in-memory ledger, and a registry of declared items. `fire`
 * runs the bound hooks the way the engine's write path does.
 */
function makeEngine(declared: any[], ledger: any[] = []) {
    let hooks: HookEntry[] = [];
    const engine = {
        registry: { getObject: (name: string) => (name === LEDGER ? { name } : undefined) },
        get _registry() {
            return { listItems: (type: string) => (type === 'webhook' ? [...declared] : []) };
        },
        async find(name: string, q?: any): Promise<any[]> {
            if (name !== LEDGER) return [];
            const f = q?.filter ?? {};
            return ledger
                .filter((r) => Object.entries(f).every(([k, v]) => {
                    if (k.startsWith('$')) throw new Error(`fake engine: the ${k} combinator is not implemented`);
                    return r[k] === v;
                }))
                .map((r) => ({ ...r }));
        },
        registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void {
            hooks.push({ event, handler, object: options?.object, packageId: options?.packageId });
        },
        unregisterHooksByPackage(packageId: string): number {
            const before = hooks.length;
            hooks = hooks.filter((h) => h.packageId !== packageId);
            return before - hooks.length;
        },
        hooksFor: (packageId: string) => hooks.filter((h) => h.packageId === packageId),
        async fire(event: string, object: string, ctx: Record<string, any>): Promise<void> {
            for (const h of hooks.filter((x) => x.event === event && x.object === object)) await h.handler(ctx);
        },
    };
    return engine;
}

const ADMIN = { userId: 'u_admin', tenantId: 'org_a' };
const SYSTEM = { isSystem: true };

function insertCtx(name: string, session: Record<string, any> = ADMIN) {
    return { input: { data: { name, url: 'https://hooks.example/mine' } }, session };
}

function updateCtx(previousName: string, data: Record<string, any>, session: Record<string, any> = ADMIN) {
    return { input: { id: 'whk_1', data }, previous: { id: 'whk_1', name: previousName }, session };
}

async function refusalOf(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (err: any) {
        return { code: err?.code, status: err?.status, webhook: err?.webhook, name: err?.name };
    }
    throw new Error('expected the write to be REFUSED, but it resolved successfully');
}

function guarded(declared: any[] = [declaredWebhook()], ledger: any[] = []) {
    const engine = makeEngine(declared, ledger);
    bindDeclaredWebhookNameGuard(engine, new DeclaredWebhookSource(engine, undefined));
    return engine;
}

describe('the declared-name guard on sys_webhook — an insert', () => {
    it('a non-system insert of a declared name is refused 409 RESOURCE_CONFLICT, naming the declaration', async () => {
        const engine = guarded();
        const refusal = await refusalOf(engine.fire('beforeInsert', 'sys_webhook', insertCtx('task_changed')));
        expect(refusal).toEqual({
            code: 'RESOURCE_CONFLICT',
            status: 409,
            webhook: 'task_changed',
            name: 'DeclaredWebhookNameConflictError',
        });
        // The catalogue's own code for the status, not a restated pair.
        expect(HttpStatusErrorCodeMap[409]).toBe(refusal.code);
    });

    it('a declaration switched OFF — shipped inactive, or by the ledger — still holds its name', async () => {
        const shippedOff = guarded([declaredWebhook({ isActive: false })]);
        expect((await refusalOf(shippedOff.fire('beforeInsert', 'sys_webhook', insertCtx('task_changed')))).code)
            .toBe('RESOURCE_CONFLICT');
        const ledgerOff = guarded([declaredWebhook()], [{ metadata_type: 'webhook', name: 'task_changed', active: false }]);
        expect((await refusalOf(ledgerOff.fire('beforeInsert', 'sys_webhook', insertCtx('task_changed')))).code)
            .toBe('RESOURCE_CONFLICT');
    });

    it('control: an undeclared name passes', async () => {
        const engine = guarded();
        await expect(engine.fire('beforeInsert', 'sys_webhook', insertCtx('my_own_hook'))).resolves.toBeUndefined();
    });

    it('control: a system insert of a declared name passes — the platform machinery, never an author', async () => {
        const engine = guarded();
        await expect(engine.fire('beforeInsert', 'sys_webhook', insertCtx('task_changed', SYSTEM))).resolves.toBeUndefined();
    });

    it('control: a deployment that declares no webhook refuses nothing', async () => {
        const engine = guarded([]);
        await expect(engine.fire('beforeInsert', 'sys_webhook', insertCtx('task_changed'))).resolves.toBeUndefined();
    });
});

describe('the declared-name guard on sys_webhook — an update', () => {
    it('a rename onto a declared name is refused 409 RESOURCE_CONFLICT', async () => {
        const engine = guarded();
        const refusal = await refusalOf(
            engine.fire('beforeUpdate', 'sys_webhook', updateCtx('my_own_hook', { name: 'task_changed' })),
        );
        expect(refusal).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409, webhook: 'task_changed' });
    });

    it('control: an update that keeps a declared name passes — an 18.0 row holding it stays editable', async () => {
        const engine = guarded();
        // A full-form save re-sends the name it already has.
        await expect(
            engine.fire('beforeUpdate', 'sys_webhook', updateCtx('task_changed', { name: 'task_changed', active: false })),
        ).resolves.toBeUndefined();
        // A patch that does not name it at all.
        await expect(
            engine.fire('beforeUpdate', 'sys_webhook', updateCtx('task_changed', { active: false })),
        ).resolves.toBeUndefined();
    });

    it('control: a rename onto an undeclared name passes, and a system rename onto a declared one passes', async () => {
        const engine = guarded();
        await expect(
            engine.fire('beforeUpdate', 'sys_webhook', updateCtx('task_changed', { name: 'renamed_hook' })),
        ).resolves.toBeUndefined();
        await expect(
            engine.fire('beforeUpdate', 'sys_webhook', updateCtx('my_own_hook', { name: 'task_changed' }, SYSTEM)),
        ).resolves.toBeUndefined();
    });
});

describe('the plugin binds the guard', () => {
    it('WebhookOutboxPlugin binds it on sys_webhook beside the reader, and unbinds it on destroy', async () => {
        const engine = makeEngine([declaredWebhook()]);
        const services: Record<string, unknown> = { objectql: engine, manifest: { register() {} } };
        const hooks: Record<string, Array<() => Promise<void>>> = {};
        const ctx: any = {
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            getService: (n: string) => {
                if (!(n in services)) throw new Error(`no ${n}`);
                return services[n];
            },
            registerService: (n: string, s: unknown) => { services[n] = s; },
            hook: (event: string, fn: () => Promise<void>) => { (hooks[event] ??= []).push(fn); },
        };
        const plugin = new WebhookOutboxPlugin({ autoEnqueue: false });
        await plugin.init(ctx);
        for (const fn of hooks['kernel:ready'] ?? []) await fn();

        expect(engine.hooksFor(DECLARED_WEBHOOK_NAME_GUARD_PACKAGE).map((h) => [h.event, h.object]).sort())
            .toEqual([['beforeInsert', 'sys_webhook'], ['beforeUpdate', 'sys_webhook']]);
        const refusal = await refusalOf(engine.fire('beforeInsert', 'sys_webhook', insertCtx('task_changed')));
        expect(refusal.code).toBe('RESOURCE_CONFLICT');

        await plugin.destroy();
        expect(engine.hooksFor(DECLARED_WEBHOOK_NAME_GUARD_PACKAGE)).toEqual([]);
    });
});
