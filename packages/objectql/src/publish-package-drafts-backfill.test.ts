// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #24253 — `publishPackageDrafts`' opt-in `backfill`: a field this publish
 * adds gets its literal `defaultValue` written into the object's existing
 * rows, as the caller, and the response counts the rows per field.
 *
 * Driven through the REAL protocol on a REAL ObjectQL engine, over an
 * in-memory driver that — like the memory and MongoDB drivers, and Turso's
 * remote transport — has no column DEFAULT: a row stored before the field
 * existed simply lacks it. (The SQL driver's `ALTER TABLE … ADD COLUMN`
 * carries the literal default, so on it the database fills those rows and a
 * backfill counts 0 — measured on a live SQLite backend, recorded on the PR.)
 *
 * The permission and hook cases use the two engine seams plugin-security and
 * authored hooks use (`registerMiddleware`, `registerHook`), so what they pin
 * is that the write reaches them carrying the caller's context.
 */
import { describe, it, expect } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { PublishPackageDraftsResponseSchema } from '@objectstack/spec/api';
import { ObjectQL } from './engine.js';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        // [#24395] The draft row's per-key provenance, written by every draft save.
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/** A schemaless store that honours `limit`, equality and the `$null` operator. */
function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const a = row[k] === undefined ? null : row[k];
            if (v && typeof v === 'object' && '$null' in (v as any)) {
                if ((a === null) !== ((v as any).$null === true)) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if (a !== (expected === undefined ? null : expected)) return false;
        }
        return true;
    };
    const finds: Array<{ object: string; limit: unknown }> = [];
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            finds.push({ object, limit: ast?.limit });
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where)).length;
        },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores, finds };
}

const PKG = 'app.edu';
const OBJ = 'case_item';
const CALLER = { userId: 'usr_editor' };

async function makeRig() {
    const engine = new ObjectQL();
    const mem = makeMemoryDriver();
    engine.registerDriver(mem.driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any, 'test-package');
    engine.registry.installPackage({ id: PKG, name: 'Edu', version: '1.0.0' } as never, 'code');
    return { engine, protocol: new ObjectStackProtocolImplementation(engine), ...mem };
}

const objectBody = (fields: Record<string, unknown>) => ({
    name: OBJ, label: 'Case Item', sharingModel: 'public_read_write', fields,
});
const TITLE = { title: { name: 'title', label: 'Title', type: 'text' } };
const DONE = { done: { name: 'done', label: 'Done', type: 'boolean', defaultValue: false } };

async function draftObject(p: ObjectStackProtocolImplementation, fields: Record<string, unknown>) {
    await (p as any).saveMetaItem({ type: 'object', name: OBJ, item: objectBody(fields), mode: 'draft', packageId: PKG });
}

/** Publishes the object with `title` only and stores `n` rows — the rows that exist before the new field does. */
async function liveObjectWithRows(rig: Awaited<ReturnType<typeof makeRig>>, n: number) {
    await draftObject(rig.protocol, TITLE);
    const first = await rig.protocol.publishPackageDrafts({ packageId: PKG });
    expect(first.outcome).toBe('published');
    for (let i = 1; i <= n; i++) await rig.engine.insert(OBJ, { title: `r${i}` }, { context: { isSystem: true } });
}

async function rows(rig: Awaited<ReturnType<typeof makeRig>>) {
    return (await rig.engine.find(OBJ, { context: { isSystem: true } })) as Array<Record<string, unknown>>;
}

/** The ADR-0112 envelope a refusal carries — its `code`, `status` and per-entry `issues[]`. */
async function refusal(pending: Promise<unknown>) {
    const err = await pending.then(() => undefined, (e) => e);
    expect(err, 'the request must be refused').toBeDefined();
    return err as { code: string; status: number; message: string; issues: Array<{ path: string; message: string }> };
}

describe('publishPackageDrafts backfill (#24253)', () => {
    it('the card: a draft adding a boolean with defaultValue false over 12 rows publishes and reads 12 false', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 12);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });

        const res = await rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'done' }], context: CALLER,
        });

        expect(res.outcome).toBe('published');
        expect(res.backfillApplied).toEqual({ success: true, fields: [{ object: OBJ, field: 'done', updated: 12 }] });
        const after = await rows(rig);
        expect(after).toHaveLength(12);
        expect(after.map((r) => r.done)).toEqual(Array(12).fill(false));
        // The declared response carries the receipt through parse unstripped.
        expect(PublishPackageDraftsResponseSchema.parse(res).backfillApplied).toEqual(res.backfillApplied);
    });

    it('nothing is backfilled unless asked: the same publish without the key leaves the 12 rows empty', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 12);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });

        const res = await rig.protocol.publishPackageDrafts({ packageId: PKG });

        expect(res.outcome).toBe('published');
        expect('backfillApplied' in res).toBe(false);
        expect((await rows(rig)).filter((r) => r.done != null)).toEqual([]);
    });

    it('a field without a defaultValue is refused in the request, by name, and nothing is published', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 3);
        await draftObject(rig.protocol, { ...TITLE, flagged: { name: 'flagged', label: 'Flagged', type: 'boolean' } });

        const err = await refusal(rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'flagged' }], context: CALLER,
        }));

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.issues).toHaveLength(1);
        expect(err.issues[0]!.path).toBe('backfill.0');
        expect(err.issues[0]!.message).toContain(`'${OBJ}.flagged' declares no defaultValue`);
        // Refused BEFORE promotion: the draft is still pending, the live object unchanged.
        expect(rig.engine.registry.getObject(OBJ)?.fields).not.toHaveProperty('flagged');
        expect((await rig.protocol.publishPackageDrafts({ packageId: PKG })).outcome).toBe('published');
    });

    it('every entry that cannot be honoured is named in ONE refusal: not new, unknown field, unknown object, token default', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 2);
        await draftObject(rig.protocol, {
            ...TITLE, ...DONE,
            seen_at: { name: 'seen_at', label: 'Seen', type: 'datetime', defaultValue: 'NOW()' },
        });

        const err = await refusal(rig.protocol.publishPackageDrafts({
            packageId: PKG,
            backfill: [
                { object: OBJ, field: 'title' },
                { object: OBJ, field: 'nope' },
                { object: 'other_obj', field: 'done' },
                { object: OBJ, field: 'seen_at' },
                { object: OBJ, field: 'done' },
            ],
            context: CALLER,
        }));

        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.status).toBe(400);
        expect(err.issues.map((i) => i.path)).toEqual(['backfill.0', 'backfill.1', 'backfill.2', 'backfill.3']);
        expect(err.issues[0]!.message).toContain('already exists on the published object');
        expect(err.issues[1]!.message).toContain("declares no field 'nope'");
        expect(err.issues[2]!.message).toContain("no pending draft of object 'other_obj'");
        expect(err.issues[3]!.message).toContain('runtime token');
        expect((await rows(rig)).filter((r) => r.done != null)).toEqual([]);
    });

    it('the request shape is judged first: unknown keys, duplicates, a non-array, and no caller context', async () => {
        const rig = await makeRig();
        const shapes: Array<[unknown, unknown, string]> = [
            [{ object: OBJ, field: 'done' }, CALLER, 'backfill'],
            [[{ object: OBJ, field: 'done', value: true }], CALLER, 'backfill.0'],
            [[{ object: OBJ, field: 'done' }, { object: OBJ, field: 'done' }], CALLER, 'backfill.1'],
            [[{ object: OBJ, field: 'done' }], undefined, 'backfill'],
        ];
        for (const [backfill, context, path] of shapes) {
            const err = await refusal(rig.protocol.publishPackageDrafts({ packageId: PKG, backfill: backfill as any, context }));
            expect(err.code).toBe('VALIDATION_ERROR');
            expect(err.status).toBe(400);
            expect(err.issues.map((i) => i.path)).toContain(path);
        }
    });

    it('only rows whose value is absent are written: a value already stored is neither overwritten nor counted', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 12);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });
        // A row that already carries `done: true` (written by a path that knew the column).
        const [first] = await rows(rig);
        (rig.stores.get(OBJ)!.get(String(first!.id)) as Record<string, unknown>).done = true;

        const res = await rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'done' }], context: CALLER,
        });

        expect(res.backfillApplied?.fields[0]?.updated).toBe(11);
        const after = await rows(rig);
        expect(after.find((r) => r.id === first!.id)?.done).toBe(true);
        expect(after.filter((r) => r.done === false)).toHaveLength(11);
    });

    it('rows are read a page at a time: 205 rows take two full pages and a final empty read', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 205);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });
        rig.finds.length = 0;

        const res = await rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'done' }], context: CALLER,
        });

        expect(res.backfillApplied?.fields[0]?.updated).toBe(205);
        const pageReads = rig.finds.filter((f) => f.object === OBJ && f.limit === 200);
        expect(pageReads).toHaveLength(3);
        expect((await rows(rig)).every((r) => r.done === false)).toBe(true);
    });

    it('the writes run as the caller: the CRUD seam and a record hook both see the caller, never the system', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 3);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });
        const seenBySeam: unknown[] = [];
        const seenByHook: unknown[] = [];
        rig.engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            if (opCtx.object === OBJ && opCtx.operation === 'update') seenBySeam.push(opCtx.context);
            await next();
        });
        rig.engine.registerHook('beforeUpdate', async (ctx: any) => {
            seenByHook.push({ userId: ctx.session?.userId ?? ctx.context?.userId, data: ctx.input?.data });
        }, { object: OBJ });

        const res = await rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'done' }], context: CALLER,
        });

        expect(res.backfillApplied?.fields[0]?.updated).toBe(3);
        expect(seenBySeam).toHaveLength(3);
        for (const c of seenBySeam) {
            expect((c as any)?.userId).toBe(CALLER.userId);
            expect((c as any)?.isSystem).not.toBe(true);
        }
        expect(seenByHook).toHaveLength(3);
        for (const h of seenByHook) expect((h as any).data).toEqual({ done: false });
    });

    it('a caller the object refuses the update is reported, loudly, with nothing written and the publish kept', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 4);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });
        rig.engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
            if (opCtx.object === OBJ && opCtx.operation === 'update' && !opCtx.context?.isSystem) {
                throw Object.assign(new Error(`Permission denied: update on '${OBJ}'`), { code: 'PERMISSION_DENIED', status: 403 });
            }
            await next();
        });

        const res = await rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'done' }], context: { userId: 'usr_viewer' },
        });

        expect(res.outcome).toBe('published');
        expect(rig.engine.registry.getObject(OBJ)?.fields).toHaveProperty('done');
        expect(res.backfillApplied?.success).toBe(false);
        const f = res.backfillApplied!.fields[0]!;
        expect(f).toMatchObject({ object: OBJ, field: 'done', updated: 0, code: 'PERMISSION_DENIED' });
        expect(f.error).toContain('was not written');
        expect((await rows(rig)).filter((r) => r.done != null)).toEqual([]);
        expect(PublishPackageDraftsResponseSchema.parse(res).backfillApplied).toEqual(res.backfillApplied);
    });

    it('a hook that clears the value stops the field instead of looping, with the count so far', async () => {
        const rig = await makeRig();
        await liveObjectWithRows(rig, 2);
        await draftObject(rig.protocol, { ...TITLE, ...DONE });
        rig.engine.registerHook('beforeUpdate', async (ctx: any) => {
            if (ctx.input?.data && 'done' in ctx.input.data) ctx.input.data.done = null;
        }, { object: OBJ });

        const res = await rig.protocol.publishPackageDrafts({
            packageId: PKG, backfill: [{ object: OBJ, field: 'done' }], context: CALLER,
        });

        expect(res.outcome).toBe('published');
        expect(res.backfillApplied?.success).toBe(false);
        expect(res.backfillApplied?.fields[0]?.updated).toBe(0);
        expect(res.backfillApplied?.fields[0]?.error).toContain('left empty');
    });
});
