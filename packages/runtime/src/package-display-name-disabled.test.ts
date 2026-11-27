// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35513 — a package's translated display name
 * (`packages.MANIFEST_ID.name` in its translation bundle) is served while the
 * package is DISABLED.
 *
 * Setup's package list is where an administrator turns a package off and back
 * on, so a disabled package is still a row there, and the console names the
 * row from the served translation document. `AppPlugin.start` loads the
 * stack's translations without reading the registry's disabled set — that set
 * gates the package's objects and handlers, not its copy — so the row keeps
 * its translated name. This pins that: a real `ObjectKernel` with the real
 * `ObjectQLPlugin`, `AppPlugin` and the host package-state store seeding the
 * package disabled, read through the dispatcher's `GET /i18n/translations`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
// Paid during collection, not inside a case's clock: `AppPlugin` loads it lazily.
import '@objectstack/metadata';

import { AppPlugin } from './app-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { createPackageStateStorePlugin, type PackageStateStore } from './package-state-host-store.js';

const ENVIRONMENT_ID = 'env_pkg_display_name';
const PKG = 'com.acme.reporting';
/** A signed-in member with no admin rights: the console loads its copy as any reader. */
const MEMBER = { userId: 'u_member', tenantId: 'org_qa', isSystem: false, positions: [], permissions: [], systemPermissions: [] };

/** A host store that reports `disabled` as switched off for every environment. */
const storeDisabling = (disabled: string[]): PackageStateStore => ({
    loadDisabledPackageIds: () => disabled,
    setPackageDisabled: () => undefined,
});

const bundle = () => ({
    manifest: { id: PKG, name: 'Acme Reporting', version: '1.0.0', type: 'app' },
    translations: [{ 'zh-CN': { packages: { [PKG]: { name: '报表', description: '经营报表' } } } }],
});

let home: string;
const savedHome = process.env.OS_HOME;
const kernels: ObjectKernel[] = [];

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-pkg-display-name-'));
    process.env.OS_HOME = home;
});

afterEach(async () => {
    for (const kernel of kernels.splice(0)) {
        if (kernel.getState() === 'running') await kernel.shutdown();
    }
    rmSync(home, { recursive: true, force: true });
    if (savedHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = savedHome;
});

async function boot(disabled: string[]) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin({}));
    await kernel.use(new AppPlugin(bundle(), { environmentId: ENVIRONMENT_ID, organizationId: 'org_qa' }));
    await kernel.use(createPackageStateStorePlugin(storeDisabling(disabled)));
    await kernel.bootstrap();
    const registry = kernel.getService<{ registry: { getPackage(id: string): { enabled?: boolean } | undefined } }>('objectql').registry;
    return { kernel, registry };
}

/** The `zh-CN` document the console loads: `GET /i18n/translations/zh-CN`. */
async function servedZh(kernel: ObjectKernel): Promise<any> {
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER });
    const request = new Request('http://localhost/api/v1/i18n/translations/zh-CN', { method: 'GET' });
    const out: any = await dispatcher.dispatch(
        'GET', '/i18n/translations/zh-CN', undefined, {}, { request, environmentId: ENVIRONMENT_ID } as any, '/api/v1',
    );
    expect(out.handled).toBe(true);
    const body = out.response?.body;
    return body?.data?.translations ?? body?.translations;
}

describe('#35513 a disabled package keeps its translated display name', () => {
    it('the served zh-CN document names the package while the registry holds it disabled', async () => {
        const { kernel, registry } = await boot([PKG]);

        expect(registry.getPackage(PKG)?.enabled).toBe(false);
        const served = await servedZh(kernel);
        expect(served?.packages?.[PKG]).toEqual({ name: '报表', description: '经营报表' });
    });

    it('control: the same package enabled is served the same row', async () => {
        const { kernel, registry } = await boot([]);

        expect(registry.getPackage(PKG)?.enabled).not.toBe(false);
        const served = await servedZh(kernel);
        expect(served?.packages?.[PKG]).toEqual({ name: '报表', description: '经营报表' });
    });
});
