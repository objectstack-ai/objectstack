// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0130 D4] A flow a composed stack declares only on its TOP LEVEL, beside
 * package bodies that do not declare it — the stack's residual — is registered
 * with the automation engine at boot and runs, the way one a body declares does.
 *
 * ## The defect this pins
 *
 * `composeStacks([mixed, other], { manifest: 'preserve' })`, where `mixed` is an
 * input that carries `packages[]` AND a top-level flow no body repeats, booted:
 * the residual rule registered that flow into the metadata service only, and the
 * engine's `manifest` service registered the residual's objects and connectors
 * only. The automation plugin's boot pull reads `registry.listItems('flow')`, so
 * the flow never reached the engine: `/meta` listed a flow `getFlow` answered
 * `null` for, and its trigger never armed.
 *
 * ## What each pin is for
 *
 *  - the residual flow is registered with the engine at boot, owned by the
 *    stack's own id (the owner the residual rule names), and runs;
 *  - a flow a package body declares is registered once, owned by that body,
 *    whether or not the top level repeats it;
 *  - CONTROL: a stack with no residual flow registers exactly the bodies' flows.
 *
 * The stack is booted through the `manifest` service, the way `AppPlugin` hands
 * a config boot's stack to it: `{ ...bundle.manifest, ...bundle }`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { composeStacks, defineStack } from '@objectstack/spec';

import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const MIXED_ID = 'com.acme.bundle';
const BODY_ID = 'com.acme.orders';

const pluginManifest = (id: string) => ({
    id,
    namespace: id.split('.').pop(),
    version: '1.0.0',
    type: 'plugin',
    name: id.split('.').pop(),
});

const flow = (name: string) => ({
    name,
    label: name,
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/**
 * An input that carries `packages[]` and, on its top level only, `topLevel`
 * flows — the mixed shape. `bodyFlows` lands on the package body.
 */
const mixed = (topLevel: unknown[] | undefined, bodyFlows: unknown[]) =>
    defineStack(
        {
            manifest: pluginManifest(MIXED_ID),
            ...(topLevel ? { flows: topLevel } : {}),
            packages: [{ manifest: { ...pluginManifest(BODY_ID), flows: bodyFlows } }],
        } as never,
        { strict: false },
    );

const other = () => defineStack({ manifest: pluginManifest('com.acme.other') } as never, { strict: false });

const composed = (topLevel: unknown[] | undefined, bodyFlows: unknown[]) =>
    composeStacks([mixed(topLevel, bodyFlows), other()] as never, { manifest: 'preserve' } as never) as Record<string, unknown>;

/** What `AppPlugin.init` hands the `manifest` service. */
const payload = (bundle: Record<string, unknown>) => ({ ...(bundle.manifest as object), ...bundle });

const kernels: ObjectKernel[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
});

/** Boot the engine and the automation plugin; register `stack` through the `manifest` service at init. */
async function boot(stack: Record<string, unknown>) {
    const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false });
    kernels.push(kernel);
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
        name: 'test.driver.sqlite',
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            ctx.registerService('driver.default', driver);
        },
    } as Plugin);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use({
        name: 'test.stack',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql', 'com.objectstack.service-automation'],
        async init(ctx: PluginContext) {
            await ctx.getService<{ register(m: unknown): Promise<void> }>('manifest').register(payload(stack));
        },
    } as Plugin);
    await kernel.bootstrap();
    return { ql: kernel.getService<ObjectQL>('objectql'), automation: kernel.getService<AutomationEngine>('automation') };
}

const flowOwners = (ql: ObjectQL): Array<[unknown, unknown]> =>
    (ql.registry.listItems('flow') as Array<{ name?: unknown; _packageId?: unknown }>)
        .map((f): [unknown, unknown] => [f.name, f._packageId])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe('[ADR-0130 D4] a flow a mixed composed input declares only on its top level', () => {
    it('is registered with the automation engine at boot, owned by the stack\'s own id, and runs', async () => {
        const stack = composed([flow('acme_residual_flow')], [flow('acme_body_flow')]);
        const { ql, automation } = await boot(stack);
        const ownerId = (stack.manifest as { id?: string }).id;

        expect(flowOwners(ql)).toEqual([
            ['acme_body_flow', BODY_ID],
            ['acme_residual_flow', ownerId],
        ]);
        expect((await automation.listFlows()).sort()).toEqual(['acme_body_flow', 'acme_residual_flow']);
        expect(await automation.getFlow('acme_residual_flow')).not.toBeNull();
        const run = await automation.execute('acme_residual_flow');
        expect(run.error).toBeUndefined();
        expect(run.success).toBe(true);
    });

    it('a flow a package body declares is registered once, owned by that body, when the top level repeats it', async () => {
        const { ql, automation } = await boot(composed([flow('acme_body_flow')], [flow('acme_body_flow')]));
        expect(flowOwners(ql)).toEqual([['acme_body_flow', BODY_ID]]);
        expect(await automation.listFlows()).toEqual(['acme_body_flow']);
    });

    it('CONTROL: a stack with no top-level flow registers exactly the bodies\' flows', async () => {
        const { ql, automation } = await boot(composed(undefined, [flow('acme_body_flow')]));
        expect(flowOwners(ql)).toEqual([['acme_body_flow', BODY_ID]]);
        expect(await automation.listFlows()).toEqual(['acme_body_flow']);
    });
});
