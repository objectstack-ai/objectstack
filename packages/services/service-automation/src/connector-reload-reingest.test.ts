// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7742 — the `metadata:reloaded` connector reconcile must read a set the
// reload actually refreshed.
//
// Every other connector reconcile test (./connector-materialization.test.ts)
// drives the reload through a HAND-MUTATED fake registry: the harness swaps the
// array `listItems('connector')` returns and only then fires the hook, so the
// reconcile always sees the new definition. Nothing on the real reload path
// does that swap. `MetadataPlugin._reloadAndAnnounce` re-ingests the artifact
// into the MetadataManager and announces `metadata:reloaded`; ObjectQL's own
// handler re-ingests the payload's OBJECT definitions into the SchemaRegistry,
// and nothing re-ingests its `connector` items. So on the real path the
// registry the reconcile reads still holds the BOOT snapshot, and a
// connector-only edit reconciles to a no-op: no teardown, no re-materialize,
// the pre-edit connector keeps serving.
//
// These tests therefore use a REAL `SchemaRegistry` and deliberately never
// mutate it across the reload — the registry going stale is the fact under
// test, not an oversight — and assert on the OBSERVABLE effect of the
// reconcile: the old instance's `close()` and a re-materialization carrying the
// new `providerConfig`.

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { SchemaRegistry } from '@objectstack/objectql';
import type {
    Connector,
    ConnectorProviderContext,
    ConnectorProviderFactory,
} from '@objectstack/spec/integration';
import { AutomationServicePlugin } from './plugin.js';
import type { AutomationEngine } from './engine.js';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const PKG = 'com.acme.billing';

/** A provider-bound declarative connector entry — the shape an artifact carries. */
function providerConnector(name: string, endpoint: string) {
    return {
        name,
        label: name,
        type: 'api',
        provider: 'fake',
        providerConfig: { endpoint },
    };
}

/**
 * A provider factory that records each materialization's `providerConfig` and
 * each teardown, so a test can prove a re-materialization happened AND that it
 * carried the edited definition (rather than re-running the boot one).
 */
function makeRecordingProvider() {
    const materialized: Array<{ name: string; endpoint: unknown }> = [];
    const closed: string[] = [];
    const factory: ConnectorProviderFactory = (ctx: ConnectorProviderContext) => {
        materialized.push({
            name: ctx.name,
            endpoint: (ctx.providerConfig as Record<string, unknown> | undefined)?.endpoint,
        });
        return {
            def: {
                name: ctx.name,
                label: ctx.label,
                type: 'api',
                authentication: { type: 'none' },
                actions: [{ key: 'ping', label: 'Ping' }],
            } as unknown as Connector,
            handlers: { ping: async () => ({ ok: true }) },
            close: async () => { closed.push(ctx.name); },
        };
    };
    return { factory, materialized, closed };
}

/**
 * Boot the automation plugin over a REAL `SchemaRegistry` holding the boot-time
 * connector items, and expose `reloadArtifact(...)` — which fires exactly what
 * `MetadataPlugin._reloadAndAnnounce` fires (`{ changed, metadata }`, the
 * freshly parsed artifact) and, like the real path, leaves the registry alone.
 */
async function bootWithRealRegistry(
    bootConnectors: unknown[],
    opts: { served?: () => unknown[] | undefined; packageOf?: (item: any) => string } = {},
) {
    const registry = new SchemaRegistry({ multiTenant: false } as never);
    for (const item of bootConnectors) {
        registry.registerItem('connector', item, 'name' as never, opts.packageOf?.(item) ?? PKG);
    }
    const { factory, materialized, closed } = makeRecordingProvider();

    let captured: any;
    const kernel = new LiteKernel({ logger: { level: 'silent' } } as never);
    kernel.use(new AutomationServicePlugin());
    kernel.use({
        name: 'test.harness',
        type: 'standard' as const,
        version: '1.0.0',
        dependencies: ['com.objectstack.service-automation'],
        async init(ctx: any) {
            captured = ctx;
            ctx.registerService('objectql', { registry });
            if (opts.served) {
                // Stands in for the protocol's flattened `/meta/connector` view:
                // the registry read with the `sys_metadata` overlay rows a Studio
                // publish promoted to active layered over it.
                ctx.registerService('protocol', {
                    getMetaItems: async ({ type }: { type: string }) => {
                        if (type !== 'connector') return [];
                        const served = opts.served!();
                        // `undefined` stands for a read that FAILS (the
                        // sys_metadata query throwing), not an empty view.
                        if (served === undefined) throw new Error('sys_metadata unavailable');
                        return served;
                    },
                });
            }
            ctx.getService('automation').registerConnectorProvider('fake', factory);
        },
        async start() {},
    } as never);
    await kernel.bootstrap();
    await flush();

    /** The dev artifact reload: MetadataPlugin's payload, registry left as-is. */
    const reloadArtifact = async (connectors: unknown[] | undefined) => {
        await captured.trigger('metadata:reloaded', {
            changed: ['connector/billing'],
            metadata: {
                manifest: { id: PKG, version: '1.0.0' },
                objects: [],
                ...(connectors === undefined ? {} : { connectors }),
            },
        });
        await flush();
    };

    return {
        kernel,
        registry,
        reloadArtifact,
        materialized,
        closed,
        engine: kernel.getService('automation') as AutomationEngine,
        trigger: async (payload?: unknown) => {
            await captured.trigger('metadata:reloaded', payload);
            await flush();
        },
    };
}

describe('#7742 — connector reconcile reads a set the reload refreshed', () => {
    it('re-materializes an edited connector on a dev artifact reload that never touches the registry', async () => {
        const h = await bootWithRealRegistry([providerConnector('billing', 'https://old.example')]);
        expect(h.materialized).toEqual([{ name: 'billing', endpoint: 'https://old.example' }]);

        // The edit lands in the artifact — and ONLY there, exactly as on the
        // real reload path.
        await h.reloadArtifact([providerConnector('billing', 'https://new.example')]);

        // Observable effect: the boot instance was torn down and a new one
        // materialized from the EDITED definition.
        expect(h.closed).toEqual(['billing']);
        expect(h.materialized).toEqual([
            { name: 'billing', endpoint: 'https://old.example' },
            { name: 'billing', endpoint: 'https://new.example' },
        ]);
        // …and it is the live, dispatchable one.
        expect(h.engine.getRegisteredConnectors()).toContain('billing');

        await h.kernel.shutdown();
    });

    it('leaves an unedited connector alone (no reconnect churn on every reload)', async () => {
        const h = await bootWithRealRegistry([providerConnector('billing', 'https://old.example')]);

        await h.reloadArtifact([providerConnector('billing', 'https://old.example')]);

        expect(h.closed).toEqual([]);
        expect(h.materialized).toHaveLength(1);

        await h.kernel.shutdown();
    });

    it('tears down a connector the reloaded artifact no longer declares', async () => {
        const h = await bootWithRealRegistry([
            providerConnector('billing', 'https://old.example'),
            providerConnector('shipping', 'https://ship.example'),
        ]);
        expect(h.materialized).toHaveLength(2);

        // `shipping` deleted from the stack; the registry still lists it.
        await h.reloadArtifact([providerConnector('billing', 'https://old.example')]);

        expect(h.closed).toEqual(['shipping']);
        expect(h.engine.getRegisteredConnectors()).not.toContain('shipping');
        expect(h.engine.getRegisteredConnectors()).toContain('billing');

        await h.kernel.shutdown();
    });

    it('materializes a connector added by the reloaded artifact', async () => {
        const h = await bootWithRealRegistry([providerConnector('billing', 'https://old.example')]);

        await h.reloadArtifact([
            providerConnector('billing', 'https://old.example'),
            providerConnector('shipping', 'https://ship.example'),
        ]);

        expect(h.engine.getRegisteredConnectors()).toContain('shipping');
        expect(h.materialized).toEqual([
            { name: 'billing', endpoint: 'https://old.example' },
            { name: 'shipping', endpoint: 'https://ship.example' },
        ]);

        await h.kernel.shutdown();
    });

    it('leaves another package’s connector alone when an app reloads', async () => {
        // The fold is scoped to what the reloaded artifact speaks for. A
        // connector contributed by a DIFFERENT package is absent from that
        // artifact for the obvious reason — it was never in it — and reading
        // that absence as a deletion would take an unrelated integration down
        // on every recompile.
        const h = await bootWithRealRegistry(
            [providerConnector('billing', 'https://old.example'), providerConnector('slack', 'https://slack.example')],
            { packageOf: (item) => (item.name === 'slack' ? 'com.objectstack.connector-slack' : PKG) },
        );
        expect(h.materialized).toHaveLength(2);

        await h.reloadArtifact([providerConnector('billing', 'https://new.example')]);

        expect(h.closed).toEqual(['billing']); // only the edited one
        expect(h.engine.getRegisteredConnectors()).toContain('slack');
        expect(h.engine.getRegisteredConnectors()).toContain('billing');

        await h.kernel.shutdown();
    });

    // The named PRODUCTION trigger. A Studio package publish promotes the
    // authored `sys_metadata` rows to active and announces `metadata:reloaded`
    // with `{ changed }` only — no artifact — so the payload fold above cannot
    // see the edit. What CAN is the protocol's flattened `/meta/connector` view:
    // the same registry read with those active overlay rows layered over it
    // (`mergePackageAwareOverlay` — a row wins over the registry entry it
    // shadows). The reconcile reads that view on every post-boot run.
    describe('Studio package publish (no artifact on the payload)', () => {
        it('re-materializes off the published view while the registry stays stale', async () => {
            let served: unknown[] = [providerConnector('billing', 'https://old.example')];
            const h = await bootWithRealRegistry([providerConnector('billing', 'https://old.example')], {
                served: () => served,
            });
            expect(h.materialized).toHaveLength(1);

            // The publish: the overlay row now carries the edited definition,
            // and the registry — as in a real scoped kernel — does not.
            served = [providerConnector('billing', 'https://published.example')];
            await h.trigger({ changed: ['connector/billing'] });

            expect(h.closed).toEqual(['billing']);
            expect(h.materialized[1]).toEqual({ name: 'billing', endpoint: 'https://published.example' });

            await h.kernel.shutdown();
        });

        it('an empty or failing published view never tears down live connectors', async () => {
            let served: unknown[] | undefined = [providerConnector('billing', 'https://old.example')];
            const h = await bootWithRealRegistry([providerConnector('billing', 'https://old.example')], {
                served: () => served,
            });

            // Empty answer while the registry still lists the connector: the
            // view is a superset of the registry by construction, so this is
            // "not served the way we assume", not "the stack declares none".
            served = [];
            await h.trigger({ changed: ['object/account'] });
            expect(h.closed).toEqual([]);
            expect(h.engine.getRegisteredConnectors()).toContain('billing');

            // Same for a read that throws.
            served = undefined;
            await h.trigger({ changed: ['object/account'] });
            expect(h.closed).toEqual([]);
            expect(h.engine.getRegisteredConnectors()).toContain('billing');

            await h.kernel.shutdown();
        });
    });

    it('a payload carrying no connector collection changes nothing', async () => {
        const h = await bootWithRealRegistry([providerConnector('billing', 'https://old.example')]);

        // A reload whose artifact has no `connectors:` key at all, and a bare
        // announce with no payload (the Studio publish shape): neither may be
        // read as "the stack declares no connectors" and tear the live one down.
        await h.reloadArtifact(undefined);
        await h.trigger({ changed: ['object/account'] });
        await h.trigger();

        expect(h.closed).toEqual([]);
        expect(h.engine.getRegisteredConnectors()).toContain('billing');

        await h.kernel.shutdown();
    });
});
