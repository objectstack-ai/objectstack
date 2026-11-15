// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Descriptor-only contract audit (#2612): declarative `connectors:` stack
// entries are catalog descriptors — registerApp stores them as metadata, but
// the engine's connector registry is populated only by plugins calling
// `engine.registerConnector(def, handlers)` (ADR-0018 §Addendum). A declared
// connector with actions and no plugin behind it LOOKS dispatchable but is
// inert; the audit at kernel:ready surfaces exactly those entries as a loud
// warning instead of letting `connector_action` fail mysteriously at runtime.
// Provider-bound declarative instances (which upgrade this warning to an
// error) are tracked in #2977 / ADR-0097.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, it, expect, vi } from 'vitest';
import { LiteKernel, ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin, SchemaRegistry, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ConnectorProviderFactory } from '@objectstack/spec/integration';
import { AutomationServicePlugin, findInertDeclaredConnectors } from './plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** A declarative connector entry, the raw shape registerApp registers. */
function declaredConnector(name: string, opts: { actions?: number; enabled?: boolean } = {}) {
    const { actions = 1, enabled } = opts;
    return {
        name,
        label: name,
        type: 'api',
        authentication: { type: 'none' },
        ...(enabled === undefined ? {} : { enabled }),
        actions: Array.from({ length: actions }, (_, i) => ({
            key: `action_${i}`,
            label: `Action ${i}`,
        })),
    };
}

/**
 * Boot a kernel with the automation plugin, a fake objectql registry serving
 * the declared connector metadata, and (optionally) a live plugin-registered
 * connector. Returns the shared kernel logger's warn spy.
 */
async function bootWithConnectors(
    declared: unknown[],
    opts: { registerLive?: string[]; registry?: SchemaRegistry; provider?: ConnectorProviderFactory } = {},
) {
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    let warnSpy!: ReturnType<typeof vi.spyOn>;
    const harness = {
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: [] as string[],
        async init(ctx: any) {
            // Kernel contexts share one logger instance (KernelBase.createContext),
            // so spying here observes the automation plugin's warn calls too.
            warnSpy = vi.spyOn(ctx.logger, 'warn');
            ctx.registerService('objectql', {
                registry: opts.registry ?? {
                    listItems: (type: string) => (type === 'connector' ? declared : []),
                },
            });
            if (opts.provider) ctx.getService('automation').registerConnectorProvider('fake', opts.provider);
            for (const name of opts.registerLive ?? []) {
                ctx.getService('automation').registerConnector(
                    {
                        name,
                        label: name,
                        type: 'api',
                        authentication: { type: 'none' },
                        actions: [{ key: 'action_0', label: 'Action 0' }],
                    },
                    { action_0: async () => ({ ok: true }) },
                );
            }
        },
        async start() {},
    };
    kernel.use(harness as never);
    await kernel.bootstrap();
    await flush();
    return { kernel, warnSpy };
}

function auditWarnings(warnSpy: ReturnType<typeof vi.spyOn>): string[] {
    return warnSpy.mock.calls
        .map((c: unknown[]) => String(c[0]))
        .filter((m: string) => m.includes('declarative connector'));
}

describe('findInertDeclaredConnectors (pure contract)', () => {
    it('flags declared connectors with actions and no runtime registration', () => {
        const inert = findInertDeclaredConnectors(
            [declaredConnector('crm_billing'), declaredConnector('crm_erp')],
            new Set(['rest']),
        );
        expect(inert).toEqual(['crm_billing', 'crm_erp']);
    });

    it('does not flag connectors that ARE runtime-registered under the same name', () => {
        expect(
            findInertDeclaredConnectors([declaredConnector('rest')], new Set(['rest'])),
        ).toEqual([]);
    });

    it('does not flag action-less catalog descriptors', () => {
        expect(
            findInertDeclaredConnectors([declaredConnector('catalog_only', { actions: 0 })], new Set()),
        ).toEqual([]);
    });

    it('does not flag entries explicitly opted out with enabled: false', () => {
        expect(
            findInertDeclaredConnectors(
                [declaredConnector('deliberate_descriptor', { enabled: false })],
                new Set(),
            ),
        ).toEqual([]);
    });

    it('tolerates malformed entries (no name, non-object) without throwing', () => {
        expect(
            findInertDeclaredConnectors(
                [null, 42, {}, { actions: [{ key: 'a' }] }],
                new Set(),
            ),
        ).toEqual([]);
    });
});

describe('kernel:ready audit (wiring)', () => {
    it('warns once at boot for an inert declared connector, naming it', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([declaredConnector('crm_billing')]);
        const warnings = auditWarnings(warnSpy);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('crm_billing');
        expect(warnings[0]).toContain('catalog descriptors (descriptor-only contract)');
        await kernel.shutdown();
    });

    it('stays silent when the declared connector is plugin-registered', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([declaredConnector('rest')], {
            registerLive: ['rest'],
        });
        expect(auditWarnings(warnSpy)).toHaveLength(0);
        await kernel.shutdown();
    });

    it('stays silent for a deliberate catalog-only entry (enabled: false)', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([
            declaredConnector('catalog_entry', { enabled: false }),
        ]);
        expect(auditWarnings(warnSpy)).toHaveLength(0);
        await kernel.shutdown();
    });

    it('[#31699 PR 3] a package\'s catalog entry is not silenced by another package\'s live instance of its name', async () => {
        const A = 'com.acme.catalog_a';
        const B = 'com.acme.instance_b';
        const registry = new SchemaRegistry();
        registry.logLevel = 'silent';
        for (const id of [A, B]) {
            registry.installPackage({ id, name: id, version: '1.0.0', type: 'app', namespace: id.split('.').pop() } as never, 'code');
        }
        registry.registerItem('connector', declaredConnector('billing') as never, 'name' as never, A);
        registry.registerItem('connector', { ...declaredConnector('billing'), provider: 'fake', providerConfig: {} } as never, 'name' as never, B);
        const provider: ConnectorProviderFactory = (ctx) => ({
            def: { name: ctx.name, label: ctx.label, type: 'api', authentication: { type: 'none' }, actions: [{ key: 'action_0', label: 'A' }] } as never,
            handlers: { action_0: async () => ({}) },
        });
        const { kernel, warnSpy } = await bootWithConnectors([], { registry, provider });
        const warnings = auditWarnings(warnSpy);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('billing');
        await kernel.shutdown();
    });

    it('stays silent when nothing is declared', async () => {
        const { kernel, warnSpy } = await bootWithConnectors([]);
        expect(auditWarnings(warnSpy)).toHaveLength(0);
        await kernel.shutdown();
    });
});

/**
 * [#33839] The metadata door. A catalog descriptor saved ACTIVE through
 * `PUT /api/v1/meta/connector/:name` raises the protocol's mutation signal
 * and no `metadata:reloaded`, so an audit wired on the reload alone never
 * reported it until a later publish or a restart. Real write path:
 * ObjectKernel, ObjectQLPlugin's metadata protocol, driver-sql on a file.
 */
describe('[#33839] the audit on the metadata save door', () => {
    const kernels: ObjectKernel[] = [];
    const dirs: string[] = [];
    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            if (k.getState() === 'running') await k.shutdown().catch(() => {});
        }
        for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    interface Protocol {
        saveMetaItem(request: { type: string; name: string; item: unknown; mode?: 'draft' | 'publish' }): Promise<unknown>;
        publishMetaItem(request: { type: string; name: string }): Promise<unknown>;
    }

    async function bootOverStore() {
        const dir = mkdtempSync(join(tmpdir(), 'os-33839-'));
        dirs.push(dir);
        let warnSpy!: ReturnType<typeof vi.spyOn>;
        const kernel = new ObjectKernel({ logger: { level: 'fatal' }, gracefulShutdown: false } as never);
        kernels.push(kernel);
        await kernel.use(new ObjectQLPlugin());
        await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory', credentialResolver: () => undefined }));
        await kernel.use({
            name: 'test.harness.33839',
            type: 'standard' as const,
            version: '1.0.0',
            dependencies: ['com.objectstack.service-automation'],
            async init(ctx: any) {
                // One logger instance across contexts: this spy sees the automation plugin's warns.
                warnSpy = vi.spyOn(ctx.logger, 'warn');
            },
            async start() {},
        } as never);
        await kernel.bootstrap();
        const ql = kernel.getService<ObjectQL>('objectql');
        const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'store.sqlite') }, useNullAsDefault: true });
        await driver.connect();
        ql.registerDriver(driver as never, true);
        await ql.syncSchemas();
        await installDefaultOrganization(ql);
        const protocol = kernel.getService<Protocol>('protocol');
        return {
            warnings: () => auditWarnings(warnSpy),
            save: (name: string, item: unknown) => protocol.saveMetaItem({ type: 'connector', name, item }),
            saveDraft: (name: string, item: unknown) => protocol.saveMetaItem({ type: 'connector', name, item, mode: 'draft' }),
            publish: async (name: string, item: unknown) => {
                await protocol.saveMetaItem({ type: 'connector', name, item, mode: 'draft' });
                await protocol.publishMetaItem({ type: 'connector', name });
            },
        };
    }

    /** Every descriptor audit; a case waits for the ones its write queues to finish. */
    const auditSpy = vi.spyOn(
        AutomationServicePlugin.prototype as unknown as { auditDeclaredConnectors(...args: unknown[]): Promise<void> },
        'auditDeclaredConnectors',
    );
    afterAll(() => auditSpy.mockRestore());
    /** Run `write`, then wait until `count` audits after it have finished. */
    async function audited(count: number, write: () => Promise<unknown>) {
        const before = auditSpy.mock.results.length;
        await write();
        await vi.waitFor(() => expect(auditSpy.mock.results.length - before).toBeGreaterThanOrEqual(count), { timeout: 3000 });
        await Promise.all(auditSpy.mock.results.slice(before).map((r) => r.value));
        for (let i = 0; i < 5; i++) await flush();
        expect(auditSpy.mock.results.length - before).toBe(count);
    }

    it('warns, naming it, when a catalog descriptor is saved active through the direct door', async () => {
        const store = await bootOverStore();
        expect(store.warnings()).toEqual([]);

        await audited(1, () => store.save('qa_erp_rt', declaredConnector('qa_erp_rt')));
        expect(store.warnings()).toHaveLength(1);
        expect(store.warnings()[0]).toContain('1 declarative connector(s)');
        expect(store.warnings()[0]).toContain(': qa_erp_rt.');
    });

    it('a later publish says the changed set once, naming every inert descriptor', async () => {
        const store = await bootOverStore();
        await audited(1, () => store.save('qa_erp_rt', declaredConnector('qa_erp_rt')));

        // A publish raises the mutation signal AND `metadata:reloaded`: two audits, one warning.
        await audited(2, () => store.publish('qa_erp_rt2', declaredConnector('qa_erp_rt2')));
        expect(store.warnings()).toHaveLength(2);
        expect(store.warnings()[1]).toContain('2 declarative connector(s)');
        expect(store.warnings()[1]).toContain('qa_erp_rt, qa_erp_rt2');
    });

    it('control: a re-save that leaves the inert set as it was adds no warning; one that empties it and restores it warns again', async () => {
        const store = await bootOverStore();
        await audited(1, () => store.save('qa_erp_rt', declaredConnector('qa_erp_rt')));
        await audited(1, () => store.save('qa_erp_rt', { ...declaredConnector('qa_erp_rt'), label: 'Relabelled' }));
        expect(store.warnings()).toHaveLength(1);

        await audited(1, () => store.save('qa_erp_rt', declaredConnector('qa_erp_rt', { enabled: false })));
        expect(store.warnings()).toHaveLength(1);
        await audited(1, () => store.save('qa_erp_rt', declaredConnector('qa_erp_rt')));
        expect(store.warnings()).toHaveLength(2);
        expect(store.warnings()[1]).toContain(': qa_erp_rt.');
    });

    it('control: a draft save runs no audit', async () => {
        const store = await bootOverStore();
        await audited(0, () => store.saveDraft('qa_erp_draft', declaredConnector('qa_erp_draft')));
        expect(store.warnings()).toEqual([]);
    });
});
