// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` — the knowledge source capability at the package write doors
 * (ADR-0161 K4, guard one; `refuseKnowledgeSourcePackageWrite`).
 *
 * A `/meta` write of a `knowledge_source` asks `manage_knowledge_sources`
 * beside `manage_metadata`. The package doors write many items at once, so the
 * rule is stated on the package: every write door of an existing package that
 * holds a knowledge source (an item, a pending draft, or for the verbs that
 * rewrite items from the timeline a commit) asks the same capability, and a
 * package that holds none answers exactly as before.
 *
 * Does NOT cover: the `manage_metadata` tier in front of this gate and the
 * anonymous floor (`packages-capability-gate.test.ts`), the wall
 * (`packages-walled-catalog-write.test.ts`), or the `/meta` doors' own row
 * (`meta-type-write-capability-parity.test.ts`).
 *
 * The driver is the sibling gate tests': `HttpDispatcher` over a fake kernel
 * whose services are `vi.fn()` doubles, so "the target never ran" is an
 * assertion, and every `/packages` transport converges on the one body driven
 * here (`handlePackagesRequest`).
 */

// Pays `@objectstack/metadata`'s first load at collection, never inside a clocked case.
import '@objectstack/metadata';
import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const ctx = (executionContext: any): any => ({ request: {}, environmentId: 'platform', executionContext });
const authed = (caps: string[], tenantId?: string) =>
    ctx({ userId: 'u_builder', isSystem: false, systemPermissions: caps, ...(tenantId ? { tenantId } : {}) });
const system = (tenantId?: string) => ctx({ isSystem: true, ...(tenantId ? { tenantId } : {}) });

const METADATA_ONLY = ['manage_metadata'];
const BOTH = ['manage_metadata', 'manage_knowledge_sources'];

/** What the package holds, as the three listings the gate reads answer it. */
interface Holding {
    items?: any[];
    drafts?: any[];
    commits?: any[];
    /** A listing that throws, by member name. */
    throws?: 'getMetaItems' | 'listDrafts' | 'listCommits';
}

function make(holding: Holding = {}) {
    const fail = (member: Holding['throws']) => () => {
        if (holding.throws === member) throw new Error('metadata store unreachable');
    };
    const protocol = {
        publishPackageDrafts: vi.fn().mockResolvedValue({ success: true, publishedCount: 0, published: [], failed: [] }),
        discardPackageDrafts: vi.fn().mockResolvedValue({ success: true, discardedCount: 2 }),
        revertCommit: vi.fn().mockResolvedValue({ success: true }),
        rollbackToPackageCommit: vi.fn().mockResolvedValue({ success: true }),
        reassignOrphanedMetadata: vi.fn().mockResolvedValue({ reassigned: 0 }),
        duplicatePackage: vi.fn().mockResolvedValue({ package: { id: 'pkg-b' } }),
        ensureCustomizationPackage: vi.fn().mockResolvedValue({ basePackageId: 'pkg-a', packageId: 'pkg-a.custom', namespace: 'pkg_custom', dependencyRange: '^1', created: true, writable: true }),
        updatePackage: vi.fn().mockResolvedValue({ package: { manifest: { id: 'com.example.pkg-a' } } }),
        deletePackage: vi.fn().mockResolvedValue({ deletedCount: 1 }),
        revertStoredPackage: vi.fn().mockResolvedValue({ stored: true }),
        // The three listings the gate reads.
        getMetaItems: vi.fn(async ({ type }: any) => {
            fail('getMetaItems')();
            return { items: type === 'knowledge_source' ? (holding.items ?? []) : [] };
        }),
        listDrafts: vi.fn(async ({ type }: any) => {
            fail('listDrafts')();
            return { drafts: (holding.drafts ?? []).filter((d) => !type || d.type === type) };
        }),
        listCommits: vi.fn(async () => {
            fail('listCommits')();
            return holding.commits ?? [{ id: 'c1', operation: 'apply', itemCount: 1, items: [{ type: 'object', name: 'ticket', existedBefore: false, prevVersion: null }] }];
        }),
    };
    const metadata = {
        publishPackage: vi.fn().mockResolvedValue({ success: true }),
        getPackageItems: vi.fn().mockResolvedValue([]),
    };
    const registry = {
        getAllPackages: vi.fn().mockReturnValue([{ id: 'com.example.pkg-a', status: 'active' }]),
        getPackage: vi.fn().mockReturnValue({ id: 'com.example.pkg-a', manifest: { id: 'com.example.pkg-a', name: 'A' } }),
        installPackage: vi.fn().mockImplementation((m: any) => ({ id: m.id, manifest: m })),
        enablePackage: vi.fn().mockReturnValue({ id: 'com.example.pkg-a' }),
        disablePackage: vi.fn().mockReturnValue({ id: 'com.example.pkg-a' }),
        uninstallPackage: vi.fn().mockReturnValue(true),
        updatePackageManifest: vi.fn().mockReturnValue({ id: 'com.example.pkg-a' }),
    };
    const objectql = { registry };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? objectql : name === 'protocol' ? protocol : name === 'metadata' ? metadata : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), protocol, metadata, registry };
}

type Stack = ReturnType<typeof make>;
interface Door {
    name: string; path: string; method: string; body?: any; tenantId?: string;
    target: (s: Stack) => any;
}

/** Every write door of an existing package, each with the writer it must not reach when refused. */
const DOORS: Door[] = [
    { name: 'PATCH /:id/enable', path: '/pkg-a/enable', method: 'PATCH', target: (s) => s.registry.enablePackage },
    { name: 'PATCH /:id/disable', path: '/pkg-a/disable', method: 'PATCH', target: (s) => s.registry.disablePackage },
    { name: 'POST /:id/publish', path: '/pkg-a/publish', method: 'POST', target: (s) => s.metadata.publishPackage },
    { name: 'POST /:id/publish-drafts', path: '/pkg-a/publish-drafts', method: 'POST', target: (s) => s.protocol.publishPackageDrafts },
    { name: 'POST /:id/discard-drafts', path: '/pkg-a/discard-drafts', method: 'POST', target: (s) => s.protocol.discardPackageDrafts },
    { name: 'POST /:id/commits/:c/revert', path: '/pkg-a/commits/c1/revert', method: 'POST', target: (s) => s.protocol.revertCommit },
    { name: 'POST /:id/rollback', path: '/pkg-a/rollback', method: 'POST', body: { commitId: 'c1' }, target: (s) => s.protocol.rollbackToPackageCommit },
    { name: 'POST /:id/revert', path: '/pkg-a/revert', method: 'POST', target: (s) => s.protocol.revertStoredPackage },
    { name: 'POST /:id/adopt-orphans', path: '/pkg-a/adopt-orphans', method: 'POST', target: (s) => s.protocol.reassignOrphanedMetadata },
    { name: 'POST /:id/duplicate', path: '/pkg-a/duplicate', method: 'POST', body: { targetPackageId: 'pkg-b' }, target: (s) => s.protocol.duplicatePackage },
    { name: 'POST /:id/ensure-customization', path: '/pkg-a/ensure-customization', method: 'POST', target: (s) => s.protocol.ensureCustomizationPackage },
    { name: 'PATCH /:id (manifest)', path: '/pkg-a', method: 'PATCH', body: { name: 'renamed' }, target: (s) => s.protocol.updatePackage },
    { name: 'DELETE /:id', path: '/pkg-a', method: 'DELETE', tenantId: 'org_a', target: (s) => s.protocol.deletePackage },
];

const call = (s: Stack, door: Door, context: any) =>
    s.dispatcher.handlePackages(door.path, door.method, door.body ?? {}, {}, context);

const SOURCE_ITEM = { name: 'faq', label: 'FAQ', adapter: 'memory', source: { kind: 'object', object: 'article', content: ['body'] } };
const SOURCE_DRAFT = { type: 'knowledge_source', name: 'faq', label: null, packageId: 'pkg-a', updatedAt: null, updatedBy: null };

describe('/packages — a package that holds a knowledge source is written by a holder of `manage_knowledge_sources`', () => {
    for (const door of DOORS) {
        it(`${door.name}: refuses a manage_metadata-only caller when the package holds a knowledge source, and the writer never runs`, async () => {
            for (const holding of [{ items: [SOURCE_ITEM] }, { drafts: [SOURCE_DRAFT] }] as Holding[]) {
                const s = make(holding);
                const r = await call(s, door, authed(METADATA_ONLY, door.tenantId));
                expect(r.response?.status, JSON.stringify(holding)).toBe(403);
                const message = r.response?.body?.error?.message as string;
                expect(message).toContain('`manage_knowledge_sources`');
                expect(message).toContain('knowledge source "faq"');
                expect(message).toContain('Nothing was changed.');
                expect(door.target(s)).not.toHaveBeenCalled();
            }
        });

        it(`${door.name}: a holder of both capabilities goes on, and the package is not read for it`, async () => {
            const s = make({ items: [SOURCE_ITEM], drafts: [SOURCE_DRAFT] });
            const r = await call(s, door, authed(BOTH, door.tenantId));
            expect(r.response?.status).not.toBe(403);
            expect(door.target(s)).toHaveBeenCalled();
            expect(s.protocol.listDrafts).not.toHaveBeenCalled();
        });

        it(`${door.name}: CONTROL — a package that holds no knowledge source answers a manage_metadata caller as before`, async () => {
            const s = make({ items: [], drafts: [{ ...SOURCE_DRAFT, type: 'object', name: 'ticket' }] });
            const r = await call(s, door, authed(METADATA_ONLY, door.tenantId));
            expect(r.response?.status).not.toBe(403);
            expect(r.response?.status).not.toBe(503);
            expect(door.target(s)).toHaveBeenCalled();
        });

        it(`${door.name}: fails closed — a listing that throws refuses 503, and the writer never runs`, async () => {
            const s = make({ throws: 'getMetaItems' });
            const r = await call(s, door, authed(METADATA_ONLY, door.tenantId));
            expect(r.response?.status).toBe(503);
            expect(r.response?.body?.error?.message).toContain('could not be read');
            expect(door.target(s)).not.toHaveBeenCalled();
        });

        it(`${door.name}: the engine's own call is not asked`, async () => {
            const s = make({ items: [SOURCE_ITEM] });
            const r = await call(s, door, system(door.tenantId));
            expect(r.response?.status).not.toBe(403);
            expect(door.target(s)).toHaveBeenCalled();
        });
    }
});

describe('/packages — the verbs that rewrite items from the timeline read the commits too', () => {
    const touching = (id: string, type: string) => ({
        id, operation: 'apply', itemCount: 1, items: [{ type, name: type === 'knowledge_source' ? 'faq' : 'ticket', existedBefore: true, prevVersion: 1 }],
    });
    const revert = (commitId: string): Door => ({
        name: 'revert', path: `/pkg-a/commits/${commitId}/revert`, method: 'POST', target: (s) => s.protocol.revertCommit,
    });
    const rollback: Door = { name: 'rollback', path: '/pkg-a/rollback', method: 'POST', body: { commitId: 'c1' }, target: (s) => s.protocol.rollbackToPackageCommit };

    it('the per-commit revert is judged on the commit it names: one that touched a knowledge source is refused, another goes on', async () => {
        const commits = [touching('c2', 'knowledge_source'), touching('c1', 'object')];
        const refused = make({ commits });
        const r = await call(refused, revert('c2'), authed(METADATA_ONLY));
        expect(r.response?.status).toBe(403);
        expect(r.response?.body?.error?.message).toContain('knowledge source "faq" in its commit history');
        expect(refused.protocol.revertCommit).not.toHaveBeenCalled();

        const other = make({ commits });
        expect((await call(other, revert('c1'), authed(METADATA_ONLY))).response?.status).not.toBe(403);
        expect(other.protocol.revertCommit).toHaveBeenCalled();
    });

    it('a commit the timeline does not list is judged on the whole timeline, never waved through', async () => {
        const s = make({ commits: [touching('c2', 'knowledge_source')] });
        expect((await call(s, revert('c_unlisted'), authed(METADATA_ONLY))).response?.status).toBe(403);
        expect(s.protocol.revertCommit).not.toHaveBeenCalled();
    });

    it('the rollback is judged on the whole timeline: a knowledge source a past commit touched refuses it though the package holds none now', async () => {
        const s = make({ items: [], drafts: [], commits: [touching('c3', 'object'), touching('c2', 'knowledge_source'), touching('c1', 'object')] });
        const r = await call(s, rollback, authed(METADATA_ONLY));
        expect(r.response?.status).toBe(403);
        expect(s.protocol.rollbackToPackageCommit).not.toHaveBeenCalled();
        // A holder rolls the same package back.
        const held = make({ commits: [touching('c2', 'knowledge_source')] });
        expect((await call(held, rollback, authed(BOTH))).response?.status).not.toBe(403);
        expect(held.protocol.rollbackToPackageCommit).toHaveBeenCalled();
    });

    it('fails closed: a timeline that cannot be read refuses the rollback 503', async () => {
        const s = make({ throws: 'listCommits' });
        expect((await call(s, rollback, authed(METADATA_ONLY))).response?.status).toBe(503);
        expect(s.protocol.rollbackToPackageCommit).not.toHaveBeenCalled();
    });
});

describe('/packages — what the gate leaves alone', () => {
    it('the draft listing\'s own answer for an id nothing carries is not a fault: the door answers that id as before', async () => {
        const s = make();
        s.protocol.listDrafts.mockImplementation(async () => {
            const err: any = new Error("'pkg-a' is not an installed package");
            err.code = 'INVALID_REQUEST';
            err.status = 400;
            throw err;
        });
        const door = DOORS.find((d) => d.name === 'POST /:id/discard-drafts')!;
        const r = await call(s, door, authed(METADATA_ONLY));
        expect(r.response?.status).not.toBe(503);
        expect(s.protocol.discardPackageDrafts).toHaveBeenCalled();
    });

    it('the install door is not asked: a packaged source arrives by that door\'s own admission (ADR-0161 K4)', async () => {
        const s = make({ items: [SOURCE_ITEM] });
        const manifest = { id: 'com.example.pkg-new', name: 'n', version: '1.0.0', type: 'app' };
        const r = await s.dispatcher.handlePackages('/', 'POST', { manifest }, { overwrite: 'true' }, authed(METADATA_ONLY));
        expect(r.response?.status).not.toBe(403);
        expect(s.registry.installPackage).toHaveBeenCalled();
    });
});
