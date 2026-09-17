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
