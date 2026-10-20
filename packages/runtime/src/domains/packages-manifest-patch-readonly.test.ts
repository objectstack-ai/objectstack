// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PATCH /packages/:id` — the ADR-0070 D2 read-only rule at the manifest-edit
 * door (#24705).
 *
 * ## The defect
 *
 * The arm asked `requireManageMetadata` and the walled refusal, and nothing
 * else, so a `manage_metadata` holder could edit the manifest of a package the
 * deployment ships: `{ description }` on a package whose manifest declares
 * `scope: 'system'` answered `200` and edited it, and with a `package` service
 * composed the edited manifest was re-persisted to `sys_packages`. Every other
 * state-changing arm on the domain — install-overwrite, disable, publish,
 * revert and delete — refuses that same id `422 WRITABLE_PACKAGE_REQUIRED`.
 *
 * ## What is asserted, and why it is not the status alone
 *
 * The harm is the edited manifest and its persisted row, so every refusal
 * reads the observables: the registry row's content is what it was (the
 * registry's `updatePackageManifest` edits the row IN PLACE, so the snapshot is
 * taken by value), `updatePackageManifest` was never called, and on the
 * protocol limb neither `protocol.updatePackage` nor the `package` service's
 * `publish` (the `sys_packages` write) ran. The engine is a REAL `ObjectQL`:
 * the code-booted and marketplace ids are booted through its own `registerApp`,
 * and the two scope-only ids are installed the way `sys_packages` hydration
 * installs a stored row (`source: 'authored'`, no booted manifest), so their
 * refusal can only come from the scope signal.
 *
 * ## The gate precedes the body
 *
 * The refusal is the whole arm's, asked before the body is read, so it is the
 * same answer whatever keys the body carries: an editable key, `dependencies`,
 * the `{ manifest }` wrapper, and a body the arm would itself refuse `400`.
 *
 * ## The gate is not an outage
 *
 * CONTROL: a writable package still edits (`200`, and the row and
 * `sys_packages` really move, on the same spies), its body checks still answer
 * `400`, and an id nothing installed still answers the arm's own `404` — the
 * predicate treats an unknown id as writable, so the gate never re-labels it.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { HttpDispatcher } from '../http-dispatcher.js';

/** Booted by the deployment's code: `registerApp`, default source `'code'`. */
const CODE_BOOTED = 'com.acme.codepkg';
/** Installed from the marketplace: `registerApp(…, 'marketplace')`. */
const MARKETPLACE = 'com.acme.marketpkg';
/** A stored row whose manifest declares `scope: 'system'`; nothing booted it. */
const SYSTEM_SCOPED = 'com.acme.systempkg';
/** A stored row whose manifest declares `scope: 'cloud'`; nothing booted it. */
const CLOUD_SCOPED = 'com.acme.cloudpkg';
/** An org's own base. */
const AUTHORED = 'com.acme.authoredpkg';
/** An id nothing has installed. */
const UNKNOWN = 'com.acme.nopkg';

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    version: '1.0.0',
    description: 'as shipped',
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
 * registry edit.
 */
function door(limb: Limb) {
    const engine = new ObjectQL({ logger: silentLogger });
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    engine.registerApp(manifest(CODE_BOOTED));
    engine.registerApp(manifest(MARKETPLACE), undefined, 'marketplace');
    engine.registry.installPackage(manifest(SYSTEM_SCOPED, { scope: 'system' }) as any, 'authored');
    engine.registry.installPackage(manifest(CLOUD_SCOPED, { scope: 'cloud' }) as any, 'authored');
    engine.registry.installPackage(manifest(AUTHORED, { scope: 'project' }) as any, 'authored');

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
    const registryEdit = vi.spyOn(engine.registry, 'updatePackageManifest');
    const protocolEdit = protocol ? vi.spyOn(protocol, 'updatePackage') : undefined;
    return {
        dispatcher: new HttpDispatcher(kernel),
        engine,
        registryEdit,
        protocolEdit,
        publish: packageService.publish,
    };
}

const ADMIN = (): any => ({
    request: {},
    environmentId: 'pkg-manifest-patch-readonly-test',
    executionContext: {
        userId: 'u_pkg_admin',
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
    },
});

type Door = ReturnType<typeof door>;
const patch = (d: Door, id: string, body: unknown) =>
    d.dispatcher.handlePackages(`/${encodeURIComponent(id)}`, 'PATCH', body, {}, ADMIN());

/** The row by value: `updatePackageManifest` edits the row object in place. */
const snapshot = (d: Door, id: string) => JSON.parse(JSON.stringify(d.engine.registry.getPackage(id) ?? null));

// ══════════════════════════════════════════════════════════════════════════════
// 1. REFUSED: a read-only package's manifest, on both limbs, whatever the body
// ══════════════════════════════════════════════════════════════════════════════

const READ_ONLY: Array<{ label: string; id: string; booted: boolean }> = [
    { label: 'code-booted (registerApp)', id: CODE_BOOTED, booted: true },
    { label: 'marketplace-installed (registerApp, marketplace)', id: MARKETPLACE, booted: true },
    { label: 'system-scoped stored row (scope signal only)', id: SYSTEM_SCOPED, booted: false },
    { label: 'cloud-scoped stored row (scope signal only)', id: CLOUD_SCOPED, booted: false },
];

const BODIES: Array<{ label: string; body: unknown }> = [
    { label: '{ description }', body: { description: 'edited over the API' } },
    { label: '{ dependencies }', body: { dependencies: {} } },
    { label: 'the { manifest } wrapper', body: { manifest: { name: 'Renamed', version: '2.0.0' } } },
    { label: 'an empty body (the arm\'s own 400 sits behind the gate)', body: {} },
];

for (const limb of LIMBS) {
    describe(`PATCH /packages/:id on a read-only package is refused (${limb} limb)`, () => {
        for (const pkg of READ_ONLY) {
            for (const b of BODIES) {
                it(`422s ${b.label} on the ${pkg.label} package and writes nothing`, async () => {
                    const d = door(limb);
                    const before = snapshot(d, pkg.id);
                    expect(before?.manifest?.description, 'precondition: the shipped row').toBe('as shipped');
                    expect((d.engine as unknown as { manifests: Map<string, unknown> }).manifests.has(pkg.id),
                        'precondition: the boot signal').toBe(pkg.booted);

                    const r = await patch(d, pkg.id, b.body);

                    expect(r.response?.status).toBe(422);
                    expect(r.response?.body?.success).toBe(false);
                    expect(r.response?.body?.error?.code).toBe('WRITABLE_PACKAGE_REQUIRED');
                    expect(r.response?.body?.error?.httpStatus).toBe(422);
                    expect(r.response?.body?.error?.details?.packageId).toBe(pkg.id);
                    expect(r.response?.body?.error?.details?.docs).toBe('docs/adr/0070-package-first-authoring.md');
                    // Neither the registry nor `sys_packages` moved.
                    expect(snapshot(d, pkg.id)).toEqual(before);
                    expect(d.registryEdit).not.toHaveBeenCalled();
                    if (d.protocolEdit) expect(d.protocolEdit).not.toHaveBeenCalled();
                    expect(d.publish).not.toHaveBeenCalled();
                });
            }
        }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. CONTROL: the gate is not an outage
// ══════════════════════════════════════════════════════════════════════════════

for (const limb of LIMBS) {
    describe(`PATCH /packages/:id still edits what an org owns (${limb} limb)`, () => {
        it('edits a writable package: 200, and the row (and sys_packages) really move', async () => {
            const d = door(limb);

            const r = await patch(d, AUTHORED, { description: 'edited by its owner', version: '1.1.0' });

            expect(r.response?.status).toBe(200);
            expect(d.registryEdit).toHaveBeenCalledTimes(1);
            expect(d.engine.registry.getPackage(AUTHORED)?.manifest?.description).toBe('edited by its owner');
            expect(d.engine.registry.getPackage(AUTHORED)?.manifest?.version).toBe('1.1.0');
            if (limb === 'protocol') {
                expect(d.protocolEdit).toHaveBeenCalledTimes(1);
                expect(d.publish).toHaveBeenCalledTimes(1);
            }
        });

        it('a writable package still reaches the body checks: an empty body answers 400 and writes nothing', async () => {
            const d = door(limb);
            const before = snapshot(d, AUTHORED);

            const r = await patch(d, AUTHORED, {});

            expect(r.response?.status).toBe(400);
            expect(r.response?.body?.error?.code).not.toBe('WRITABLE_PACKAGE_REQUIRED');
            expect(snapshot(d, AUTHORED)).toEqual(before);
            expect(d.registryEdit).not.toHaveBeenCalled();
            expect(d.publish).not.toHaveBeenCalled();
        });

        it('an id nothing installed keeps the arm\'s own 404 — the gate is no existence oracle', async () => {
            const d = door(limb);
            expect(d.engine.registry.getPackage(UNKNOWN), 'precondition: nothing installed it').toBeUndefined();

            const r = await patch(d, UNKNOWN, { description: 'x' });

            expect(r.response?.status).toBe(404);
            expect(r.response?.body?.error?.code).not.toBe('WRITABLE_PACKAGE_REQUIRED');
            // It reached the edit, which is where the 404 comes from.
            expect(d.registryEdit).toHaveBeenCalledTimes(1);
            expect(d.publish).not.toHaveBeenCalled();
        });
    });
}
