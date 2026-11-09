// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30072] ADR-0029 D7 — the protocol install primitive refuses
 * `navigationContributions` on a package created at runtime.
 *
 * The primitive's registry write (`SchemaRegistry.installPackage`) registers
 * no contribution, and neither does the `sys_packages` replay at boot: only a
 * code package's `ObjectQL.registerApp` does. So the key was stored, answered
 * success and never applied. Every in-process caller passes here (the HTTP
 * door's composed limb, the duplicate, an embedder), so the gate is on the
 * primitive.
 *
 * Each refusal is pinned by its envelope — what an HTTP boundary answers for
 * the throw (`resolveThrownHttpError`), status AND code — and by the absence of
 * both writes. The lit controls hold the other direction.
 */
import { describe, it, expect, vi } from 'vitest';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { runtimeNavigationContributionsRefusal } from './protocol-package-install.js';

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

const BASE = { id: 'com.example.leave', name: 'Leave', version: '1.0.0', type: 'module' } as const;
const CONTRIBUTION = { app: 'crm_app', group: 'group_sales', items: [{ id: 'nav_leave', type: 'object', label: 'Leave', objectName: 'leave_request' }] };

describe('[#30072] installPackage refuses navigationContributions on a runtime-created package', () => {
    it('refuses a contribution — 400 VALIDATION_ERROR with the prescription, and writes nothing', async () => {
        const { impl, registryCalls, publish } = makeImpl();
        const manifest = { ...BASE, navigationContributions: [CONTRIBUTION] };
        const err = await refusalOf(() => (impl as any).installPackage({ manifest }));
        expect(resolveThrownHttpError(err)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(err.message).toBe(runtimeNavigationContributionsRefusal(manifest));
        // Neither writer ran: not the in-memory registry, not the durable row.
        expect(registryCalls).toHaveLength(0);
        expect(publish).not.toHaveBeenCalled();
    });

    it('the refusal names the key, the package and both routes that work', () => {
        const message = runtimeNavigationContributionsRefusal({ ...BASE, navigationContributions: [CONTRIBUTION] });
        // The sentence is the contract an author (or an AI) repairs from: its
        // first clause names the key and where it is refused.
        expect(message?.startsWith('manifest.navigationContributions is not accepted on a package created at runtime')).toBe(true);
        expect(message).toContain(`'${BASE.id}'`);
        expect(message).toContain('customization package');
        expect(message).toContain('code package');
    });

    it('a malformed manifest keeps the declaration\'s located answer, ahead of this refusal', async () => {
        const { impl, registryCalls } = makeImpl();
        const err = await refusalOf(() => (impl as any).installPackage({
            manifest: { ...BASE, type: 'application', navigationContributions: [CONTRIBUTION] },
        }));
        expect(resolveThrownHttpError(err)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(err.message).toContain('manifest.type');
        expect(registryCalls).toHaveLength(0);
    });

    it('lit control — the same manifest without the key, or with an empty list, installs', async () => {
        const { impl, registryCalls, publish } = makeImpl();
        await (impl as any).installPackage({ manifest: { ...BASE } });
        await (impl as any).installPackage({ manifest: { ...BASE, id: 'com.example.empty', navigationContributions: [] } });
        expect(registryCalls.map((c) => c.manifest.id)).toEqual([BASE.id, 'com.example.empty']);
        expect(publish).toHaveBeenCalledTimes(2);
    });
});
