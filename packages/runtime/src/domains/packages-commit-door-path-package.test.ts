// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0067 — the per-commit revert and the rollback act only on a commit of
 * the package their path names.
 *
 * Measured before this change: `POST /packages/B/commits/COMMIT_OF_A/revert`
 * handed the protocol only the commit id, so it answered 200 and reverted
 * package A; `POST /packages/B/rollback` with `{ commitId: COMMIT_OF_A }` did
 * the same through A's timeline. Both doors now hand the protocol the path's
 * package (`packageId`), whose `COMMIT_NOT_FOUND` the door relays as 404, and
 * answer an unknown package id with the sibling doors' 404 before the
 * protocol is called. The protocol's own refusal is pinned in
 * `packages/objectql/src/protocol-commit-history.test.ts`; the live wire in
 * `packages/qa/dogfood/test/package-commit-revert-path-package.dogfood.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.app';
const ADMIN = { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };

function commitNotFound(commitId: string, packageId: string) {
    const err: any = new Error(`No commit '${commitId}' in package '${packageId}'.`);
    err.code = 'COMMIT_NOT_FOUND';
    err.status = 404;
    return err;
}

/** The dispatcher over a real registry holding one writable package, and a recording protocol. */
function boot() {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, name: PKG, namespace: 'app', version: '1.0.0', type: 'app' } as any, 'authored');
    const protocol = {
        revertCommit: vi.fn(async (r: any) => {
            if (r.commitId === 'c_other') throw commitNotFound(r.commitId, r.packageId);
            return { success: true, revertedCount: 1, failedCount: 0, reverted: [], failed: [] };
        }),
        rollbackToPackageCommit: vi.fn(async (r: any) => {
            if (r.commitId === 'c_other') throw commitNotFound(r.commitId, r.packageId);
            return { success: true, revertedCommits: [], failed: [] };
        }),
    };
    const services: Record<string, unknown> = { objectql: { registry }, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get, trigger: vi.fn() }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...ADMIN });
    return { dispatcher, protocol };
}

const DOORS = [
    { door: 'POST /packages/:id/commits/:c/revert', act: 'revertCommit' as const, call: (pkg: string, c: string) => [`/packages/${pkg}/commits/${c}/revert`, {}] as const },
    { door: 'POST /packages/:id/rollback', act: 'rollbackToPackageCommit' as const, call: (pkg: string, c: string) => [`/packages/${pkg}/rollback`, { commitId: c }] as const },
];

async function post(door: (typeof DOORS)[number], pkg: string, commitId: string) {
    const { dispatcher, protocol } = boot();
    const [path, body] = door.call(pkg, commitId);
    const res = await dispatcher.dispatch('POST', path, body, {}, { request: { headers: {} } } as any);
    return { status: res.response?.status ?? 0, body: res.response?.body as any, spy: protocol[door.act] };
}

describe.each(DOORS)('$door — the path\'s package decides', (door) => {
    it('hands the protocol the path\'s package with the commit id', async () => {
        const { status, spy } = await post(door, PKG, 'c_1');
        expect(status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy.mock.calls[0][0]).toMatchObject({ commitId: 'c_1', packageId: PKG });
    });

    it('relays the protocol\'s COMMIT_NOT_FOUND for a commit of another package as 404', async () => {
        const { status, body } = await post(door, PKG, 'c_other');
        expect(status).toBe(404);
        expect(JSON.stringify(body)).toContain('COMMIT_NOT_FOUND');
        expect(JSON.stringify(body)).toContain(`No commit 'c_other' in package '${PKG}'.`);
    });

    it('answers an unknown package id 404 without calling the protocol', async () => {
        const { status, body, spy } = await post(door, 'com.acme.nosuch', 'c_1');
        expect(status).toBe(404);
        expect(JSON.stringify(body)).toContain("Package 'com.acme.nosuch' not found");
        expect(spy).not.toHaveBeenCalled();
    });
});
