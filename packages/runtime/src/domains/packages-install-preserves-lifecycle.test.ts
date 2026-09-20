// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18877] The install contract is 「缺省 = 保持,有旗 = 设置」 — maintainer
 * decision batch #157 item 5, letter C.
 *
 * ## The defect this file pins shut
 *
 * `SchemaRegistry.initialDisabledPackageIds` is a BOOT HYDRATION input: it is
 * filled once, before any registration, from the durable disable file, and no
 * lifecycle verb updates it. It was nevertheless consulted by EVERY
 * `installPackage` call, so an id the operator had since re-enabled was still
 * named by the seed and every re-install within that boot re-landed it
 * DISABLED. Since #18752 the durable write follows the row the door returned,
 * which turned that memory-only quirk into a durable one:
 *
 * ```text
 * boot 1   operator disables the package             → disk lists the id
 * boot 2   seeded from disk, package installs disabled
 *          PATCH /packages/:id/enable                → 200, registry true, disk CLEARED
 *          install(m, { overwrite: true })  (no flag) → the seed still listed the id
 *                                                     → row disabled, disk written DISABLED
 * boot 3   the operator's enable is gone, with no error anywhere
 * ```
 *
 * Reachable with nothing exotic: disable → restart → enable in Studio → an SDK
 * upgrade with `overwrite`. The three records agreed at every single step; only
 * the operator's most recent explicit decision was lost.
 *
 * ## The rule, and why BOTH halves are pinned here
 *
 * - 「缺省 = 保持」 — an install that was not asked to move the lifecycle state
 *   does not move it. `installPackage` carries an EXISTING row's `enabled` /
 *   `status` / `statusChangedAt` over, and consults the boot seed only for an
 *   id that has no row yet (ruling item 1).
 * - 「有旗 = 设置」 — `enableOnInstall: true` ⇒ `enablePackage`, `false` ⇒
 *   `disablePackage`, absent ⇒ NO lifecycle call at all (ruling item 2).
 * - `DELETE /packages/:id` clears the seed entry AND the durable record: a row
 *   that no longer exists has no lifecycle state, so the next install of that
 *   id is a fresh install (ruling item 3).
 *
 * A file that pinned only 「保持」 would be satisfied by a door that had simply
 * stopped honouring the flag — which is the #18058 defect pointing the other
 * way. A file that pinned only 「设置」 would be satisfied by today's revert.
 *
 * ## Harness notes, both load-bearing
 *
 * `OS_HOME` is redirected to a temp dir for the whole file, because
 * `setPackageDisabled` writes a REAL file under the ObjectStack home and a test
 * that wrote into the developer's own home would disable packages in their
 * running system. And every case uses its OWN package id: the state file is one
 * shared document keyed by environment and project, so a shared id would let
 * one case's write satisfy — or break — the next one's read.
 *
 * ⛔ Every `restart` here re-seeds the registry exactly the way
 * `AppPlugin.seedPersistedDisabledPackages` does — a registry born empty, then
 * seeded from the durable file BEFORE any registration. A case that does not
 * restart through the file cannot tell 「保持」 from 「the seed happened to
 * agree」, which is the blind spot this whole card lives in.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

/**
 * A restart, spelled exactly as `AppPlugin.seedPersistedDisabledPackages`
 * spells it: a registry born empty, seeded from the durable file BEFORE any
 * package registration.
 */
function restart(): { registry: SchemaRegistry; dispatcher: HttpDispatcher } {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.setInitialDisabledPackageIds(loadDisabledPackageIds(undefined));
    return { registry, dispatcher: makeDoor(registry) };
}

const install = (dispatcher: HttpDispatcher, body: unknown) =>
    dispatcher.handlePackages('', 'POST', body, {}, PKG_ADMIN());

const patchLifecycle = (dispatcher: HttpDispatcher, id: string, verb: 'enable' | 'disable') =>
    dispatcher.handlePackages(`${id}/${verb}`, 'PATCH', {}, {}, PKG_ADMIN());

const del = (dispatcher: HttpDispatcher, id: string) =>
    dispatcher.handlePackages(id, 'DELETE', {}, {}, PKG_ADMIN());

/**
 * The context above names no environment, so the handler persists under
 * `undefined` — this read must ask the same question the write answered.
 */
const persistedDisabled = () => loadDisabledPackageIds(undefined);

const envSnapshot = { OS_HOME: process.env.OS_HOME };
let home: string;

beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-18877-'));
    process.env.OS_HOME = home;
});

afterAll(() => {
    if (envSnapshot.OS_HOME === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = envSnapshot.OS_HOME;
    rmSync(home, { recursive: true, force: true });
});

describe('#18877 — the card\'s own scenario, end to end', () => {
    it('seeded → operator enable → flag-absent overwrite: enabled on row, registry, disk AND after a restart', async () => {
        const id = 'com.acme.preserve.scenario';
        const ns = 'preservescenario';

        // ── boot 1 ── the operator disables the package the ordinary way.
        {
            const boot1 = restart();
            const first = await install(boot1.dispatcher, { manifest: manifest(id, ns) });
            expect(first.response?.status).toBe(201);
            const off = await patchLifecycle(boot1.dispatcher, id, 'disable');
            expect(off.response?.status, 'precondition: the disable is accepted').toBe(200);
            expect(persistedDisabled().has(id), 'precondition: the disable reached disk').toBe(true);
        }

        // ── boot 2 ── seeded from disk; the package installs disabled.
        const boot2 = restart();
        const seeded = await install(boot2.dispatcher, { manifest: manifest(id, ns) });
        expect(seeded.response?.body?.data?.enabled, 'precondition: the seed landed it disabled').toBe(false);

        // The operator changes their mind — the most recent explicit action.
        const on = await patchLifecycle(boot2.dispatcher, id, 'enable');
        expect(on.response?.status).toBe(200);
        expect(on.response?.body?.data?.enabled).toBe(true);
        expect(persistedDisabled().has(id), 'precondition: the enable cleared the disk record').toBe(false);

        // ⭐ The measured call: an SDK upgrade. No `enableOnInstall` key at all.
        const upgrade = await install(boot2.dispatcher, { manifest: manifest(id, ns), overwrite: true });

        expect(upgrade.response?.status).toBe(201);
        expect(upgrade.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(true);
        expect(upgrade.response?.body?.data?.status, '`status` is carried over too, not recomputed').toBe('installed');
        expect(boot2.registry.getPackage(id)?.enabled, 'the registry the next read serves from').toBe(true);
        expect(
            persistedDisabled().has(id),
            'the durable state — an install that asked for nothing must not resurrect a revoked disable',
        ).toBe(false);

        // ── boot 3 ── the half the operator actually experiences.
        const boot3 = restart();
        const afterRestart = await install(boot3.dispatcher, { manifest: manifest(id, ns) });
        expect(
            afterRestart.response?.body?.data?.enabled,
            'a restart must replay the operator\'s enable, not the seed it superseded',
        ).toBe(true);
        expect(boot3.registry.getPackage(id)?.enabled).toBe(true);
    });

    it('the mirror: operator DISABLE then a flag-absent overwrite keeps it disabled', async () => {
        // ⛔ The control leg for the case above. Without it 「preserve」 is
        // satisfiable by a door that simply enables everything on install —
        // which is remedy (b), refused by name on #18058.
        const id = 'com.acme.preserve.mirror';
        const ns = 'preservemirror';

        const boot = restart();
        const first = await install(boot.dispatcher, { manifest: manifest(id, ns) });
        expect(first.response?.body?.data?.enabled, 'precondition: a fresh id lands at the declared default').toBe(true);

        const off = await patchLifecycle(boot.dispatcher, id, 'disable');
        expect(off.response?.status).toBe(200);

        const upgrade = await install(boot.dispatcher, { manifest: manifest(id, ns), overwrite: true });
        expect(upgrade.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(false);
        expect(boot.registry.getPackage(id)?.enabled).toBe(false);
        expect(persistedDisabled().has(id), 'the durable state agrees').toBe(true);

        const after = restart();
        const replayed = await install(after.dispatcher, { manifest: manifest(id, ns) });
        expect(replayed.response?.body?.data?.enabled, 'and the restart replays the disable').toBe(false);
    });

    it('a flag-absent overwrite does not restamp `statusChangedAt` — a re-install is not a lifecycle move', async () => {
        const id = 'com.acme.preserve.stamp';
        const ns = 'preservestamp';

        const boot = restart();
        await install(boot.dispatcher, { manifest: manifest(id, ns) });
        const off = await patchLifecycle(boot.dispatcher, id, 'disable');
        const stampedAt = off.response?.body?.data?.statusChangedAt;
        expect(typeof stampedAt, 'precondition: the disable stamped a time').toBe('string');

        const upgrade = await install(boot.dispatcher, { manifest: manifest(id, ns), overwrite: true });
        expect(
            upgrade.response?.body?.data?.statusChangedAt,
            '`statusChangedAt` answers «when did an operator last move this package»',
        ).toBe(stampedAt);
    });
});

describe('#18877 — 「有旗 = 设置」: a PRESENT flag sets the state in both directions', () => {
    it('`enableOnInstall: true` ENABLES an existing disabled row', async () => {
        const id = 'com.acme.setflag.on';
        const ns = 'setflagon';

        const boot = restart();
        await install(boot.dispatcher, { manifest: manifest(id, ns) });
        await patchLifecycle(boot.dispatcher, id, 'disable');
        expect(persistedDisabled().has(id), 'precondition').toBe(true);

        const again = await install(boot.dispatcher, {
            manifest: manifest(id, ns), overwrite: true, enableOnInstall: true,
        });

        expect(again.response?.body?.data?.enabled, 'the row this door RETURNED').toBe(true);
        expect(again.response?.body?.data?.status).toBe('installed');
        expect(boot.registry.getPackage(id)?.enabled).toBe(true);
        expect(persistedDisabled().has(id), 'and the disk followed the row').toBe(false);
    });

    it('`enableOnInstall: false` DISABLES an existing enabled row', async () => {
        const id = 'com.acme.setflag.off';
        const ns = 'setflagoff';

        const boot = restart();
        const first = await install(boot.dispatcher, { manifest: manifest(id, ns) });
        expect(first.response?.body?.data?.enabled, 'precondition').toBe(true);

        const again = await install(boot.dispatcher, {
            manifest: manifest(id, ns), overwrite: true, enableOnInstall: false,
        });

        expect(again.response?.body?.data?.enabled).toBe(false);
        expect(again.response?.body?.data?.status).toBe('disabled');
        expect(boot.registry.getPackage(id)?.enabled).toBe(false);
        expect(persistedDisabled().has(id)).toBe(true);
    });

    it('⛔ the BARE body form still sets nothing — no schema declares the key there', async () => {
        // `PackageInstallBodySchema`'s bare branch is `ManifestSchema`, a strict
        // close with no `enableOnInstall` key. Honouring it here would enforce
        // something no schema declares, so a bare body is always 「缺省」.
        const id = 'com.acme.setflag.bare';
        const ns = 'setflagbare';

        const boot = restart();
        await install(boot.dispatcher, { manifest: manifest(id, ns) });
        await patchLifecycle(boot.dispatcher, id, 'disable');

        const forced = await boot.dispatcher.handlePackages(
            '', 'POST', { ...manifest(id, ns), enableOnInstall: true }, { overwrite: 'true' }, PKG_ADMIN(),
        );

        expect(forced.response?.status).toBe(201);
        expect(forced.response?.body?.data?.enabled, 'the bare key is not read, so this install asked for nothing').toBe(false);
        expect(persistedDisabled().has(id)).toBe(true);
    });
});

describe('#18877 item 3 — DELETE clears the seed entry AND the durable record', () => {
    it('a deleted package leaves no lifecycle state behind, in the same boot', async () => {
        const id = 'com.acme.delete.sameboot';
        const ns = 'deletesameboot';

        // Boot 1 puts the id on disk as disabled; boot 2 is seeded with it.
        {
            const boot1 = restart();
            await install(boot1.dispatcher, { manifest: manifest(id, ns) });
            await patchLifecycle(boot1.dispatcher, id, 'disable');
            expect(persistedDisabled().has(id), 'precondition: the disable reached disk').toBe(true);
        }

        const boot2 = restart();
        const seeded = await install(boot2.dispatcher, { manifest: manifest(id, ns) });
        expect(seeded.response?.body?.data?.enabled, 'precondition: the seed landed it disabled').toBe(false);

        const removed = await del(boot2.dispatcher, id);
        expect(removed.response?.status).toBe(200);
        expect(boot2.registry.getPackage(id), 'the row is gone').toBeUndefined();
        // ⭐ The durable half of «a row that no longer exists has no lifecycle state».
        expect(
            persistedDisabled().has(id),
            'the durable record goes with the row — otherwise it is a disable nobody can see to undo',
        ).toBe(false);

        // ⭐ The seed half: the next install of this id is a FRESH install, even
        // though THIS boot's seed set was born naming it.
        const reinstalled = await install(boot2.dispatcher, { manifest: manifest(id, ns) });
        expect(
            reinstalled.response?.body?.data?.enabled,
            'the boot seed must not outlive the row it was seeded for',
        ).toBe(true);
        expect(persistedDisabled().has(id)).toBe(false);
    });

    it('and the restart agrees: the deleted id does not come back disabled', async () => {
        const id = 'com.acme.delete.restart';
        const ns = 'deleterestart';

        {
            const boot1 = restart();
            await install(boot1.dispatcher, { manifest: manifest(id, ns) });
            await patchLifecycle(boot1.dispatcher, id, 'disable');
        }

        const boot2 = restart();
        await install(boot2.dispatcher, { manifest: manifest(id, ns) });
        const removed = await del(boot2.dispatcher, id);
        expect(removed.response?.status).toBe(200);

        const boot3 = restart();
        const fresh = await install(boot3.dispatcher, { manifest: manifest(id, ns) });
        expect(fresh.response?.body?.data?.enabled, 'a reinstall after a delete lands at the declared default').toBe(true);
    });

    it('⛔ a 404 delete changes no durable state', async () => {
        // The control leg: the clear is written only when the registry really
        // removed a row, so a delete of an id that is not installed cannot
        // quietly re-enable a package an operator disabled.
        const present = 'com.acme.delete.bystander';
        const absent = 'com.acme.delete.nosuch';

        const boot = restart();
        await install(boot.dispatcher, { manifest: manifest(present, 'deletebystander') });
        await patchLifecycle(boot.dispatcher, present, 'disable');
        expect(persistedDisabled().has(present), 'precondition').toBe(true);

        const missing = await del(boot.dispatcher, absent);
        expect(missing.response?.status).toBe(404);
        expect(persistedDisabled().has(present), 'the bystander\'s disable is untouched').toBe(true);
    });
});
