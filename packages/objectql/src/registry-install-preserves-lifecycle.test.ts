// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18877] `SchemaRegistry.installPackage` — 「缺省 = 保持」, the engine half of
 * the install contract ruled in maintainer decision batch #157 item 5, letter C.
 *
 * ## The rule, in one sentence
 *
 * An EXISTING row keeps its own `enabled` / `status` / `statusChangedAt`, and
 * the boot seed decides only for an id that has no row yet. `installPackage`
 * takes no lifecycle argument at all, so at this layer every install is 「缺省」
 * — 「有旗」 is spelled one layer up, where `enableOnInstall` reaches
 * `enablePackage` / `disablePackage` (`packages/runtime/src/domains/packages.ts`).
 *
 * ## Why the seed had to stop being consulted every time
 *
 * `initialDisabledPackageIds` is a BOOT HYDRATION input. It is filled once,
 * before any registration, from the durable disable file, and no lifecycle verb
 * updates it — so it goes stale the moment an operator enables anything. Read
 * on every install, it let the most recent explicit lifecycle action be
 * reverted by an unrelated re-install, durably and with no error anywhere
 * (`packages/runtime/src/domains/packages-install-preserves-lifecycle.test.ts`
 * pins that scenario through the real door, disk and restart included).
 *
 * Reading the ROW first is what makes the stale answer unreachable: by the time
 * an operator can have acted on a package, a row for it exists.
 *
 * ⛔ These cases deliberately do NOT go through the HTTP door. The door's own
 * pins cannot tell 「the registry preserved the row」 from 「the door re-applied
 * the same state」, because on every arm the two produce the same three
 * records. This file is the only place the registry's own answer is visible.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SchemaRegistry } from './registry.js';

const manifest = (id: string, namespace?: string) =>
    ({ id, name: `Pkg ${id}`, version: '1.0.0', ...(namespace ? { namespace } : {}) }) as any;

describe('#18877 — installPackage preserves an existing row\'s lifecycle state', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
        (registry as any).logLevel = 'silent';
    });

    it('a re-install carries `enabled` / `status` / `statusChangedAt` over from the existing row', () => {
        registry.installPackage(manifest('com.acme.carry'));
        const disabled = registry.disablePackage('com.acme.carry');
        const stampedAt = disabled?.statusChangedAt;
        expect(typeof stampedAt, 'precondition: the disable stamped a time').toBe('string');

        const again = registry.installPackage(manifest('com.acme.carry'));

        expect(again.enabled, 'the row the registry RETURNED').toBe(false);
        expect(again.status).toBe('disabled');
        // A re-install is not a lifecycle move, so the stamp is carried, not
        // refreshed — otherwise «when did an operator last move this package»
        // would answer «at the last upgrade».
        expect(again.statusChangedAt).toBe(stampedAt);
        expect(registry.getPackage('com.acme.carry')?.enabled).toBe(false);
    });

    it('⛔ the control leg — a re-install does not disable an ENABLED row either', () => {
        // Without this, «preserve» is satisfiable by a registry that simply
        // stopped enabling anything.
        registry.installPackage(manifest('com.acme.stayon'));
        const again = registry.installPackage(manifest('com.acme.stayon'));

        expect(again.enabled).toBe(true);
        expect(again.status).toBe('installed');
        expect(again.statusChangedAt, 'an always-enabled row never carried a stamp').toBeUndefined();
    });

    it('the boot seed still decides for an id that has NO row yet', () => {
        registry.setInitialDisabledPackageIds(['com.acme.seeded']);

        const first = registry.installPackage(manifest('com.acme.seeded'));

        expect(first.enabled, 'boot hydration must still replay a persisted disable').toBe(false);
        expect(first.status).toBe('disabled');
        expect(typeof first.statusChangedAt).toBe('string');
    });

    it('⭐ but the seed cannot outrank a row: enable, then re-install, and the enable stands', () => {
        // The card's own defect, at this layer. Before #18877 the second
        // install read the seed again and re-landed the package disabled.
        registry.setInitialDisabledPackageIds(['com.acme.seeded.enabled']);
        registry.installPackage(manifest('com.acme.seeded.enabled'));
        registry.enablePackage('com.acme.seeded.enabled');

        const again = registry.installPackage(manifest('com.acme.seeded.enabled'));

        expect(again.enabled, 'the most recent explicit lifecycle action stands').toBe(true);
        expect(again.status).toBe('installed');
        expect(registry.getPackage('com.acme.seeded.enabled')?.enabled).toBe(true);
    });

    it('an id the seed never named still lands at the declared default', () => {
        registry.setInitialDisabledPackageIds(['com.acme.someone.else']);
        const fresh = registry.installPackage(manifest('com.acme.unseeded'));
        expect(fresh.enabled).toBe(true);
        expect(fresh.status).toBe('installed');
    });

    it('the non-lifecycle facets of a re-install are UNCHANGED — manifest and `updatedAt` still move', () => {
        // ⛔ The scope leg: 「preserve」 is about lifecycle state only. A
        // re-install is still an install, and the row it writes is still the
        // new manifest's.
        registry.installPackage({ ...manifest('com.acme.scope'), version: '1.0.0' } as any);
        registry.disablePackage('com.acme.scope');

        const again = registry.installPackage({ ...manifest('com.acme.scope'), version: '2.0.0' } as any);

        expect(again.manifest.version, 'the re-install really replaced the manifest').toBe('2.0.0');
        expect(again.enabled, 'and did so without touching the lifecycle state').toBe(false);
    });
});

describe('#18877 item 3 — uninstallPackage forgets the id from the boot seed', () => {
    let registry: SchemaRegistry;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
        (registry as any).logLevel = 'silent';
    });

    it('a package deleted and re-installed in the same boot is a FRESH install', () => {
        registry.setInitialDisabledPackageIds(['com.acme.gone']);
        expect(registry.installPackage(manifest('com.acme.gone')).enabled, 'precondition: the seed applied').toBe(false);

        expect(registry.uninstallPackage('com.acme.gone')).toBe(true);

        const reinstalled = registry.installPackage(manifest('com.acme.gone'));
        expect(
            reinstalled.enabled,
            'a row that no longer exists has no lifecycle state — and the seed must not supply one',
        ).toBe(true);
        expect(reinstalled.status).toBe('installed');
    });

    it('⛔ and it forgets only the id it was given', () => {
        registry.setInitialDisabledPackageIds(['com.acme.gone2', 'com.acme.neighbour']);
        registry.installPackage(manifest('com.acme.gone2'));
        registry.uninstallPackage('com.acme.gone2');

        const neighbour = registry.installPackage(manifest('com.acme.neighbour'));
        expect(neighbour.enabled, 'the neighbour\'s persisted disable is untouched').toBe(false);
    });

    it('⛔ a refused uninstall forgets nothing — every mutation stays downstream of the refusal', () => {
        // ADR-0029: a package whose object another package `extend`s cannot be
        // uninstalled. The seed delete must not be the one step that happens
        // anyway, or a refused uninstall would silently re-enable the package
        // on its next registration.
        registry.setInitialDisabledPackageIds(['com.acme.extended']);
        registry.installPackage(manifest('com.acme.extended', 'ext'));
        registry.registerObject({ name: 'account', fields: {} } as any, 'com.acme.extended', 'ext', 'own');
        registry.registerObject({ name: 'account', fields: {} } as any, 'com.acme.extender', undefined, 'extend');

        expect(() => registry.uninstallPackage('com.acme.extended')).toThrow(
            /extended by com\.acme\.extender/,
        );

        // The row survived the refusal — and so did the seed entry, which is
        // only observable once the row is gone for real.
        expect(registry.getPackage('com.acme.extended'), 'the refused uninstall removed nothing').toBeDefined();
        registry.unregisterObjectsByPackage('com.acme.extender');
        expect(registry.uninstallPackage('com.acme.extended'), 'now it really goes').toBe(true);
        expect(
            registry.installPackage(manifest('com.acme.extended', 'ext')).enabled,
            'and only THEN is the id forgotten',
        ).toBe(true);
    });
});
