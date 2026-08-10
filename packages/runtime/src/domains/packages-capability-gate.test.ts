// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` — authorization posture (#7033 / #7023).
 *
 * The `/packages` domain shipped with ZERO authorization predicates: a survey
 * drove a guest-principal caller to a 200 on the DESTRUCTIVE `discard-drafts`
 * and the whole-package `export`, while its five sibling dispatcher domains
 * (/meta, /actions, /automation, /ai, /security) all carried the
 * anonymous-deny floor. The maintainer's 2026-08-09 ruling: a domain-wide
 * anonymous floor, `manage_metadata` on every state-changing route (mirroring
 * #6603 / #7019 on `/meta` writes), and the ADR-0106 D4 read set
 * (`studio.access` / `setup.access`) on every read.
 *
 * ## One handler, every transport
 *
 * Unlike `/meta` — whose REST and dispatcher transports are two SEPARATE handler
 * bodies, which is why #6603's REST gate had to be re-added on the dispatcher
 * side by #7019 — every `/packages` transport (the dispatcher-plugin explicit
 * mounts, the `@objectstack/hono` catch-all, and the legacy
 * `HttpDispatcher.handlePackages` method) converges on ONE body,
 * `handlePackagesRequest`. So the gate placed there covers them all, and driving
 * `handlePackages()` here exercises the identical gate the HTTP path runs.
 *
 * The driver is the one the sibling gate tests use
 * (`meta-migrate-stored.test.ts`, `anonymous-gate-actions-automation.test.ts`):
 * `HttpDispatcher` over a fake kernel whose services are `vi.fn()` doubles, so
 * "the target function never ran" is an assertion, not an inference.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── caller contexts ──────────────────────────────────────────────────────────
const ctx = (executionContext?: any): any => ({
    request: {},
    environmentId: 'platform',
    ...(executionContext ? { executionContext } : {}),
});
/** No identity resolved at all — the `principalKind: 'guest'` shape. */
const anon = () => ctx();
/** Identity resolved but sessionless (no `userId`) — also anonymous. */
const anonResolved = () => ctx({ isSystem: false, positions: [], permissions: [], systemPermissions: [] });
/** Authenticated, holding exactly `caps`. */
const authed = (caps: string[] = []) => ctx({ userId: 'u_portal', isSystem: false, systemPermissions: caps });
/** Engine self-invocation — never settable from the wire. */
const system = () => ctx({ isSystem: true });

// ── fake kernel ──────────────────────────────────────────────────────────────
function make(overrides: { protocol?: any; metadata?: any; registry?: any } = {}) {
    const registry = overrides.registry ?? {
        getAllPackages: vi.fn().mockReturnValue([{ id: 'pkg-a', status: 'active' }]),
        getPackage: vi.fn().mockReturnValue({ id: 'pkg-a', manifest: { id: 'pkg-a', name: 'A' } }),
        installPackage: vi.fn().mockImplementation((m: any) => ({ id: m.id, manifest: m })),
        enablePackage: vi.fn().mockReturnValue({ id: 'pkg-a' }),
        disablePackage: vi.fn().mockReturnValue({ id: 'pkg-a' }),
        uninstallPackage: vi.fn().mockReturnValue(true),
        updatePackageManifest: vi.fn().mockReturnValue({ id: 'pkg-a' }),
    };
    const objectql = { registry };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? objectql
                    : name === 'protocol' ? (overrides.protocol ?? null)
                        : name === 'metadata' ? (overrides.metadata ?? null)
                            : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), registry };
}

/** A protocol double carrying every method the package routes call. */
function fullProtocol() {
    return {
        publishPackageDrafts: vi.fn().mockResolvedValue({ success: true, publishedCount: 0, published: [], failed: [] }),
        discardPackageDrafts: vi.fn().mockResolvedValue({ success: true, discardedCount: 2 }),
        listCommits: vi.fn().mockResolvedValue([{ id: 'c1' }]),
        revertCommit: vi.fn().mockResolvedValue({ success: true }),
        rollbackToPackageCommit: vi.fn().mockResolvedValue({ success: true }),
        reassignOrphanedMetadata: vi.fn().mockResolvedValue({ reassigned: 0 }),
        duplicatePackage: vi.fn().mockResolvedValue({ package: { id: 'pkg-b' } }),
        updatePackage: vi.fn().mockResolvedValue({ package: { manifest: { id: 'pkg-a' } } }),
        deletePackage: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
    };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Domain-wide anonymous floor — every route, before the registry probe
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages — anonymous-deny floor (#7033/#7023)', () => {
    it('401s an anonymous GET /packages and never reads the registry', async () => {
        const { dispatcher, registry } = make();
        const r = await dispatcher.handlePackages('/', 'GET', undefined, {}, anon());
        expect(r.response?.status).toBe(401);
        expect(r.response?.body?.error?.code).toBe('UNAUTHENTICATED');
        expect(registry.getAllPackages).not.toHaveBeenCalled();
    });

    it('401s the sessionless (resolved-but-no-user) shape too', async () => {
        const { dispatcher, registry } = make();
        const r = await dispatcher.handlePackages('/', 'GET', undefined, {}, anonResolved());
        expect(r.response?.status).toBe(401);
        expect(registry.getAllPackages).not.toHaveBeenCalled();
    });

    it('401s an anonymous DESTRUCTIVE discard-drafts and never calls the protocol', async () => {
        const protocol = fullProtocol();
        const { dispatcher } = make({ protocol });
        const r = await dispatcher.handlePackages('/pkg-a/discard-drafts', 'POST', {}, {}, anon());
        expect(r.response?.status).toBe(401);
        expect(protocol.discardPackageDrafts).not.toHaveBeenCalled();
    });

    it('answers the anonymous floor BEFORE the 503 registry probe — no 401-vs-503 fingerprint', async () => {
        // Registry ABSENT: an authenticated caller gets 503, but an anonymous one
        // must still get 401, so the difference cannot reveal whether the package
        // service is mounted.
        const objectqlNoRegistry = { find: vi.fn() }; // no `.registry`
        const { dispatcher } = make({ registry: undefined });
        // rebuild kernel with a registry-less objectql
        const kernel: any = { context: { getService: (n: string) => (n === 'objectql' ? objectqlNoRegistry : null) } };
        const d = new HttpDispatcher(kernel);
        expect((await d.handlePackages('/', 'GET', undefined, {}, anon())).response?.status).toBe(401);
        expect((await d.handlePackages('/', 'GET', undefined, {}, authed(['studio.access']))).response?.status).toBe(503);
        void dispatcher;
    });

    it('does not turn a CORS preflight (OPTIONS) into a 401 — it passes the floor', async () => {
        const { dispatcher } = make();
        const r = await dispatcher.handlePackages('/', 'OPTIONS', undefined, {}, anon());
        // No OPTIONS route matches → not handled; crucially NOT a 401.
        expect(r.response?.status).not.toBe(401);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Write gate — `manage_metadata` on every state-changing route
// ══════════════════════════════════════════════════════════════════════════════

type WriteCase = { name: string; path: string; method: string; body?: any; query?: any; target: (p: any, r: any) => any };
const WRITE_ROUTES: WriteCase[] = [
    // `overwrite` so the allow-path clears the 409 duplicate guard (the shared
    // registry double answers `getPackage` truthy for any id); the write gate
    // runs FIRST, so the deny cases still 403/401 before this is consulted.
    { name: 'POST /packages (install)', path: '/', method: 'POST', body: { manifest: { id: 'pkg-new', name: 'n', version: '1.0.0' } }, query: { overwrite: 'true' }, target: (_p, r) => r.installPackage },
    { name: 'PATCH /:id/enable', path: '/pkg-a/enable', method: 'PATCH', target: (_p, r) => r.enablePackage },
    { name: 'PATCH /:id/disable', path: '/pkg-a/disable', method: 'PATCH', target: (_p, r) => r.disablePackage },
    { name: 'POST /:id/publish-drafts', path: '/pkg-a/publish-drafts', method: 'POST', target: (p) => p.publishPackageDrafts },
    { name: 'POST /:id/discard-drafts', path: '/pkg-a/discard-drafts', method: 'POST', target: (p) => p.discardPackageDrafts },
    { name: 'POST /:id/commits/:c/revert', path: '/pkg-a/commits/c1/revert', method: 'POST', target: (p) => p.revertCommit },
    { name: 'POST /:id/rollback', path: '/pkg-a/rollback', method: 'POST', body: { commitId: 'c1' }, target: (p) => p.rollbackToPackageCommit },
    { name: 'POST /:id/adopt-orphans', path: '/pkg-a/adopt-orphans', method: 'POST', target: (p) => p.reassignOrphanedMetadata },
    { name: 'POST /:id/duplicate', path: '/pkg-a/duplicate', method: 'POST', body: { targetPackageId: 'pkg-b' }, target: (p) => p.duplicatePackage },
    { name: 'PATCH /:id (manifest)', path: '/pkg-a', method: 'PATCH', body: { name: 'renamed' }, target: (p) => p.updatePackage },
    { name: 'DELETE /:id', path: '/pkg-a', method: 'DELETE', target: (p) => p.deletePackage },
];

describe('/packages — write gate: every state-changing route demands `manage_metadata`', () => {
    for (const wc of WRITE_ROUTES) {
        it(`403s a zero-capability caller on ${wc.name} and the target never runs`, async () => {
            const protocol = fullProtocol();
            const { dispatcher, registry } = make({ protocol });
            const r = await dispatcher.handlePackages(wc.path, wc.method, wc.body ?? {}, wc.query ?? {}, authed([]));
            expect(r.response?.status).toBe(403);
            expect(wc.target(protocol, registry)).not.toHaveBeenCalled();
        });

        it(`403s a READ-capability-only caller on ${wc.name} — studio.access is not the write key`, async () => {
            const protocol = fullProtocol();
            const { dispatcher, registry } = make({ protocol });
            const r = await dispatcher.handlePackages(wc.path, wc.method, wc.body ?? {}, wc.query ?? {}, authed(['studio.access', 'setup.access']));
            expect(r.response?.status).toBe(403);
            expect(wc.target(protocol, registry)).not.toHaveBeenCalled();
        });

        it(`lets a manage_metadata caller through on ${wc.name}`, async () => {
            const protocol = fullProtocol();
            const { dispatcher, registry } = make({ protocol });
            const r = await dispatcher.handlePackages(wc.path, wc.method, wc.body ?? {}, wc.query ?? {}, authed(['manage_metadata']));
            expect(r.response?.status).not.toBe(403);
            expect(r.response?.status).not.toBe(401);
            expect(wc.target(protocol, registry)).toHaveBeenCalled();
        });

        it(`lets an isSystem caller through on ${wc.name}`, async () => {
            const protocol = fullProtocol();
            const { dispatcher, registry } = make({ protocol });
            const r = await dispatcher.handlePackages(wc.path, wc.method, wc.body ?? {}, wc.query ?? {}, system());
            expect(r.response?.status).not.toBe(403);
            expect(wc.target(protocol, registry)).toHaveBeenCalled();
        });
    }

    // The publish route that needs the metadata service (not the protocol).
    it('403s POST /:id/publish (metadata-service publish) and never calls publishPackage', async () => {
        const metadata = { publishPackage: vi.fn().mockResolvedValue({ success: true }) };
        const { dispatcher } = make({ metadata });
        const r = await dispatcher.handlePackages('/pkg-a/publish', 'POST', {}, {}, authed([]));
        expect(r.response?.status).toBe(403);
        expect(metadata.publishPackage).not.toHaveBeenCalled();
    });

    it('403s POST /:id/revert (metadata-service revert) and never calls revertPackage', async () => {
        const metadata = { revertPackage: vi.fn().mockResolvedValue(undefined) };
        const { dispatcher } = make({ metadata });
        const r = await dispatcher.handlePackages('/pkg-a/revert', 'POST', {}, {}, authed([]));
        expect(r.response?.status).toBe(403);
        expect(metadata.revertPackage).not.toHaveBeenCalled();
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. `discard-drafts` — the "delete first, refuse second" shape, pinned directly
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages discard-drafts — the destructive route refuses BEFORE any delete', () => {
    /** A protocol whose discard mutates a stand-in draft store (the "库"). */
    function discardWithStore() {
        const store = { drafts: ['app.hr:account', 'app.hr:salary_review'] };
        const discardPackageDrafts = vi.fn(async () => {
            const n = store.drafts.length;
            store.drafts = [];
            return { success: true, discardedCount: n };
        });
        return { store, discardPackageDrafts };
    }

    it('a zero-capability caller gets 403 and NOT ONE draft is deleted', async () => {
        const { store, discardPackageDrafts } = discardWithStore();
        const { dispatcher } = make({ protocol: { discardPackageDrafts } });
        const r = await dispatcher.handlePackages('/app.hr/discard-drafts', 'POST', {}, {}, authed([]));
        expect(r.response?.status).toBe(403);
        // The load-bearing assertion: the delete never ran, so the drafts survive.
        expect(discardPackageDrafts).not.toHaveBeenCalled();
        expect(store.drafts).toEqual(['app.hr:account', 'app.hr:salary_review']);
    });

    it('an anonymous caller gets 401 and NOT ONE draft is deleted', async () => {
        const { store, discardPackageDrafts } = discardWithStore();
        const { dispatcher } = make({ protocol: { discardPackageDrafts } });
        const r = await dispatcher.handlePackages('/app.hr/discard-drafts', 'POST', {}, {}, anon());
        expect(r.response?.status).toBe(401);
        expect(discardPackageDrafts).not.toHaveBeenCalled();
        expect(store.drafts).toEqual(['app.hr:account', 'app.hr:salary_review']);
    });

    it('a manage_metadata caller DOES discard (the gate is not over-blocking)', async () => {
        const { store, discardPackageDrafts } = discardWithStore();
        const { dispatcher } = make({ protocol: { discardPackageDrafts } });
        const r = await dispatcher.handlePackages('/app.hr/discard-drafts', 'POST', {}, {}, authed(['manage_metadata']));
        expect(r.response?.status).toBe(200);
        expect(discardPackageDrafts).toHaveBeenCalledTimes(1);
        expect(store.drafts).toEqual([]);
    });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Read gate — `studio.access` / `setup.access` on every read
// ══════════════════════════════════════════════════════════════════════════════

type ReadCase = { name: string; path: string; target: (p: any, r: any) => any };
const READ_ROUTES: ReadCase[] = [
    { name: 'GET /packages (enumeration)', path: '/', target: (_p, r) => r.getAllPackages },
    { name: 'GET /:id (detail)', path: '/pkg-a', target: (_p, r) => r.getPackage },
    { name: 'GET /:id/commits', path: '/pkg-a/commits', target: (p) => p.listCommits },
    { name: 'GET /:id/export', path: '/pkg-a/export', target: (p) => p.getMetaItems },
];

describe('/packages — read gate: every read demands studio.access or setup.access', () => {
    for (const rc of READ_ROUTES) {
        it(`403s a zero-capability caller on ${rc.name} and the target never runs`, async () => {
            const protocol = fullProtocol();
            const { dispatcher, registry } = make({ protocol });
            const r = await dispatcher.handlePackages(rc.path, 'GET', undefined, {}, authed([]));
            expect(r.response?.status).toBe(403);
            expect(rc.target(protocol, registry)).not.toHaveBeenCalled();
        });

        it(`403s a WRITE-only caller (manage_metadata) on ${rc.name} — the read cohort is a different set`, async () => {
            const protocol = fullProtocol();
            const { dispatcher, registry } = make({ protocol });
            const r = await dispatcher.handlePackages(rc.path, 'GET', undefined, {}, authed(['manage_metadata']));
            expect(r.response?.status).toBe(403);
            expect(rc.target(protocol, registry)).not.toHaveBeenCalled();
        });

        it(`lets a studio.access caller read ${rc.name}`, async () => {
            const protocol = fullProtocol();
            const { dispatcher } = make({ protocol });
            const r = await dispatcher.handlePackages(rc.path, 'GET', undefined, {}, authed(['studio.access']));
            expect(r.response?.status).not.toBe(403);
            expect(r.response?.status).not.toBe(401);
        });

        it(`lets a setup.access caller read ${rc.name}`, async () => {
            const protocol = fullProtocol();
            const { dispatcher } = make({ protocol });
            const r = await dispatcher.handlePackages(rc.path, 'GET', undefined, {}, authed(['setup.access']));
            expect(r.response?.status).not.toBe(403);
            expect(r.response?.status).not.toBe(401);
        });

        it(`lets an isSystem caller read ${rc.name}`, async () => {
            const protocol = fullProtocol();
            const { dispatcher } = make({ protocol });
            const r = await dispatcher.handlePackages(rc.path, 'GET', undefined, {}, system());
            expect(r.response?.status).not.toBe(403);
            expect(r.response?.status).not.toBe(401);
        });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. The two cohorts are genuinely different (write ≠ read)
// ══════════════════════════════════════════════════════════════════════════════

describe('/packages — the write cohort and the read cohort do not collapse into one', () => {
    it('a setup.access-only caller (org-admin shape) may READ but not PUBLISH', async () => {
        const protocol = fullProtocol();
        const { dispatcher } = make({ protocol });
        const read = await dispatcher.handlePackages('/', 'GET', undefined, {}, authed(['setup.access']));
        expect(read.response?.status).toBe(200);
        const write = await dispatcher.handlePackages('/pkg-a/publish-drafts', 'POST', {}, {}, authed(['setup.access']));
        expect(write.response?.status).toBe(403);
        expect(protocol.publishPackageDrafts).not.toHaveBeenCalled();
    });

    it('a manage_metadata-only caller may PUBLISH but not READ the export', async () => {
        const protocol = fullProtocol();
        const { dispatcher } = make({ protocol });
        const write = await dispatcher.handlePackages('/pkg-a/publish-drafts', 'POST', {}, {}, authed(['manage_metadata']));
        expect(write.response?.status).toBe(200);
        const read = await dispatcher.handlePackages('/pkg-a/export', 'GET', undefined, {}, authed(['manage_metadata']));
        expect(read.response?.status).toBe(403);
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
    });
});
