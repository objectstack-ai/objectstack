// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30962] The host seam for package lifecycle state — the platform half (F2)
 * of cloud#3636, under the maintainer's ruling 「AAAA + 三条验收（推荐）」.
 *
 * A hosted container loses the file under `OS_HOME` when it is replaced, so a
 * host supplies the store (`createPackageStateStorePlugin`). The card's three
 * acceptance lines, each pinned through the shipped pieces — a real
 * `ObjectKernel`, the real `ObjectQLPlugin` and `AppPlugin`, and the real
 * `HttpDispatcher` answering the package doors:
 *
 *  1. A host-injected store sees every enable/disable write and seeds boot.
 *  2. A refusing store makes the door fail visibly, with in-memory state
 *     unchanged.
 *  3. Without injection, behaviour is unchanged: the file is written as before,
 *     and its write failure still only warns.
 *
 * The negative pins (2, and the file half of 3) were each ablated once — the
 * forbidden behaviour put back and watched go red — and the outputs are cited
 * in the PR, not kept as permanent cases.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { resolveThrownHttpError } from '@objectstack/types';
// Paid during collection, not inside a case's clock: `AppPlugin` loads it lazily.
import '@objectstack/metadata';

import { AppPlugin } from './app-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';
import {
    PACKAGE_STATE_STORE_PLUGIN_NAME,
    PACKAGE_STATE_STORE_SERVICE,
    createPackageStateStorePlugin,
    type PackageStateStore,
} from './package-state-host-store.js';
import { packageStateFileName, setPackageDisabled } from './package-state-store.js';

const ENVIRONMENT_ID = 'env_host_store';
const PKG = 'com.acme.reporting';
const OTHER = 'com.acme.billing';
const ADMIN = {
    userId: 'u_admin', tenantId: 'org_qa', isSystem: false,
    positions: [], permissions: [], systemPermissions: ['manage_metadata'],
};

interface Row { enabled?: boolean; status?: string }
interface Registry {
    installPackage(manifest: Record<string, unknown>, source: 'code' | 'marketplace' | 'authored'): unknown;
    getPackage(id: string): Row | undefined;
}

/** An in-memory host store that records every write, and can be told to refuse. */
class RecordingStore implements PackageStateStore {
    readonly disabled = new Map<string, Set<string>>();
    readonly writes: Array<[string | undefined, string, boolean]> = [];
    readonly loads: Array<string | undefined> = [];
    refuseWrites = false;
    refuseLoads = false;

    async loadDisabledPackageIds(environmentId: string | undefined): Promise<Iterable<string>> {
        this.loads.push(environmentId);
        if (this.refuseLoads) throw new Error('hosted store offline');
        return [...(this.disabled.get(environmentId ?? '') ?? [])];
    }

    async setPackageDisabled(environmentId: string | undefined, packageId: string, disabled: boolean): Promise<void> {
        if (this.refuseWrites) throw new Error('hosted store offline');
        this.writes.push([environmentId, packageId, disabled]);
        const ids = this.disabled.get(environmentId ?? '') ?? new Set<string>();
        if (disabled) ids.add(packageId);
        else ids.delete(packageId);
        this.disabled.set(environmentId ?? '', ids);
    }
}

let home: string;
const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_ENVIRONMENT_ID: process.env.OS_ENVIRONMENT_ID };
const kernels: ObjectKernel[] = [];

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'os-host-package-state-'));
    process.env.OS_HOME = home;
    delete process.env.OS_ENVIRONMENT_ID;
});

afterEach(async () => {
    for (const kernel of kernels.splice(0)) {
        if (kernel.getState() === 'running') await kernel.shutdown();
    }
    vi.restoreAllMocks();
    rmSync(home, { recursive: true, force: true });
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    if (envSnapshot.OS_ENVIRONMENT_ID === undefined) delete process.env.OS_ENVIRONMENT_ID;
    else process.env.OS_ENVIRONMENT_ID = envSnapshot.OS_ENVIRONMENT_ID;
});

const stateFile = (): string => join(home, 'package-state', packageStateFileName(ENVIRONMENT_ID, process.cwd()));
const manifestFor = (id: string) => ({ id, name: id, version: '1.0.0', type: 'module' });

/**
 * Boot an empty environment, with `extra` plugins composed AFTER `AppPlugin`
 * in `use()` order — so a store that still seeds proves the declared ordering,
 * not the slot it was given.
 */
async function boot(extra: Plugin[] = []): Promise<{ kernel: ObjectKernel; registry: Registry }> {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    kernels.push(kernel);
    await kernel.use(new ObjectQLPlugin({}));
    await kernel.use(new AppPlugin({}, { environmentId: ENVIRONMENT_ID, organizationId: 'org_qa' }));
    for (const plugin of extra) await kernel.use(plugin);
    await kernel.bootstrap();
    return { kernel, registry: kernel.getService<{ registry: Registry }>('objectql').registry };
}

const codeOf = (body: any): unknown => (body?.error && typeof body.error === 'object' ? body.error.code : body?.code);

/** What the runtime dispatcher answers the admin on `PATCH /packages/:id/<verb>`. */
async function patch(kernel: ObjectKernel, id: string, verb: 'enable' | 'disable') {
    const path = `/packages/${encodeURIComponent(id)}/${verb}`;
    const dispatcher = new HttpDispatcher(kernel as any, undefined, { enforceProjectMembership: false });
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...ADMIN });
    const request = new Request(`http://localhost/api/v1${path}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    try {
        const out: any = await dispatcher.dispatch('PATCH', path, {}, {}, { request, environmentId: ENVIRONMENT_ID } as any, '/api/v1');
        return { status: out.response?.status as number | undefined, code: codeOf(out.response?.body), message: out.response?.body?.error?.message as string | undefined };
    } catch (e) {
        const thrown = resolveThrownHttpError(e);
        return { status: thrown.status as number | undefined, code: thrown.code as unknown, message: undefined };
    }
}

describe('[#30962] a host-injected package-state store', () => {
    it('seeds the boot from the host store — not from the file — even when composed after AppPlugin', async () => {
        const store = new RecordingStore();
        store.disabled.set(ENVIRONMENT_ID, new Set([PKG]));
        // The file says the OPPOSITE: a host store must be the only source.
        setPackageDisabled(ENVIRONMENT_ID, OTHER, true);

        const { registry } = await boot([createPackageStateStorePlugin(store)]);
        registry.installPackage(manifestFor(PKG), 'authored');
        registry.installPackage(manifestFor(OTHER), 'authored');

        expect(store.loads).toEqual([ENVIRONMENT_ID]);
        expect(registry.getPackage(PKG)).toMatchObject({ enabled: false, status: 'disabled' });
        expect(registry.getPackage(OTHER)).toMatchObject({ enabled: true });
    });

    it('sees every enable and disable write, and the file under OS_HOME is never written', async () => {
        const store = new RecordingStore();
        const { kernel, registry } = await boot([createPackageStateStorePlugin(store)]);
        registry.installPackage(manifestFor(PKG), 'authored');

        expect(await patch(kernel, PKG, 'disable')).toMatchObject({ status: 200 });
        expect(registry.getPackage(PKG)?.enabled).toBe(false);
        expect(await patch(kernel, PKG, 'enable')).toMatchObject({ status: 200 });
        expect(registry.getPackage(PKG)?.enabled).toBe(true);

        expect(store.writes).toEqual([
            [ENVIRONMENT_ID, PKG, true],
            [ENVIRONMENT_ID, PKG, false],
        ]);
        expect(existsSync(join(home, 'package-state'))).toBe(false);
    });

    it('a disable written to the host store is what the NEXT boot seeds', async () => {
        const store = new RecordingStore();
        const first = await boot([createPackageStateStorePlugin(store)]);
        first.registry.installPackage(manifestFor(PKG), 'authored');
        expect(await patch(first.kernel, PKG, 'disable')).toMatchObject({ status: 200 });
        await first.kernel.shutdown();

        // A replaced container: a fresh OS_HOME, the same host store.
        process.env.OS_HOME = mkdtempSync(join(home, 'replaced-'));
        const second = await boot([createPackageStateStorePlugin(store)]);
        second.registry.installPackage(manifestFor(PKG), 'authored');
        expect(second.registry.getPackage(PKG)).toMatchObject({ enabled: false, status: 'disabled' });
    });

    it('a refusing store fails the disable door visibly, and the package stays enabled', async () => {
        const store = new RecordingStore();
        const { kernel, registry } = await boot([createPackageStateStorePlugin(store)]);
        registry.installPackage(manifestFor(PKG), 'authored');
        store.refuseWrites = true;

        const answer = await patch(kernel, PKG, 'disable');

        expect(answer).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(answer.message).toMatch(/^Package 'com\.acme\.reporting' was not disabled: the package-state store refused/);
        expect(registry.getPackage(PKG)).toMatchObject({ enabled: true, status: 'installed' });
        expect(store.disabled.get(ENVIRONMENT_ID)).toBeUndefined();
        expect(existsSync(join(home, 'package-state'))).toBe(false);
    });

    it('a refusing store fails the enable door visibly, and the package stays disabled', async () => {
        const store = new RecordingStore();
        const { kernel, registry } = await boot([createPackageStateStorePlugin(store)]);
        registry.installPackage(manifestFor(PKG), 'authored');
        expect(await patch(kernel, PKG, 'disable')).toMatchObject({ status: 200 });
        store.refuseWrites = true;

        const answer = await patch(kernel, PKG, 'enable');

        expect(answer).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(registry.getPackage(PKG)).toMatchObject({ enabled: false, status: 'disabled' });
        expect([...(store.disabled.get(ENVIRONMENT_ID) ?? [])]).toEqual([PKG]);
    });

    it('an unknown package still answers 404 and writes nothing to the store', async () => {
        const store = new RecordingStore();
        const { kernel } = await boot([createPackageStateStorePlugin(store)]);

        expect(await patch(kernel, 'com.acme.absent', 'disable')).toMatchObject({ status: 404 });
        expect(await patch(kernel, 'com.acme.absent', 'enable')).toMatchObject({ status: 404 });
        expect(store.writes).toEqual([]);
    });

    it('a host store whose boot read throws fails the boot, naming the store', async () => {
        const store = new RecordingStore();
        store.refuseLoads = true;

        await expect(boot([createPackageStateStorePlugin(store)])).rejects.toThrow(
            new RegExp(`package-state store \\(${PACKAGE_STATE_STORE_PLUGIN_NAME.replace(/\./g, '\\.')}\\) could not read`),
        );
    });

    it('a store registered under the service name by a plugin AppPlugin is not ordered after is refused at start', async () => {
        const store = new RecordingStore();
        const late: Plugin = {
            name: 'qa.host-registers-its-own-store',
            init: (ctx: PluginContext) => { ctx.registerService(PACKAGE_STATE_STORE_SERVICE, store); },
        };

        await expect(boot([late])).rejects.toThrow(/createPackageStateStorePlugin/);
    });

    it('createPackageStateStorePlugin refuses a store missing either method', () => {
        expect(() => createPackageStateStorePlugin({ loadDisabledPackageIds: () => [] } as never)).toThrow(TypeError);
        expect(() => createPackageStateStorePlugin(null as never)).toThrow(TypeError);
    });
});

describe('[#30962] without a host store, behaviour is unchanged', () => {
    it('the disable and enable doors write the file under OS_HOME exactly as before', async () => {
        const { kernel, registry } = await boot();
        registry.installPackage(manifestFor(PKG), 'authored');

        expect(await patch(kernel, PKG, 'disable')).toMatchObject({ status: 200 });
        expect(readFileSync(stateFile(), 'utf8')).toBe(`{\n  "disabled": [\n    "${PKG}"\n  ]\n}\n`);
        expect(registry.getPackage(PKG)?.enabled).toBe(false);

        expect(await patch(kernel, PKG, 'enable')).toMatchObject({ status: 200 });
        expect(readFileSync(stateFile(), 'utf8')).toBe(`{\n  "disabled": []\n}\n`);
        expect(registry.getPackage(PKG)?.enabled).toBe(true);
    });

    it('a file that cannot be written still only warns: the disable lands in memory and answers 200', async () => {
        const { kernel, registry } = await boot();
        registry.installPackage(manifestFor(PKG), 'authored');
        // An OS_HOME that is a FILE: the state directory under it cannot be made.
        const blocked = join(home, 'not-a-directory');
        writeFileSync(blocked, '');
        process.env.OS_HOME = blocked;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(await patch(kernel, PKG, 'disable')).toMatchObject({ status: 200 });
        expect(registry.getPackage(PKG)).toMatchObject({ enabled: false, status: 'disabled' });
        expect(warn).toHaveBeenCalledWith('[handlePackages] failed to persist disable state', expect.objectContaining({ id: PKG }));
    });
});
