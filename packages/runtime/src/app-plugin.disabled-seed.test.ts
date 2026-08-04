// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Persisted package disable-state must survive a restart of an EMPTY env (#5047).
 *
 * The seed that carries an operator's "disable this package" decision across a
 * restart works by filling the registry's initial-disabled set BEFORE the first
 * `installPackage` call, so that every registration path installs those
 * packages disabled. It used to run AFTER `AppPlugin.init`'s empty-env early
 * return — and an empty env (an artifact with no app payload) is precisely the
 * environment whose packages ALL arrive later, from `sys_packages` hydration or
 * an HTTP install. So on exactly those envs the set stayed empty and every
 * disabled package came back ENABLED on each restart.
 *
 * These tests boot a REAL kernel (LiteKernel + ObjectQLPlugin + AppPlugin) over
 * a REAL state file, and drive the REAL `PackageServicePlugin` rehydration, so
 * the regression is pinned end to end rather than against a re-implementation.
 *
 * Reverse verification for the fix: move `seedPersistedDisabledPackages(ctx)`
 * back below the `if (this.empty)` return in `app-plugin.ts` and every
 * empty-env case here fails (`installed` / `enabled: true`), while the
 * non-empty case stays green.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LiteKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { PackageServicePlugin } from '@objectstack/service-package';

import { AppPlugin } from './app-plugin.js';
import { setPackageDisabled } from './package-state-store.js';

const ENVIRONMENT_ID = 'env_disabled_seed';
const DISABLED_ID = 'com.acme.reporting';
const ENABLED_ID = 'com.acme.billing';

interface InstalledPackageView {
    status?: string;
    enabled?: boolean;
}
interface TestRegistry {
    installPackage(manifest: Record<string, unknown>): unknown;
    getPackage(id: string): InstalledPackageView | undefined;
}

let home: string;
const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_ENVIRONMENT_ID: process.env.OS_ENVIRONMENT_ID };

function manifestFor(id: string) {
    return { id, name: id, version: '1.0.0', type: 'application' };
}

/**
 * Boot the composition an empty environment actually runs: the engine plus an
 * AppPlugin whose bundle carries no app payload.
 */
async function bootEmptyEnv(): Promise<{ kernel: LiteKernel; registry: TestRegistry }> {
    const kernel = new LiteKernel({ logger: { level: 'error' } });
    kernel.use(new ObjectQLPlugin({}));
    kernel.use(new AppPlugin({}, { environmentId: ENVIRONMENT_ID, organizationId: 'org_test' }));
    await kernel.bootstrap();
    const ql = kernel.getService<{ registry: TestRegistry }>('objectql');
    return { kernel, registry: ql.registry };
}

/** A PluginContext for PackageServicePlugin whose engine shares `registry`. */
function packageServiceCtx(registry: TestRegistry, rows: Array<Record<string, unknown>>) {
    const execute = vi.fn(async ({ sql }: { sql: string }) => {
        if (/SELECT \* FROM sys_packages/i.test(sql)) return { rows };
        return { rows: [] }; // CREATE TABLE / INDEX / …
    });
    const services = new Map<string, unknown>([['objectql', { execute, registry }]]);
    return {
        logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        getService: (n: string) => services.get(n),
        registerService: (n: string, s: unknown) => services.set(n, s),
    } as never;
}

function sysPackagesRow(manifest: Record<string, unknown>) {
    return {
        id: manifest.id,
        version: manifest.version,
        manifest: JSON.stringify(manifest),
        metadata: '{}',
        hash: 'h',
        created_at: 't',
        updated_at: 't',
    };
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-disabled-seed-'));
    process.env.OS_HOME = home;
    delete process.env.OS_ENVIRONMENT_ID;
});

afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    if (envSnapshot.OS_ENVIRONMENT_ID === undefined) delete process.env.OS_ENVIRONMENT_ID;
    else process.env.OS_ENVIRONMENT_ID = envSnapshot.OS_ENVIRONMENT_ID;
});

describe('empty-env boot seeds persisted package disable-state (#5047)', () => {
    it('a package registered after boot lands DISABLED — the hydration-only path', async () => {
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, true); // operator disabled it last run

        const { kernel, registry } = await bootEmptyEnv();
        // Nothing came from the (empty) artifact; this is the post-boot
        // registration every package in such an env goes through.
        registry.installPackage(manifestFor(DISABLED_ID));

        expect(registry.getPackage(DISABLED_ID)).toMatchObject({
            status: 'disabled',
            enabled: false,
        });

        await kernel.shutdown();
    });

    it('seeds only the persisted ids — other packages still install enabled', async () => {
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, true);

        const { kernel, registry } = await bootEmptyEnv();
        registry.installPackage(manifestFor(ENABLED_ID));

        expect(registry.getPackage(ENABLED_ID)).toMatchObject({
            status: 'installed',
            enabled: true,
        });

        await kernel.shutdown();
    });

    it('a package replayed from sys_packages by PackageServicePlugin lands DISABLED', async () => {
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, true);

        // Phase 1: the empty-env kernel boots and seeds the registry.
        const { kernel, registry } = await bootEmptyEnv();

        // Phase 2: the real rehydration replays the durable row into that same
        // registry (ADR-0033 consolidation).
        await new PackageServicePlugin().start(
            packageServiceCtx(registry, [
                sysPackagesRow(manifestFor(DISABLED_ID)),
                sysPackagesRow(manifestFor(ENABLED_ID)),
            ]),
        );

        expect(registry.getPackage(DISABLED_ID)).toMatchObject({
            status: 'disabled',
            enabled: false,
        });
        expect(registry.getPackage(ENABLED_ID)).toMatchObject({
            status: 'installed',
            enabled: true,
        });

        await kernel.shutdown();
    });

    it('re-enabling clears the persisted state — the package comes back enabled', async () => {
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, true);
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, false);

        const { kernel, registry } = await bootEmptyEnv();
        registry.installPackage(manifestFor(DISABLED_ID));

        expect(registry.getPackage(DISABLED_ID)).toMatchObject({
            status: 'installed',
            enabled: true,
        });

        await kernel.shutdown();
    });

    it('boots an empty env with no persisted state at all (nothing to seed)', async () => {
        const { kernel, registry } = await bootEmptyEnv();
        registry.installPackage(manifestFor(DISABLED_ID));

        expect(registry.getPackage(DISABLED_ID)).toMatchObject({ enabled: true });

        await kernel.shutdown();
    });

    // Guards the other direction of the reorder: moving the seed earlier must
    // not change what a NON-empty env already did.
    it('non-empty env keeps its existing behavior — bundle package installs disabled', async () => {
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, true);

        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(new ObjectQLPlugin({}));
        kernel.use(
            new AppPlugin(
                { id: DISABLED_ID, name: DISABLED_ID, version: '1.0.0', objects: [] },
                { environmentId: ENVIRONMENT_ID, organizationId: 'org_test' },
            ),
        );
        await kernel.bootstrap();

        const registry = kernel.getService<{ registry: TestRegistry }>('objectql').registry;
        expect(registry.getPackage(DISABLED_ID)).toMatchObject({
            status: 'disabled',
            enabled: false,
        });

        await kernel.shutdown();
    });

    // The seed resolves `objectql` through getService; a kernel without an
    // engine (metadata-only one-shot commands) must still boot.
    it('degrades silently on a kernel with no engine at all', async () => {
        setPackageDisabled(ENVIRONMENT_ID, DISABLED_ID, true);

        const kernel = new LiteKernel({ logger: { level: 'error' } });
        kernel.use(new AppPlugin({}, { environmentId: ENVIRONMENT_ID, organizationId: 'org_test' }));

        await expect(kernel.bootstrap()).resolves.toBeUndefined();
        await kernel.shutdown();
    });
});
