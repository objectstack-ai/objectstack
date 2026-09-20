// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19277] The IN-PROCESS install door honours `enableOnInstall`.
 *
 * ## The defect this file pins shut
 *
 * `InstallPackageRequestSchema.enableOnInstall`
 * (`packages/spec/src/kernel/package-registry.zod.ts`) is the request contract
 * of the in-process `ObjectStackProtocol.installPackage` /
 * `MetadataProtocol.installPackage` primitive. The HTTP door has honoured its
 * copy of the key since #18058; this primitive read `manifest` + `settings`
 * and nothing else. So a caller that asked for `enableOnInstall: false` got an
 * ENABLED install, with no refusal and no warning — «declared but not
 * enforced» on a published option, which ADR-0049 (enforce-or-remove) and
 * Prime Directive #10 exist to end. Ruling batch #153 item 5 letter 1 (#18605)
 * kept the kernel declaration as a COPY of the HTTP request key with the SAME
 * meaning ⇒ the disposition is ENFORCE, not retire.
 *
 * ## The matrix, taken from the tree rather than from the card
 *
 * ⚠️ The card that filed this work describes the target as
 * 「`enableOnInstall ?? true` on install AND on re-install」. That sentence was
 * written before #19291 landed and it is SPENT: `?? true` on re-install is
 * precisely what the HTTP door stopped doing. The live rule is 「缺省 = 保持，
 * 有旗 = 设置」 (maintainer ruling batch #157 item 5 letter C), and the cells
 * below are the ones
 * `packages/runtime/src/domains/packages-install-enable-on-install.test.ts`
 * pins on the HTTP door today, read on `origin/main`:
 *
 * ```text
 * FRESH id   flag false  ⇒ disabled      flag true ⇒ enabled     absent ⇒ enabled
 * EXISTING   flag false  ⇒ disabled      flag true ⇒ enabled     absent ⇒ PRESERVE
 * SEEDED id  flag true   ⇒ enabled (the flag outranks the boot seed)
 *            absent      ⇒ disabled (the seed decides for a row that does not exist yet)
 * ```
 *
 * ## Why these cases use a REAL `SchemaRegistry`
 *
 * 「缺省 = 保持」 and 「the seed decides only for an id with no row」 are
 * `SchemaRegistry.installPackage`'s own behaviour (#18877). A registry double
 * that simply returns `{ enabled: true }` makes every preserve/seed cell below
 * satisfiable by a door that does nothing at all, so this file drives the real
 * registry and the real protocol implementation and reads the state both of
 * them end up holding.
 *
 * ## The one HTTP-door cell with no analogue here
 *
 * The door's BARE body form (a manifest posted as the whole body, where
 * `ManifestSchema`'s strict close refuses the key by name) does not exist at
 * this seam: `InstallPackageRequest` always carries `manifest` as a field, so
 * there is no second body shape for the key to be spelled on. What IS pinned
 * instead is the third state's boundary — a non-boolean value is read as
 * ABSENT, never coerced.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';

/** A complete manifest — the shape the in-process primitive is reached with. */
const manifest = (id: string, namespace: string) => ({
    id,
    name: `Acme ${namespace}`,
    namespace,
    version: '1.0.0',
    type: 'app',
});

function freshRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    return registry;
}

/**
 * The in-process door, with a `package` service present so the durable
 * `sys_packages` half is exercised rather than warned past. That service
 * stores the MANIFEST; it carries no lifecycle column, which is why the
 * registry row below is the record every assertion reads.
 */
function makeDoor(registry: SchemaRegistry) {
    const publish = vi.fn(async () => ({ success: true }));
    const services = new Map<string, unknown>([['package', { publish }]]);
    const protocol = new ObjectStackProtocolImplementation({ registry } as never, () => services);
    return { protocol, publish };
}

const install = (protocol: ObjectStackProtocolImplementation, request: unknown) =>
    (protocol as any).installPackage(request) as Promise<{ package: any; message: string }>;

describe('#19277 — the in-process install door honours `enableOnInstall` (FRESH id)', () => {
    let registry: SchemaRegistry;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = freshRegistry();
        protocol = makeDoor(registry).protocol;
    });

    it('`enableOnInstall: false` installs the package DISABLED, in both records', async () => {
        const res = await install(protocol, {
            manifest: manifest('com.acme.off', 'off'),
            enableOnInstall: false,
        });

        // ⭐ The line this card exists for. Before #19277 both of these read
        // `true`, because nothing at this seam read the key.
        expect(res.package.enabled, 'the row this primitive RETURNED').toBe(false);
        expect(registry.getPackage('com.acme.off')?.enabled, 'the registry the next read serves from').toBe(false);
    });

    it('`enableOnInstall: false` also moves `status`, the way `PATCH /:id/disable` does', async () => {
        const res = await install(protocol, {
            manifest: manifest('com.acme.status', 'status'),
            enableOnInstall: false,
        });

        expect(res.package.status).toBe('disabled');
        expect(registry.getPackage('com.acme.status')?.status).toBe('disabled');
    });

    it('`enableOnInstall: true` installs it ENABLED — the `false` case is not a door that disables everything', async () => {
        const res = await install(protocol, {
            manifest: manifest('com.acme.on', 'on'),
            enableOnInstall: true,
        });

        expect(res.package.enabled).toBe(true);
        expect(res.package.status).toBe('installed');
        expect(registry.getPackage('com.acme.on')?.enabled).toBe(true);
    });

    it('an ABSENT `enableOnInstall` installs a FRESH id enabled — the declared default', async () => {
        const res = await install(protocol, { manifest: manifest('com.acme.absent', 'absent') });

        expect(res.package.enabled).toBe(true);
        expect(registry.getPackage('com.acme.absent')?.enabled).toBe(true);
    });

    it('a NON-BOOLEAN value is read as ABSENT — three states, never a truthiness test', async () => {
        // `'false'` is truthy and would DISABLE nothing under `=== false`, but
        // it would also ENABLE under a `??`/truthiness reading. The declaration
        // admits `boolean | undefined` only, so a string is not a fourth state:
        // it is an undeclared value, and the door must not act on it. Same
        // disposition the HTTP door records for a string-typed flag.
        const res = await install(protocol, {
            manifest: manifest('com.acme.stringy', 'stringy'),
            enableOnInstall: 'false',
        });

        expect(res.package.enabled, 'not coerced into the `false` arm').toBe(true);
        expect(registry.getPackage('com.acme.stringy')?.enabled).toBe(true);
    });

    it('the durable `sys_packages` write still happens on the flag arms', async () => {
        // The lifecycle flip must not displace the persistence half: the
        // manifest still reaches the `package` service on an install that
        // carries the key.
        const local = freshRegistry();
        const { protocol: door, publish } = makeDoor(local);
        await install(door, { manifest: manifest('com.acme.persisted', 'persisted'), enableOnInstall: false });

        expect(publish).toHaveBeenCalledTimes(1);
        expect((publish.mock.calls[0] as unknown[])[0]).toMatchObject({
            manifest: { id: 'com.acme.persisted' },
        });
        expect(local.getPackage('com.acme.persisted')?.enabled).toBe(false);
    });
});

describe('#19277 — an EXISTING row: 「缺省 = 保持，有旗 = 设置」', () => {
    let registry: SchemaRegistry;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(() => {
        registry = freshRegistry();
        protocol = makeDoor(registry).protocol;
    });

    /** Install once with the flag off, and prove the disable really landed. */
    const installDisabled = async (id: string, namespace: string) => {
        const first = await install(protocol, { manifest: manifest(id, namespace), enableOnInstall: false });
        expect(first.package.enabled, 'precondition: the first install really disabled it').toBe(false);
    };

    it('[#18877 re-ruled] a re-install with the flag ABSENT PRESERVES the disable', async () => {
        // ⚠️ The card's own prose asks for `enableOnInstall ?? true` here, which
        // would RE-ENABLE. That is the cell ruling batch #157 item 5 letter C
        // re-ruled and #19291 landed on the HTTP door
        // (`packages-install-enable-on-install.test.ts`, the
        // `[#18877 re-ruled]` cases). An install that asked for nothing must
        // leave the operator's last explicit decision standing.
        const id = 'com.acme.reinstall.absent';
        await installDisabled(id, 'reinstallabsent');

        const again = await install(protocol, { manifest: manifest(id, 'reinstallabsent') });

        expect(again.package.enabled, 'the row this primitive RETURNED').toBe(false);
        expect(again.package.status, '`status` is carried over with `enabled`, not recomputed').toBe('disabled');
        expect(registry.getPackage(id)?.enabled, 'the registry the next read serves from').toBe(false);
    });

    it('a re-install with `enableOnInstall: true` CLEARS the disable', async () => {
        // The arm that is load-bearing only because `installPackage` preserves:
        // nothing else clears a durable disable on a re-install any more.
        const id = 'com.acme.reinstall.true';
        await installDisabled(id, 'reinstalltrue');

        const again = await install(protocol, {
            manifest: manifest(id, 'reinstalltrue'),
            enableOnInstall: true,
        });

        expect(again.package.enabled).toBe(true);
        expect(again.package.status).toBe('installed');
        expect(registry.getPackage(id)?.enabled).toBe(true);
    });

    it('⛔ the disable direction is UNCHANGED — `false` still disables an enabled row', async () => {
        const id = 'com.acme.reinstall.staysoff';
        await install(protocol, { manifest: manifest(id, 'reinstallstaysoff') });
        expect(registry.getPackage(id)?.enabled, 'precondition: it started enabled').toBe(true);

        const again = await install(protocol, {
            manifest: manifest(id, 'reinstallstaysoff'),
            enableOnInstall: false,
        });

        expect(again.package.enabled).toBe(false);
        expect(registry.getPackage(id)?.enabled).toBe(false);
    });
});

describe('#19277 — a BOOT-SEEDED disable, the durable state this seam can see', () => {
    /**
     * A restart, spelled exactly as `AppPlugin.seedPersistedDisabledPackages`
     * spells it: a registry born empty, then seeded from the persisted disable
     * set BEFORE any package registration.
     */
    const rebootWithSeed = (ids: string[]) => {
        const registry = freshRegistry();
        registry.setInitialDisabledPackageIds(ids);
        return { registry, protocol: makeDoor(registry).protocol };
    };

    it('flag ABSENT on a seeded id: the seed decides, and the primitive reports it honestly', async () => {
        const id = 'com.acme.seeded.absent';
        const { registry, protocol } = rebootWithSeed([id]);

        const res = await install(protocol, { manifest: manifest(id, 'seededabsent') });

        expect(res.package.enabled, 'the row this primitive RETURNED').toBe(false);
        expect(res.package.status).toBe('disabled');
        expect(registry.getPackage(id)?.enabled).toBe(false);
    });

    it('[#18877 re-ruled] a seeded id asked for `enableOnInstall: true` is ENABLED — 「有旗 = 设置」', async () => {
        // The in-process analogue of the HTTP door's 「re-install with `true`
        // clears the durable disable」: an explicit flag outranks the boot seed,
        // in both directions (ruling batch #157 item 5 letter C item 2).
        const id = 'com.acme.seeded.true';
        const { registry, protocol } = rebootWithSeed([id]);

        const res = await install(protocol, {
            manifest: manifest(id, 'seededtrue'),
            enableOnInstall: true,
        });

        expect(res.package.enabled, 'the flag was present and it said `true`').toBe(true);
        expect(res.package.status).toBe('installed');
        expect(registry.getPackage(id)?.enabled, 'the registry agrees with the row').toBe(true);
    });

    it('⛔ the seed is not a door that disables everything — an id it never named installs enabled', async () => {
        // The control leg. Without it every seeded assertion above is
        // satisfiable by a registry that simply refuses to enable anything.
        const { registry, protocol } = rebootWithSeed(['com.acme.seeded.neighbour']);

        const res = await install(protocol, { manifest: manifest('com.acme.seeded.control', 'seededcontrol') });

        expect(res.package.enabled).toBe(true);
        expect(registry.getPackage('com.acme.seeded.control')?.enabled).toBe(true);
    });
});
