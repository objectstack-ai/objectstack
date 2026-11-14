// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23316 — a stored flow the engine refuses at boot is not served as running,
 * and its reason is readable; a registered flow reads as before.
 *
 * The defect: the `kernel:ready` cold-boot bind refused a stored flow, warned,
 * and withdrew it (#21848), while the metadata read kept serving the stored row
 * as `status: 'active'` with nothing beside it. After the protocol-18 upgrade
 * every stored flow carrying a shape the engine now refuses boots into exactly
 * that state.
 *
 * The real composition, as `GET /api/v1/meta/flow/:name` and the list read
 * reach it: an ObjectKernel, ObjectQLPlugin's metadata protocol over
 * driver-sql on better-sqlite3 `:memory:`, and the real automation plugin.
 * The stored rows land in `sys_metadata` after ObjectQL has started, so the
 * boot pull never sees them and the `kernel:ready` bind is the step that
 * judges them; the node type's executor is registered from a later plugin's
 * `start()` (the #21848 harness's shape), so the bind refuses the row whose
 * plugin node carries a key the descriptor does not declare — a row stored
 * under one vocabulary and refused under the next, as an upgrade does.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { GetMetaItemCachedResponse, GetMetaItemResponse, GetMetaItemsResponse } from '@objectstack/spec/api';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine, NodeExecutor } from './engine.js';

/** The read surface these tests drive: `ObjectStackProtocolImplementation`'s meta doors. */
interface MetadataReadDoors {
    getMetaItem(request: { type: string; name: string; state?: 'draft' }): Promise<GetMetaItemResponse>;
    /** The default door's producer: REST's cached branch serves `data` and `registration` from it. */
    getMetaItemCached(request: { type: string; name: string }): Promise<GetMetaItemCachedResponse>;
    getMetaItems(request: { type: string }): Promise<GetMetaItemsResponse>;
    saveMetaItem(request: { type: string; name: string; item: unknown; mode?: 'draft' }): Promise<unknown>;
}

const SYS = { isSystem: true } as const;

/** A plugin node type the spec knows nothing about: its descriptor declares `count`. */
const STAMP = 'test_stamp';

function stampExecutor(): NodeExecutor {
    return {
        type: STAMP,
        descriptor: defineActionDescriptor({
            type: STAMP,
            version: '1.0.0',
            name: 'Stamp',
            category: 'custom',
            paradigms: ['flow'],
            source: 'plugin',
            configSchema: { type: 'object', properties: { count: { type: 'number' } } },
        }),
        async execute() {
            return { success: true };
        },
    };
}

/** An active, manually-launched flow whose one plugin node carries `config`. */
function stampFlow(name: string, config: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'stamp', type: STAMP, label: 'Stamp', config },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'stamp' },
            { id: 'e2', source: 'stamp', target: 'end' },
        ],
    };
}

/**
 * The deployment's store and the late node type: the driver joins in `init()`
 * (ObjectQL connects it and creates `sys_metadata` in its own `start()`); the
 * rows land and the executor registers in this plugin's `start()`, after the
 * boot pull and before `kernel:ready`.
 */
function storedFlowsPlugin(driver: SqlDriver, flows: ReadonlyArray<ReturnType<typeof stampFlow>>): Plugin {
    return {
        name: 'test.stored-flows',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.getService<ObjectQL>('objectql').registerDriver(driver as never, true);
        },
        async start(ctx: PluginContext) {
            const ql = ctx.getService<ObjectQL>('objectql');
            for (const flow of flows) {
                await ql.insert(
                    'sys_metadata',
                    { id: `meta_${flow.name}`, name: flow.name, type: 'flow', state: 'active', metadata: JSON.stringify(flow) },
                    { context: SYS } as never,
                );
            }
            ctx.getService<AutomationEngine>('automation').registerNodeExecutor(stampExecutor());
        },
    };
}

describe('a stored flow the engine refuses at boot is not served as running (#23316)', () => {
    let kernel: ObjectKernel;

    afterEach(async () => {
        if (kernel?.getState() === 'running') await kernel.shutdown();
    });

    async function boot() {
        kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        // `cuont` is a key the node type's descriptor does not declare.
        await kernel.use(storedFlowsPlugin(driver, [stampFlow('typo', { cuont: 2 }), stampFlow('valid', { count: 2 })]));
        await kernel.bootstrap();
        return {
            protocol: kernel.getService<MetadataReadDoors>('protocol'),
            automation: kernel.getService<AutomationEngine>('automation'),
        };
    }

    /** What the engine throws for this body — the reason the read must carry verbatim. */
    function refusalOf(automation: AutomationEngine, body: unknown): Error & { code?: unknown } {
        try {
            automation.registerFlow('typo', body);
        } catch (e) {
            return e as Error & { code?: unknown };
        }
        throw new Error('control: the engine was expected to refuse this body');
    }

    it('the item read serves the stored status unchanged, beside the engine\'s refusal and its reason', async () => {
        const { protocol, automation } = await boot();
        expect(await automation.getFlow('typo'), 'control: the bind refused the stored row').toBeNull();

        const read = await protocol.getMetaItem({ type: 'flow', name: 'typo' });
        // Two facts, apart: the author's declared state, as stored…
        expect((read.item as { status?: string }).status).toBe('active');
        // …and the engine's verdict, beside it — what it threw, verbatim.
        const thrown = refusalOf(automation, stampFlow('typo', { cuont: 2 }));
        expect(read.registration).toEqual({ state: 'refused', reason: { message: thrown.message } });
        expect(thrown.code, 'this refusal is a plain error, so the reason carries no code').toBeUndefined();
        expect(read.registration?.state === 'refused' && read.registration.reason.message).toContain('cuont');
    });

    it('the cached read — what the default `GET /meta/flow/:name` serves from — carries the same refusal', async () => {
        const { protocol, automation } = await boot();

        const cached = await protocol.getMetaItemCached({ type: 'flow', name: 'typo' });
        const thrown = refusalOf(automation, stampFlow('typo', { cuont: 2 }));
        expect((cached.data as { status?: string }).status).toBe('active');
        expect(cached.registration).toEqual({ state: 'refused', reason: { message: thrown.message } });
        expect((await protocol.getMetaItemCached({ type: 'flow', name: 'valid' })).registration).toEqual({ state: 'registered' });
    });

    it('control: a registered stored flow reads `registered`, its status as stored', async () => {
        const { protocol, automation } = await boot();
        expect(await automation.getFlow('valid')).not.toBeNull();

        const read = await protocol.getMetaItem({ type: 'flow', name: 'valid' });
        expect((read.item as { status?: string }).status).toBe('active');
        expect(read.registration).toEqual({ state: 'registered' });
    });

    it('the list carries each verdict beside the items, keyed by name — no per-item read', async () => {
        const { protocol } = await boot();
        const list = await protocol.getMetaItems({ type: 'flow' });

        expect(list.registrations?.typo).toMatchObject({ state: 'refused' });
        expect(list.registrations?.valid).toEqual({ state: 'registered' });
        const typo = (list.items as Array<{ name?: string; status?: string }>).find((i) => i.name === 'typo');
        expect(typo?.status, 'the listed item stays as authored').toBe('active');
        expect(typo).not.toHaveProperty('registration');
    });

    it('a later successful registration of the name ends the refusal', async () => {
        const { protocol, automation } = await boot();
        await protocol.saveMetaItem({ type: 'flow', name: 'typo', item: stampFlow('typo', { count: 3 }) });

        await vi.waitFor(async () => {
            expect(await automation.getFlow('typo'), 'the mutation sync registered the corrected row').not.toBeNull();
        });
        expect((await protocol.getMetaItem({ type: 'flow', name: 'typo' })).registration).toEqual({ state: 'registered' });
    });
});

/**
 * A flow stored with no `start` node, now that registration refuses that shape:
 * what each path does with a row stored before the refusal existed, or kept
 * mid-edit through the metadata save door.
 *
 *  - Boot: the kernel still reaches `running`; the bind refuses the row, warns,
 *    and records the refusal; every other stored flow is armed as before.
 *  - Read: the stored row is served unchanged (it does not vanish), beside
 *    `registration: refused` and the engine's words naming the missing node.
 *  - Save: since #32289 the metadata save door's own lint rule
 *    (`flow-start-node-missing`) refuses a live start-less save, whatever the
 *    flow's `status`, so nothing reaches the engine; a metadata draft
 *    (`mode: 'draft'`) still stores mid-edit, with the finding on its draft read.
 */
describe('a stored flow with no start node: refused at the bind, never at the boot, and readable as refused', () => {
    let kernel: ObjectKernel;

    afterEach(async () => {
        if (kernel?.getState() === 'running') await kernel.shutdown();
    });

    const startless = (name: string, status: string) => ({
        ...stampFlow(name, { count: 1 }),
        status,
        nodes: [
            { id: 'stamp', type: STAMP, label: 'Stamp', config: { count: 1 } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'stamp', target: 'end' }],
    });

    async function boot() {
        kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        await kernel.use(storedFlowsPlugin(driver, [startless('no_start', 'active'), stampFlow('valid', { count: 2 })]));
        await kernel.bootstrap();
        return {
            protocol: kernel.getService<MetadataReadDoors>('protocol'),
            automation: kernel.getService<AutomationEngine>('automation'),
        };
    }

    it('the boot completes, the row is not armed, and the read serves it as stored beside the refusal', async () => {
        const { protocol, automation } = await boot();
        expect(kernel.getState()).toBe('running');
        expect(await automation.getFlow('no_start')).toBeNull();
        expect(await automation.getFlow('valid'), 'control: the other stored flow is armed').not.toBeNull();

        const read = await protocol.getMetaItem({ type: 'flow', name: 'no_start' });
        expect((read.item as { status?: string }).status).toBe('active');
        expect(read.registration?.state).toBe('refused');
        const reason = read.registration?.state === 'refused' ? read.registration.reason.message : '';
        expect(reason).toMatch(/^Flow 'no_start' rejected: the flow's top-level `nodes` hold no `start` node/);
    });

    // [#32289] The save door's own lint rule (`flow-start-node-missing`) now
    // refuses the live save, whatever the flow's `status`, so nothing reaches
    // the engine; a metadata draft (`mode: 'draft'`) still stores mid-edit,
    // with the finding on its draft read.
    it('the metadata save door refuses a live start-less save, and keeps a start-less draft with the finding', async () => {
        const { protocol, automation } = await boot();
        const refusal = await protocol
            .saveMetaItem({ type: 'flow', name: 'draft_no_start', item: startless('draft_no_start', 'draft') })
            .then(() => null, (e: unknown) => e as { code?: string; status?: number; issues?: Array<{ rule?: string }> });
        expect({ code: refusal?.code, status: refusal?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect((refusal?.issues ?? []).map((i) => i.rule)).toContain('flow-start-node-missing');
        expect(await automation.getFlow('draft_no_start')).toBeNull();

        await protocol.saveMetaItem({ type: 'flow', name: 'draft_no_start', item: startless('draft_no_start', 'draft'), mode: 'draft' });
        const read = await protocol.getMetaItem({ type: 'flow', name: 'draft_no_start', state: 'draft' });
        const diagnostics = (read.item as { _diagnostics?: { valid: boolean; errors?: Array<{ code?: string }> } })._diagnostics;
        expect(diagnostics?.valid).toBe(false);
        expect((diagnostics?.errors ?? []).map((e) => e.code)).toContain('flow-start-node-missing');
        expect(await automation.getFlow('draft_no_start')).toBeNull();
    });
});

/**
 * Ruling 6810500711 (letter D): an after-save flow whose inline outbound call
 * is retried, now that registration refuses it. At every door a flow becomes
 * active through:
 *
 *  - Boot: a row stored before the refusal is refused at the bind and reads as
 *    refused beside its stored body; it does not vanish, and the kernel runs.
 *  - Save: the metadata save door's lint rule (`flow-after-save-inline-retry`)
 *    refuses a live save with 422 and stores nothing; a draft keeps the
 *    finding. The same node with `durable: true` saves and is armed.
 *  - `POST /automation` and the clone door call `registerFlow`, whose refusal
 *    the route answers as a 4xx (`registerAndSaveFlow`); the engine's own
 *    refusal is pinned in `flow-registration-checks.test.ts`.
 */
describe('an after-save flow with a retried inline callout: refused at the bind and at the save door', () => {
    let kernel: ObjectKernel;

    afterEach(async () => {
        if (kernel?.getState() === 'running') await kernel.shutdown();
    });

    const afterSaveSync = (name: string, status: string, httpConfig: Record<string, unknown> = {}) => ({
        name,
        label: name,
        type: 'autolaunched',
        status,
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'sys_metadata', triggerType: 'record-after-update' } },
            {
                id: 'guarded_push', type: 'try_catch', label: 'Push with retry',
                config: {
                    retry: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
                    try: { nodes: [{ id: 'push', type: 'http', label: 'Push', config: { url: 'https://api.example.com/v1/tasks', method: 'POST', ...httpConfig } }], edges: [] },
                    catch: { nodes: [{ id: 'flag', type: 'assignment', label: 'Flag', config: { failed: true } }], edges: [] },
                },
            },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'guarded_push' },
            { id: 'e2', source: 'guarded_push', target: 'end' },
        ],
    });

    async function boot() {
        kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
        await kernel.use(storedFlowsPlugin(driver, [
            afterSaveSync('stored_sync', 'active') as never,
            stampFlow('valid', { count: 2 }),
        ]));
        await kernel.bootstrap();
        return {
            protocol: kernel.getService<MetadataReadDoors>('protocol'),
            automation: kernel.getService<AutomationEngine>('automation'),
        };
    }

    it('the boot completes, the stored row is not armed, and the read serves it beside the refusal', async () => {
        const { protocol, automation } = await boot();
        expect(kernel.getState()).toBe('running');
        expect(await automation.getFlow('stored_sync')).toBeNull();
        expect(await automation.getFlow('valid'), 'control: the other stored flow is armed').not.toBeNull();

        const read = await protocol.getMetaItem({ type: 'flow', name: 'stored_sync' });
        expect((read.item as { status?: string }).status).toBe('active');
        expect(read.registration?.state).toBe('refused');
        const reason = read.registration?.state === 'refused' ? read.registration.reason.message : '';
        expect(reason).toMatch(/^Flow 'stored_sync' rejected: 1 inline outbound call\(s\) retried on the save path/);
        expect(reason).toContain("node 'push' (`http`)");
        expect(reason).toContain('Set `durable: true` on the node');
    });

    it('the metadata save door refuses a live save with 422 and the rule, and keeps a draft with the finding', async () => {
        const { protocol, automation } = await boot();
        const refusal = await protocol
            .saveMetaItem({ type: 'flow', name: 'new_sync', item: afterSaveSync('new_sync', 'active') })
            .then(() => null, (e: unknown) => e as { code?: string; status?: number; issues?: Array<{ rule?: string }> });
        expect({ code: refusal?.code, status: refusal?.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
        expect((refusal?.issues ?? []).map((i) => i.rule)).toContain('flow-after-save-inline-retry');
        expect(await automation.getFlow('new_sync')).toBeNull();

        await protocol.saveMetaItem({ type: 'flow', name: 'new_sync', item: afterSaveSync('new_sync', 'active'), mode: 'draft' });
        const read = await protocol.getMetaItem({ type: 'flow', name: 'new_sync', state: 'draft' });
        const diagnostics = (read.item as { _diagnostics?: { valid: boolean; errors?: Array<{ code?: string }> } })._diagnostics;
        expect(diagnostics?.valid).toBe(false);
        expect((diagnostics?.errors ?? []).map((e) => e.code)).toContain('flow-after-save-inline-retry');
    });

    it('control: the same flow with `durable: true` saves and is armed', async () => {
        const { protocol, automation } = await boot();
        await protocol.saveMetaItem({ type: 'flow', name: 'durable_sync', item: afterSaveSync('durable_sync', 'active', { durable: true }) });
        await vi.waitFor(async () => {
            expect(await automation.getFlow('durable_sync'), 'the mutation sync registered the durable row').not.toBeNull();
        });
        expect((await protocol.getMetaItem({ type: 'flow', name: 'durable_sync' })).registration).toEqual({ state: 'registered' });
    });
});
