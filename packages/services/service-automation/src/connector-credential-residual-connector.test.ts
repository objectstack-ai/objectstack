// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0015 D7 × ADR-0130 D4] A connector instance a composed stack declares
 * only on its TOP LEVEL, beside package bodies that do not declare it — the
 * stack's residual — lends its credential at boot, the way one a body
 * declares does.
 *
 * ## The defect this pins
 *
 * `composeStacks([mixed, borrower], { manifest: 'preserve' })`, where `mixed`
 * is an input that carries `packages[]` AND a top-level connector instance no
 * body repeats, is accepted at build: the composed check finds the instance
 * and judges that it can lend. At boot the residual rule registered that
 * instance into the metadata service only, and the engine's `manifest`
 * service registered the residual's OBJECTS only, so the lender — which reads
 * the ObjectQL registry (`readDeclaredConnectorItems`) — did not see it, and
 * the datasource's borrow was refused as undeclared until a dev reload
 * carried the artifact in. Build and boot gave two answers.
 *
 * ## What each pin is for
 *
 *  - the residual instance lends at boot, under the stack's own id, which is
 *    the owner the residual rule names;
 *  - the residual descriptor (no `provider`) is refused at boot as a
 *    descriptor, not as undeclared: the lender sees it and judges it;
 *  - CONTROL: an instance a package body declares lends, as it always did.
 *
 * The stack is booted through the `manifest` service, the way `AppPlugin`
 * hands a config boot's stack to it: `{ ...bundle.manifest, ...bundle }`. The
 * artifact door hands the engine the same stack. The values are obvious dummies.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { composeStacks, defineStack } from '@objectstack/spec';
import { CONNECTOR_CREDENTIAL_SOURCE_SERVICE, type IConnectorCredentialSource } from '@objectstack/types';

import { AutomationServicePlugin } from './plugin.js';

const REF = 'DUMMY_RESIDUAL_SAP_TOKEN';
const DUMMY_ENV_VALUE = 'dummy-residual-dddd-0004';

const MIXED_ID = 'com.acme.bundle';
const BODY_ID = 'com.acme.orders';

const pluginManifest = (id: string) => ({
    id,
    namespace: id.split('.').pop(),
    version: '1.0.0',
    type: 'plugin',
    name: id.split('.').pop(),
});

const instance = (over: Record<string, unknown> = {}) => ({
    name: 'sap_s4',
    label: 'SAP S/4HANA',
    type: 'api',
    provider: 'fake',
    providerConfig: {},
    auth: { type: 'bearer', credentialRef: REF },
    ...over,
});

const sapOrders = () => ({
    name: 'sap_orders',
    driver: 'odata',
    config: { serviceUrl: 'https://sap.example.com/odata/v4/orders' },
    schemaMode: 'external',
    external: { connector: 'sap_s4' },
});

/** The borrowing input, which declares no connector of its own. */
const looseBorrower = () =>
    defineStack({ manifest: pluginManifest('com.acme.ds'), datasources: [sapOrders()] } as never, { strict: false });

/**
 * An input that carries `packages[]` and, on its top level only, `connectors`
 * — the mixed shape. `bodyConnectors` lands on the package body instead.
 */
const mixed = (topLevel: unknown[] | undefined, bodyConnectors?: unknown[]) =>
    defineStack(
        {
            manifest: pluginManifest(MIXED_ID),
            ...(topLevel ? { connectors: topLevel } : {}),
            packages: [{ manifest: { ...pluginManifest(BODY_ID), ...(bodyConnectors ? { connectors: bodyConnectors } : {}) } }],
        } as never,
        { strict: false },
    );

/** What `AppPlugin.init` hands the `manifest` service. */
const payload = (bundle: Record<string, unknown>) => ({ ...(bundle.manifest as object), ...bundle });

const kernels: ObjectKernel[] = [];
const envKeys: string[] = [];
afterEach(async () => {
    for (const k of kernels.splice(0)) await k.shutdown().catch(() => {});
    for (const key of envKeys.splice(0)) delete process.env[key];
});

function setEnv(key: string, value: string): void {
    envKeys.push(key);
    process.env[key] = value;
}

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
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: () => undefined }));
    await kernel.use({
        name: 'test.stack',
        type: 'standard',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql', 'com.objectstack.service-automation'],
        async init(ctx: PluginContext) {
            ctx.getService<any>('automation').registerConnectorProvider('fake', (pctx: any) => ({
                def: { name: pctx.name, label: pctx.label, type: 'api', actions: [{ key: 'request', label: 'Request' }] },
                handlers: { request: async () => ({ status: 200, ok: true, body: {} }) },
            }));
            await ctx.getService<{ register(m: unknown): Promise<void> }>('manifest').register(payload(stack));
        },
    } as Plugin);
    await kernel.bootstrap();
    const ql = kernel.getService<ObjectQL>('objectql');
    const source = kernel.getService<IConnectorCredentialSource>(CONNECTOR_CREDENTIAL_SOURCE_SERVICE);
    return { ql, source };
}

const connectorOwners = (ql: ObjectQL): Array<[unknown, unknown]> =>
    (ql.registry.listItems('connector') as Array<{ name?: unknown; _packageId?: unknown }>)
        .map((c) => [c.name, c._packageId]);

describe('[ADR-0015 D7] a connector a mixed composed input declares only on its top level', () => {
    it('is accepted at build: the composed check judges that it can lend', () => {
        expect(() => composeStacks([mixed([instance()]), looseBorrower()] as never, { manifest: 'preserve' } as never)).not.toThrow();
    });

    it('lends its credential at boot, registered under the stack\'s own id', async () => {
        setEnv(REF, DUMMY_ENV_VALUE);
        const stack = composeStacks([mixed([instance()]), looseBorrower()] as never, { manifest: 'preserve' } as never) as Record<string, unknown>;
        const { ql, source } = await boot(stack);
        const ownerId = (stack.manifest as { id?: string }).id;
        const handle = await source.borrow('sap_s4');
        expect(handle.connector).toBe('sap_s4');
        await expect(handle.get()).resolves.toEqual({ auth: { type: 'bearer', token: DUMMY_ENV_VALUE } });
        expect(connectorOwners(ql)).toEqual([['sap_s4', ownerId]]);
    });

    it('is judged by the lender at boot when it cannot lend: a descriptor is refused as one, not as undeclared', async () => {
        // Hand-assembled: the composed check refuses a borrow of a descriptor.
        const descriptor = { name: 'sap_s4', label: 'SAP S/4HANA', type: 'api' };
        const stack = composeStacks([mixed([descriptor]), defineStack({ manifest: pluginManifest('com.acme.ds') } as never)] as never, {
            manifest: 'preserve',
        } as never) as Record<string, unknown>;
        const { ql, source } = await boot(stack);
        const refused = await source.borrow('sap_s4').then(() => undefined, (err: unknown) => err as { status?: number; message?: string });
        expect(refused?.status).toBe(422);
        expect(refused?.message).not.toContain('is not declared');
        expect(refused?.message).toContain('declares no provider');
        expect(connectorOwners(ql).map(([name]) => name)).toEqual(['sap_s4']);
    });

    it('CONTROL: an instance a package body declares lends at boot, owned by that body', async () => {
        setEnv(REF, DUMMY_ENV_VALUE);
        const stack = composeStacks([mixed(undefined, [instance()]), looseBorrower()] as never, { manifest: 'preserve' } as never) as Record<string, unknown>;
        const { ql, source } = await boot(stack);
        expect(connectorOwners(ql)).toEqual([['sap_s4', BODY_ID]]);
        await expect((await source.borrow('sap_s4')).get()).resolves.toEqual({ auth: { type: 'bearer', token: DUMMY_ENV_VALUE } });
    });
});
