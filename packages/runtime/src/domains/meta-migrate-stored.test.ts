// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /meta/_migrate-stored` — the server-side form of
 * `os migrate meta --stored` (#4327 / #4454 / #4498).
 *
 * The CLI form needs shell access to the deployment's database, which a hosted
 * operator does not have, so on a managed deployment ADR-0087's stored-metadata
 * chain had no finish line at all. This route is that finish line — and, unlike
 * the CLI, it runs in a process that already holds a live automation engine, so
 * flow rows are covered without threading anything (#4498).
 *
 * What is pinned here is the route's POSTURE, not the migration itself (that is
 * `metadata-protocol`'s `protocol.stored-migration.test.ts`): it rewrites every
 * eligible row in the deployment, so it must demand a capability rather than a
 * session, and it must not write unless the caller explicitly asked it to.
 */
import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const REPORT = {
    apply: false,
    protocol: '17.0.0',
    scanned: 3,
    canonical: 2,
    pending: 1,
    rewritten: 0,
    skipped: 0,
    failed: 0,
    rows: [],
};

function make(protocol: any) {
    const kernel = {
        context: {
            getService: (name: string) => (name === 'protocol' ? protocol : null),
        },
    } as any;
    return new HttpDispatcher(kernel);
}

const ctx = (executionContext: any): any => ({ request: {}, environmentId: 'platform', executionContext });

describe('POST /meta/_migrate-stored — capability gate (#4327)', () => {
    it('403s an authenticated caller without `manage_metadata`', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        const res = await make({ migrateStoredMetadata }).handleMetadata(
            '/_migrate-stored',
            ctx({ userId: 'u1', systemPermissions: ['setup.access'] }),
            'POST',
            { apply: true },
        );
        expect(res.response.status).toBe(403);
        // The gate is the point: an ordinary session must not be able to rewrite
        // every metadata row in the deployment.
        expect(migrateStoredMetadata).not.toHaveBeenCalled();
    });

    it('allows a caller holding `manage_metadata`', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        const res = await make({ migrateStoredMetadata }).handleMetadata(
            '/_migrate-stored',
            ctx({ userId: 'u1', systemPermissions: ['manage_metadata'] }),
            'POST',
            {},
        );
        expect(res.response.status).not.toBe(403);
        expect(migrateStoredMetadata).toHaveBeenCalledTimes(1);
    });

    it('engine self-invocation (isSystem) bypasses, matching every other capability gate', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata }).handleMetadata(
            '/_migrate-stored',
            ctx({ isSystem: true }),
            'POST',
            {},
        );
        expect(migrateStoredMetadata).toHaveBeenCalledTimes(1);
    });

    it('an anonymous caller is refused by the domain gate before reaching this route', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        const res = await make({ migrateStoredMetadata }).handleMetadata(
            '/_migrate-stored',
            ctx({}),
            'POST',
            {},
        );
        expect(res.response.status).toBe(401);
        expect(migrateStoredMetadata).not.toHaveBeenCalled();
    });
});

describe('POST /meta/_migrate-stored — preview by default (#4327)', () => {
    const admin = () => ctx({ userId: 'admin', systemPermissions: ['manage_metadata'] });

    it('an empty body previews — `apply` is never inferred', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata }).handleMetadata('/_migrate-stored', admin(), 'POST', {});
        expect(migrateStoredMetadata.mock.calls[0][0].apply).toBe(false);
    });

    it('only a literal `true` applies — a truthy string does not', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        const d = make({ migrateStoredMetadata });
        await d.handleMetadata('/_migrate-stored', admin(), 'POST', { apply: 'yes' });
        expect(migrateStoredMetadata.mock.calls[0][0].apply).toBe(false);
        await d.handleMetadata('/_migrate-stored', admin(), 'POST', { apply: true });
        expect(migrateStoredMetadata.mock.calls[1][0].apply).toBe(true);
    });

    it('passes a `types` filter through, dropping non-string members', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata }).handleMetadata(
            '/_migrate-stored', admin(), 'POST', { types: ['flow', 42, '', 'object'] },
        );
        expect(migrateStoredMetadata.mock.calls[0][0].types).toEqual(['flow', 'object']);
    });

    it('omits `types` entirely when none survive, so the run is not silently empty', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata }).handleMetadata(
            '/_migrate-stored', admin(), 'POST', { types: [42] },
        );
        expect(migrateStoredMetadata.mock.calls[0][0]).not.toHaveProperty('types');
    });

    it('threads NO canonicalizeFlow — the protocol resolves the engine itself (#4498)', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata }).handleMetadata('/_migrate-stored', admin(), 'POST', {});
        expect(migrateStoredMetadata.mock.calls[0][0]).not.toHaveProperty('canonicalizeFlow');
    });

    it('attributes the run to the caller — history and audit rows answer "who ran it"', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata }).handleMetadata('/_migrate-stored', admin(), 'POST', {});
        expect(migrateStoredMetadata.mock.calls[0][0].actor).toContain('admin');
    });

    it('returns the report as-is', async () => {
        const res = await make({ migrateStoredMetadata: vi.fn().mockResolvedValue(REPORT) })
            .handleMetadata('/_migrate-stored', admin(), 'POST', {});
        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toEqual(REPORT);
    });

    it('501s on a kernel whose protocol predates the pass', async () => {
        const res = await make({}).handleMetadata('/_migrate-stored', admin(), 'POST', {});
        expect(res.response.status).toBe(501);
    });

    it('is POST-only — a GET falls through to the type-list handler, not a rewrite', async () => {
        const migrateStoredMetadata = vi.fn().mockResolvedValue(REPORT);
        await make({ migrateStoredMetadata, getMetaItems: vi.fn().mockResolvedValue({ items: [] }) })
            .handleMetadata('/_migrate-stored', admin(), 'GET');
        expect(migrateStoredMetadata).not.toHaveBeenCalled();
    });
});
