// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /packages` with `overwrite` — the ADR-0070 D2 read-only rule at the
 * install door (#24030).
 *
 * ## The defect
 *
 * `overwrite` only bypassed the `409 Package '…' already exists`; nothing
 * asked whether the id was a read-only package. An overwrite naming an id that
 * `registerApp` booted (code, or a marketplace install) answered `201` on
 * both limbs and REPLACED the registry row, stamped `source: 'authored'`,
 * while `engine.manifests` still held the id, so the served row read
 * `writable: false`. Disable, publish, revert and delete already refused that
 * same id `422 WRITABLE_PACKAGE_REQUIRED`.
 *
 * ## What is asserted, and why it is not the status alone
 *
 * The harm is the replaced row, so every refusal reads the observables: the
 * registry row is the SAME object it was (the registry's `installPackage`
 * replaces the row object), `engine.manifests` holds the same manifest, and no
 * write was attempted: neither `registry.installPackage` nor, on the protocol
 * limb, `protocol.installPackage` and the `package` service's `publish` (the
 * `sys_packages` write). The engine is a REAL `ObjectQL`: the read-only ids are
 * booted through its own `registerApp`, so `engine.manifests` and each row's
 * `source` are what production stamps. The scope-only id is installed the way
 * `sys_packages` hydration installs a stored row (`source: 'authored'`, no
 * booted manifest), so its refusal can only come from the scope signal.
 *
 * ## Both limbs
 *
 * The door installs through the `protocol` service's `installPackage` when one
 * resolves, and falls back to the bare registry write when none does. Every
 * case runs on both.
 *
 * ## The gate is not an outage
 *
 * CONTROL: an install of a new id (with and without `overwrite`) and an
 * overwrite of an authored package still answer `201` and really write, on the
 * same spies, which is what makes the refusal rows' "nothing was written" a
 * measurement rather than a vacuous truth.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';

/** Booted by the deployment's code: `registerApp`, default source `'code'`. */
const CODE_BOOTED = 'com.acme.codepkg';
/** Installed from the marketplace: `registerApp(…, 'marketplace')`. */
const MARKETPLACE = 'com.acme.marketpkg';
/** A stored row whose manifest declares `scope: 'cloud'`; nothing booted it. */
const CLOUD_SCOPED = 'com.acme.cloudpkg';
/** An org's own base, installed through this door. */
const AUTHORED = 'com.acme.authoredpkg';
/** An id nothing has installed. */
const FRESH = 'com.acme.freshpkg';

const manifest = (id: string, version: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    version,
    type: 'app',
    ...extra,
});

const silentLogger: any = {
    debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {},
    child() { return silentLogger; },
};

type Limb = 'protocol' | 'fallback';
const LIMBS: Limb[] = ['protocol', 'fallback'];

/**
 * The composed door over a real engine. `protocol` resolves the real protocol
 * primitive with a `package` service double standing in for `sys_packages`;
 * `fallback` resolves no protocol service, so the door takes its bare
 * registry write.
 */
function door(limb: Limb) {
    const engine = new ObjectQL({ logger: silentLogger });
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registerApp(manifest(CODE_BOOTED, '1.0.0'));
    engine.registerApp(manifest(MARKETPLACE, '1.0.0'), undefined, 'marketplace');
    engine.registry.installPackage(manifest(CLOUD_SCOPED, '1.0.0', { scope: 'cloud' }) as any, 'authored');

    const packageService = { publish: vi.fn(async () => ({ success: true })) };
    const services = new Map<string, unknown>([['package', packageService]]);
    const protocol = limb === 'protocol'
        ? new ObjectStackProtocolImplementation(engine as any, () => services)
        : null;
    const kernel: any = {
        getService: (name: string) => {
            if (name === 'protocol') return protocol ? Promise.resolve(protocol) : null;
            if (name === 'objectql') return Promise.resolve(engine);
            return null;
        },
        context: { getService: (name: string) => (name === 'objectql' ? engine : null) },
    };
    const registryInstall = vi.spyOn(engine.registry, 'installPackage');
    const protocolInstall = protocol ? vi.spyOn(protocol, 'installPackage') : undefined;
    const manifests = (engine as unknown as { manifests: Map<string, unknown> }).manifests;
    return {
        dispatcher: new HttpDispatcher(kernel),
        engine,
        manifests,
        registryInstall,
        protocolInstall,
        publish: packageService.publish,
    };
}

const ADMIN = (): any => ({
    request: {},
    environmentId: 'pkg-install-overwrite-readonly-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
});

type Door = ReturnType<typeof door>;
const install = (d: Door, body: unknown, query: Record<string, unknown> = {}) =>
    d.dispatcher.handlePackages('', 'POST', body, query, ADMIN());

// The allow path persists enable state under OS_HOME; keep it out of the
// developer's own home.
let home: string;
let priorHome: string | undefined;
beforeAll(() => {
    priorHome = process.env.OS_HOME;
    home = mkdtempSync(join(tmpdir(), 'os-pkg-overwrite-readonly-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    if (priorHome === undefined) delete process.env.OS_HOME;
    else process.env.OS_HOME = priorHome;
    rmSync(home, { recursive: true, force: true });
});

/** The refusal's envelope, and that nothing on either limb was written. */
function expectRefusedUnwritten(d: Door, r: any, id: string) {
    expect(r.response?.status).toBe(422);
    expect(r.response?.body?.success).toBe(false);
    expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
    expect(r.response?.body?.error?.httpStatus).toBe(422);
    expect(r.response?.body?.error?.details?.packageId).toBe(id);
    expect(d.registryInstall).not.toHaveBeenCalled();
    if (d.protocolInstall) expect(d.protocolInstall).not.toHaveBeenCalled();
    expect(d.publish).not.toHaveBeenCalled();
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. REFUSED: an overwrite over a read-only id, on both limbs
// ══════════════════════════════════════════════════════════════════════════════

const READ_ONLY: Array<{ label: string; id: string; source: string; booted: boolean }> = [
    { label: 'code-booted (registerApp)', id: CODE_BOOTED, source: 'code', booted: true },
    { label: 'marketplace-installed (registerApp, marketplace)', id: MARKETPLACE, source: 'marketplace', booted: true },
    { label: 'cloud-scoped stored row (scope signal only)', id: CLOUD_SCOPED, source: 'authored', booted: false },
];

for (const limb of LIMBS) {
    describe(`POST /packages overwrite over a read-only id is refused (${limb} limb)`, () => {
        for (const pkg of READ_ONLY) {
            it(`422s the overwrite of the ${pkg.label} package and leaves its row and manifest as they were`, async () => {
                const d = door(limb);
                const rowBefore = d.engine.registry.getPackage(pkg.id);
                const manifestBefore = d.manifests.get(pkg.id);
                expect(rowBefore?.manifest?.version, 'precondition: the booted row').toBe('1.0.0');
                expect(d.manifests.has(pkg.id), 'precondition: the boot signal').toBe(pkg.booted);

                const r = await install(d, { manifest: manifest(pkg.id, '2.0.0'), overwrite: true });

                expectRefusedUnwritten(d, r, pkg.id);
                expect(d.engine.registry.getPackage(pkg.id)).toBe(rowBefore);
                expect(d.engine.registry.getPackage(pkg.id)?.manifest?.version).toBe('1.0.0');
                expect(d.engine.registry.getPackage(pkg.id)?.source).toBe(pkg.source);
                expect(d.manifests.get(pkg.id)).toBe(manifestBefore);
                expect(d.manifests.has(pkg.id)).toBe(pkg.booted);
            });
        }

        it('refuses the `?overwrite=true` query spelling the same way', async () => {
            const d = door(limb);
            const rowBefore = d.engine.registry.getPackage(CODE_BOOTED);

            const r = await install(d, { manifest: manifest(CODE_BOOTED, '2.0.0') }, { overwrite: 'true' });

            expectRefusedUnwritten(d, r, CODE_BOOTED);
            expect(d.engine.registry.getPackage(CODE_BOOTED)).toBe(rowBefore);
            expect(d.manifests.has(CODE_BOOTED)).toBe(true);
        });

        it('keeps the 409 for an install over a read-only id that does not ask to overwrite', async () => {
            const d = door(limb);
            const rowBefore = d.engine.registry.getPackage(CODE_BOOTED);

            const r = await install(d, { manifest: manifest(CODE_BOOTED, '2.0.0') });

            expect(r.response?.status).toBe(409);
            expect(d.registryInstall).not.toHaveBeenCalled();
            expect(d.publish).not.toHaveBeenCalled();
            expect(d.engine.registry.getPackage(CODE_BOOTED)).toBe(rowBefore);
        });
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. CONTROL: the gate is not an outage
// ══════════════════════════════════════════════════════════════════════════════

for (const limb of LIMBS) {
    describe(`POST /packages still installs and overwrites what an org owns (${limb} limb)`, () => {
        it('installs a new id: 201, and the row is written', async () => {
            const d = door(limb);

            const r = await install(d, { manifest: manifest(FRESH, '1.0.0') });

            expect(r.response?.status).toBe(201);
            expect(d.registryInstall).toHaveBeenCalledTimes(1);
            expect(d.engine.registry.getPackage(FRESH)?.source).toBe('authored');
            if (limb === 'protocol') expect(d.publish).toHaveBeenCalledTimes(1);
        });

        it('installs a new id with `overwrite: true` set: nothing to overwrite, still 201', async () => {
            const d = door(limb);

            const r = await install(d, { manifest: manifest(FRESH, '1.0.0'), overwrite: true });

            expect(r.response?.status).toBe(201);
            expect(d.registryInstall).toHaveBeenCalledTimes(1);
            expect(d.engine.registry.getPackage(FRESH)?.manifest?.version).toBe('1.0.0');
            if (limb === 'protocol') expect(d.publish).toHaveBeenCalledTimes(1);
        });

        it('overwrites an authored base: 201, and the row is replaced', async () => {
            const d = door(limb);
            const first = await install(d, { manifest: manifest(AUTHORED, '1.0.0') });
            expect(first.response?.status, 'precondition: the base is installed').toBe(201);
            const rowBefore = d.engine.registry.getPackage(AUTHORED);

            const r = await install(d, { manifest: manifest(AUTHORED, '2.0.0'), overwrite: true });

            expect(r.response?.status).toBe(201);
            expect(d.registryInstall).toHaveBeenCalledTimes(2);
            expect(d.engine.registry.getPackage(AUTHORED)).not.toBe(rowBefore);
            expect(d.engine.registry.getPackage(AUTHORED)?.manifest?.version).toBe('2.0.0');
            expect(d.engine.registry.getPackage(AUTHORED)?.source).toBe('authored');
            if (limb === 'protocol') {
                expect(d.protocolInstall).toHaveBeenCalledTimes(2);
                expect(d.publish).toHaveBeenCalledTimes(2);
            }
        });
    });
}
