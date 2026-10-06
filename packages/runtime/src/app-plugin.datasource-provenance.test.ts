// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21889 — `AppPlugin` registers each code-defined datasource with the package
 * that declares it.
 *
 * ## The defect this pins closed
 *
 * `AppPlugin.start()` registered a code-defined datasource as
 * `{ ...ds, origin: 'code' }`, with no `_packageId`. The federation service
 * resolves the ADR-0028 namespace an imported object must carry from the
 * datasource's `_packageId`, so for every code-defined datasource it resolved
 * none: `POST /datasources/:name/external/tables/:remote/import` accepted an
 * unprefixed `name`, and the draft door emitted the bare remote table name.
 * The datasource is now stamped through `applyProtection`, the stamping helper
 * the other load paths use.
 *
 * ## What each case pins
 *
 *  - a single-package bundle (the `defineStack()` shape every example boots):
 *    the manifest's id and version, in both datasource spellings;
 *  - an ADR-0130 `packages[]` artifact, in today's ADDITIVE shape and in the
 *    option-B shape: each datasource carries the id of the package BODY that
 *    declares it, never the artifact's top-level manifest id (#14599's
 *    misattribution class), and each is registered once;
 *  - a top-level datasource no body declares keeps its registration, under the
 *    artifact's own manifest id, and the disagreement is logged.
 *
 * No in-repo example declares a datasource in a multi-package artifact
 * (`examples/app-multi-package` declares none), so the two-body cases are
 * pinned here, at the plugin. The booted-stack half (the showcase's
 * `showcase_external` at the import door) is the dogfood pin's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PluginContext } from '@objectstack/core';

import { AppPlugin } from './app-plugin.js';

type Register = (type: string, name: string, data: unknown) => void;

const datasource = (name: string) => ({
    name,
    label: name,
    driver: 'sqlite',
    schemaMode: 'external',
    config: { filename: ':memory:' },
    external: { allowWrites: false },
});

const coreBody = () => ({
    id: 'com.test.dsprov.core',
    name: 'Datasource Provenance Core',
    version: '1.0.0',
    type: 'app',
    namespace: 'dpcore',
    datasources: [datasource('dpcore_wh')],
});

const ordersBody = () => ({
    id: 'com.test.dsprov.orders',
    name: 'Datasource Provenance Orders',
    version: '3.2.0',
    type: 'module',
    namespace: 'dporders',
    dependencies: { 'com.test.dsprov.core': '^1.0.0' },
    datasources: [datasource('dporders_wh')],
});

/** The artifact's top-level manifest: the core package's, as `selectManifest` may pick it. */
const topManifest = { id: 'com.test.dsprov.core', name: 'Datasource Provenance Core', version: '1.0.0', type: 'app' };

/** What the platform emits today: every datasource flattened to the top level AND under its body. */
const additiveArtifact = () => {
    const core = coreBody();
    const orders = ordersBody();
    return {
        manifest: topManifest,
        datasources: [...orders.datasources.map((d) => ({ ...d })), ...core.datasources.map((d) => ({ ...d }))],
        packages: [{ manifest: orders }, { manifest: core }],
    };
};

/** Option B: `packages[]` carries every datasource once, the top level none. */
const optionBArtifact = () => ({
    manifest: topManifest,
    packages: [{ manifest: ordersBody() }, { manifest: coreBody() }],
});

describe('#21889 — AppPlugin stamps each code-defined datasource with the package that declares it', () => {
    let register: ReturnType<typeof vi.fn<Register>>;
    let warn: ReturnType<typeof vi.fn>;
    let ctx: PluginContext;

    beforeEach(() => {
        register = vi.fn<Register>();
        warn = vi.fn();
        ctx = {
            logger: { info: vi.fn(), error: vi.fn(), warn, debug: vi.fn() },
            registerService: vi.fn(),
            getService: vi.fn((name: string) => {
                if (name === 'objectql') return { setDatasourceMapping: () => undefined };
                if (name === 'metadata') return { registerInMemory: register };
                return undefined;
            }),
            getServices: vi.fn(() => []),
            hook: vi.fn(),
            trigger: vi.fn(),
        } as unknown as PluginContext;
    });

    /** Every `registerInMemory('datasource', …)` call, by name. */
    const registered = () => {
        const calls = register.mock.calls.filter(([type]) => type === 'datasource');
        return {
            names: calls.map(([, name]) => name),
            item: (name: string) => calls.find(([, n]) => n === name)?.[2] as Record<string, unknown> | undefined,
        };
    };

    it('a single-package bundle: the manifest\'s id and version, with provenance `package`', async () => {
        const declared = datasource('solo_wh');
        await new AppPlugin({
            manifest: { id: 'com.test.dsprov.solo', name: 'Solo', version: '2.1.0', namespace: 'solo' },
            datasources: [declared],
        }).start!(ctx);

        expect(registered().names).toEqual(['solo_wh']);
        expect(registered().item('solo_wh')).toEqual({
            ...declared,
            origin: 'code',
            _packageId: 'com.test.dsprov.solo',
            _packageVersion: '2.1.0',
            _provenance: 'package',
        });
        // The author's definition is not written to: the stamp lands on the copy.
        expect(declared).not.toHaveProperty('_packageId');
    });

    it('a single-package bundle in the record spelling: the key is the name, and the same stamp lands', async () => {
        await new AppPlugin({
            manifest: { id: 'com.test.dsprov.solo', name: 'Solo', version: '2.1.0' },
            datasources: { solo_wh: { driver: 'sqlite', schemaMode: 'external', config: {} } },
        }).start!(ctx);

        expect(registered().item('solo_wh')).toMatchObject({
            name: 'solo_wh',
            origin: 'code',
            _packageId: 'com.test.dsprov.solo',
            _packageVersion: '2.1.0',
        });
    });

    it('today\'s additive `packages[]` artifact: each datasource carries ITS body\'s id, not the top-level manifest\'s', async () => {
        await new AppPlugin(additiveArtifact()).start!(ctx);

        // Read once each: the flattened copy and the body's copy are one datasource.
        expect(registered().names.sort()).toEqual(['dpcore_wh', 'dporders_wh']);
        expect(registered().item('dporders_wh')).toMatchObject({
            origin: 'code',
            _packageId: 'com.test.dsprov.orders',
            _packageVersion: '3.2.0',
            _provenance: 'package',
        });
        expect(registered().item('dpcore_wh')).toMatchObject({
            _packageId: 'com.test.dsprov.core',
            _packageVersion: '1.0.0',
        });
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('none of its package bodies declare'));
    });

    it('the option-B artifact (the top level carries no datasource): the same attribution', async () => {
        await new AppPlugin(optionBArtifact()).start!(ctx);

        expect(registered().names.sort()).toEqual(['dpcore_wh', 'dporders_wh']);
        expect(registered().item('dporders_wh')?._packageId).toBe('com.test.dsprov.orders');
        expect(registered().item('dpcore_wh')?._packageId).toBe('com.test.dsprov.core');
    });

    it('a top-level datasource no body declares keeps its registration, under the artifact\'s own id, and is logged', async () => {
        const artifact = additiveArtifact();
        artifact.datasources.push({ ...datasource('stray_wh') });

        await new AppPlugin(artifact).start!(ctx);

        expect(registered().names.sort()).toEqual(['dpcore_wh', 'dporders_wh', 'stray_wh']);
        expect(registered().item('stray_wh')).toMatchObject({ _packageId: 'com.test.dsprov.core' });
        expect(registered().item('dporders_wh')?._packageId).toBe('com.test.dsprov.orders');
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/1 top-level datasource\(s\) that none of its package bodies declare: 'stray_wh'/));
    });
});
