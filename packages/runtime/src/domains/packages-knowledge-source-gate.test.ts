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
import { ObjectKernel, ServiceLifecycle } from '@objectstack/core';
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
    throws?: 'getMetaItemsPerPackage' | 'listDrafts' | 'listCommits';
}

function make(holding: Holding = {}, knowledge?: unknown) {
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
        getMetaItemsPerPackage: vi.fn(async ({ type }: any) => {
            fail('getMetaItemsPerPackage')();
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
                name === 'objectql' ? objectql
                    : name === 'protocol' ? protocol
                        : name === 'metadata' ? metadata
                            : name === 'knowledge' ? (knowledge ?? null)
                                : null,
        },
    };
    return { dispatcher: new HttpDispatcher(kernel), protocol, metadata, registry, kernelServices: { objectql, protocol, metadata } };
}

type Stack = ReturnType<typeof make>;
interface Door {
    name: string; path: string; method: string; body?: any; tenantId?: string;
    target: (s: Stack) => any;
}

/**
 * Every door that writes an existing package, each with the writer it must not
 * reach when refused. The install door and the ensure-customization door are
 * not here: neither is asked (pinned under "what the gate leaves alone").
 */
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

        it(`${door.name}: a holder of both capabilities goes on, and the capability gate reads no draft listing for it`, async () => {
            // A host that mounts a knowledge service admitting each source: the duplicate copies them as the caller,
            // and on a host with none a duplicate that copies one is refused (ruled D, pinned below).
            const s = make({ items: [SOURCE_ITEM], drafts: [SOURCE_DRAFT] }, { admitAuthoredSource: async () => ({ admitted: true }) });
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
            const s = make({ throws: 'getMetaItemsPerPackage' });
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

describe('/packages — duplicate admits each knowledge source it copies for the caller (guard two)', () => {
    const DUPLICATE = DOORS.find((d) => d.name === 'POST /:id/duplicate')!;
    const REFUSAL = {
        admitted: false, status: 403, code: 'PERMISSION_DENIED',
        message: "The knowledge source \"faq\" was not saved: you may not query field 'salary' of object 'article'.",
    };
    /** A stack whose kernel also serves a knowledge service answering `admit`. */
    function withKnowledge(holding: Holding, admit: (item: unknown, ctx: unknown) => unknown) {
        const admitAuthoredSource = vi.fn(async (item: unknown, c: unknown) => admit(item, c));
        return { ...make(holding, { admitAuthoredSource }), admitAuthoredSource };
    }

    it('a holder of both capabilities who may not search what a source indexes is refused with the gate\'s sentence, and nothing is copied', async () => {
        const s = withKnowledge({ items: [SOURCE_ITEM] }, () => REFUSAL);
        const caller = authed(BOTH);
        const r = await call(s, DUPLICATE, caller);
        expect(r.response?.status).toBe(403);
        expect(r.response?.body?.error?.message).toContain('nothing was copied');
        expect(r.response?.body?.error?.message).toContain(REFUSAL.message);
        expect(s.protocol.duplicatePackage).not.toHaveBeenCalled();
        // Judged as the caller, on the item the package holds.
        expect(s.admitAuthoredSource).toHaveBeenCalledWith(SOURCE_ITEM, caller.executionContext);
    });

    // The save refusal of a source whose `adapter` the deployment does not
    // mount is a `400`, where the gates' own are `403`: the door answers the
    // predicate's status and sentence, never one of its own.
    it('a source naming an adapter the deployment does not mount refuses the duplicate 400 VALIDATION_ERROR with the save\'s sentence, and nothing is copied', async () => {
        const UNMOUNTED = {
            admitted: false, status: 400, code: 'VALIDATION_ERROR',
            message: "The knowledge source \"faq\" was not saved: it names adapter 'ragflow', which this deployment does not mount (mounted: memory).",
        };
        const held = { ...SOURCE_ITEM, adapter: 'ragflow' };
        const s = withKnowledge({ items: [held] }, () => UNMOUNTED);
        const caller = authed(BOTH);
        const r = await call(s, DUPLICATE, caller);
        expect(r.response?.status).toBe(400);
        expect(r.response?.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(r.response?.body?.error?.message).toContain('nothing was copied');
        expect(r.response?.body?.error?.message).toContain(UNMOUNTED.message);
        expect(s.protocol.duplicatePackage).not.toHaveBeenCalled();
        expect(s.admitAuthoredSource).toHaveBeenCalledWith(held, caller.executionContext);
    });

    it('every source is asked about: the second one refused refuses the duplicate', async () => {
        const second = { ...SOURCE_ITEM, name: 'handbook' };
        const s = withKnowledge({ items: [SOURCE_ITEM, second] }, (item: any) => (item.name === 'handbook' ? REFUSAL : { admitted: true }));
        expect((await call(s, DUPLICATE, authed(BOTH))).response?.status).toBe(403);
        expect(s.admitAuthoredSource).toHaveBeenCalledTimes(2);
        expect(s.protocol.duplicatePackage).not.toHaveBeenCalled();
    });

    it('fails closed: a verdict that throws, and a listing that throws, refuse 503', async () => {
        const thrown = withKnowledge({ items: [SOURCE_ITEM] }, () => { throw new Error('registry unavailable'); });
        expect((await call(thrown, DUPLICATE, authed(BOTH))).response?.status).toBe(503);
        expect(thrown.protocol.duplicatePackage).not.toHaveBeenCalled();

        const unread = withKnowledge({ throws: 'getMetaItemsPerPackage' }, () => ({ admitted: true }));
        const r = await call(unread, DUPLICATE, authed(BOTH));
        expect(r.response?.status).toBe(503);
        expect(r.response?.body?.error?.message).toContain('Nothing was copied');
        expect(unread.protocol.duplicatePackage).not.toHaveBeenCalled();
    });

    it('CONTROL: admitted sources are copied; a package with none copies as before', async () => {
        const admitted = withKnowledge({ items: [SOURCE_ITEM] }, () => ({ admitted: true }));
        expect((await call(admitted, DUPLICATE, authed(BOTH))).response?.status).not.toBe(403);
        expect(admitted.protocol.duplicatePackage).toHaveBeenCalled();

        const none = withKnowledge({ items: [] }, () => REFUSAL);
        expect((await call(none, DUPLICATE, authed(METADATA_ONLY))).response?.status).not.toBe(403);
        expect(none.admitAuthoredSource).not.toHaveBeenCalled();
        expect(none.protocol.duplicatePackage).toHaveBeenCalled();
    });

    /**
     * The duplicate saves each source again, for the caller, through the
     * predicate the `/meta` save asks: on a deployment with no knowledge
     * service the copy of a source would be kept and never served, so the
     * duplicate is refused as the save is, naming the remedy.
     */
    it('a host with no knowledge service refuses a duplicate that copies a source 503, naming the remedy, and nothing is copied', async () => {
        const noService = make({ items: [SOURCE_ITEM] });
        const r = await call(noService, DUPLICATE, authed(BOTH));
        expect(r.response?.status).toBe(503);
        expect(r.response?.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
        const message: string = r.response?.body?.error?.message;
        expect(message).toMatch(
            /^Duplicating package "pkg-a" is refused, and nothing was copied\. The knowledge source 'faq' cannot be copied: this deployment runs no knowledge service/,
        );
        expect(message).toMatch(/requires: \['knowledge'\].*restart the server, then duplicate the package again: /);
        // The caller duplicates a package: never told to save a source, and told once that nothing was copied.
        expect(message).not.toMatch(/save the source|Nothing was written/);
        expect(message.match(/nothing was copied/gi)).toHaveLength(1);
        expect(noService.protocol.duplicatePackage).not.toHaveBeenCalled();

        // A package with no source, and the engine's own call, copy as before.
        const none = make({ items: [] });
        expect((await call(none, DUPLICATE, authed(BOTH))).response?.status).not.toBe(503);
        expect(none.protocol.duplicatePackage).toHaveBeenCalled();
        const engine = make({ items: [SOURCE_ITEM] });
        expect((await call(engine, DUPLICATE, system())).response?.status).not.toBe(503);
        expect(engine.protocol.duplicatePackage).toHaveBeenCalled();
    });

    /**
     * A host that registers `knowledge` per environment and serves no instance
     * for this request's: the deployment runs a knowledge service, so the
     * caller is told what is true and the stack's `requires` is not named.
     */
    it('a knowledge service registered with no instance in the request\'s environment refuses 503 with its own sentence; the plain instance is the control', async () => {
        const scoped = make({ items: [SOURCE_ITEM] });
        const kernel = new ObjectKernel({ gracefulShutdown: false, skipSystemValidation: true });
        for (const name of ['objectql', 'protocol', 'metadata'] as const) {
            kernel.registerService(name, scoped.kernelServices[name]);
        }
        kernel.registerServiceFactory('knowledge', () => undefined, ServiceLifecycle.SCOPED);
        const r = await new HttpDispatcher(kernel as any).handlePackages('/pkg-a/duplicate', 'POST', { targetPackageId: 'pkg-b' }, {}, authed(BOTH));
        expect(r.response?.status).toBe(503);
        expect(r.response?.body?.error?.code).toBe('SERVICE_UNAVAILABLE');
        const message: string = r.response?.body?.error?.message;
        expect(message).toMatch(
            /^Duplicating package "pkg-a" is refused, and nothing was copied\. The knowledge source 'faq' cannot be copied: the knowledge service registered on this deployment serves no instance for environment 'platform'/,
        );
        expect(message).not.toMatch(/runs no knowledge service|requires: \['knowledge'\]|save the source|Nothing was written/);
        expect(scoped.protocol.duplicatePackage).not.toHaveBeenCalled();

        // CONTROL: a plain instance, as the platform's plugin registers it, is asked and admits.
        const plain = make({ items: [SOURCE_ITEM] });
        const plainKernel = new ObjectKernel({ gracefulShutdown: false, skipSystemValidation: true });
        for (const name of ['objectql', 'protocol', 'metadata'] as const) {
            plainKernel.registerService(name, plain.kernelServices[name]);
        }
        const admitAuthoredSource = vi.fn(async () => ({ admitted: true }));
        plainKernel.registerService('knowledge', { admitAuthoredSource });
        const ok = await new HttpDispatcher(plainKernel as any).handlePackages('/pkg-a/duplicate', 'POST', { targetPackageId: 'pkg-b' }, {}, authed(BOTH));
        expect(ok.response?.status).not.toBe(503);
        expect(admitAuthoredSource).toHaveBeenCalledTimes(1);
        expect(plain.protocol.duplicatePackage).toHaveBeenCalled();
    });

    it('the engine\'s own call is not asked', async () => {
        const s = withKnowledge({ items: [SOURCE_ITEM] }, () => REFUSAL);
        expect((await call(s, DUPLICATE, system())).response?.status).not.toBe(403);
        expect(s.admitAuthoredSource).not.toHaveBeenCalled();
        expect(s.protocol.duplicatePackage).toHaveBeenCalled();
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

    it('a host with no metadata store holds no knowledge source: a missing table, and a store object the engine does not hold, are not faults', async () => {
        const absent: Array<() => Error> = [
            () => new Error('no such table: sys_metadata'),
            () => Object.assign(new Error("Object 'sys_metadata' not found"), { code: 'OBJECT_NOT_FOUND', status: 404, object: 'sys_metadata' }),
        ];
        const door = DOORS.find((d) => d.name === 'PATCH /:id/disable')!;
        for (const error of absent) {
            const s = make();
            s.protocol.listDrafts.mockImplementation(async () => { throw error(); });
            s.protocol.getMetaItemsPerPackage.mockImplementation(async () => { throw error(); });
            const r = await call(s, door, authed(METADATA_ONLY));
            expect(r.response?.status, error().message).toBe(200);
            expect(s.registry.disablePackage).toHaveBeenCalled();
        }
        // CONTROL: the same envelope naming another object is a listing that
        // could not be read, and refuses.
        const s = make();
        s.protocol.listDrafts.mockImplementation(async () => {
            throw Object.assign(new Error("Object 'ghost' not found"), { code: 'OBJECT_NOT_FOUND', status: 404, object: 'ghost' });
        });
        const r = await call(s, door, authed(METADATA_ONLY));
        expect(r.response?.status).toBe(503);
        expect(s.registry.disablePackage).not.toHaveBeenCalled();
    });

    it('the ensure-customization door is not asked: it writes nothing of the base, and the pair it creates is empty', async () => {
        const s = make({ items: [SOURCE_ITEM], drafts: [SOURCE_DRAFT] });
        const r = await s.dispatcher.handlePackages('/pkg-a/ensure-customization', 'POST', {}, {}, authed(METADATA_ONLY));
        expect(r.response?.status).toBe(201);
        expect(s.protocol.ensureCustomizationPackage).toHaveBeenCalledWith({ basePackageId: 'pkg-a' });
        expect(s.protocol.getMetaItemsPerPackage).not.toHaveBeenCalled();
        expect(s.protocol.listDrafts).not.toHaveBeenCalled();
    });

    it('the install door is not asked: a packaged source arrives by that door\'s own admission (ADR-0161 K4)', async () => {
        const s = make({ items: [SOURCE_ITEM] });
        const manifest = { id: 'com.example.pkg-new', name: 'n', version: '1.0.0', type: 'app' };
        const r = await s.dispatcher.handlePackages('/', 'POST', { manifest }, { overwrite: 'true' }, authed(METADATA_ONLY));
        expect(r.response?.status).not.toBe(403);
        expect(s.registry.installPackage).toHaveBeenCalled();
    });
});
