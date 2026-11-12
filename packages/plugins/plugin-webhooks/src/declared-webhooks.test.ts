// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Declared webhooks, read from the registry (ADR-0131 D2/D6) — the dispatcher
 * side of the retired `bootstrapDeclaredWebhooks` seeder.
 *
 * Three things are pinned here:
 *
 *  1. **The new shape, on a fresh install.** A declared webhook dispatches from
 *     its declaration — URL, method, triggers, `timeoutMs`, signing secret and
 *     headers — and nothing writes a `sys_webhook` row for it.
 *  2. **The switch (regime C).** A `sys_metadata_activation` row of type
 *     `webhook` turns a declared webhook off, or on when it shipped inactive,
 *     and a ledger write refreshes the cache in the request that made it.
 *  3. **A row holding a declared name, on a certified database.** The
 *     ownership ceremony settles every seeded copy of a declaration before
 *     certification; what it leaves is a seeded row no package declares, and
 *     authored rows. Any row holding a declared name answers as itself and the
 *     declaration is withheld — one delivery, never two — whatever the row's
 *     provenance: a seeded row the ceremony left whose name a package declares
 *     LATER is withheld-by, not skipped (regime C). The fixture
 *     {@link seeded18_0Row} is byte-for-byte the row shape 18.0's seeder wrote
 *     (its `mapWebhookToRow` plus provenance), which is the shape such a row
 *     keeps.
 */

import { describe, expect, it, vi } from 'vitest';
import { AutoEnqueuer, type HttpEnqueueFn } from './auto-enqueuer.js';
import {
    DeclaredWebhookAmbiguousError,
    DeclaredWebhookNameConflictError,
    DeclaredWebhookSource,
    WEBHOOK_ACTIVATION_TYPE,
    bindDeclaredWebhookNameGuard,
    declaredWebhookRefId,
} from './declared-webhooks.js';
import { SchemaRegistry } from '@objectstack/objectql';
import { createWebhookRedeliverGuard } from './redeliver-guard.js';
import { bindWebhookProvenanceStamp } from './webhook-provenance.js';
import { WebhookOutboxPlugin } from './webhook-outbox-plugin.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const LEDGER = 'sys_metadata_activation';

interface HookEntry {
    event: string;
    handler: (ctx: any) => any;
    object?: string;
    packageId?: string;
}

/** Equality and `$in` — the two predicate shapes the reader and the dispatcher send. */
function rowMatches(row: any, cond?: Record<string, any>): boolean {
    if (!cond) return true;
    return Object.entries(cond).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake engine: the ${k} combinator is not implemented`);
        if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
        return row[k] === v;
    });
}

/**
 * The ObjectQL surface the dispatcher, the reader and the provenance hook
 * touch: `find({ where | filter })` with equality and `$in` and the caller's
 * `limit`, `insert`, update-by-id with `beforeUpdate` hooks, and a
 * `_registry.listItems(type)` for declared metadata. Every write is recorded, so
 * "nothing writes a row" is a reading, not an assumption.
 */
function makeFakeEngine(rows: Record<string, any[]>, declared: Record<string, any[]>) {
    const writes: Array<{ op: string; object: string; data: any }> = [];
    let hooks: HookEntry[] = [];
    return {
        rows,
        writes,
        declared,
        get _registry() {
            return { listItems: (type: string) => [...(declared[type] ?? [])] };
        },
        async find(name: string, q?: any): Promise<any[]> {
            const matched = (rows[name] ?? []).filter((r) => rowMatches(r, q?.filter ?? q?.where));
            const bounded = q?.limit !== undefined ? matched.slice(0, q.limit) : matched;
            return bounded.map((r) => ({ ...r }));
        },
        async findOne(name: string, q?: any): Promise<any> {
            assertEngineFindOnePredicate(name, q);
            return (await this.find(name, q))[0] ?? null;
        },
        async insert(name: string, data: any): Promise<any> {
            writes.push({ op: 'insert', object: name, data });
            (rows[name] = rows[name] ?? []).push({ ...data });
            return data;
        },
        async update(name: string, data: any, opts?: any): Promise<any> {
            writes.push({ op: 'update', object: name, data });
            const id = data?.id ?? opts?.where?.id;
            const cond = opts?.where ?? (id ? { id } : undefined);
            const previous = (rows[name] ?? []).find((r) => rowMatches(r, cond));
            const ctx = { input: { id, data }, previous: previous ? { ...previous } : undefined, session: opts?.context };
            for (const h of hooks) {
                if (h.event === 'beforeUpdate' && (!h.object || h.object === name)) await h.handler(ctx);
            }
            for (const r of rows[name] ?? []) if (rowMatches(r, cond)) Object.assign(r, data);
            return { affected: 1 };
        },
        async delete(): Promise<any> {
            return { affected: 0 };
        },
        async count(name: string): Promise<number> {
            return (rows[name] ?? []).length;
        },
        registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void {
            hooks.push({ event, handler, object: options?.object, packageId: options?.packageId });
        },
        unregisterHooksByPackage(packageId: string): number {
            const before = hooks.length;
            hooks = hooks.filter((h) => h.packageId !== packageId);
            return before - hooks.length;
        },
    };
}

type FakeEngine = ReturnType<typeof makeFakeEngine>;

function newEngine(seed?: { rows?: Record<string, any[]>; declared?: Record<string, any[]> }): FakeEngine {
    return makeFakeEngine(
        seed?.rows ? JSON.parse(JSON.stringify(seed.rows)) : {},
        seed?.declared ? JSON.parse(JSON.stringify(seed.declared)) : {},
    );
}

class FakeRealtime {
    private subs = new Map<string, { handler: any; opts?: any }>();
    private n = 0;
    async publish(event: any): Promise<void> {
        for (const sub of this.subs.values()) {
            const o = sub.opts ?? {};
            if (o.object && event.object !== o.object) continue;
            await sub.handler(event);
        }
    }
    async subscribe(_channel: string, handler: any, opts?: any): Promise<string> {
        const id = `s-${++this.n}`;
        this.subs.set(id, { handler, opts });
        return id;
    }
    async unsubscribe(id: string): Promise<void> {
        this.subs.delete(id);
    }
}

const ADMIN_CTX = { isSystem: false, positions: [], permissions: [] };

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
 * The row 18.0's `bootstrapDeclaredWebhooks` wrote for `wh` — its
 * `mapWebhookToRow` (lower-cased method, `object`→`object_name`,
 * `isActive`→`active`, the envelope minus both credentials in
 * `definition_json`) plus `managed_by: 'package'` / `customized: false`. The
 * credentials went to the encrypted columns; this fake engine has no encrypted
 * channel, so the column holds the plaintext the real one would dereference
 * to, which is what `resolveWebhookSecret` reads back here.
 */
function seeded18_0Row(id: string, wh: any, over: Record<string, any> = {}): any {
    const { secret, headers, ...envelope } = { method: 'POST', timeoutMs: 30000, isActive: true, ...wh };
    return {
        id,
        name: wh.name,
        label: wh.label ?? wh.name,
        object_name: wh.object ?? null,
        triggers: wh.triggers ?? [],
        url: wh.url,
        method: String(envelope.method).toLowerCase(),
        description: wh.description ?? null,
        active: envelope.isActive !== false,
        definition_json: JSON.stringify(envelope),
        ...(secret ? { signing_secret: secret } : {}),
        ...(headers ? { headers_secret: JSON.stringify(headers) } : {}),
        managed_by: 'package',
        customized: false,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        ...over,
    };
}

function ledgerRow(name: string, active: boolean): any {
    return { id: `act_${name}`, metadata_type: WEBHOOK_ACTIVATION_TYPE, name, active };
}

function taskCreated(recordId = 't-1'): any {
    return {
        type: 'data.record.created',
        object: 'showcase_task',
        payload: { recordId },
        timestamp: '2026-10-19T00:00:00.000Z',
    };
}

async function flush() {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
}

async function startEnqueuer(engine: FakeEngine, logger?: any) {
    const realtime = new FakeRealtime();
    const calls: any[] = [];
    const enqueue: HttpEnqueueFn = async (input) => {
        calls.push(input);
        return 'id';
    };
    const declaredWebhooks = new DeclaredWebhookSource(engine, undefined, logger);
    const enqueuer = new AutoEnqueuer(engine as any, realtime as any, enqueue, {
        refreshIntervalMs: 0,
        declaredWebhooks,
        ...(logger ? { logger } : {}),
    });
    await enqueuer.start();
    return { enqueuer, realtime, calls, declaredWebhooks };
}

// ---------------------------------------------------------------------------
// 1. The new shape, on a fresh install
// ---------------------------------------------------------------------------

describe('declared webhooks — a fresh install dispatches from the registry', () => {
    it('a declared webhook dispatches on a matching event, with its secret, headers, method and timeout from the declaration', async () => {
        const engine = newEngine({
            declared: {
                webhook: [declaredWebhook({
                    triggers: ['create'], secret: 'shh', headers: { 'X-Env': 'prod' }, method: 'PUT', timeoutMs: 5000,
                })],
            },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);

        await realtime.publish(taskCreated());
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            source: 'webhook',
            refId: declaredWebhookRefId('task_changed'),
            url: 'https://hooks.example/task',
            method: 'PUT',
            headers: { 'X-Env': 'prod' },
            signingSecret: 'shh',
            timeoutMs: 5000,
        });
        expect(calls[0].organizationId).toBeUndefined();
        await enqueuer.stop();
    });

    it('nothing writes a sys_webhook row: the plugin boot binds the reader and seeds zero rows', async () => {
        const engine = newEngine({ declared: { webhook: [declaredWebhook({ secret: 'shh' })] } });
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

        expect(engine.writes.filter((w) => w.object === 'sys_webhook')).toEqual([]);
        expect(engine.rows['sys_webhook']).toBeUndefined();
        const reader = services['declaredWebhooks'] as DeclaredWebhookSource;
        expect(reader).toBeInstanceOf(DeclaredWebhookSource);
        expect((await reader.declaredWebhookNamed('task_changed'))?.webhook.object).toBe('showcase_task');
        await plugin.destroy();
    });

    it('a declared webhook shipped inactive is not dispatched', async () => {
        const engine = newEngine({ declared: { webhook: [declaredWebhook({ isActive: false })] } });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('an invalid declaration is skipped with one warning per name, and a valid one beside it still dispatches', async () => {
        const warn = vi.fn();
        const engine = newEngine({
            declared: { webhook: [declaredWebhook({ name: 'good' }), declaredWebhook({ name: 'bad', url: 'not-a-url' })] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine, { warn, debug() {} });
        await enqueuer.refresh();
        await realtime.publish(taskCreated());
        await flush();

        expect(calls.map((c) => c.refId)).toEqual([declaredWebhookRefId('good')]);
        const reports = warn.mock.calls.filter(([m]) => String(m).includes('failed validation'));
        expect(reports).toHaveLength(1);
        expect(reports[0][1]).toMatchObject({ name: 'bad' });
        await enqueuer.stop();
    });
});

describe('declared webhooks — the organization dimension follows the posture (ADR-0131 D2/D9)', () => {
    const orgEvent = (organizationId: string) => ({
        ...taskCreated(),
        payload: { recordId: 't-1', organizationId },
    });

    it('a declared webhook receives an organization-stamped event, its delivery stamped with that organization', async () => {
        // Under `single` every record carries the Default Organization (D9), and
        // the 18.0 seeded copy carried it too, so it delivered. The declaration
        // has no organization of its own; deployment-wide, it delivers as well.
        const engine = newEngine({ declared: { webhook: [declaredWebhook()] } });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(orgEvent('org_default'));
        await flush();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ refId: declaredWebhookRefId('task_changed'), organizationId: 'org_default' });
        await enqueuer.stop();
    });

    it('[ruling A] two organizations: one delivery per event, each stamped with its event\'s organization, and nothing refused', async () => {
        const warn = vi.fn();
        const engine = newEngine({ declared: { webhook: [declaredWebhook()] } });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine, { warn, debug() {} });
        await realtime.publish(orgEvent('org_a'));
        await realtime.publish(orgEvent('org_b'));
        await flush();
        expect(calls.map((c) => [c.refId, c.organizationId])).toEqual([
            [declaredWebhookRefId('task_changed'), 'org_a'],
            [declaredWebhookRefId('task_changed'), 'org_b'],
        ]);
        expect(warn.mock.calls.filter(([m]) => String(m).includes('belongs to NO organization'))).toEqual([]);
        await enqueuer.stop();
    });

    it('[ruling A] the plugin serves it deployment-wide under every posture, and with no tenancy service', async () => {
        const boot = async (tenancy?: unknown) => {
            const engine = newEngine({ declared: { webhook: [declaredWebhook()] } });
            const realtime = new FakeRealtime();
            const calls: any[] = [];
            const services: Record<string, unknown> = {
                objectql: engine,
                manifest: { register() {} },
                realtime,
                messaging: {
                    isHttpDeliveryReady: () => true,
                    enqueueHttp: async (input: any) => { calls.push(input); return 'd'; },
                    redeliverHttp: async () => ({ id: 'd', status: 'pending' }),
                    registerRedeliverGuard() {},
                },
                ...(tenancy ? { tenancy } : {}),
            };
            const hooks: Array<() => Promise<void>> = [];
            const ctx: any = {
                logger: { info() {}, warn() {}, error() {}, debug() {} },
                getService: (n: string) => {
                    if (!(n in services)) throw new Error(`no ${n}`);
                    return services[n];
                },
                registerService: (n: string, svc: unknown) => { services[n] = svc; },
                hook: (event: string, fn: () => Promise<void>) => { if (event === 'kernel:ready') hooks.push(fn); },
            };
            const plugin = new WebhookOutboxPlugin({ autoEnqueue: { refreshIntervalMs: 0 } });
            await plugin.init(ctx);
            for (const fn of hooks) await fn();
            await realtime.publish(orgEvent('org_default'));
            await flush();
            await plugin.destroy();
            return calls;
        };
        for (const tenancy of [{ posture: 'single' }, { posture: 'group' }, { posture: 'isolated' }, undefined]) {
            const calls = await boot(tenancy);
            expect(calls.map((c: any) => c.organizationId), JSON.stringify(tenancy)).toEqual(['org_default']);
        }
    });
});

// ---------------------------------------------------------------------------
// 2. The switch (regime C)
// ---------------------------------------------------------------------------

describe('declared webhooks — the activation ledger switches them (ADR-0131 D6 regime C)', () => {
    it('a ledger row with active:false switches a declared webhook off', async () => {
        const engine = newEngine({
            declared: { webhook: [declaredWebhook()] },
            rows: { [LEDGER]: [ledgerRow('task_changed', false)] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('a ledger row with active:true switches on a webhook shipped inactive', async () => {
        const engine = newEngine({
            declared: { webhook: [declaredWebhook({ isActive: false })] },
            rows: { [LEDGER]: [ledgerRow('task_changed', true)] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toHaveLength(1);
        await enqueuer.stop();
    });

    it('another type\'s ledger row of the same name switches nothing', async () => {
        const engine = newEngine({
            declared: { webhook: [declaredWebhook()] },
            rows: { [LEDGER]: [{ id: 'a1', metadata_type: 'flow', name: 'task_changed', active: false }] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toHaveLength(1);
        await enqueuer.stop();
    });

    it('a ledger write refreshes the cache in the same request — no wait for the periodic refresh', async () => {
        const engine = newEngine({ declared: { webhook: [declaredWebhook()] } });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);

        engine.rows[LEDGER] = [ledgerRow('task_changed', false)];
        await realtime.publish({ type: 'data.record.created', object: LEDGER, payload: { recordId: 'act_task_changed' } });
        await flush();
        await realtime.publish(taskCreated());
        await flush();

        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('a ledger read that fails keeps each declared webhook at its declared isActive', async () => {
        const warn = vi.fn();
        const engine = newEngine({ declared: { webhook: [declaredWebhook()] } });
        const read = engine.find;
        engine.find = async (name: string, q?: any) => {
            if (name === LEDGER) throw new Error('ledger down');
            return read.call(engine, name, q);
        };
        const { enqueuer, realtime, calls } = await startEnqueuer(engine, { warn, debug() {} });
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('sys_metadata_activation read failed'), expect.anything());
        await enqueuer.stop();
    });
});

// ---------------------------------------------------------------------------
// 3. A row holding a declared name, on a certified database
// ---------------------------------------------------------------------------

describe('declared webhooks — a row holding a declared name answers as itself (regime C)', () => {
    it('a seeded row the ceremony left, its name declared later, withholds the declaration: one delivery, from the row', async () => {
        // The 18.x step 5a leftover: a pristine seeded row no package declared
        // at the ceremony, so it stayed. A package now declares its name with
        // another URL. The row answers; the declaration is withheld, said once.
        const warn = vi.fn();
        const engine = newEngine({
            declared: { webhook: [declaredWebhook({ url: 'https://hooks.example/task-v2', secret: 'shh' })] },
            rows: { sys_webhook: [seeded18_0Row('whk_left', declaredWebhook())] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine, { warn, debug() {} });
        await enqueuer.refresh();
        await realtime.publish(taskCreated());
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ refId: 'whk_left', url: 'https://hooks.example/task' });
        const withheld = warn.mock.calls.filter(([m]) => String(m).includes("declared webhook 'task_changed' is not dispatched"));
        expect(withheld).toHaveLength(1);
        expect(engine.writes).toEqual([]);
        await enqueuer.stop();
    });

    it('a pristine seeded row switched off keeps the declaration withheld: neither fires, whatever the ledger says', async () => {
        const wh = declaredWebhook();
        const engine = newEngine({
            declared: { webhook: [wh] },
            rows: {
                sys_webhook: [seeded18_0Row('whk_left', wh, { active: false })],
                [LEDGER]: [ledgerRow('task_changed', true)],
            },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('a customized seeded row answers as itself — one delivery, to the row\'s URL', async () => {
        const wh = declaredWebhook({ isActive: false });
        const engine = newEngine({
            declared: { webhook: [wh] },
            rows: {
                sys_webhook: [seeded18_0Row('whk_seeded', wh, {
                    active: true, customized: true, url: 'https://real.example/task',
                })],
            },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ refId: 'whk_seeded', url: 'https://real.example/task' });
        await enqueuer.stop();
    });

    it('the provenance stamp still records an admin edit of a seeded row — the ceremony\'s reader of `customized`', async () => {
        const wh = declaredWebhook({ name: 'retired_hook' });
        const engine = newEngine({ rows: { sys_webhook: [seeded18_0Row('whk_left', wh)] } });
        bindWebhookProvenanceStamp(engine as any);
        await engine.update('sys_webhook', { id: 'whk_left', active: false }, { context: ADMIN_CTX });
        expect(engine.rows['sys_webhook'][0].customized).toBe(true);
    });

    it('an administrator-authored row under a declared name answers as itself, and the declaration is withheld', async () => {
        const engine = newEngine({
            declared: { webhook: [declaredWebhook()] },
            rows: {
                sys_webhook: [{
                    id: 'admin-1', name: 'task_changed', object_name: 'showcase_task', triggers: ['create'],
                    url: 'https://admin.example', method: 'post', active: true, managed_by: 'admin', customized: false,
                }],
            },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({ refId: 'admin-1', url: 'https://admin.example' });
        await enqueuer.stop();
    });

    it('a seeded row whose name no package declares keeps dispatching, as it did on 18.0', async () => {
        const engine = newEngine({
            rows: { sys_webhook: [seeded18_0Row('whk_orphan', declaredWebhook({ name: 'retired_hook' }))] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls.map((c) => c.refId)).toEqual(['whk_orphan']);
        await enqueuer.stop();
    });
});

// ---------------------------------------------------------------------------
// The redelivery veto reads the same declaration
// ---------------------------------------------------------------------------

describe('declared webhooks — the redelivery veto', () => {
    const guardFor = (engine: FakeEngine) =>
        createWebhookRedeliverGuard(engine as any, 'sys_webhook', new DeclaredWebhookSource(engine, undefined));

    it('allows a declared webhook\'s delivery while it is declared and switched on', async () => {
        const engine = newEngine({ declared: { webhook: [declaredWebhook({ secret: 'shh' })] } });
        expect(await guardFor(engine)({ source: 'webhook', refId: declaredWebhookRefId('task_changed') })).toBeUndefined();
    });

    it('refuses one whose declaration is gone, and one switched off through the ledger', async () => {
        const gone = newEngine();
        expect(await guardFor(gone)({ source: 'webhook', refId: declaredWebhookRefId('task_changed') }))
            .toMatch(/no longer declared/);

        const off = newEngine({
            declared: { webhook: [declaredWebhook()] },
            rows: { [LEDGER]: [ledgerRow('task_changed', false)] },
        });
        expect(await guardFor(off)({ source: 'webhook', refId: declaredWebhookRefId('task_changed') }))
            .toMatch(/switched off/);
    });

    it('judges a pristine seeded row holding a declared name by the row, not by the declaration\'s switch', async () => {
        const wh = declaredWebhook();
        const engine = newEngine({
            declared: { webhook: [wh] },
            rows: { sys_webhook: [seeded18_0Row('whk_left', wh)], [LEDGER]: [ledgerRow('task_changed', false)] },
        });
        // The row reads active:true and the dispatcher reads it as itself, so a replay is allowed.
        expect(await guardFor(engine)({ source: 'webhook', refId: 'whk_left' })).toBeUndefined();
    });

    it('judges a customized seeded row by the row, as before', async () => {
        const wh = declaredWebhook();
        const engine = newEngine({
            declared: { webhook: [wh] },
            rows: {
                sys_webhook: [seeded18_0Row('whk_seeded', wh, { customized: true })],
                [LEDGER]: [ledgerRow('task_changed', false)],
            },
        });
        expect(await guardFor(engine)({ source: 'webhook', refId: 'whk_seeded' })).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// 4. One declaration per (package, name) slot — ADR-0150 D3/D4/D5 (#31699 PR 2)
// ---------------------------------------------------------------------------

describe('declared webhooks — one declaration per (package, name) slot (ADR-0150 D3/D4/D5, #31699)', () => {
    const A = 'com.acme.alpha';
    const B = 'com.acme.beta';
    const ALPHA = declaredWebhook({ url: 'https://hooks.example/alpha', secret: 'alpha-secret' });
    const BETA = declaredWebhook({ url: 'https://hooks.example/beta', secret: 'beta-secret' });

    /** A real registry with each id installed as a code package shipping `wh` in its own composite slot. */
    function registryShipping(packages: Array<[string, any]>): SchemaRegistry {
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        for (const [id, wh] of packages) {
            if (!registry.getPackage(id)) {
                registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } as never, 'code');
            }
            registry.registerItem('webhook', { ...wh }, 'name' as never, id);
        }
        return registry;
    }

    /** The fake engine, its `_registry` the real one. */
    function engineOver(registry: SchemaRegistry, seed?: { rows?: Record<string, any[]> }): FakeEngine {
        const engine = newEngine(seed);
        Object.defineProperty(engine, '_registry', { get: () => registry });
        return engine;
    }

    const twoHolders = (rows?: Record<string, any[]>) => engineOver(registryShipping([[A, ALPHA], [B, BETA]]), rows ? { rows } : undefined);
    /** A ledger row naming `packageId` (`null`: none). */
    const slotRow = (packageId: string | null, active: boolean) =>
        ({ id: `act_${packageId ?? 'none'}`, metadata_type: WEBHOOK_ACTIVATION_TYPE, name: 'task_changed', package_id: packageId, active });
    const switches = async (source: DeclaredWebhookSource) =>
        (await source.list()).map((d) => [d.packageId ?? null, d.active]);
    const loggerWith = (warn = vi.fn()) => ({ warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() });

    it('one package holder: dispatched exactly once, as `declared:PKG/NAME`, and that is its only subscription', async () => {
        const engine = engineOver(registryShipping([[A, declaredWebhook()]]));
        const source = new DeclaredWebhookSource(engine, undefined);
        expect((await source.list()).map((d) => [d.webhook.name, d.packageId])).toEqual([['task_changed', A]]);
        expect((await source.declaredWebhookNamed('task_changed'))?.packageId).toBe(A);

        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls.map((c) => c.refId)).toEqual([`declared:${A}/task_changed`]);
        expect(declaredWebhookRefId('task_changed', A)).toBe(`declared:${A}/task_changed`);
        await enqueuer.stop();
    });

    it('[FROM neither TO both] two namespaces\' packages declaring one name: each dispatched under its own id, URL and secret', async () => {
        const warn = vi.fn();
        const { enqueuer, realtime, calls, declaredWebhooks } = await startEnqueuer(twoHolders(), loggerWith(warn));
        await realtime.publish(taskCreated());
        await flush();
        expect(calls.map((c) => [c.refId, c.url, c.signingSecret])).toEqual([
            [declaredWebhookRefId('task_changed', A), 'https://hooks.example/alpha', 'alpha-secret'],
            [declaredWebhookRefId('task_changed', B), 'https://hooks.example/beta', 'beta-secret'],
        ]);
        expect((await declaredWebhooks.list()).map((d) => d.packageId)).toEqual([A, B]);
        expect(warn.mock.calls.filter(([msg]) => String(msg).includes('is not dispatched'))).toEqual([]);
        await enqueuer.stop();
    });

    it('two holders: the bare by-name read throws the 409 naming both, carrying the refusal; each slot is read exactly', async () => {
        const source = new DeclaredWebhookSource(twoHolders(), undefined);
        const err = await source.declaredWebhookNamed('task_changed').then(() => undefined, (e: unknown) => e);
        expect(err).toBeInstanceOf(DeclaredWebhookAmbiguousError);
        expect(err).toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409, webhook: 'task_changed' });
        const refusal = (err as DeclaredWebhookAmbiguousError).refusal;
        expect([refusal.status, refusal.reason, refusal.candidates]).toEqual([
            'refused', 'ambiguous-in-environment', [{ kind: 'package', packageId: A }, { kind: 'package', packageId: B }],
        ]);
        expect((await source.declaredWebhookAt(A, 'task_changed'))?.webhook.url).toBe('https://hooks.example/alpha');
        expect((await source.declaredWebhookAt(B, 'task_changed'))?.webhook.url).toBe('https://hooks.example/beta');
        expect(await source.declaredWebhookAt(null, 'task_changed')).toBeNull();
        expect(await source.declaredWebhookAt('com.acme.gamma', 'task_changed')).toBeNull();
    });

    it('the ledger: each slot reads its own row; a row of one package never switches the other', async () => {
        const source = new DeclaredWebhookSource(twoHolders({ [LEDGER]: [slotRow(A, false)] }), undefined);
        expect(await switches(source)).toEqual([[A, false], [B, true]]);
    });

    it('[Q1] two holders and a row naming no package: off keeps both off, on turns none on, said once naming both', async () => {
        const warn = vi.fn();
        const off = new DeclaredWebhookSource(twoHolders({ [LEDGER]: [slotRow(null, false)] }), undefined, loggerWith(warn));
        expect(await switches(off)).toEqual([[A, false], [B, false]]);
        await off.list();
        const said = warn.mock.calls.filter(([msg]) => String(msg).includes('no holder\'s own'));
        expect(said).toHaveLength(1);
        expect(said[0][0]).toContain(`"${A}"`);
        expect(said[0][0]).toContain(`"${B}"`);

        const shippedOff = engineOver(
            registryShipping([[A, ALPHA], [B, declaredWebhook({ url: 'https://hooks.example/beta', isActive: false })]]),
            { rows: { [LEDGER]: [slotRow(null, true)] } },
        );
        expect(await switches(new DeclaredWebhookSource(shippedOff, undefined))).toEqual([[A, true], [B, false]]);

        // A holder's own row is its switch, whatever the unowned row says.
        const own = new DeclaredWebhookSource(twoHolders({ [LEDGER]: [slotRow(null, false), slotRow(A, true)] }), undefined);
        expect(await switches(own)).toEqual([[A, true], [B, false]]);
    });

    it('[D8] one holder: a row naming no package, or a package that no longer declares the name, is its switch, as before', async () => {
        const one = (rows: any[]) => new DeclaredWebhookSource(engineOver(registryShipping([[A, ALPHA]]), { rows: { [LEDGER]: rows } }), undefined);
        expect(await switches(one([slotRow(null, false)]))).toEqual([[A, false]]);
        expect(await switches(one([slotRow('com.acme.gone', false)]))).toEqual([[A, false]]);
        expect(await switches(one([slotRow('com.acme.gone', false), slotRow(A, true)]))).toEqual([[A, true]]);
    });

    it('[Q4] a delivery naming no package (`declared:NAME`, the CLI ceremony\'s shape): one holder judges it as before; two refuse it naming both, sent to neither', async () => {
        const legacy = { source: 'webhook', refId: declaredWebhookRefId('task_changed') };
        const one = engineOver(registryShipping([[A, ALPHA]]));
        expect(await createWebhookRedeliverGuard(one as any, 'sys_webhook', new DeclaredWebhookSource(one, undefined))(legacy)).toBeUndefined();

        const two = twoHolders();
        const refused = await createWebhookRedeliverGuard(two as any, 'sys_webhook', new DeclaredWebhookSource(two, undefined))(legacy);
        expect(refused).toMatch(/names no package/);
        expect(refused).toContain(`"${A}"`);
        expect(refused).toContain(`"${B}"`);
    });

    it('a delivery naming a package is judged by exactly that slot; a malformed reference addresses none', async () => {
        const engine = twoHolders({ [LEDGER]: [slotRow(A, false)] });
        const guard = createWebhookRedeliverGuard(engine as any, 'sys_webhook', new DeclaredWebhookSource(engine, undefined));
        const judge = (refId: string) => guard({ source: 'webhook', refId });
        expect(await judge(declaredWebhookRefId('task_changed', A))).toMatch(/switched off/);
        expect(await judge(declaredWebhookRefId('task_changed', B))).toBeUndefined();
        for (const refId of [`declared:com.acme.gamma/task_changed`, 'declared:/task_changed', `declared:${B}/task/changed`, `declared:${B}/`]) {
            expect(await judge(refId), refId).toMatch(/no longer declared/);
        }
    });

    it('[mixed version] a node reading the reference as a bare name finds no declaration of `PKG/NAME`, so it refuses (fail closed)', async () => {
        const source = new DeclaredWebhookSource(engineOver(registryShipping([[A, ALPHA]])), undefined);
        expect(await source.declaredWebhookNamed(`${A}/task_changed`)).toBeNull();
    });

    it('the name guard: a write taking a name two packages declare is the declared-name conflict, not the ambiguity', async () => {
        const hooks: Record<string, (ctx: any) => Promise<void>> = {};
        bindDeclaredWebhookNameGuard({ registerHook: (event, handler) => { hooks[event] = handler; } },
            new DeclaredWebhookSource(twoHolders(), undefined));
        const err = await hooks.beforeInsert({ input: { data: { name: 'task_changed' } }, session: {} })
            .then(() => undefined, (e: unknown) => e);
        expect(err).toBeInstanceOf(DeclaredWebhookNameConflictError);
    });

    it('with no registry to resolve against, each package the metadata service lists is its own slot', async () => {
        const metadata = {
            list: (type: string) => (type === 'webhook' ? [{ ...ALPHA, _packageId: A }, { ...BETA, _packageId: B }] : []),
        };
        const source = new DeclaredWebhookSource(newEngine(), metadata);
        expect((await source.list()).map((d) => [d.packageId, d.webhook.url])).toEqual([
            [A, 'https://hooks.example/alpha'], [B, 'https://hooks.example/beta'],
        ]);
        await expect(source.declaredWebhookNamed('task_changed')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    });

    it('CONTROL — with no registry, a name listed twice for one holder is refused, never first-picked', async () => {
        const metadata = {
            list: (type: string) => (type === 'webhook' ? [{ ...ALPHA, _packageId: A }, { ...BETA, _packageId: A }] : []),
        };
        const source = new DeclaredWebhookSource(newEngine(), metadata);
        expect(await source.list()).toEqual([]);
        await expect(source.declaredWebhookNamed('task_changed')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    });
});
