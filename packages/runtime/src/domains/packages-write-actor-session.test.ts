// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28414] The package write doors record the request's authenticated user on
 * the history rows and package commits their protocol call writes — never a
 * name the request body supplies.
 *
 * Measured before this change, driving `dispatch()`: each door below passed
 * `body.actor` straight into its protocol request, so a caller holding
 * `manage_metadata` who sent `{ actor: 'u_someone_else' }` had the protocol
 * stamp `u_someone_else` into `sys_metadata_history.recorded_by` and the
 * package commit. The single-item door already took the session identity
 * (`RestServer.resolveMetaWriteActor`); these doors now read the same
 * identity through the one helper the publish-drafts door already used,
 * `resolvePackageWriteActor`.
 *
 * Both halves per door: the session user is what the protocol receives when
 * the body names another user, and a caller with no user id (a system
 * context) keeps the actor-less fallback — no `actor` key, so the protocol
 * records `null` (#4556) — whether or not its body names one.
 *
 * The publish-drafts door's own `publishPackageDrafts` call is not pinned
 * here (#28406 pinned it beside the door); its ADR-0045 visibility flip,
 * which re-saves each `_unpublished` app through `saveMetaItem`, is.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.app';
const SESSION_USER = 'u_author';
const SPOOFED = 'u_someone_else';

/** Admitted by the write doors' capability gate. */
const AUTHOR = { userId: SESSION_USER, isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };
/** A system context: admitted by `isSystem`, and no user id to record. */
const SYSTEM = { isSystem: true, systemPermissions: [] as string[] };

/**
 * The dispatcher over a REAL registry holding one installed, writable package
 * and a recording protocol: each door's protocol call is a spy, so "what was
 * recorded" is the request that spy received.
 */
function boot(caller: Record<string, unknown>) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, name: PKG, namespace: 'app', version: '1.0.0', type: 'app' } as any, 'authored');
    const protocol = {
        discardPackageDrafts: vi.fn(async (_r: any) => ({ success: true, discardedCount: 1, failedCount: 0, discarded: [], failed: [] })),
        revertCommit: vi.fn(async (_r: any) => ({ success: true })),
        rollbackToPackageCommit: vi.fn(async (_r: any) => ({ success: true, revertedCommits: [], failed: [] })),
        reassignOrphanedMetadata: vi.fn(async (r: any) => ({ success: true, reassignedCount: 0, reassigned: [], targetPackageId: r.targetPackageId })),
        duplicatePackage: vi.fn(async (r: any) => ({ success: true, copiedCount: 0, failedCount: 0, targetPackageId: r.targetPackageId, copied: [], failed: [] })),
    };
    const services: Record<string, unknown> = { objectql: { registry }, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get, trigger: vi.fn() }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...caller });
    return { dispatcher, protocol };
}

type Protocol = ReturnType<typeof boot>['protocol'];

interface Door {
    door: string;
    path: string;
    /** The door's own body, without any `actor`. */
    body: Record<string, unknown>;
    act: keyof Protocol;
}

const DOORS: Door[] = [
    { door: 'POST /packages/:id/discard-drafts', path: `/packages/${PKG}/discard-drafts`, body: {}, act: 'discardPackageDrafts' },
    { door: 'POST /packages/:id/commits/:c/revert', path: `/packages/${PKG}/commits/c_1/revert`, body: {}, act: 'revertCommit' },
    { door: 'POST /packages/:id/rollback', path: `/packages/${PKG}/rollback`, body: { commitId: 'c_1' }, act: 'rollbackToPackageCommit' },
    { door: 'POST /packages/:id/adopt-orphans', path: `/packages/${PKG}/adopt-orphans`, body: {}, act: 'reassignOrphanedMetadata' },
    { door: 'POST /packages/:id/duplicate', path: `/packages/${PKG}/duplicate`, body: { targetPackageId: 'com.acme.copy' }, act: 'duplicatePackage' },
];

async function post(caller: Record<string, unknown>, door: Door, body: Record<string, unknown>) {
    const { dispatcher, protocol } = boot(caller);
    const res = await dispatcher.dispatch('POST', door.path, body, {}, { request: { headers: {} } } as any);
    const status = res.response?.status ?? (res.handled ? 200 : 0);
    expect(status, `expected 200, got ${JSON.stringify(res.response)}`).toBe(200);
    const spy = protocol[door.act];
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0][0] as Record<string, unknown>;
}

describe.each(DOORS)('[#28414] $door records the session user, never a body actor', (door) => {
    it('a body naming another user records the session user', async () => {
        const request = await post(AUTHOR, door, { ...door.body, actor: SPOOFED });
        expect(request.actor).toBe(SESSION_USER);
    });

    it('a body naming no one records the session user too', async () => {
        const request = await post(AUTHOR, door, { ...door.body });
        expect(request.actor).toBe(SESSION_USER);
    });

    it('a system context keeps the actor-less fallback, whatever its body names', async () => {
        const plain = await post(SYSTEM, door, { ...door.body });
        expect(plain).not.toHaveProperty('actor');
        const named = await post(SYSTEM, door, { ...door.body, actor: SPOOFED });
        expect(named).not.toHaveProperty('actor');
    });
});

describe('[#28414] the publish-drafts visibility flip re-saves each app as the session user', () => {
    function makeDoor(executionContext: Record<string, unknown>) {
        const publishPackageDrafts = vi.fn().mockResolvedValue({
            success: true, publishedCount: 0, failedCount: 0, published: [], failed: [],
            seedApplied: { success: true, inserted: 0 },
        });
        const getMetaItems = vi.fn().mockResolvedValue({ items: [{ name: 'hidden_app', label: 'Hidden', _unpublished: true }] });
        const saveMetaItem = vi.fn().mockResolvedValue({ success: true });
        const services: Record<string, unknown> = {
            protocol: { publishPackageDrafts, getMetaItems, saveMetaItem },
            objectql: { registry: { getAllPackages: () => [] } },
        };
        const kernel: any = {
            getService: (name: string) => (name in services ? Promise.resolve(services[name]) : null),
            context: { getService: () => null, trigger: vi.fn() },
        };
        const context = { request: {}, executionContext } as any;
        return { dispatcher: new HttpDispatcher(kernel), saveMetaItem, context };
    }

    async function flip(executionContext: Record<string, unknown>, body: Record<string, unknown>) {
        const { dispatcher, saveMetaItem, context } = makeDoor(executionContext);
        const { response } = await dispatcher.handlePackages(`/${PKG}/publish-drafts`, 'POST', body, {}, context);
        expect((response as any)?.status).toBe(200);
        expect(((response as any)?.body?.data ?? (response as any)?.body)?.unhiddenApps).toEqual(['hidden_app']);
        expect(saveMetaItem).toHaveBeenCalledTimes(1);
        return saveMetaItem.mock.calls[0][0] as Record<string, unknown>;
    }

    it('a body naming another user re-saves the app as the session user', async () => {
        const saved = await flip({ ...AUTHOR }, { actor: SPOOFED });
        expect(saved).toMatchObject({ type: 'app', name: 'hidden_app', packageId: PKG });
        expect(saved.actor).toBe(SESSION_USER);
    });

    it('a system context keeps the actor-less fallback, whatever its body names', async () => {
        expect(await flip({ ...SYSTEM }, {})).not.toHaveProperty('actor');
        expect(await flip({ ...SYSTEM }, { actor: SPOOFED })).not.toHaveProperty('actor');
    });
});
