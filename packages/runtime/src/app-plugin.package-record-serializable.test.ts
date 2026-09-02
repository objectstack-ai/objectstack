// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14442 — a stack that declares plugin INSTANCES still produces a package
 * record every read door can serialize.
 *
 * ## The defect
 *
 * `AppPlugin.init` flattens its bundle into `{ ...bundle.manifest, ...bundle }`
 * and hands that to `manifest.register()`; `SchemaRegistry.installPackage`
 * stores it RAW as the package record's `manifest`. A code-defined stack's
 * `plugins: [new ConnectorOpenApiPlugin(), …]` are instantiated kernel plugins,
 * and a booted one holds the engine (`ctx.getService('objectql')`), which
 * refers back to itself — so the stored record contained a CYCLE. Every door
 * that serves a package row runs it through `JSON.stringify`:
 *
 *   GET /api/v1/packages            (dispatcher list)    → HTTP 500
 *   GET /api/v1/packages/:id        (dispatcher detail)  → HTTP 500
 *   GET /api/v1/meta/package        (getMetaItems)       → HTTP 500
 *   POST /api/v1/packages/:id/duplicate → sys_packages persist FAILED
 *
 * all answering `Converting circular structure to JSON`. Studio's package
 * picker reads the list door, so it was wholly unavailable on any app with
 * plugin instances (`examples/app-showcase`), while a purely declarative one
 * (`examples/app-todo`) was unaffected.
 *
 * ## What these pins are shaped to catch
 *
 * The whole risk of the fix is over-removal, so the discriminating assertion is
 * a COMPARISON against a control kernel booted with the same bundle minus the
 * instances. Everything else about the record — including a manifest-shaped
 * nested plugin, whose objects the engine registers under the parent package's
 * ownership (`ObjectQL.registerApp` step 7 → `registerPlugin`) — must be
 * byte-identical between the two. A fix that dropped `plugins` wholesale would
 * pass "it serializes" and fail here, which is exactly the point: that fix
 * would silently retire nested-plugin registration.
 *
 * The registry is REAL (`ObjectQLPlugin` on a real kernel) and so is the door
 * body (`handlePackagesRequest` via `HttpDispatcher.handlePackages`, and
 * `ObjectStackProtocolImplementation.getMetaItems`) — no `vi.fn` stands in for
 * either. A double for the registry cannot see this defect at all: the defect
 * is what the real registry stores.
 *
 * ## Ablation — predicted 1 red / 3 green, MEASURED 2 red / 2 green
 *
 * Restoring the raw spread in `app-plugin.ts` (`const servicePayload =
 * this.bundle.manifest ? { ...this.bundle.manifest, ...this.bundle } :
 * this.bundle;`) turns BOTH kernel-boot tests red, and the two direct
 * `withoutRuntimePluginInstances` tests stay green — they never go through the
 * register seam, so they are the deliberate control.
 *
 * The prediction was wrong by one and the correction is worth stating: the
 * byte-identity test was expected to survive, because the raw spread does not
 * touch a declarative key. It fails anyway, and for the right reason — its
 * comparison is `JSON.stringify(record.manifest)`, and on the unfixed side
 * that expression THROWS rather than returning a different string. Both
 * failures carry the production envelope verbatim:
 *
 *   TypeError: Converting circular structure to JSON
 *       --> starting at object with constructor 'EngineHoldingPlugin'
 *       |     property 'connectors' -> object with constructor 'Array'
 *       |     index 0 -> object with constructor 'Object'
 *       --- property 'owner' closes the circle
 *
 * Both the mutated module and this file live in `packages/runtime/src` and
 * resolve through vitest's in-package transform, so no `dist` leg participates
 * and neither ablation leg needs a rebuild.
 */

import { describe, it, expect } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

import { AppPlugin, withoutRuntimePluginInstances } from './app-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';

const PACKAGE_ID = 'com.example.instances';

/**
 * A kernel plugin doing at boot what every real connector plugin does: resolve
 * the engine, keep it, and materialize the instances it owns — each of which
 * holds its owner back.
 *
 * ⚠️ Where the cycle comes from, measured rather than assumed. In production
 * the circle the 500 named runs through the ENGINE
 * (`_ObjectQL.actionActivation.store.engine`), but that store only attaches on
 * a composition where `sys_action_activation` is registered and probeable
 * (`ObjectQLPlugin`), which a bare engine kernel is not: measured here, a
 * booted engine on this composition serializes clean, so a fixture that only
 * held the engine would make every pin below VACUOUS. So the fixture closes
 * the circle the other ordinary way a plugin does — an owned instance holding
 * its owner — and the first assertion of the first test is the guard that the
 * fixture really is cyclic. What is under test either way is the same and does
 * not depend on which edge closes it: a booted plugin instance carries an
 * arbitrary runtime object graph, and a package record must not carry one.
 */
class EngineHoldingPlugin implements Plugin {
    name = 'com.example.engine-holding';
    /** Set at init — the reference the record must not end up carrying. */
    engine?: unknown;
    /** Materialized at boot, each holding the plugin back. */
    readonly connectors: Array<{ owner: EngineHoldingPlugin }> = [];
    init(ctx: PluginContext): void {
        this.engine = ctx.getService('objectql');
        this.connectors.push({ owner: this });
    }
}

/**
 * A manifest-shaped nested plugin — NOT an instance. The engine reads this one
 * as metadata and registers its objects under the parent package, so it must
 * survive into the record untouched.
 */
const nestedDeclarativePlugin = () => ({
    name: 'com.example.nested',
    namespace: 'pins',
    objects: [
        {
            name: 'pins_nested_note',
            label: 'Nested Note',
            fields: { title: { type: 'text', label: 'Title' } },
        },
    ],
});

/** The declarative half of the stack — identical on both kernels. */
const declarativeStack = () => ({
    manifest: {
        id: PACKAGE_ID,
        name: 'instances_pin',
        version: '1.0.0',
        type: 'app',
        namespace: 'pins',
    },
    objects: [
        {
            name: 'pins_account',
            label: 'Account',
            fields: { name: { type: 'text', label: 'Name' } },
        },
    ],
});

interface PackageRecord {
    manifest?: Record<string, unknown>;
    status?: string;
    enabled?: boolean;
}
interface TestRegistry {
    getPackage(id: string): PackageRecord | undefined;
    getAllPackages(): PackageRecord[];
    getAllObjects(): Array<{ name: string }>;
    listItems(type: string): unknown[];
}
type QlService = { registry: TestRegistry };

/**
 * Boot the composition production runs: the engine, the runtime plugin
 * instances the CLI wires with `kernel.use()`, and an AppPlugin holding the
 * SAME instances inside its bundle — which is how they reached the registry.
 */
async function boot(pluginEntries: unknown[]): Promise<{ kernel: LiteKernel; ql: QlService }> {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    kernel.use(new ObjectQLPlugin({}));
    for (const entry of pluginEntries) {
        if (typeof (entry as { init?: unknown })?.init === 'function') kernel.use(entry as Plugin);
    }
    kernel.use(new AppPlugin({ ...declarativeStack(), plugins: pluginEntries }));
    await kernel.bootstrap();
    return { kernel, ql: kernel.getService<QlService>('objectql') };
}

/** A kernel façade over the REAL objectql service, as `HttpDispatcher` reads it. */
const dispatcherOver = (ql: QlService): HttpDispatcher =>
    new HttpDispatcher({
        context: { getService: (name: string) => (name === 'objectql' ? ql : null) },
    } as never);

/**
 * A read-only data-plane stub, registered AFTER boot so `getMetaItems` can make
 * its `sys_metadata` overlay read.
 *
 * The SchemaRegistry — the thing under test, and the thing that stores the
 * record — stays entirely real; this answers only the DB half `getMetaItems`
 * consults after the registry, which a driver-less kernel cannot answer at all
 * (it throws "The metadata store could not be read"). Hand-written rather than
 * `vi.fn`: nothing here is asserted on, and no code-authored package has an
 * overlay row anyway, so an empty answer IS the production answer for this
 * type.
 */
const emptyOverlayDriver = {
    name: 'pin_empty_overlay',
    supports: {},
    async connect() { /* nothing to open */ },
    async disconnect() { /* nothing to close */ },
    async find() { return []; },
    async findOne() { return null; },
    async count() { return 0; },
};

/** Engine self-invocation — passes the domain's anonymous floor and read gate. */
const systemCaller = () => ({ request: {}, environmentId: 'platform', executionContext: { isSystem: true } }) as never;

describe('#14442 — the package record of an instance-bearing stack is serializable', () => {
    it('stores a record `JSON.stringify` accepts, and serves it through both read doors', async () => {
        const instance = new EngineHoldingPlugin();
        const { kernel, ql } = await boot([instance, nestedDeclarativePlugin()]);
        try {
            // The instance really did capture the engine — without this the
            // pins below would be vacuous (nothing cyclic to strip).
            expect(instance.engine).toBeDefined();
            expect(() => JSON.stringify(instance)).toThrow(/circular/i);

            const record = ql.registry.getPackage(PACKAGE_ID);
            expect(record).toBeDefined();

            // Pin 1 — the record itself.
            expect(() => JSON.stringify(record)).not.toThrow();
            expect(record?.manifest?.plugins).toEqual([nestedDeclarativePlugin()]);

            // Pin 2a — the dispatcher list and detail doors.
            const dispatcher = dispatcherOver(ql);
            const list = await dispatcher.handlePackages('/', 'GET', undefined, {}, systemCaller());
            expect(list.response?.status).toBe(200);
            expect(() => JSON.stringify(list.response)).not.toThrow();
            const rows = (list.response?.body as { data?: { packages?: Array<{ manifest?: { id?: string } }> } })
                ?.data?.packages ?? (list.response?.body as { packages?: Array<{ manifest?: { id?: string } }> })?.packages;
            expect(rows?.some((r) => r?.manifest?.id === PACKAGE_ID)).toBe(true);

            const detail = await dispatcher.handlePackages(`/${PACKAGE_ID}`, 'GET', undefined, {}, systemCaller());
            expect(detail.response?.status).toBe(200);
            expect(() => JSON.stringify(detail.response)).not.toThrow();

            // Pin 2b — the REST `/meta/package` door's primitive.
            (ql as unknown as { registerDriver(d: unknown, isDefault?: boolean): void })
                .registerDriver(emptyOverlayDriver, true);
            const protocol = new ObjectStackProtocolImplementation(ql as never);
            const meta = await protocol.getMetaItems({ type: 'package' });
            expect(() => JSON.stringify(meta)).not.toThrow();
            const metaItems = (meta as { items?: Array<{ manifest?: { id?: string } }> })?.items
                ?? (meta as unknown as Array<{ manifest?: { id?: string } }>);
            expect(metaItems.some((i) => i?.manifest?.id === PACKAGE_ID)).toBe(true);
        } finally {
            await kernel.shutdown?.();
        }
    });

    it('leaves every declarative key byte-identical to a stack that never had the instances', async () => {
        const withInstances = await boot([new EngineHoldingPlugin(), nestedDeclarativePlugin()]);
        const control = await boot([nestedDeclarativePlugin()]);
        try {
            const a = withInstances.ql.registry.getPackage(PACKAGE_ID);
            const b = control.ql.registry.getPackage(PACKAGE_ID);

            // The whole manifest, byte for byte — key order included. This is
            // what makes over-removal (dropping `plugins` outright, or dropping
            // a declarative sibling) a failure rather than a silent pass.
            expect(JSON.stringify(a?.manifest)).toBe(JSON.stringify(b?.manifest));
            expect(a?.status).toBe(b?.status);
            expect(a?.enabled).toBe(b?.enabled);

            // …and the nested plugin's objects reached the registry on BOTH
            // sides: the registration the instances rode alongside is intact.
            const fqns = (k: typeof withInstances) => k.ql.registry.getAllObjects().map((o) => o.name).sort();
            expect(fqns(withInstances)).toEqual(fqns(control));
            expect(fqns(withInstances).some((n) => n.includes('nested_note'))).toBe(true);
        } finally {
            await withInstances.kernel.shutdown?.();
            await control.kernel.shutdown?.();
        }
    });
});

describe('withoutRuntimePluginInstances — the predicate, stated directly', () => {
    it('returns the payload BY REFERENCE when there is nothing to strip', () => {
        const noPlugins = { id: 'a' };
        expect(withoutRuntimePluginInstances(noPlugins)).toBe(noPlugins);

        const declarativeOnly = { id: 'a', plugins: [{ name: 'nested' }, 'pkg-by-name'] };
        expect(withoutRuntimePluginInstances(declarativeOnly)).toBe(declarativeOnly);

        // Not an array (a map-shaped or malformed `plugins`) is left alone too
        // — this function narrows a record, it does not normalize one.
        const notAnArray = { id: 'a', plugins: { nested: {} } };
        expect(withoutRuntimePluginInstances(notAnArray)).toBe(notAnArray);
    });

    it('keeps declarative members and their order while removing the instances', () => {
        const nested = { name: 'nested' };
        const payload = {
            id: 'a',
            plugins: [new EngineHoldingPlugin(), nested, 'pkg-by-name', new EngineHoldingPlugin()],
            objects: [],
        };
        const out = withoutRuntimePluginInstances(payload);
        expect(out).not.toBe(payload);
        expect(out.plugins).toEqual([nested, 'pkg-by-name']);
        // The authored key keeps its position, so the record's key order — and
        // therefore its serialization — is unchanged for every other key.
        expect(Object.keys(out)).toEqual(Object.keys(payload));
        // The input is not mutated: the caller's bundle is still the kernel's.
        expect(payload.plugins).toHaveLength(4);
    });
});
