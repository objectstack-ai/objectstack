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
 *  3. **The dual read, on an 18.0-shaped database.** The rows the 18.0 seeder
 *     wrote stay. A pristine one is ignored in favour of its declaration — one
 *     delivery, never two; an edited one (`customized: true`) or an admin row
 *     of the same name answers as itself and the declaration is withheld, so
 *     an administrator's `active: false` survives the upgrade. The fixture
 *     {@link seeded18_0Row} is byte-for-byte the row shape 18.0's seeder wrote
 *     (its `mapWebhookToRow` plus provenance), which is the shape an upgraded
 *     database holds.
 */

import { describe, expect, it, vi } from 'vitest';
import { AutoEnqueuer, type HttpEnqueueFn } from './auto-enqueuer.js';
import {
    DeclaredWebhookSource,
    WEBHOOK_ACTIVATION_TYPE,
    declaredWebhookRefId,
} from './declared-webhooks.js';
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

/**
 * The ObjectQL surface the dispatcher, the reader and the provenance hook
 * touch: `find({ where | filter })` with equality and `$in`, `insert`,
 * update-by-id with `beforeUpdate` hooks, and a `_registry.listItems(type)` for
 * declared metadata. Every write is recorded, so "nothing writes a row" is a
 * reading, not an assumption.
 */
class FakeEngine {
    rows: Record<string, any[]> = {};
    writes: Array<{ op: string; object: string; data: any }> = [];
    declared: Record<string, any[]> = {};
    failLedgerRead = false;
    private hooks: HookEntry[] = [];

    constructor(seed?: { rows?: Record<string, any[]>; declared?: Record<string, any[]> }) {
        if (seed?.rows) this.rows = JSON.parse(JSON.stringify(seed.rows));
        if (seed?.declared) this.declared = JSON.parse(JSON.stringify(seed.declared));
    }

    get _registry() {
        return { listItems: (type: string) => [...(this.declared[type] ?? [])] };
    }

    private matches(row: any, cond?: Record<string, any>): boolean {
        if (!cond) return true;
        return Object.entries(cond).every(([k, v]) => {
            if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
            return row[k] === v;
        });
    }

    async find(name: string, q?: any): Promise<any[]> {
        if (name === LEDGER && this.failLedgerRead) throw new Error('ledger down');
        const all = this.rows[name] ?? [];
        const out = all.filter((r) => this.matches(r, q?.filter ?? q?.where)).map((r) => ({ ...r }));
        return typeof q?.limit === 'number' ? out.slice(0, q.limit) : out;
    }
    async findOne(name: string, q?: any): Promise<any> {
        assertEngineFindOnePredicate(name, q);
        return (await this.find(name, q))[0] ?? null;
    }
    async insert(name: string, data: any): Promise<any> {
        this.writes.push({ op: 'insert', object: name, data });
        (this.rows[name] = this.rows[name] ?? []).push({ ...data });
        return data;
    }
    async update(name: string, data: any, opts?: any): Promise<any> {
        this.writes.push({ op: 'update', object: name, data });
        const id = data?.id ?? opts?.where?.id;
        const cond = opts?.where ?? (id ? { id } : undefined);
        const previous = (this.rows[name] ?? []).find((r) => this.matches(r, cond));
        const ctx = { input: { id, data }, previous: previous ? { ...previous } : undefined, session: opts?.context };
        for (const h of this.hooks) {
            if (h.event === 'beforeUpdate' && (!h.object || h.object === name)) await h.handler(ctx);
        }
        for (const r of this.rows[name] ?? []) if (this.matches(r, cond)) Object.assign(r, data);
        return { affected: 1 };
    }
    async delete(): Promise<any> {
        return { affected: 0 };
    }
    async count(name: string): Promise<number> {
        return (this.rows[name] ?? []).length;
    }
    registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void {
        this.hooks.push({ event, handler, object: options?.object, packageId: options?.packageId });
    }
    unregisterHooksByPackage(packageId: string): number {
        const before = this.hooks.length;
        this.hooks = this.hooks.filter((h) => h.packageId !== packageId);
        return before - this.hooks.length;
    }
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
        const engine = new FakeEngine({
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
        const engine = new FakeEngine({ declared: { webhook: [declaredWebhook({ secret: 'shh' })] } });
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
        const engine = new FakeEngine({ declared: { webhook: [declaredWebhook({ isActive: false })] } });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('an invalid declaration is skipped with one warning per name, and a valid one beside it still dispatches', async () => {
        const warn = vi.fn();
        const engine = new FakeEngine({
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

// ---------------------------------------------------------------------------
// 2. The switch (regime C)
// ---------------------------------------------------------------------------

describe('declared webhooks — the activation ledger switches them (ADR-0131 D6 regime C)', () => {
    it('a ledger row with active:false switches a declared webhook off', async () => {
        const engine = new FakeEngine({
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
        const engine = new FakeEngine({
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
        const engine = new FakeEngine({
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
        const engine = new FakeEngine({ declared: { webhook: [declaredWebhook()] } });
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
        const engine = new FakeEngine({ declared: { webhook: [declaredWebhook()] } });
        engine.failLedgerRead = true;
        const { enqueuer, realtime, calls } = await startEnqueuer(engine, { warn, debug() {} });
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('sys_metadata_activation read failed'), expect.anything());
        await enqueuer.stop();
    });
});

// ---------------------------------------------------------------------------
// 3. The dual read, on an 18.0-shaped database
// ---------------------------------------------------------------------------

describe('declared webhooks — an 18.0 database keeps its seeded rows, and nothing fires twice', () => {
    it('a pristine seeded row is ignored in favour of its declaration: one delivery, from the declaration', async () => {
        const wh = declaredWebhook({ secret: 'shh' });
        const engine = new FakeEngine({
            declared: { webhook: [wh] },
            rows: { sys_webhook: [seeded18_0Row('whk_seeded', wh)] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();

        expect(calls).toHaveLength(1);
        expect(calls[0].refId).toBe(declaredWebhookRefId('task_changed'));
        expect(calls[0].signingSecret).toBe('shh');
        // Expand first: the row is left exactly where 18.0 put it.
        expect(engine.rows['sys_webhook']).toHaveLength(1);
        expect(engine.writes).toEqual([]);
        await enqueuer.stop();
    });

    it('a pristine seeded row follows its declaration\'s switch: switched off, neither the row nor the declaration fires', async () => {
        const wh = declaredWebhook();
        const engine = new FakeEngine({
            declared: { webhook: [wh] },
            rows: { sys_webhook: [seeded18_0Row('whk_seeded', wh)], [LEDGER]: [ledgerRow('task_changed', false)] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('a pristine seeded row follows a changed declaration — the new URL, as the 18.0 seeder would have rewritten it', async () => {
        const engine = new FakeEngine({
            declared: { webhook: [declaredWebhook({ url: 'https://hooks.example/task-v2' })] },
            rows: { sys_webhook: [seeded18_0Row('whk_seeded', declaredWebhook())] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);
        await realtime.publish(taskCreated());
        await flush();
        expect(calls.map((c) => c.url)).toEqual(['https://hooks.example/task-v2']);
        await enqueuer.stop();
    });

    it('a seeded row an administrator switched off (customized) stays off: the declaration is withheld, said once', async () => {
        const warn = vi.fn();
        const wh = declaredWebhook();
        const engine = new FakeEngine({
            declared: { webhook: [wh] },
            rows: { sys_webhook: [seeded18_0Row('whk_seeded', wh, { active: false, customized: true })] },
        });
        const { enqueuer, realtime, calls } = await startEnqueuer(engine, { warn, debug() {} });
        await enqueuer.refresh();
        await realtime.publish(taskCreated());
        await flush();

        expect(calls).toEqual([]);
        const withheld = warn.mock.calls.filter(([m]) => String(m).includes("declared webhook 'task_changed' is not dispatched"));
        expect(withheld).toHaveLength(1);
        await enqueuer.stop();
    });

    it('a seeded row an administrator pointed elsewhere (customized) answers as itself — one delivery, to the row\'s URL', async () => {
        const wh = declaredWebhook({ isActive: false });
        const engine = new FakeEngine({
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

    it('an admin edit through the provenance stamp turns a pristine seeded row into one that answers as itself', async () => {
        const wh = declaredWebhook();
        const engine = new FakeEngine({
            declared: { webhook: [wh] },
            rows: { sys_webhook: [seeded18_0Row('whk_seeded', wh)] },
        });
        bindWebhookProvenanceStamp(engine as any);
        const { enqueuer, realtime, calls } = await startEnqueuer(engine);

        await engine.update('sys_webhook', { id: 'whk_seeded', active: false }, { context: ADMIN_CTX });
        expect(engine.rows['sys_webhook'][0].customized).toBe(true);
        await realtime.publish({ type: 'data.record.updated', object: 'sys_webhook', payload: { recordId: 'whk_seeded' } });
        await flush();
        await realtime.publish(taskCreated());
        await flush();

        expect(calls).toEqual([]);
        await enqueuer.stop();
    });

    it('an administrator-authored row under a declared name answers as itself, and the declaration is withheld', async () => {
        const engine = new FakeEngine({
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

    it('a pristine seeded row whose declaration is gone keeps dispatching, as it did on 18.0', async () => {
        const engine = new FakeEngine({
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
        const engine = new FakeEngine({ declared: { webhook: [declaredWebhook({ secret: 'shh' })] } });
        expect(await guardFor(engine)({ source: 'webhook', refId: declaredWebhookRefId('task_changed') })).toBeUndefined();
    });

    it('refuses one whose declaration is gone, and one switched off through the ledger', async () => {
        const gone = new FakeEngine();
        expect(await guardFor(gone)({ source: 'webhook', refId: declaredWebhookRefId('task_changed') }))
            .toMatch(/no longer declared/);

        const off = new FakeEngine({
            declared: { webhook: [declaredWebhook()] },
            rows: { [LEDGER]: [ledgerRow('task_changed', false)] },
        });
        expect(await guardFor(off)({ source: 'webhook', refId: declaredWebhookRefId('task_changed') }))
            .toMatch(/switched off/);
    });

    it('judges an 18.0 pristine seeded row\'s old delivery by the declaration that now answers for it', async () => {
        const wh = declaredWebhook();
        const engine = new FakeEngine({
            declared: { webhook: [wh] },
            rows: { sys_webhook: [seeded18_0Row('whk_seeded', wh)], [LEDGER]: [ledgerRow('task_changed', false)] },
        });
        // The row itself still reads active:true; the declaration's switch governs.
        expect(await guardFor(engine)({ source: 'webhook', refId: 'whk_seeded' })).toMatch(/switched off/);
    });

    it('judges a customized seeded row by the row, as before', async () => {
        const wh = declaredWebhook();
        const engine = new FakeEngine({
            declared: { webhook: [wh] },
            rows: {
                sys_webhook: [seeded18_0Row('whk_seeded', wh, { customized: true })],
                [LEDGER]: [ledgerRow('task_changed', false)],
            },
        });
        expect(await guardFor(engine)({ source: 'webhook', refId: 'whk_seeded' })).toBeUndefined();
    });
});
