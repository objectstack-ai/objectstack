// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0141 D5 at the install-local `kernel:ready` rehydrate: the ledger's
 * entries register in `manifest.dependencies` order, not the order the
 * directory lists them in.
 *
 * Each ledger entry is a node — an artifact that may carry several packages —
 * so a module's declared parent resolves to the entry carrying it. A cycle
 * between entries degrades to listed order, is logged naming them, and never
 * stops the rehydrate. The listing is pinned (spied) so the module-first order
 * the directory could return is the one under test, whatever `readdirSync`
 * answers on this filesystem.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import '@objectstack/runtime';
import { MarketplaceInstallLocalPlugin } from './marketplace-install-local-plugin.js';
import { LocalManifestSource, type InstalledManifestEntry } from './local-manifest-source.js';
import { installerAuthService, withInstallerGrants } from './install-local-principal.fixtures.js';

const entryOf = (manifestId: string, manifest: Record<string, unknown>): InstalledManifestEntry => ({
    packageId: manifestId, versionId: '1.0.0', manifestId, version: '1.0.0',
    manifest: { id: manifestId, name: manifestId, version: '1.0.0', ...manifest },
    installedAt: '2026-01-01T00:00:00.000Z', installedBy: 'admin', withSampleData: false,
});

/** HotCRM's artifact: the app and a companion, one ledger entry. */
const HOTCRM = entryOf('app.objectstack.hotcrm', {
    type: 'app',
    packages: [
        { manifest: { id: 'app.objectstack.hotcrm', name: 'HotCRM', version: '6.0.0', type: 'app', namespace: 'crm' } },
        { manifest: { id: 'app.objectstack.hotcrm.service', name: 'Service', version: '6.0.0', type: 'module', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm': '^6.0.0' } } },
    ],
});
/** A standalone module declaring the app, its own entry. */
const REVENUE = entryOf('app.objectstack.hotcrm.revenue', {
    type: 'module', namespace: 'crm', dependencies: { 'app.objectstack.hotcrm': '^6.0.0' },
});

async function rehydrate(dir: string, listed: InstalledManifestEntry[]) {
    vi.spyOn(LocalManifestSource.prototype, 'list').mockReturnValue({ entries: listed, skipped: [] });
    const hooks = new Map<string, any>();
    const order: string[] = [];
    const register = vi.fn((m: any) => { order.push(m.id); });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const services: Record<string, any> = {
        manifest: { register },
        auth: installerAuthService(),
        objectql: withInstallerGrants({ syncSchemas: vi.fn(async () => undefined), registry: { getAllPackages: () => [], getPackage: () => undefined } }),
    };
    const routes = new Map<string, unknown>();
    const rawApp = { get: (p: string, h: unknown) => routes.set(p, h), post: (p: string, h: unknown) => routes.set(p, h), delete: (p: string, h: unknown) => routes.set(p, h) };
    const ctx = {
        hook: (e: string, h: any) => hooks.set(e, h),
        getService: (name: string) => {
            if (name === 'http-server') return { getRawApp: () => rawApp };
            const svc = services[name];
            if (svc === undefined) throw new Error(`no ${name}`);
            return svc;
        },
        logger,
    };
    await new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir: dir }).start(ctx as any);
    await hooks.get('kernel:ready')?.();
    // The plugin registers its own UI package too; only the ledger's entries are under test.
    const ledgerIds = new Set(listed.map((e) => e.manifestId));
    return { order: order.filter((id) => ledgerIds.has(id)), errors: logger.error.mock.calls.map((c: unknown[]) => String(c[0])) };
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mil-rehydrate-order-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('kernel:ready rehydrate — ADR-0141 D5 dependency order', () => {
    it('registers the entry carrying a declared parent before the module listed ahead of it', async () => {
        const { order, errors } = await rehydrate(dir, [REVENUE, HOTCRM]);
        expect(order).toEqual(['app.objectstack.hotcrm', 'app.objectstack.hotcrm.revenue']);
        expect(errors.filter((e) => e.includes('cycle'))).toEqual([]);
    });

    it('degrades a cycle between entries to listed order, logs it naming them, and rehydrates every entry', async () => {
        const a = entryOf('com.acme.a', { type: 'app', namespace: 'aa', dependencies: { 'com.acme.b': '1.x' } });
        const b = entryOf('com.acme.b', { type: 'app', namespace: 'bb', dependencies: { 'com.acme.a': '1.x' } });
        const { order, errors } = await rehydrate(dir, [a, b]);
        expect(order).toEqual(['com.acme.a', 'com.acme.b']);
        const cycle = errors.find((e) => e.includes('cycle'));
        expect(cycle).toContain('com.acme.a');
        expect(cycle).toContain('com.acme.b');
    });
});
