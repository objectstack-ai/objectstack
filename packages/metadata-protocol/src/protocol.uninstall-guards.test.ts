// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31232 — the pre-uninstall guard registry (`registerUninstallGuard`), the
 * before-half of the uninstall-cleanup registry: `deletePackage` asks every
 * registered guard, in registration order, before it reads or moves anything,
 * and throws the first refusal as its own. The runtime registers the package
 * doors' dependent-rule verdict here, so every in-process caller of the verb is
 * refused on it; that end-to-end half lives in the runtime's shared
 * dependent-rule harness (`packages-disable-module-extension-fields.test.ts`).
 *
 * What this file pins, on a protocol over an engine double:
 *   - a refusing guard: the verb rejects with the guard's `code`, `status` and
 *     `message`, and nothing was read or moved — no `sys_metadata` read, no
 *     store delete, no registry withdrawal, no cleanup;
 *   - each guard is handed the package id and exactly the actor the request
 *     carried; the first refusal wins and later guards are not asked;
 *   - a guard's own throw propagates as is, with nothing moved;
 *   - CONTROL: guards that answer nothing let the uninstall proceed as before;
 *   - CONTROL: a bare protocol (no guard registered) uninstalls as before.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './index.js';

const PACKAGE_ID = 'com.example.tasksapp';
const CODE = 'PACKAGE_DISABLE_RESTRICTED_BY_VALIDATION_RULE';

function makeProtocol() {
    const registry = {
        assertPackageUninstallable: vi.fn(() => undefined),
        uninstallPackage: vi.fn(() => true),
    };
    const engine = { registry, find: vi.fn(async () => []) };
    const store = { delete: vi.fn(async () => ({ success: true })) };
    const services = new Map<string, unknown>([['package', store]]);
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as never);
    const cleanup = vi.fn(async () => ({ success: true, removed: 0 }));
    protocol.registerUninstallCleanup('qa.cleanup', cleanup);
    return { protocol, engine, registry, store, cleanup };
}

/** Every step of the verb that reads or moves something, as the double saw it. */
function touched(rig: ReturnType<typeof makeProtocol>) {
    return {
        read: rig.engine.find.mock.calls.length,
        asked: rig.registry.assertPackageUninstallable.mock.calls.length,
        stored: rig.store.delete.mock.calls.length,
        withdrawn: rig.registry.uninstallPackage.mock.calls.length,
        cleaned: rig.cleanup.mock.calls.length,
    };
}
const NOTHING = { read: 0, asked: 0, stored: 0, withdrawn: 0, cleaned: 0 };

describe('#31232: deletePackage asks every registered pre-uninstall guard before anything moves', () => {
    it('a refusing guard\'s code, status and message are the verb\'s refusal, and nothing is read or moved', async () => {
        const rig = makeProtocol();
        const message = `Package '${PACKAGE_ID}' cannot be uninstalled: a rule reads its field.`;
        rig.protocol.registerUninstallGuard('qa.refuses', () => ({ code: CODE, status: 409, message }));

        const refused = await rig.protocol.deletePackage({ packageId: PACKAGE_ID }).then(
            () => { throw new Error('the uninstall was not refused'); },
            (e: any) => e,
        );

        expect({ code: refused.code, status: refused.status, message: refused.message }).toEqual({ code: CODE, status: 409, message });
        expect(touched(rig)).toEqual(NOTHING);
    });

    it('hands each guard the package id and the request\'s actor; the first refusal wins and later guards are not asked', async () => {
        const rig = makeProtocol();
        const passes = vi.fn(async () => undefined);
        const refuses = vi.fn(async () => ({ code: CODE, status: 409, message: 'first' }));
        const later = vi.fn(() => ({ code: 'RESOURCE_CONFLICT', status: 409, message: 'second' }));
        rig.protocol.registerUninstallGuard('qa.passes', passes);
        rig.protocol.registerUninstallGuard('qa.refuses', refuses);
        rig.protocol.registerUninstallGuard('qa.later', later);

        await expect(rig.protocol.deletePackage({ packageId: PACKAGE_ID, actor: 'usr_1', keepData: true }))
            .rejects.toMatchObject({ code: CODE, status: 409, message: 'first' });

        expect(passes.mock.calls).toEqual([[{ packageId: PACKAGE_ID, actor: 'usr_1' }]]);
        expect(refuses.mock.calls).toEqual([[{ packageId: PACKAGE_ID, actor: 'usr_1' }]]);
        expect(later).not.toHaveBeenCalled();
        expect(touched(rig)).toEqual(NOTHING);
    });

    it('a guard that throws refuses with its throw, and nothing is read or moved', async () => {
        const rig = makeProtocol();
        const fault = Object.assign(new Error('the registry could not be read'), { code: 'INTERNAL_ERROR' });
        rig.protocol.registerUninstallGuard('qa.throws', () => { throw fault; });

        await expect(rig.protocol.deletePackage({ packageId: PACKAGE_ID })).rejects.toBe(fault);
        expect(touched(rig)).toEqual(NOTHING);
    });

    it('a second registration under a name replaces the first', async () => {
        const rig = makeProtocol();
        rig.protocol.registerUninstallGuard('qa.guard', () => ({ code: CODE, status: 409, message: 'replaced' }));
        const replacement = vi.fn(() => undefined);
        rig.protocol.registerUninstallGuard('qa.guard', replacement);

        await rig.protocol.deletePackage({ packageId: PACKAGE_ID });

        expect(replacement).toHaveBeenCalledTimes(1);
        expect(rig.store.delete).toHaveBeenCalledTimes(1);
    });

    it('control: guards that answer nothing let the uninstall proceed through every step, once each', async () => {
        const rig = makeProtocol();
        const guard = vi.fn(() => undefined);
        rig.protocol.registerUninstallGuard('qa.passes', guard);

        const res = await rig.protocol.deletePackage({ packageId: PACKAGE_ID });

        expect(guard.mock.calls).toEqual([[{ packageId: PACKAGE_ID }]]);
        expect(touched(rig)).toEqual({ read: 1, asked: 1, stored: 1, withdrawn: 1, cleaned: 1 });
        expect(res.cleanups).toEqual([{ name: 'qa.cleanup', success: true, removed: 0 }]);
    });

    it('control: a bare protocol, no guard registered, uninstalls exactly as before', async () => {
        const rig = makeProtocol();

        const res = await rig.protocol.deletePackage({ packageId: PACKAGE_ID });

        expect(touched(rig)).toEqual({ read: 1, asked: 1, stored: 1, withdrawn: 1, cleaned: 1 });
        expect(rig.store.delete.mock.calls).toEqual([[PACKAGE_ID]]);
        expect(rig.registry.uninstallPackage.mock.calls).toEqual([[PACKAGE_ID]]);
        expect(res).toMatchObject({ success: false, deletedCount: 0, failedCount: 0 });
    });
});
