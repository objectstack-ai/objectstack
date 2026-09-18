// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18058] `enableOnInstall` is HONOURED at the install door, not merely declared.
 *
 * ## The defect this file pins shut
 *
 * `PackageInstallRequestSchema` has carried
 * `enableOnInstall: z.boolean().default(true)` since it was written, the
 * first-party SDK SENDS the key (`client.packages.install(m, {
 * enableOnInstall: false })`, pinned on the request side in
 * `packages/client/src/client.test.ts`), and — measured across
 * `packages/runtime`, `packages/metadata-protocol` and `packages/objectql` —
 * NO server-side handler read it. An author switched the option off and the
 * runtime installed the package enabled anyway, with a `201` and no warning.
 * That is «declared but not enforced» on a published option, which Prime
 * Directive #10 refuses outright: never advertise a capability the runtime does
 * not deliver.
 *
 * ## What is asserted, and why each half is needed
 *
 * - `false` ⇒ the row this door RETURNS says `enabled: false` (the caller's own
 *   evidence), the registry agrees (the next reader's evidence), and the
 *   durable state file names the package (the evidence that a restart does not
 *   silently re-enable it — the whole reason `PATCH /:id/disable` writes it).
 * - `true` and ABSENT ⇒ installed enabled. Without these the `false` case is
 *   satisfiable by a door that disables everything, and the declared default is
 *   `true`.
 * - The BARE body form carries no options, so an `enableOnInstall` spelled
 *   there is NOT honoured — `ManifestSchema`'s strict close refuses that key by
 *   name, and honouring what no schema declares is the same defect pointing the
 *   other way.
 *
 * ## Two things this harness gets right on purpose
 *
 * `OS_HOME` is redirected to a temp dir for the whole file, because
 * `setPackageDisabled` writes a REAL file under the ObjectStack home and a test
 * that wrote into the developer's own home would disable packages in their
 * running system. And every case installs its OWN package id: the state file is
 * one shared document keyed by environment and project, so a shared id would
 * let the first case's write satisfy — or break — the next one's read.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';
import { loadDisabledPackageIds } from '../package-state-store.js';

const PKG_ADMIN = () => ({
    request: {},
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
}) as any;

/** A complete AUTHORING-stage manifest — the stage this door is reached at. */
const manifest = (id: string, namespace: string) => ({
    id,
    name: `Acme ${namespace}`,
    namespace,
    version: '1.0.0',
    type: 'app',
});

function makeDoor(registry: SchemaRegistry) {
    const kernel: any = {
        getService: (name: string) =>
            name === 'objectql' ? Promise.resolve({ registry }) : null,
        context: { getService: () => null },
    };
    return new HttpDispatcher(kernel);
}

function freshRegistry(): SchemaRegistry {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    return registry;
}

/** `POST /api/v1/packages` exactly as the route reads it. */
const install = (dispatcher: HttpDispatcher, body: unknown) =>
    dispatcher.handlePackages('', 'POST', body, {}, PKG_ADMIN());

/**
 * The context above names no environment, so the handler persists under
 * `undefined` — this read must ask the same question the write answered.
 */
const persistedDisabled = () => loadDisabledPackageIds(undefined);

const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;

beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-18058-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    rmSync(home, { recursive: true, force: true });
});

describe('#18058 — the install door honours `enableOnInstall`', () => {
    let registry: SchemaRegistry;
    let dispatcher: HttpDispatcher;

    beforeEach(() => {
        registry = freshRegistry();
        dispatcher = makeDoor(registry);
    });

    it('`enableOnInstall: false` installs the package DISABLED, in all three records', async () => {
        const pkg = manifest('com.acme.off', 'off');
        const result = await install(dispatcher, { manifest: pkg, enableOnInstall: false });

        expect(result.handled).toBe(true);
        expect(result.response?.status, 'the install must still SUCCEED — this is an option, not a refusal').toBe(201);

        // ⭐ The line this card exists for. Before #18058 every one of these
        // three read "enabled", because nothing read the key.
        expect(result.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(false);
        expect(registry.getPackage('com.acme.off')?.enabled, 'the registry the next read serves from').toBe(false);
        expect(
            persistedDisabled().has('com.acme.off'),
            'the durable state — without it a restart re-enables what the caller switched off',
        ).toBe(true);
    });

    it('`enableOnInstall: false` also moves `status`, the way `PATCH /:id/disable` does', async () => {
        const pkg = manifest('com.acme.status', 'status');
        const result = await install(dispatcher, { manifest: pkg, enableOnInstall: false });
        expect(result.response?.body?.data?.status).toBe('disabled');
    });

    it('`enableOnInstall: true` installs it ENABLED — the `false` case is not a door that disables everything', async () => {
        const pkg = manifest('com.acme.on', 'on');
        const result = await install(dispatcher, { manifest: pkg, enableOnInstall: true });

        expect(result.response?.status).toBe(201);
        expect(result.response?.body?.data?.enabled).toBe(true);
        expect(registry.getPackage('com.acme.on')?.enabled).toBe(true);
        expect(persistedDisabled().has('com.acme.on')).toBe(false);
    });

    it('an ABSENT `enableOnInstall` installs it enabled — the declared default is `true`', async () => {
        const pkg = manifest('com.acme.absent', 'absent');
        const result = await install(dispatcher, { manifest: pkg });

        expect(result.response?.status).toBe(201);
        expect(result.response?.body?.data?.enabled).toBe(true);
        expect(persistedDisabled().has('com.acme.absent')).toBe(false);
    });

    it('the BARE body form does NOT honour the key — no schema declares it there', async () => {
        // `PackageInstallBodySchema`'s bare branch is `ManifestSchema`, a strict
        // close with no `enableOnInstall` key: this body parses through NEITHER
        // declared form. The door must not act on it.
        const result = await install(dispatcher, { ...manifest('com.acme.bare', 'bare'), enableOnInstall: false });

        expect(result.response?.status).toBe(201);
        expect(result.response?.body?.data?.enabled).toBe(true);
        expect(persistedDisabled().has('com.acme.bare')).toBe(false);
    });
});

/**
 * [#18058 F1] The DURABLE half of the declared default, on the path the cases
 * above structurally cannot reach: an id that is ALREADY INSTALLED.
 *
 * ## The defect these pin shut
 *
 * The handler wrote `setPackageDisabled(env, id, true)` and never `false`, so
 * the three records this door is held to only agreed while every id was fresh:
 *
 * ```text
 * POST {manifest, overwrite:true, enableOnInstall:false}  → 201, disabled, state file lists the id
 * POST {manifest, overwrite:true}         (flag absent)   → 201, enabled:true, registry true,
 *                                                           and the state file STILL lists it
 * ```
 *
 * Nothing is red at that moment. The loss surfaces one restart later:
 * `SchemaRegistry.installPackage` reads `initialDisabledPackageIds`, finds the
 * id, and re-installs the package DISABLED — a door that answered correctly on
 * the wire and wrongly on disk. `PATCH /packages/:id/enable` has always made
 * exactly the `false` call these cases demand; the install door did not.
 *
 * ⚠️ The fix is deliberately UNCONDITIONAL rather than scoped to the overwrite
 * path: `DELETE /packages/:id` does not clear the durable disable either, so a
 * disable → uninstall → re-install lands on a FRESH registry id whose durable
 * record still says disabled. Persisting the state the door actually returned,
 * every time, is one call that cannot be out of step with the row.
 */
describe('#18058 — a re-install persists the state it RETURNS, not just a disable', () => {
    let registry: SchemaRegistry;
    let dispatcher: HttpDispatcher;

    beforeEach(() => {
        registry = freshRegistry();
        dispatcher = makeDoor(registry);
    });

    /** Install once with `enableOnInstall: false`, and prove the disable really landed. */
    const installDisabled = async (id: string, namespace: string) => {
        const first = await install(dispatcher, {
            manifest: manifest(id, namespace),
            overwrite: true,
            enableOnInstall: false,
        });
        expect(first.response?.status).toBe(201);
        expect(first.response?.body?.data?.enabled, 'precondition: the first install really disabled it').toBe(false);
        expect(persistedDisabled().has(id), 'precondition: the disable really reached disk').toBe(true);
    };

    it('re-installing with the flag ABSENT clears the durable disable — the declared default is `true`', async () => {
        const id = 'com.acme.reinstall.absent';
        await installDisabled(id, 'reinstallabsent');

        const again = await install(dispatcher, { manifest: manifest(id, 'reinstallabsent'), overwrite: true });

        expect(again.response?.status).toBe(201);
        expect(again.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(true);
        expect(registry.getPackage(id)?.enabled, 'the registry the next read serves from').toBe(true);
        // ⭐ The line this F item exists for: without it the next boot reads the
        // stale id out of `initialDisabledPackageIds` and installs it DISABLED.
        expect(
            persistedDisabled().has(id),
            'the durable state — a re-install that answered `enabled` must not leave `disabled` on disk',
        ).toBe(false);
    });

    it('re-installing with `enableOnInstall: true` clears the durable disable', async () => {
        const id = 'com.acme.reinstall.true';
        await installDisabled(id, 'reinstalltrue');

        const again = await install(dispatcher, {
            manifest: manifest(id, 'reinstalltrue'),
            overwrite: true,
            enableOnInstall: true,
        });

        expect(again.response?.status).toBe(201);
        expect(again.response?.body?.data?.enabled).toBe(true);
        expect(registry.getPackage(id)?.enabled).toBe(true);
        expect(persistedDisabled().has(id)).toBe(false);
    });

    it('a BARE re-install clears it too — that form cannot ask for `false`, so it installs enabled', async () => {
        const id = 'com.acme.reinstall.bare';
        await installDisabled(id, 'reinstallbare');

        // No wrapper, so `enableOnInstall` is not a declared key here at all and
        // the door installs at the default. The durable record must follow.
        const again = await install(dispatcher, manifest(id, 'reinstallbare'));

        expect(again.response?.status, 'the bare form reaches overwrite through the query string alone').toBe(409);

        const forced = await dispatcher.handlePackages(
            '', 'POST', manifest(id, 'reinstallbare'), { overwrite: 'true' }, PKG_ADMIN(),
        );
        expect(forced.response?.status).toBe(201);
        expect(forced.response?.body?.data?.enabled).toBe(true);
        expect(persistedDisabled().has(id)).toBe(false);
    });

    it('⛔ the disable direction is UNCHANGED — a re-install asking for `false` still persists it', async () => {
        const id = 'com.acme.reinstall.stays-off';
        await installDisabled(id, 'reinstallstaysoff');

        const again = await install(dispatcher, {
            manifest: manifest(id, 'reinstallstaysoff'),
            overwrite: true,
            enableOnInstall: false,
        });

        expect(again.response?.status).toBe(201);
        expect(again.response?.body?.data?.enabled).toBe(false);
        expect(persistedDisabled().has(id)).toBe(true);
    });
});

/**
 * [#18058 F1b] The MIRROR of F1 — an id an operator disabled in an EARLIER
 * boot, seeded back into the registry at this boot's start.
 *
 * ## Why the four F1 cases above cannot see this
 *
 * Not one of them calls `setInitialDisabledPackageIds`. Their registries are
 * born empty, so `SchemaRegistry.installPackage` always lands a package
 * ENABLED and the only thing that can move it is this door's own
 * `enableOnInstall: false` flip. That makes "the state the request asked for"
 * and "the state the registry ended up in" the SAME value on every one of
 * them — the two can only be told apart on a registry that was seeded, which
 * is the same structural blind spot the earlier review named for the fresh-id
 * cases. ⛔ A case that does not seed proves nothing here.
 *
 * ## The divergence these pin shut
 *
 * `SchemaRegistry.installPackage` lands an id that is in the boot-seeded
 * `initialDisabledPackageIds` DISABLED **whatever the request says** — the
 * seed is read at registration, not at the door. So with the flag ABSENT:
 *
 * ```text
 * boot 1  POST {manifest, enableOnInstall:false}   → 201, enabled:false, disk lists the id
 * restart setInitialDisabledPackageIds(loadDisabledPackageIds(undefined))
 * boot 2  POST {manifest}            (flag absent) → 201, enabled:FALSE  (the seed won)
 *                                                    …and the disk record was CLEARED
 * boot 3                                           → the package comes back ENABLED
 * ```
 *
 * Nothing is red at boot 2: the wire answer and the registry agree with each
 * other and only the disk disagrees — an operator's disable, persisted before a
 * restart, erased by an install that never asked for it. Reachable from the
 * SDK's default `client.packages.install(manifest)` and from objectui's
 * `{ manifest }` post.
 *
 * ## The remedy, and the one that was NOT taken
 *
 * The disk follows the ROW THIS DOOR RETURNED (`!pkg.enabled`), so memory and
 * disk cannot disagree by construction. ⛔ Deliberately NOT "enable first so
 * the declared default wins": that would make a flag-absent install RE-ENABLE a
 * package an operator disabled in an earlier boot — a new behaviour this card
 * does not authorise. Which state a seeded id should end in when the request
 * asks for `enableOnInstall: true` is therefore left exactly as it was, and the
 * last case here pins that it is at least SELF-CONSISTENT.
 */
describe('#18058 F1b — a boot-seeded disable survives an install that never asked to clear it', () => {
    /**
     * A restart, spelled exactly as `AppPlugin.seedPersistedDisabledPackages`
     * spells it (`app-plugin.ts`): a registry born empty, then seeded from the
     * durable file BEFORE any package registration.
     */
    const rebootFromDisk = () => {
        const registry = freshRegistry();
        registry.setInitialDisabledPackageIds(loadDisabledPackageIds(undefined));
        return { registry, dispatcher: makeDoor(registry) };
    };

    /**
     * Boot 1: an operator disables the package the ordinary way, and it reaches
     * disk. Returns nothing — the durable file is the whole point, and the
     * registry that wrote it is deliberately thrown away.
     */
    const persistDisableInAnEarlierBoot = async (id: string, namespace: string) => {
        const { dispatcher } = rebootFromDisk();
        const first = await install(dispatcher, {
            manifest: manifest(id, namespace),
            enableOnInstall: false,
        });
        expect(first.response?.status).toBe(201);
        expect(first.response?.body?.data?.enabled, 'precondition: boot 1 really disabled it').toBe(false);
        expect(loadDisabledPackageIds(undefined).has(id), 'precondition: boot 1 reached disk').toBe(true);
    };

    it('case F — flag ABSENT on a seeded id: wire, registry and disk all still say disabled', async () => {
        const id = 'com.acme.seeded.absent';
        await persistDisableInAnEarlierBoot(id, 'seededabsent');

        // Boot 2 — the registry is seeded, the package is not installed yet.
        const { registry, dispatcher } = rebootFromDisk();
        const again = await install(dispatcher, { manifest: manifest(id, 'seededabsent') });

        expect(again.response?.status).toBe(201);
        // The seed decides, and the door reports it honestly.
        expect(again.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(false);
        expect(registry.getPackage(id)?.enabled, 'the registry the next read serves from').toBe(false);
        // ⭐ The line F1b exists for: the request's intent must not overwrite it.
        expect(
            loadDisabledPackageIds(undefined).has(id),
            'the durable state — an install that ANSWERED `enabled:false` must not clear the disable on disk',
        ).toBe(true);
    });

    it('case F — and boot 3 agrees: the package does not come back enabled', async () => {
        const id = 'com.acme.seeded.restart';
        await persistDisableInAnEarlierBoot(id, 'seededrestart');

        const boot2 = rebootFromDisk();
        const second = await install(boot2.dispatcher, { manifest: manifest(id, 'seededrestart') });
        expect(second.response?.body?.data?.enabled).toBe(false);

        // Boot 3 — re-seeded from whatever boot 2 left behind.
        const boot3 = rebootFromDisk();
        const third = await install(boot3.dispatcher, { manifest: manifest(id, 'seededrestart') });
        expect(third.response?.body?.data?.enabled, 'a restart must replay the disable, not undo it').toBe(false);
        expect(boot3.registry.getPackage(id)?.enabled).toBe(false);
        expect(loadDisabledPackageIds(undefined).has(id)).toBe(true);
    });

    it('case G — `overwrite:true` with the flag absent, on an id already installed-disabled this boot', async () => {
        const id = 'com.acme.seeded.overwrite';
        await persistDisableInAnEarlierBoot(id, 'seededoverwrite');

        const { registry, dispatcher } = rebootFromDisk();
        // Install it once this boot: the seed lands it disabled with no flip.
        const seeded = await install(dispatcher, { manifest: manifest(id, 'seededoverwrite') });
        expect(seeded.response?.body?.data?.enabled, 'precondition: the seed landed it disabled').toBe(false);

        // Now the re-install the review measured: overwrite, no flag.
        const again = await install(dispatcher, {
            manifest: manifest(id, 'seededoverwrite'),
            overwrite: true,
        });

        expect(again.response?.status).toBe(201);
        expect(again.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(false);
        expect(registry.getPackage(id)?.enabled, 'the registry the next read serves from').toBe(false);
        expect(
            loadDisabledPackageIds(undefined).has(id),
            'the durable state — the overwrite path diverges the same way, and must not',
        ).toBe(true);

        // And the restart round-trip, from the state this install left.
        const boot3 = rebootFromDisk();
        const third = await install(boot3.dispatcher, { manifest: manifest(id, 'seededoverwrite') });
        expect(third.response?.body?.data?.enabled, 'a re-seeded registry still agrees with that row').toBe(false);
    });

    it('a seeded id asked for `enableOnInstall: true` is at least SELF-CONSISTENT — the seed wins, and the disk says so', async () => {
        // ⛔ NOT a claim that the flag is honoured here. The registry seed is
        // read at registration and this door does not re-enable (that is remedy
        // (b), which no ruling authorises). What IS required is that the three
        // records do not disagree: whatever state the install lands in, the
        // durable file records THAT state and a restart replays it.
        const id = 'com.acme.seeded.true';
        await persistDisableInAnEarlierBoot(id, 'seededtrue');

        const { registry, dispatcher } = rebootFromDisk();
        const again = await install(dispatcher, {
            manifest: manifest(id, 'seededtrue'),
            enableOnInstall: true,
        });

        expect(again.response?.status).toBe(201);
        const returned = again.response?.body?.data?.enabled;
        expect(registry.getPackage(id)?.enabled, 'the registry agrees with the row').toBe(returned);
        expect(
            loadDisabledPackageIds(undefined).has(id),
            'the disk agrees with the row',
        ).toBe(returned === false);
    });

    it('⛔ the seed is not a door that disables everything — an UNSEEDED id still installs enabled', async () => {
        // The control leg. Without it every assertion above is satisfiable by a
        // registry that simply refuses to enable anything.
        const other = 'com.acme.seeded.control';
        await persistDisableInAnEarlierBoot('com.acme.seeded.neighbour', 'seededneighbour');

        const { registry, dispatcher } = rebootFromDisk();
        const fresh = await install(dispatcher, { manifest: manifest(other, 'seededcontrol') });

        expect(fresh.response?.status).toBe(201);
        expect(fresh.response?.body?.data?.enabled, 'an id the seed never named').toBe(true);
        expect(registry.getPackage(other)?.enabled).toBe(true);
        expect(loadDisabledPackageIds(undefined).has(other)).toBe(false);
    });
});

/**
 * [#18058] The changeset's own sentence, MEASURED rather than presumed:
 *
 * > «Every install now persists the state it returned.»
 *
 * The cases above each pin a specific expected state. This block pins the
 * WEAKER but universal claim that sentence actually makes — for every arm of
 * this door that answers `201`, the durable record and the row served are the
 * same fact:
 *
 * ```text
 * loadDisabledPackageIds().has(id)  ===  (row.enabled === false)
 * ```
 *
 * ⚠️ It asserts the invariant, deliberately NOT which value each arm lands on:
 * a block that also pinned the values would pass for the wrong reason the day
 * one arm's expected value changed. Held against the arms that can reach this
 * door at all — both body forms, the flag in all three of its states, a
 * registry with and without a boot seed, and the `overwrite` re-install path.
 * `409` is a red here, not a skip: an arm that stopped reaching `201` would
 * otherwise drop out of the measurement silently.
 */
describe('#18058 — MEASURED: every install persists the state it RETURNED', () => {
    const rebootFromDisk = () => {
        const registry = freshRegistry();
        registry.setInitialDisabledPackageIds(loadDisabledPackageIds(undefined));
        return { registry, dispatcher: makeDoor(registry) };
    };

    /** Put `id` on disk as disabled, using the door, and throw that boot away. */
    const seedDiskWith = async (id: string, namespace: string) => {
        const { dispatcher } = rebootFromDisk();
        const first = await install(dispatcher, { manifest: manifest(id, namespace), enableOnInstall: false });
        expect(first.response?.status, `setup: ${id}`).toBe(201);
        expect(loadDisabledPackageIds(undefined).has(id), `setup: ${id} reached disk`).toBe(true);
    };

    interface Arm {
        /** Reads as the test name — keep it a description of the ARM, not of an expected value. */
        name: string;
        /** Disk carries this id as disabled before the boot under measurement. */
        seeded?: boolean;
        /** Install once this boot before the measured call (reaches the `overwrite` path). */
        preinstall?: 'default' | 'off';
        /** The measured call's body, given the manifest. */
        body: (m: Record<string, unknown>) => unknown;
    }

    const arms: Arm[] = [
        { name: 'fresh id · wrapped · flag absent', body: (m) => ({ manifest: m }) },
        { name: 'fresh id · wrapped · flag true', body: (m) => ({ manifest: m, enableOnInstall: true }) },
        { name: 'fresh id · wrapped · flag false', body: (m) => ({ manifest: m, enableOnInstall: false }) },
        { name: 'fresh id · bare manifest', body: (m) => m },
        { name: 'seeded id · wrapped · flag absent', seeded: true, body: (m) => ({ manifest: m }) },
        { name: 'seeded id · wrapped · flag true', seeded: true, body: (m) => ({ manifest: m, enableOnInstall: true }) },
        { name: 'seeded id · wrapped · flag false', seeded: true, body: (m) => ({ manifest: m, enableOnInstall: false }) },
        { name: 'seeded id · bare manifest', seeded: true, body: (m) => m },
        {
            name: 'seeded id · installed this boot · overwrite · flag absent',
            seeded: true,
            preinstall: 'default',
            body: (m) => ({ manifest: m, overwrite: true }),
        },
        {
            name: 'seeded id · installed this boot · overwrite · flag false',
            seeded: true,
            preinstall: 'default',
            body: (m) => ({ manifest: m, overwrite: true, enableOnInstall: false }),
        },
        {
            name: 'unseeded id · disabled this boot · overwrite · flag absent',
            preinstall: 'off',
            body: (m) => ({ manifest: m, overwrite: true }),
        },
    ];

    arms.forEach((arm, index) => {
        it(`${arm.name} — disk and row agree`, async () => {
            const id = `com.acme.measured${index}`;
            const namespace = `measured${index}`;
            if (arm.seeded) await seedDiskWith(id, namespace);

            const { registry, dispatcher } = rebootFromDisk();
            if (arm.preinstall) {
                const pre = await install(
                    dispatcher,
                    arm.preinstall === 'off'
                        ? { manifest: manifest(id, namespace), enableOnInstall: false }
                        : { manifest: manifest(id, namespace) },
                );
                expect(pre.response?.status, 'setup: the pre-install must land').toBe(201);
            }

            const result = await install(dispatcher, arm.body(manifest(id, namespace)));
            expect(result.response?.status, 'this arm must still reach the door').toBe(201);

            const row = result.response?.body?.data;
            expect(typeof row?.enabled, 'the row must state its own enabled-ness').toBe('boolean');
            expect(registry.getPackage(id)?.enabled, 'the registry agrees with the row').toBe(row?.enabled);
            // ⭐ The sentence itself.
            expect(
                loadDisabledPackageIds(undefined).has(id),
                'the durable record is the state this door RETURNED',
            ).toBe(row?.enabled === false);
        });
    });
});
