// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D5, ADR-0131 D4] `securityCatalogNamesHeldBy` — the read the
 * uninstall doors take just before `uninstallPackage` releases a package's
 * names, so the cleanups can revoke the grants naming its permission sets.
 * It answers for a disabled package (still installed, still holding its
 * names) and nothing once the package is gone.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry.js';

const manifest = (id: string, permissions: string[]) =>
    ({ id, name: `Pkg ${id}`, version: '1.0.0', permissions: permissions.map((name) => ({ name, label: name })) }) as any;

describe('SchemaRegistry.securityCatalogNamesHeldBy', () => {
    let registry: SchemaRegistry;
    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    });

    it('answers the permission-set names a package declared, and no other package\'s', () => {
        registry.installPackage(manifest('com.acme.tasks', ['tasks_user', 'tasks_admin']), 'code');
        registry.installPackage(manifest('com.acme.other', ['other_user']), 'code');

        expect(registry.securityCatalogNamesHeldBy('com.acme.tasks', 'permission')).toEqual(['tasks_admin', 'tasks_user']);
        expect(registry.securityCatalogNamesHeldBy('com.acme.tasks', 'position')).toEqual([]);
    });

    it('a disabled package still holds its names', () => {
        registry.installPackage(manifest('com.acme.tasks', ['tasks_user']), 'code');
        registry.disablePackage('com.acme.tasks');

        expect(registry.securityCatalogNamesHeldBy('com.acme.tasks', 'permission')).toEqual(['tasks_user']);
    });

    it('nothing once the package is uninstalled — which is why the doors read it first', () => {
        registry.installPackage(manifest('com.acme.tasks', ['tasks_user']), 'code');
        registry.uninstallPackage('com.acme.tasks');

        expect(registry.securityCatalogNamesHeldBy('com.acme.tasks', 'permission')).toEqual([]);
    });
});
