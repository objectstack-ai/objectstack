// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7559 — the revert path's history lookup must ask under the key the history
 * WRITER used, against a REAL {@link ObjectQL} engine and the REAL
 * {@link SysMetadataRepository} behind the protocol.
 *
 * ## Why a real engine, and why the whole publish→revert round trip
 *
 * The existing ADR-0067 suites (`protocol-commit-history.test.ts`) stub
 * `repo.restoreVersion` outright, so they pin the revert PLAN — created →
 * soft-remove, edited → restoreVersion(prevVersion) — and are structurally
 * unable to see whether the number in that plan resolves to a row. #7559 lived
 * exactly in that gap: the plan was right and the lookup missed.
 *
 * ## The measurement this file pins (both sides of the same row)
 *
 * Drive a package publish twice with an active organization, over drafts
 * authored env-wide (what Studio / AI authoring writes, and what
 * `SysMetadataRepository.listDrafts`'s `$or` deliberately surfaces to a
 * non-null-org caller):
 *
 * | | writer | reader (before the fix) |
 * |---|---|---|
 * | version base | `sys_metadata_history.version`, the per-(org,type,name) lineage counter — drafts consume numbers too, so publish #1 is v2 and publish #2 is v4, and the commit records `prevVersion: 2` | asks for version `2` — AGREES |
 * | `package_id` | history carries no `package_id` column at all | not filtered — AGREES (so NOT the #6215 scoping) |
 * | `organization_id` | `NULL` — publish routes each draft to the draft's OWN scope (#3115) | the REQUEST's active org — **DISAGREES** |
 *
 * so the revert answered `VERSION_NOT_FOUND: No history row at version 2` over
 * a row the history endpoint lists. `organization_id` is the disagreeing key,
 * alone; the other two agree, which is what makes this a distinct defect rather
 * than a regression of #6215 (that one fails LATER, at `restoreVersion`'s
 * `put()` parent lookup, with a 409).
 *
 * ## What each test is for
 *
 * The POSITIVE identity is pinned first and asserts the restored BODY, not just
 * the absence of an error: a revert that "succeeds" while restoring the wrong
 * version is the failure this card is one step away from. The refusal case then
 * asserts `code` AND `status` (ADR-0112) — a bare `rejects.toThrow()` is green
 * against an implementation that throws a naked `Error`, so it proves nothing
 * about the envelope.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';

const txt = (name: string, extra: Record<string, unknown> = {}) =>
    ({ name, label: name, type: 'text' as const, ...extra });
const num = (name: string) => ({ name, label: name, type: 'number' as const });
const dt = (name: string) => ({ name, label: name, type: 'datetime' as const });
const long = (name: string) => ({ name, label: name, type: 'longtext' as const });

const sysMetadataObject = {
    name: 'sys_metadata', label: 'System Metadata',
    fields: {
        id: txt('id', { primaryKey: true }),
        type: txt('type', { required: true }), name: txt('name', { required: true }),
        organization_id: txt('organization_id'), package_id: txt('package_id'),
        metadata: long('metadata'), checksum: txt('checksum', { maxLength: 71 }),
        state: txt('state'), version: num('version'),
        created_at: dt('created_at'), updated_at: dt('updated_at'),
        created_by: txt('created_by'), updated_by: txt('updated_by'),
    },
};

const sysMetadataHistoryObject = {
    name: 'sys_metadata_history', label: 'Metadata History',
    fields: {
        id: txt('id', { primaryKey: true }), event_seq: num('event_seq'),
        type: txt('type', { required: true }), name: txt('name', { required: true }),
        version: num('version'), operation_type: txt('operation_type'),
        metadata: long('metadata'), checksum: txt('checksum', { maxLength: 71 }),
        previous_checksum: txt('previous_checksum', { maxLength: 71 }),
        change_note: long('change_note'), source: txt('source'),
        organization_id: txt('organization_id'), recorded_by: txt('recorded_by'),
        recorded_at: dt('recorded_at'),
    },
};

const sysMetadataCommitObject = {
    name: 'sys_metadata_commit', label: 'Metadata Commit',
    fields: {
        id: txt('id', { primaryKey: true }), package_id: txt('package_id'),
        operation: txt('operation'), message: long('message'), actor: txt('actor'),
        ai_model: txt('ai_model'), parent_commit_id: txt('parent_commit_id'),
        event_seq_start: num('event_seq_start'), event_seq_end: num('event_seq_end'),
        items: long('items'), item_count: num('item_count'),
        organization_id: txt('organization_id'), created_at: dt('created_at'),
    },
};

/**
 * Minimal driver; equality-only WHERE.
 *
 * `$and` / `$or` are conjoined WITH their sibling keys, which is the one thing
 * this stub may NOT get wrong here: `listDrafts` sends
 * `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`,
 * and the short-circuiting shape some older stubs in this package use
 * (`if ($or) return $or.some(...)`) drops the `state` and `package_id` filters
 * and hands back rows no real driver would — which silently turns this whole
 * scenario into a different one.
 */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    let nextId = 0;

    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and') {
                if (!(v as any[]).every((w) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or') {
                if (!(v as any[]).some((w) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };

    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(o: string, ast: any) {
            return Array.from(storeFor(o).values()).filter((r) => matchesWhere(r, ast?.where));
        },
        async findOne(o: string, ast: any) {
            for (const r of storeFor(o).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(o).set(id, row);
            return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${o}/${id}`);
            const u = { ...cur, ...data, id };
            s.set(id, u);
            return u;
        },
        async upsert(o: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(o).has(id)) return this.update(o, id, data);
            return this.create(o, data);
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(o, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver };
}

const PKG = 'app.revertscope';
const ORG = 'org_x';
const viewBody = (label: string) => ({ name: 'cases', type: 'grid', label, columns: ['id'] });

describe('#7559 — the revert reads the history row under the key the writer stored it with', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject);
        engine.registry.registerObject(sysMetadataHistoryObject);
        engine.registry.registerObject(sysMetadataCommitObject);
        protocol = new ObjectStackProtocolImplementation(engine);
        (protocol as any).ensureOverlayIndex = async () => {};
    });

    /** The active row's stored body, read straight out of the table. */
    const activeBody = async (orgId: string | null) => {
        const row = (await engine.findOne('sys_metadata', {
            where: { organization_id: orgId, type: 'view', name: 'cases', state: 'active' },
        })) as any;
        return row ? JSON.parse(row.metadata) : null;
    };

    /**
     * The card's reproduction: two publishes of an env-wide draft, driven by a
     * caller carrying an active org — which is every console request, since
     * `resolveActiveOrganizationId` puts one on all of them.
     */
    const publishTwiceEnvWideAsOrg = async () => {
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', item: viewBody('A'), packageId: PKG, mode: 'draft',
        });
        await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, message: 'publish 1',
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', item: viewBody('B'), packageId: PKG, mode: 'draft',
        });
        const p2 = await protocol.publishPackageDrafts({
            packageId: PKG, organizationId: ORG, message: 'publish 2',
        });
        return p2;
    };

    // ── POSITIVE IDENTITY FIRST ──────────────────────────────────────────
    // Pinned before any refusal so this suite cannot pass by refusing
    // everything, and asserting the restored BODY so it cannot pass by
    // reverting to the wrong version.

    it('revertCommit restores the pre-commit BODY for an env-wide item when the caller has an active org', async () => {
        const p2 = await publishTwiceEnvWideAsOrg();
        expect(p2.success).toBe(true);
        expect(p2.commitId).toBeTruthy();
        // Live state is publish #2's body before the revert.
        expect(await activeBody(null)).toMatchObject({ label: 'B' });

        const res = await protocol.revertCommit({
            commitId: p2.commitId!, organizationId: ORG,
        });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(res.reverted).toEqual([{ type: 'view', name: 'cases', action: 'restored' }]);
        // The identity that matters: publish #1's body is live again, in the
        // env-wide scope it was published into.
        expect(await activeBody(null)).toMatchObject({ label: 'A' });
    });

    it('the writer and the reader address the SAME row — history is env-wide, and the commit asks for a version that is in it', async () => {
        const p2 = await publishTwiceEnvWideAsOrg();

        // WRITER: every history row landed env-wide, and the lineage counter
        // numbers drafts too, so the pre-commit publish is version 2.
        const hist = (await engine.find('sys_metadata_history', { where: {} })) as any[];
        expect(hist.map((r) => ({ v: r.version, org: r.organization_id ?? null }))).toEqual([
            { v: 1, org: null }, { v: 2, org: null }, { v: 3, org: null }, { v: 4, org: null },
        ]);

        // READER: the commit's revert plan asks for exactly that version.
        const commits = await protocol.listCommits({ packageId: PKG, organizationId: ORG });
        const target = commits.find((c) => c.id === p2.commitId)!;
        expect(target.items).toEqual([
            { type: 'view', name: 'cases', existedBefore: true, prevVersion: 2 },
        ]);

        // …and #6215's `package_id` scoping is NOT what is in play here: the
        // history table the version lookup reads carries no such column.
        expect(Object.keys(hist[0])).not.toContain('package_id');
    });

    it('rollbackMetaItem — the sibling item-level revert — restores the same env-wide item for an org caller', async () => {
        await publishTwiceEnvWideAsOrg();
        expect(await activeBody(null)).toMatchObject({ label: 'B' });

        const res = await protocol.rollbackMetaItem({
            type: 'view', name: 'cases', toVersion: 2, organizationId: ORG,
        });

        expect(res.success).toBe(true);
        expect(res.restoredFromVersion).toBe(2);
        expect(await activeBody(null)).toMatchObject({ label: 'A' });
    });

    it('an ORG-SCOPED item is still reverted in its OWN scope, not redirected env-wide', async () => {
        // The control for the resolution's precedence: an org that has its own
        // overlay row must keep reverting that row. Without it, "fall back to
        // env-wide" could pass every test above while quietly hijacking the
        // org-scoped case that already worked.
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', item: viewBody('ORG-A'),
            packageId: PKG, mode: 'draft', organizationId: ORG,
        });
        await protocol.publishPackageDrafts({ packageId: PKG, organizationId: ORG });
        await protocol.saveMetaItem({
            type: 'view', name: 'cases', item: viewBody('ORG-B'),
            packageId: PKG, mode: 'draft', organizationId: ORG,
        });
        const p2 = await protocol.publishPackageDrafts({ packageId: PKG, organizationId: ORG });

        const res = await protocol.revertCommit({
            commitId: p2.commitId!, organizationId: ORG,
        });

        expect(res.failed).toEqual([]);
        expect(res.success).toBe(true);
        expect(await activeBody(ORG)).toMatchObject({ label: 'ORG-A' });
        // Nothing was written into the env-wide scope on this org's behalf.
        expect(await activeBody(null)).toBeNull();
    });

    // ── REFUSALS — `code` AND `status`, never a bare throw ────────────────

    it('a version that genuinely has no history row is still refused, with the ADR-0112 envelope', async () => {
        // The fix widens WHERE the lookup looks; it must not make a real miss
        // resolve to something. Version 99 exists in no scope.
        await publishTwiceEnvWideAsOrg();

        await expect(
            protocol.rollbackMetaItem({
                type: 'view', name: 'cases', toVersion: 99, organizationId: ORG,
            }),
        ).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND', status: 404 });
    });

    it('revertCommit reports a genuinely missing version per item, carrying the code', async () => {
        await publishTwiceEnvWideAsOrg();
        // Hand-write a commit whose plan points at a version nobody ever wrote.
        await engine.insert('sys_metadata_commit', {
            id: 'cmt_bogus', package_id: PKG, operation: 'apply',
            organization_id: ORG, item_count: 1,
            items: JSON.stringify([
                { type: 'view', name: 'cases', existedBefore: true, prevVersion: 99 },
            ]),
            created_at: '2026-08-11T00:00:00.000Z',
        });

        const res = await protocol.revertCommit({ commitId: 'cmt_bogus', organizationId: ORG });

        expect(res.success).toBe(false);
        expect(res.failedCount).toBe(1);
        expect(res.failed[0]).toMatchObject({
            type: 'view', name: 'cases', code: 'VERSION_NOT_FOUND',
        });
    });

    it('an unknown commit id is refused with COMMIT_NOT_FOUND / 404', async () => {
        await expect(
            protocol.revertCommit({ commitId: 'cmt_nope', organizationId: ORG }),
        ).rejects.toMatchObject({ code: 'COMMIT_NOT_FOUND', status: 404 });
    });
});
