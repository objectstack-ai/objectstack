// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D12 items 7–8 · D11] Every `/packages` write door asks the walled
 * refusal (`walledCatalogWriteVerdict`, `@objectstack/metadata-core`) right
 * after its capability gate: under `isolated` / `group` a package write is the
 * platform operator's, whatever the package carries (ruling A on #23231 — W2
 * and W3 refused only a write that touched a position, a permission set or a
 * capability).
 *
 * Pinned here, door by door: a `manage_metadata` holder below the operator
 * rung is refused `403 PERMISSION_DENIED` naming the posture, BEFORE any
 * protocol call or registry mutation; and the controls — the operator rung,
 * `isSystem`, `single`, and no `tenancy` service — are not refused by it. The
 * booted proof, with the cross-organization read-back, is
 * `wall-environment-metadata-refusal.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.example.pkg-a';

function boot(posture: 'single' | 'isolated' | 'group' | null) {
    const protocol = {
        publishPackageDrafts: vi.fn().mockResolvedValue({ success: true, publishedCount: 0, published: [], failed: [] }),
        discardPackageDrafts: vi.fn().mockResolvedValue({ success: true, discardedCount: 0 }),
        listCommits: vi.fn().mockResolvedValue([{ id: 'c1' }]),
        revertCommit: vi.fn().mockResolvedValue({ success: true }),
        rollbackToPackageCommit: vi.fn().mockResolvedValue({ success: true }),
        reassignOrphanedMetadata: vi.fn().mockResolvedValue({ reassigned: 0 }),
        duplicatePackage: vi.fn().mockResolvedValue({ package: { id: 'com.example.pkg-b' } }),
        updatePackage: vi.fn().mockResolvedValue({ package: { manifest: { id: PKG } } }),
        deletePackage: vi.fn().mockResolvedValue({ deletedCount: 0 }),
        installPackage: vi.fn().mockResolvedValue({ package: { manifest: { id: 'com.example.new' } } }),
    };
    const registry = {
        getAllPackages: vi.fn().mockReturnValue([{ id: PKG, status: 'active' }]),
        getPackage: vi.fn().mockReturnValue({ id: PKG, manifest: { id: PKG, name: 'A' } }),
        installPackage: vi.fn().mockImplementation((m: any) => ({ id: m.id, manifest: m })),
        enablePackage: vi.fn().mockReturnValue({ id: PKG }),
        disablePackage: vi.fn().mockReturnValue({ id: PKG }),
        uninstallPackage: vi.fn().mockReturnValue(true),
        updatePackageManifest: vi.fn().mockReturnValue({ id: PKG }),
    };
    const services: Record<string, unknown> = { protocol, objectql: { registry } };
    if (posture) services.tenancy = { posture };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), protocol, registry };
}

const ctx = (executionContext: any): any => ({ request: {}, environmentId: 'platform', executionContext });
/** An organization-scoped `manage_metadata` holder: the capability gate admits it, and it is not the operator. */
const TENANT_AUTHOR = { userId: 'u_tenant', tenantId: 'org_a', systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN' };
const OPERATOR = { userId: 'u_operator', systemPermissions: ['manage_metadata'], posture: 'PLATFORM_ADMIN' };
const SYSTEM = { userId: 'u_system', isSystem: true };

/** The thirteen write doors, with the message's subject each one names. */
const DOORS: Array<{ method: string; path: string; body?: unknown; action: string }> = [
    { method: 'POST', path: '/', body: { manifest: { id: 'com.example.new', name: 'New', version: '1.0.0', type: 'app' } }, action: 'Installing a package' },
    { method: 'PATCH', path: `/${PKG}`, body: { description: 'x' }, action: `Updating package "${PKG}"` },
    { method: 'PATCH', path: `/${PKG}/enable`, body: {}, action: `Enabling package "${PKG}"` },
    { method: 'PATCH', path: `/${PKG}/disable`, body: {}, action: `Disabling package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/publish`, body: {}, action: `Publishing package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/publish-drafts`, body: {}, action: `Publishing the drafts of package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/discard-drafts`, body: {}, action: `Discarding the drafts of package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/commits/c1/revert`, body: {}, action: 'Reverting commit "c1"' },
    { method: 'POST', path: `/${PKG}/rollback`, body: { commitId: 'c1' }, action: `Rolling back package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/revert`, body: {}, action: `Reverting package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/adopt-orphans`, body: {}, action: `Adopting orphaned metadata into package "${PKG}"` },
    { method: 'POST', path: `/${PKG}/duplicate`, body: { targetPackageId: 'com.example.pkg-b' }, action: `Duplicating package "${PKG}"` },
    { method: 'DELETE', path: `/${PKG}`, action: `Deleting package "${PKG}"` },
];

const MUTATORS = ['installPackage', 'enablePackage', 'disablePackage', 'uninstallPackage', 'updatePackageManifest'] as const;

/** Did the request reach any write the door performs? */
function anythingWritten(stack: ReturnType<typeof boot>): string[] {
    const protocolCalls = Object.entries(stack.protocol)
        .filter(([name, fn]) => name !== 'listCommits' && (fn as ReturnType<typeof vi.fn>).mock.calls.length > 0)
        .map(([name]) => `protocol.${name}`);
    const registryCalls = MUTATORS.filter((name) => stack.registry[name].mock.calls.length > 0).map((name) => `registry.${name}`);
    return [...protocolCalls, ...registryCalls];
}

describe('[ADR-0131 D12 items 7–8] the /packages write doors — the walled refusal', () => {
    for (const posture of ['isolated', 'group'] as const) {
        for (const door of DOORS) {
            it(`${posture} · ${door.method} ${door.path}: a tenant holder is refused 403 PERMISSION_DENIED naming the posture, and nothing is written`, async () => {
                const stack = boot(posture);
                const res = await stack.dispatcher.handlePackages(door.path, door.method, door.body, {}, ctx(TENANT_AUTHOR));
                expect(res.response?.status).toBe(403);
                expect(res.response?.body?.error?.code).toBe('PERMISSION_DENIED');
                const message = String(res.response?.body?.error?.message);
                expect(message.startsWith(`${door.action} is refused.`), message).toBe(true);
                expect(message).toContain(`'${posture}' tenancy posture`);
                expect(anythingWritten(stack)).toEqual([]);
            });
        }

        it(`${posture}: CONTROL — the platform operator rung and the engine itself are not refused by it, at any door`, async () => {
            for (const caller of [OPERATOR, SYSTEM]) {
                for (const door of DOORS) {
                    const stack = boot(posture);
                    const res = await stack.dispatcher.handlePackages(door.path, door.method, door.body, {}, ctx(caller));
                    expect(String(res.response?.body?.error?.message ?? ''), `${caller.userId} ${door.method} ${door.path}`)
                        .not.toContain('tenancy posture');
                    expect(res.response?.status, `${caller.userId} ${door.method} ${door.path}`).not.toBe(403);
                }
            }
        });
    }

    it('CONTROL — under `single` and with no `tenancy` service the same tenant holder is not refused by it, at any door', async () => {
        for (const posture of ['single', null] as const) {
            for (const door of DOORS) {
                const stack = boot(posture);
                const res = await stack.dispatcher.handlePackages(door.path, door.method, door.body, {}, ctx(TENANT_AUTHOR));
                expect(String(res.response?.body?.error?.message ?? ''), `${posture} ${door.method} ${door.path}`)
                    .not.toContain('tenancy posture');
                expect(res.response?.status, `${posture} ${door.method} ${door.path}`).not.toBe(403);
            }
        }
    });

    it('the capability gate still answers first: a caller without `manage_metadata` gets its sentence, not the posture one', async () => {
        const stack = boot('isolated');
        const res = await stack.dispatcher.handlePackages(`/${PKG}`, 'DELETE', undefined, {}, ctx({ userId: 'u_x', systemPermissions: [] }));
        expect(res.response?.status).toBe(403);
        expect(String(res.response?.body?.error?.message)).toContain('requires the `manage_metadata` capability');
        expect(String(res.response?.body?.error?.message)).not.toContain('tenancy posture');
        expect(anythingWritten(stack)).toEqual([]);
    });
});
