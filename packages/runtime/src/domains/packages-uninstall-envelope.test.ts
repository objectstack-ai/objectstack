// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7557 (B, envelope half) — `DELETE /packages/:id` must not wrap a failed
 * uninstall in a 200.
 *
 * Reproduced on `origin/main` against a real running server (dev showcase app,
 * a runtime-installed package with three package-bound `sys_metadata` rows):
 *
 *   DELETE /api/v1/packages/com.repro.b
 *     -> HTTP 200
 *        { "success": true,
 *          "data": { "success": true, "registryRemoved": true,
 *                    "persisted": { "success": false, "deletedCount": 0,
 *                                   "failedCount": 0, … } } }
 *   …and the three `sys_metadata` rows were still there afterwards.
 *
 * Two independent problems live in that one line, and this file pins only the
 * first:
 *
 *   1. **The envelope** (fixed here). The handler stated `success: true`
 *      unconditionally and forwarded the protocol's own `success: false`
 *      underneath it, so the status line and the payload disagreed. Any caller
 *      that reads the status — which is every caller that does not go digging
 *      into `persisted` — recorded an uninstall that had not happened.
 *
 *   2. **The persistence** (NOT fixed here — reported for transfer). The
 *      protocol's own `deletePackage` found ZERO rows to delete while three
 *      package-bound rows demonstrably existed, so it returned
 *      `deletedCount: 0, failedCount: 0` and the rows survived. That is a
 *      `sys_metadata` query defect in `@objectstack/metadata-protocol`, one
 *      layer below this handler; patching it from here would be papering over
 *      the producer. See the issue thread for the evidence.
 *
 * Because (2) is untouched, the failure this file pins is specifically the
 * PER-ITEM one (`failedCount > 0`) — the shape where the protocol itself
 * reports that rows resisted deletion. The silent-miss shape from (2) has
 * `failedCount: 0` and legitimately still reads as success at this layer; it
 * stops being a lie only once the producer stops missing rows.
 *
 * ## Why the rule is spelled the way it is
 *
 * `DELETE /packages/:id` has TWO doors: this dispatcher handler and the
 * direct-mount REST registrar (`packages/rest/src/package-routes.ts`), which
 * shadows it only when a `package` service is registered. The REST door already
 * answered `400 PACKAGE_DELETE_PARTIAL` for per-item failures; this one
 * answered 200. Two doors to one route answering differently is how the
 * divergence arrived, so the rule here is copied from that door deliberately —
 * including its carve-out that ZERO metadata rows is still a SUCCESSFUL
 * uninstall (a runtime-registered package that never published metadata has
 * nothing in `sys_metadata`), which is why the predicate is `failedCount > 0`
 * and not `!persisted.success`.
 *
 * ---------------------------------------------------------------------------
 * Reverse verification, direction predicted BEFORE running
 * ---------------------------------------------------------------------------
 * Restoring the old unconditional `deps.success({ success: true, … })` turns
 * the two failure cases below red (200 where 400 is required) and leaves every
 * success case green — the success cases assert a 200 the old code produced
 * unconditionally, so they cannot distinguish the versions on their own. That
 * asymmetry is intended: the success cases exist to constrain the fix from
 * over-reaching into "any non-empty `failed` array 400s", which would break the
 * never-published-metadata uninstall.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const authed = (caps: string[] = ['manage_metadata']): any => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: caps },
});

function make(deletePackageResult: any, opts: { registryRemoved?: boolean } = {}) {
    const registry = {
        getAllPackages: vi.fn().mockReturnValue([]),
        getPackage: vi.fn().mockReturnValue({ id: 'pkg-a', manifest: { id: 'pkg-a', name: 'A' } }),
        uninstallPackage: vi.fn().mockReturnValue(opts.registryRemoved ?? true),
    };
    const protocol = {
        deletePackage: vi.fn().mockResolvedValue(deletePackageResult),
    };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? { registry }
                    : name === 'protocol' ? protocol
                        : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry, protocol };
}

const uninstall = (d: HttpDispatcher) =>
    d.handlePackages('/pkg-a', 'DELETE', undefined, {}, authed());

describe('#7557 (B) — a failed uninstall is reported as a failure, not wrapped in a 200', () => {
    it('per-item failures answer 400 PACKAGE_DELETE_PARTIAL, not 200', async () => {
        const { dispatcher } = make({
            success: false,
            deletedCount: 2,
            failedCount: 1,
            deleted: [{ type: 'object', name: 'a', state: 'active' }],
            failed: [{ type: 'object', name: 'stuck', error: 'locked', code: 'ITEM_LOCKED' }],
            cleanups: [],
        });

        const r = await uninstall(dispatcher);

        // THE LINE THAT WAS RED: this was a 200.
        expect(r.response?.status).toBe(400);
        expect(r.response?.body?.error?.code).toBe('PACKAGE_DELETE_PARTIAL');
        // The status and the payload must now AGREE — the whole defect was that
        // they did not.
        expect(r.response?.body?.success).toBe(false);
    });

    it('the per-item detail rides on the failure, so a caller learns WHICH item stuck', async () => {
        const { dispatcher } = make({
            success: false,
            deletedCount: 0,
            failedCount: 1,
            deleted: [],
            failed: [{ type: 'object', name: 'stuck', error: 'locked', code: 'ITEM_LOCKED' }],
            cleanups: [{ name: 'security.package-permissions', success: false, removed: 0 }],
        });

        const r = await uninstall(dispatcher);
        const details = r.response?.body?.error?.details ?? r.response?.body?.error;

        expect(r.response?.status).toBe(400);
        expect(JSON.stringify(details)).toContain('stuck');
        // Cleanup outcomes are a SECURITY signal (a failed permission revocation
        // is a ghost grant) — they must survive the failure path, not only the
        // success path.
        expect(JSON.stringify(details)).toContain('security.package-permissions');
    });

    it('an all-rows-failed uninstall is a 400, NOT the 404 its zero deletedCount would imply', async () => {
        // `deletedCount === 0` is also the not-found shape. Answering "not
        // found" for a package whose rows are demonstrably present and
        // demonstrably stuck is the same lie one layer over, so the failure
        // check has to come first.
        const { dispatcher } = make({
            success: false,
            deletedCount: 0,
            failedCount: 3,
            deleted: [],
            failed: [
                { type: 'object', name: 'a', error: 'locked' },
                { type: 'object', name: 'b', error: 'locked' },
                { type: 'view', name: 'c', error: 'locked' },
            ],
            cleanups: [],
        }, { registryRemoved: false });

        const r = await uninstall(dispatcher);

        expect(r.response?.status).toBe(400);
        expect(r.response?.status).not.toBe(404);
        expect(r.response?.body?.error?.code).toBe('PACKAGE_DELETE_PARTIAL');
    });

    it('a clean uninstall still answers 200', async () => {
        const { dispatcher } = make({
            success: true, deletedCount: 3, failedCount: 0, deleted: [], failed: [], cleanups: [],
        });

        const r = await uninstall(dispatcher);

        expect(r.response?.status).toBe(200);
        expect(r.response?.body?.success).toBe(true);
    });

    it('zero metadata rows is still a SUCCESSFUL uninstall — the carve-out, kept', async () => {
        // A runtime-registered package that never published metadata: nothing
        // in `sys_metadata`, so `deletePackage` reports `success: false` merely
        // because `deleted.length === 0`. The registry removal is the real
        // outcome here, and it succeeded. Failing this would break every
        // uninstall of a package that ships no metadata — which is why the
        // predicate is `failedCount > 0`, not `!persisted.success`.
        const { dispatcher } = make({
            success: false, deletedCount: 0, failedCount: 0, deleted: [], failed: [], cleanups: [],
        }, { registryRemoved: true });

        const r = await uninstall(dispatcher);

        expect(r.response?.status).toBe(200);
    });

    it('an unknown package — nothing in the registry, nothing persisted — still 404s', async () => {
        const { dispatcher } = make({
            success: false, deletedCount: 0, failedCount: 0, deleted: [], failed: [], cleanups: [],
        }, { registryRemoved: false });

        const r = await uninstall(dispatcher);

        expect(r.response?.status).toBe(404);
    });
});
