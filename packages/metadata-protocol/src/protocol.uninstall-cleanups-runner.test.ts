// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21490 — `runUninstallCleanups` is the ONE runner of the uninstall-cleanup
 * registry (`registerUninstallCleanup`, ADR-0086 D3): `deletePackage` calls it
 * as its last step, and install-local's uninstall door
 * (`DELETE /api/v1/marketplace/install-local/:manifestId`, in
 * `@objectstack/cloud-connection`) calls it after its own ledger removal, so
 * the same cleanups fire on both doors and neither keeps a second revocation
 * path.
 *
 * What this file pins:
 *   - every registered cleanup runs once, with the package id and exactly the
 *     organization / actor the request carried, and each outcome is reported;
 *   - a cleanup's failure is an outcome, never a throw: a returned
 *     `success: false` keeps its own error, a thrown undeclared fault is
 *     reported with the withheld fallback sentence, never its driver text;
 *   - the control: `deletePackage` reports exactly what the runner returned,
 *     having called it once with its own request.
 *
 * End to end — the rows themselves, before and after a restart — lives in the
 * CLI suite `package-install-local-uninstall-cleanups.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './index.js';

const PACKAGE_ID = 'com.example.tasksapp';

function makeProtocol() {
    const engine = {
        registry: {
            assertPackageUninstallable: () => undefined,
            uninstallPackage: () => true,
        },
        find: async () => [],
    };
    const services = new Map<string, unknown>([
        ['package', { delete: async () => ({ success: true }) }],
    ]);
    return new ObjectStackProtocolImplementation(engine as never, () => services as never);
}

describe('#21490: runUninstallCleanups — the uninstall-cleanup registry\'s one runner', () => {
    it('runs every registered cleanup once, with the package id, organization and actor it was given, and reports each outcome', async () => {
        const protocol = makeProtocol();
        const first = vi.fn(async () => ({ success: true, removed: 3 }));
        const second = vi.fn(async () => ({ success: true, removed: 0 }));
        protocol.registerUninstallCleanup('security.package-permissions', first);
        protocol.registerUninstallCleanup('another.cleanup', second);

        const outcomes = await protocol.runUninstallCleanups({ packageId: PACKAGE_ID, organizationId: 'org_1', actor: 'usr_1' });

        expect(first.mock.calls).toEqual([[{ packageId: PACKAGE_ID, organizationId: 'org_1', actor: 'usr_1' }]]);
        expect(second.mock.calls).toEqual([[{ packageId: PACKAGE_ID, organizationId: 'org_1', actor: 'usr_1' }]]);
        expect(outcomes).toEqual([
            { name: 'security.package-permissions', success: true, removed: 3 },
            { name: 'another.cleanup', success: true, removed: 0 },
        ]);
    });

    it('passes no organization and no actor when the request carries none — an installation-wide uninstall', async () => {
        const protocol = makeProtocol();
        const cleanup = vi.fn(async () => ({ success: true, removed: 1 }));
        protocol.registerUninstallCleanup('security.package-permissions', cleanup);

        await protocol.runUninstallCleanups({ packageId: PACKAGE_ID });

        expect(cleanup.mock.calls).toEqual([[{ packageId: PACKAGE_ID }]]);
    });

    it('a failed cleanup is an outcome, never a throw — and the rest still run', async () => {
        const protocol = makeProtocol();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        protocol.registerUninstallCleanup('returns.failure', async () => ({ success: false, removed: 0, error: 'refused by the store' }));
        protocol.registerUninstallCleanup('throws.fault', async () => { throw new Error('SQLITE_ERROR: no such table: sys_permission_set'); });
        const last = vi.fn(async () => ({ success: true, removed: 2 }));
        protocol.registerUninstallCleanup('still.runs', last);

        const outcomes = await protocol.runUninstallCleanups({ packageId: PACKAGE_ID });

        expect(outcomes).toEqual([
            { name: 'returns.failure', success: false, removed: 0, error: 'refused by the store' },
            { name: 'throws.fault', success: false, removed: 0, error: 'cleanup failed' },
            { name: 'still.runs', success: true, removed: 2 },
        ]);
        expect(last).toHaveBeenCalledTimes(1);
        // The driver text goes to the operator log, never into the outcome.
        expect(JSON.stringify(outcomes)).not.toContain('SQLITE_ERROR');
        expect(warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('throws.fault') && m.includes(PACKAGE_ID))).toHaveLength(1);
        warn.mockRestore();
    });

    it('control: deletePackage calls the runner once with its own request and reports exactly its outcomes', async () => {
        const protocol = makeProtocol();
        protocol.registerUninstallCleanup('security.package-permissions', async () => ({ success: true, removed: 4 }));
        const runner = vi.spyOn(protocol, 'runUninstallCleanups');
        const request = { packageId: PACKAGE_ID, allTenants: true as const, actor: 'usr_1' };

        const res = await protocol.deletePackage(request);

        expect(runner.mock.calls).toEqual([[request]]);
        expect(res.cleanups).toEqual(await runner.mock.results[0]!.value);
        expect(res.cleanups).toEqual([{ name: 'security.package-permissions', success: true, removed: 4 }]);
    });
});
