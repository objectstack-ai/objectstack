// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24086] The protocol install primitive judges the WHOLE manifest by the
 * install door's declaration, `PackageInstallManifestSchema`.
 *
 * `installPackage` parsed only the `id` leg, so an in-process caller stored what
 * `POST /api/v1/packages` answers `400 VALIDATION_ERROR` for: an off-spec
 * `type` (`'application'`), an off-spec `scope` (`'environment'`), a platform
 * scope (`'cloud'` / `'system'`, which that declaration narrows away from
 * `ManifestSchema`), a missing `type`, an unknown key.
 *
 * Every refusal is pinned by its envelope — what an HTTP boundary answers for
 * the throw (`resolveThrownHttpError`), status AND code — by the key path it
 * names, and by the absence of both writes. The lit controls hold the other
 * direction: the versionless manifest the primitive has completed since #2532
 * still installs, and the gate stores the manifest as sent, not the parse's
 * defaulted copy.
 */
import { describe, it, expect, vi } from 'vitest';
import { manifestIdRefusal } from '@objectstack/spec/kernel';
import { packageInstallScopeRefusal } from '@objectstack/spec/api';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';

function makeImpl() {
    const registryCalls: Array<{ manifest: any }> = [];
    const engine = {
        registry: {
            installPackage: (manifest: any) => {
                registryCalls.push({ manifest });
                return { manifest, status: 'installed', enabled: true };
            },
        },
        find: async () => [],
    };
    const publish = vi.fn(async () => ({ success: true }));
    const services = new Map<string, any>([['package', { publish }]]);
    const impl = new ObjectStackProtocolImplementation(engine as never, () => services);
    return { impl, registryCalls, publish };
}

/** The thrown refusal, or a failure naming what happened instead. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

const BASE = { id: 'com.example.leave', name: 'Leave', version: '1.0.0', type: 'app' } as const;

/** Manifests the door's declaration refuses, with the key path the refusal names. */
const REFUSED: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
    ["an off-spec type 'application' (cloud's AI authoring)", { ...BASE, type: 'application' }, 'manifest.type'],
    ["an off-spec scope 'environment' (cloud's AI authoring)", { ...BASE, scope: 'environment' }, 'manifest.scope'],
    ["the platform scope 'cloud', which the install declaration narrows away", { ...BASE, scope: 'cloud' }, 'manifest.scope'],
    ["the platform scope 'system'", { ...BASE, scope: 'system' }, 'manifest.scope'],
    ['a manifest with no type at all', { id: BASE.id, name: BASE.name, version: BASE.version }, 'manifest.type'],
    ['an unknown key (a metadata collection on the manifest)', { ...BASE, pages: [] }, 'manifest'],
];

describe('[#24086] installPackage judges the whole manifest by PackageInstallManifestSchema', () => {
    for (const [why, manifest, path] of REFUSED) {
        it(`refuses ${why} — 400 VALIDATION_ERROR naming ${path}, and writes nothing`, async () => {
            const { impl, registryCalls, publish } = makeImpl();
            const err = await refusalOf(() => (impl as any).installPackage({ manifest }));
            // What an HTTP boundary answers for this throw — the door's envelope.
            expect(resolveThrownHttpError(err)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
            expect(err.message).toContain(`${path}`);
            // Neither writer ran: not the in-memory registry, not the durable row.
            expect(registryCalls).toHaveLength(0);
            expect(publish).not.toHaveBeenCalled();
        });
    }

    it("surfaces the declaration's own sentence for a platform scope, not a reworded one", async () => {
        const { impl } = makeImpl();
        const err = await refusalOf(() => (impl as any).installPackage({ manifest: { ...BASE, scope: 'cloud' } }));
        expect(err.message).toContain(`manifest.scope: ${packageInstallScopeRefusal('cloud')}`);
    });

    it('the id leg still answers first, with its own sentence and repair', async () => {
        const { impl } = makeImpl();
        const err = await refusalOf(() => (impl as any).installPackage({
            manifest: { ...BASE, id: 'com.example.my_erp', type: 'application' },
        }));
        expect(resolveThrownHttpError(err)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(err.message).toBe(manifestIdRefusal('manifest.id', 'com.example.my_erp'));
    });

    it('lit control — a VERSIONLESS manifest still installs with the defaulted version (#2532)', async () => {
        const { impl, registryCalls, publish } = makeImpl();
        const res: any = await (impl as any).installPackage({
            manifest: { id: BASE.id, name: BASE.name, type: 'app' },
        });
        expect(res.package.status).toBe('installed');
        expect(registryCalls).toHaveLength(1);
        expect(registryCalls[0].manifest).toMatchObject({ id: BASE.id, version: '0.1.0', namespace: 'leave' });
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it("lit control — scope 'project' installs, and the gate stores the manifest as SENT (no parse defaults)", async () => {
        const { impl, registryCalls } = makeImpl();
        await (impl as any).installPackage({ manifest: { ...BASE, scope: 'project' } });
        expect(registryCalls[0].manifest.scope).toBe('project');

        const plain = makeImpl();
        await (plain.impl as any).installPackage({ manifest: { ...BASE } });
        // `PackageInstallManifestSchema` defaults `scope` and `defaultDatasource`;
        // neither is copied onto what is stored.
        expect(plain.registryCalls[0].manifest).not.toHaveProperty('scope');
        expect(plain.registryCalls[0].manifest).not.toHaveProperty('defaultDatasource');
    });
});
