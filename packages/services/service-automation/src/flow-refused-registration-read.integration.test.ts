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
    getMetaItem(request: { type: string; name: string }): Promise<GetMetaItemResponse>;
    /** The default door's producer: REST's cached branch serves `data` and `registration` from it. */
    getMetaItemCached(request: { type: string; name: string }): Promise<GetMetaItemCachedResponse>;
    getMetaItems(request: { type: string }): Promise<GetMetaItemsResponse>;
    saveMetaItem(request: { type: string; name: string; item: unknown }): Promise<unknown>;
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
