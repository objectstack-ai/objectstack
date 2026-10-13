// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D5, ADR-0131 D4] The uninstall cleanups are handed what the
 * package declared, captured from the registry just BEFORE the withdrawal
 * releases it.
 *
 * A grant names its permission set, and a package's sets are served from the
 * registry, not stored as rows. The withdrawal (`registry.uninstallPackage`)
 * runs before the cleanups (#21576) and releases the names, so a cleanup that
 * looked them up itself would find nothing, and the grants naming them would
 * survive the uninstall. {@link captureUninstallDeclared} is the one capture
 * both doors call; these cases pin it, the runner's hand-off, and
 * `deletePackage`'s order.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation, captureUninstallDeclared } from './index.js';

const PACKAGE_ID = 'com.example.tasksapp';

describe('captureUninstallDeclared — the one capture both uninstall doors call', () => {
    it('reads the permission-set names the registry says the package holds', () => {
        const held = vi.fn(() => ['tasks_app_task_user', 'tasks_app_admin']);
        expect(captureUninstallDeclared({ securityCatalogNamesHeldBy: held }, PACKAGE_ID))
            .toEqual({ permission: ['tasks_app_task_user', 'tasks_app_admin'] });
        expect(held.mock.calls).toEqual([[PACKAGE_ID, 'permission']]);
    });

    it('answers nothing when no source names a set: absent, a build without the read, a throw, or none declared', () => {
        expect(captureUninstallDeclared(undefined, PACKAGE_ID)).toBeUndefined();
        expect(captureUninstallDeclared({ securityCatalogNamesHeldBy: () => [] }, PACKAGE_ID, [{ type: 'object', name: 'x' }])).toBeUndefined();
        expect(captureUninstallDeclared({ uninstallPackage: () => true }, PACKAGE_ID)).toBeUndefined();
        expect(captureUninstallDeclared({ securityCatalogNamesHeldBy: () => { throw new Error('boom'); } }, PACKAGE_ID)).toBeUndefined();
    });

    it('unions the package\'s stored `permission` rows: a writable base\'s sets are stored, not held by the registry', () => {
        const stored = [
            { type: 'permission', name: 'base_set' },
            { type: 'object', name: 'base_widget' },
            { type: 'permission', name: 'tasks_app_task_user' },
        ];
        expect(captureUninstallDeclared({ securityCatalogNamesHeldBy: () => ['tasks_app_task_user'] }, PACKAGE_ID, stored))
            .toEqual({ permission: ['tasks_app_task_user', 'base_set'] });
        expect(captureUninstallDeclared(undefined, PACKAGE_ID, stored)).toEqual({ permission: ['base_set', 'tasks_app_task_user'] });
    });

    it('keeps only non-empty string names', () => {
        expect(captureUninstallDeclared({ securityCatalogNamesHeldBy: () => ['a', '', 7, null, 'b'] }, PACKAGE_ID))
            .toEqual({ permission: ['a', 'b'] });
    });
});

describe('runUninstallCleanups hands `declared` to every cleanup, and only when it has one', () => {
    function makeProtocol(registry: Record<string, unknown>) {
        const engine = { registry, find: async () => [] };
        const services = new Map<string, unknown>([['package', { delete: async () => ({ success: true }) }]]);
        return new ObjectStackProtocolImplementation(engine as never, () => services as never);
    }

    it('passes the captured names through, beside the package id and actor', async () => {
        const protocol = makeProtocol({});
        const cleanup = vi.fn(async () => ({ success: true, removed: 1 }));
        protocol.registerUninstallCleanup('security.package-permissions', cleanup);

        await protocol.runUninstallCleanups({ packageId: PACKAGE_ID, actor: 'usr_1', declared: { permission: ['tasks_app_task_user'] } });

        expect(cleanup.mock.calls).toEqual([[{ packageId: PACKAGE_ID, actor: 'usr_1', declared: { permission: ['tasks_app_task_user'] } }]]);
    });

    it('deletePackage captures BEFORE it withdraws, and the cleanups get what it captured', async () => {
        const order: string[] = [];
        const registry = {
            assertPackageUninstallable: () => undefined,
            securityCatalogNamesHeldBy: vi.fn((id: string) => {
                order.push(`capture ${id}`);
                // The withdrawal releases the names: after it, the registry holds none.
                return order.includes(`withdraw ${id}`) ? [] : ['tasks_app_task_user'];
            }),
            uninstallPackage: vi.fn((id: string) => { order.push(`withdraw ${id}`); return true; }),
        };
        const protocol = makeProtocol(registry);
        const cleanup = vi.fn(async () => { order.push('cleanup'); return { success: true, removed: 1 }; });
        protocol.registerUninstallCleanup('security.package-permissions', cleanup);

        await protocol.deletePackage({ packageId: PACKAGE_ID, actor: 'usr_1' });

        expect(order).toEqual([`capture ${PACKAGE_ID}`, `withdraw ${PACKAGE_ID}`, 'cleanup']);
        expect(cleanup.mock.calls).toEqual([[{ packageId: PACKAGE_ID, actor: 'usr_1', declared: { permission: ['tasks_app_task_user'] } }]]);
    });
});
