// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23119, ADR-0010 §3.5 and §4.1] The save door's author faces never set,
 * change or remove an item's lock.
 *
 * The `_lock*` family (`_lock`, `_lockReason`, `_lockDocsUrl`, `_lockSource`)
 * is the runtime's private envelope: a code package's loader stamps it from
 * `protection`, and an install or a migration's re-save carries it. The door
 * used to store a body's family verbatim, so a hand-written or echoed
 * `_lock: 'full'` bound the item: the next save and the delete answered
 * `403 ITEM_LOCKED`, and no door unlocks it. And the other way round, an author
 * save that sent no family dropped a lock a server face had stamped.
 *
 * The pins, on both author faces (`meta-envelope`, the REST `PUT`, and
 * `meta-dispatch`, the runtime dispatcher):
 *
 *  - the card's probe: a family on a new item is refused with a located
 *    `400 VALIDATION_ERROR`, nothing is stored, and the item stays editable
 *    and deletable;
 *  - the add, the change and the removal are each refused, on an item with a
 *    server-stamped lock and on one without, in publish and draft mode;
 *  - the echo is accepted and ignored: of a stored row's family, of a packaged
 *    item's served family on its first overlay (a new row), in draft mode, and
 *    on a clone of an item that serves no lock — while a clone carrying
 *    another item's lock is refused;
 *  - a lock a server face stamped (`source`, `package-duplicate`) still binds
 *    afterwards, and an author save without a family keeps it;
 *  - CONTROL: a body without a family saves as before, and the item stays
 *    editable and deletable;
 *  - CONTROL: a family value the type's declaration refuses is still the
 *    parse's `422 INVALID_METADATA`;
 *  - a type with no schema (`external_catalog`) is judged too.
 *
 * Refusals are asserted as the envelope an HTTP boundary answers with
 * (`resolveThrownHttpError`), never as a bare throw.
 *
 * The engine below is a stub: this package cannot import `@objectstack/objectql`
 * (that package depends on this one). It keeps real rows, so the REAL save,
 * read and delete doors run against it, and its write verbs route through the
 * producer's own dispatch predicates.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch, isCodeArtifactBody } from '@objectstack/metadata-core';
import { applyProtection } from '@objectstack/spec/shared';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

type Row = Record<string, any>;

const PACKAGE_ID = 'com.example.locks';
const LOCK_KEYS = ['_lock', '_lockReason', '_lockDocsUrl', '_lockSource'] as const;

/** Equality and `null`; any other operator is refused, so a matcher that ignored one cannot prove anything. */
/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key.startsWith('$')) throw new Error(`stub engine: unsupported operator ${key}`);
        if (want !== null && typeof want === 'object' && !Array.isArray((want as { $in?: unknown }).$in)) {
            throw new Error(`stub engine: unsupported operator on ${key}`);
        }
        if (!whereValueMatches(row[key] ?? null, want)) return false;
    }
    return true;
}

/**
 * A stub engine that keeps rows, and a registry holding what a code package's
 * loader registered: each artifact as `applyProtection` leaves it.
 */
function makeProtocol(artifacts: Array<{ type: string; item: Record<string, unknown> }> = []) {
    const tables = new Map<string, Row[]>();
    const table = (name: string) => {
        if (!tables.has(name)) tables.set(name, []);
        return tables.get(name)!;
    };
    let nextId = 0;
    const writes: Array<{ op: string; table: string }> = [];
    const shipped = (type: string, name: string) => artifacts
        .filter((a) => a.type === type && a.item.name === name)
        .map((a) => a.item);
    const engine: any = {
        async find(t: string, q?: { where?: Record<string, unknown>; limit?: number }) {
            const rows = table(t).filter((r) => matches(r, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        async findOne(t: string, q: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, q);
            return table(t).find((r) => matches(r, q.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            writes.push({ op: 'insert', table: t });
            nextId += 1;
            const row = { id: `r_${nextId}`, ...data };
            table(t).push(row);
            return { ...row };
        },
        async update(t: string, data: Row, q?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, q);
            writes.push({ op: 'update', table: t });
            const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
            const hit = table(t).filter((r) => matches(r, where));
            for (const r of hit) Object.assign(r, data);
            return { id: hit[0]?.id ?? null };
        },
        async delete(t: string, q?: Record<string, unknown>) {
            assertEngineDeleteDispatch(q);
            writes.push({ op: 'delete', table: t });
            const where = (q as { where?: Record<string, unknown> } | undefined)?.where;
            const keep = table(t).filter((r) => !matches(r, where));
            const deleted = table(t).length - keep.length;
            tables.set(t, keep);
            return { deleted };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            getArtifactItem: (type: string, name: string) => shipped(type, name).find((item) => isCodeArtifactBody(item)),
            getItem: (type: string, name: string) => shipped(type, name)[0],
            listItems: (type: string) => artifacts.filter((a) => a.type === type).map((a) => a.item),
            getObject: () => undefined,
            getPackage: () => undefined,
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    const metadataWrites = () => writes.filter((w) => w.table === 'sys_metadata' && w.op !== 'delete');
    const rows = (type: string, name: string, state = 'active') =>
        table('sys_metadata').filter((r) => r.type === type && r.name === name && r.state === state);
    /** The lock family the item's row stores, or `undefined` when it has no row. */
    const storedFamily = (type: string, name: string, state = 'active') => {
        const [row] = rows(type, name, state);
        return row ? familyOf(JSON.parse(row.metadata)) : undefined;
    };
    return { protocol, metadataWrites, rows, storedFamily };
}

function familyOf(body: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(LOCK_KEYS.filter((k) => body[k] !== undefined).map((k) => [k, body[k]]));
}

/**
 * A dashboard a code package ships, as its loader registers it: `protection`
 * translated and stripped. A dashboard, because its type takes an environment
 * overlay (an `app` a package ships is sealed against one).
 */
function packagedDashboard(name: string, protection: { lock: string; reason: string }) {
    const item: Record<string, unknown> = { name, label: `Packaged ${name}`, widgets: [], protection };
    applyProtection(item, { packageId: PACKAGE_ID, packageVersion: '1.0.0' });
    return { type: 'dashboard', item };
}

const app = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: `App ${name}`, ...extra });

/** The lock a server face stamps: a migration's re-save carries the family a stored body holds. */
const STAMPED = { _lock: 'no-delete', _lockReason: 'Stamped by the platform.', _lockSource: 'package' } as const;

async function stamp(protocol: any, name: string, family: Record<string, unknown> = STAMPED): Promise<void> {
    const r = await protocol.saveMetaItem({ type: 'app', name, item: app(name, family), source: 'migrate-stored', force: true });
    expect(r.success).toBe(true);
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

/** The refusal's envelope and its location: every family key sent, named in the message and as an issue path. */
function expectLockFamilyRefusal(err: any, sentKeys: readonly string[], effect: string): void {
    const envelope = resolveThrownHttpError(err);
    expect(envelope.status).toBe(400);
    expect(envelope.code).toBe('VALIDATION_ERROR');
    expect(err.issues.map((i: any) => i.path).sort()).toEqual([...sentKeys].sort());
    expect(err.message).toMatch(/^Remove `_lock/);
    expect(err.message).toContain(`They would ${effect}`);
    // It names the door ADR-0010 does state.
    expect(err.message).toContain("code package's source");
}

const AUTHOR_FACES = ['meta-envelope', 'meta-dispatch'] as const;

const ENV_KEYS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_METADATA_WRITABLE'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
    resetEnvWritableMetadataTypes();
});

for (const writeFace of AUTHOR_FACES) {
    describe(`[${writeFace}] the card's probe: a hand-written lock on a new item`, () => {
        it('is refused with a located 400 VALIDATION_ERROR, nothing is stored, and the item stays editable and deletable', async () => {
            const { protocol, metadataWrites, rows } = makeProtocol();
            const name = 'probe_rawlock_app';
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'app', name, item: app(name, { _lock: 'full', _lockReason: 'raw' }), writeFace,
            }));
            expectLockFamilyRefusal(err, ['_lock', '_lockReason'], 'set a lock on it');
            expect(err.message).toContain(`app '${name}'`);
            expect(rows('app', name)).toEqual([]);
            expect(metadataWrites()).toEqual([]);
            // The same body without the family saves, and binds nothing.
            expect((await protocol.saveMetaItem({ type: 'app', name, item: app(name), writeFace })).success).toBe(true);
            const read = await protocol.getMetaItem({ type: 'app', name });
            expect(read).toMatchObject({ lock: 'none', editable: true, deletable: true });
            expect((await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Edited' }), writeFace })).success).toBe(true);
            expect((await protocol.deleteMetaItem({ type: 'app', name })).success).toBe(true);
        });
    });

    describe(`[${writeFace}] the add, the change and the removal are each refused`, () => {
        it('the add on an existing item with no lock — every lock state, and a lone prose key', async () => {
            const { protocol, storedFamily } = makeProtocol();
            const name = 'plain_app';
            await protocol.saveMetaItem({ type: 'app', name, item: app(name), writeFace });
            for (const family of [{ _lock: 'full' }, { _lock: 'no-overlay' }, { _lock: 'no-delete' }, { _lock: 'none' }, { _lockReason: 'why' }]) {
                const err = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name, item: app(name, family), writeFace }));
                // A lone prose key, or `none`, binds nothing: it adds keys, not a lock.
                expectLockFamilyRefusal(err, Object.keys(family), family._lock && family._lock !== 'none' ? 'set a lock on it' : 'add lock keys to it');
            }
            expect(storedFamily('app', name)).toEqual({});
        });

        it('the change of a server-stamped lock: its state, and its prose alone', async () => {
            const { protocol, storedFamily } = makeProtocol();
            const name = 'stamped_app';
            await stamp(protocol, name);
            for (const family of [{ ...STAMPED, _lock: 'full' }, { ...STAMPED, _lockReason: 'Mine now.' }, { ...STAMPED, _lockDocsUrl: 'https://example.invalid/x' }]) {
                const err = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name, item: app(name, family), writeFace }));
                expectLockFamilyRefusal(err, LOCK_KEYS.filter((k) => k in family), 'change its lock');
            }
            expect(storedFamily('app', name)).toEqual(STAMPED);
            const del = await refusalOf(() => protocol.deleteMetaItem({ type: 'app', name }));
            expect(resolveThrownHttpError(del)).toMatchObject({ status: 403, code: 'ITEM_LOCKED' });
        });

        it('the removal of a server-stamped lock: `none`, and a partial echo that drops its prose', async () => {
            const { protocol, storedFamily } = makeProtocol();
            const name = 'stamped_app';
            await stamp(protocol, name);
            const none = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name, item: app(name, { _lock: 'none' }), writeFace }));
            expectLockFamilyRefusal(none, ['_lock'], 'remove its lock');
            const partial = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name, item: app(name, { _lock: 'no-delete' }), writeFace }));
            expectLockFamilyRefusal(partial, ['_lock'], 'change its lock');
            expect(storedFamily('app', name)).toEqual(STAMPED);
            const del = await refusalOf(() => protocol.deleteMetaItem({ type: 'app', name }));
            expect(resolveThrownHttpError(del)).toMatchObject({ status: 403, code: 'ITEM_LOCKED' });
        });

        it('in draft mode: the add is refused and no draft is written', async () => {
            const { protocol, rows } = makeProtocol();
            const name = 'draft_app';
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'app', name, item: app(name, { _lock: 'full' }), mode: 'draft', writeFace,
            }));
            expectLockFamilyRefusal(err, ['_lock'], 'set a lock on it');
            expect(rows('app', name, 'draft')).toEqual([]);
        });
    });

    describe(`[${writeFace}] the echo is accepted and ignored`, () => {
        it("of a server-stamped lock: the read's own body sent back, edited", async () => {
            const { protocol, storedFamily } = makeProtocol();
            const name = 'stamped_app';
            await stamp(protocol, name);
            const read = await protocol.getMetaItem({ type: 'app', name });
            expect(familyOf(read.item)).toEqual(STAMPED);
            const r = await protocol.saveMetaItem({ type: 'app', name, item: { ...read.item, label: 'Edited' }, writeFace });
            expect(r.success).toBe(true);
            expect(storedFamily('app', name)).toEqual(STAMPED);
            expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('Edited');
        });

        it("of a packaged item's lock on its first overlay: a new row, which stores none, while the package's lock still binds", async () => {
            const artifact = packagedDashboard('vendor_dash', { lock: 'no-delete', reason: 'Shipped by the vendor.' });
            const { protocol, storedFamily } = makeProtocol([artifact]);
            const read = await protocol.getMetaItem({ type: 'dashboard', name: 'vendor_dash' });
            expect(familyOf(read.item)).toEqual({ _lock: 'no-delete', _lockReason: 'Shipped by the vendor.', _lockSource: 'package' });
            const r = await protocol.saveMetaItem({ type: 'dashboard', name: 'vendor_dash', item: { ...read.item, label: 'Edited' }, writeFace });
            expect(r.success).toBe(true);
            expect(storedFamily('dashboard', 'vendor_dash')).toEqual({});
            const after = await protocol.getMetaItem({ type: 'dashboard', name: 'vendor_dash' });
            expect(after).toMatchObject({ lock: 'no-delete', deletable: false });
            expect(after.item.label).toBe('Edited');
            expect(familyOf(after.item)).toEqual(familyOf(read.item));
            // A family the package does not ship is still refused on the overlay.
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'dashboard', name: 'vendor_dash', item: { ...after.item, _lock: 'full' }, writeFace,
            }));
            expectLockFamilyRefusal(err, ['_lock', '_lockReason', '_lockSource'], 'change its lock');
        });

        it('in draft mode: the first draft echoes the active read, carries its lock, and publishing keeps it', async () => {
            const { protocol, storedFamily } = makeProtocol();
            const name = 'stamped_app';
            await stamp(protocol, name);
            const read = await protocol.getMetaItem({ type: 'app', name });
            const r = await protocol.saveMetaItem({ type: 'app', name, item: { ...read.item, label: 'Drafted' }, mode: 'draft', writeFace });
            expect(r.success).toBe(true);
            expect(storedFamily('app', name, 'draft')).toEqual(STAMPED);
            // The draft read serves the draft row's own family; sent back, it is an echo too.
            const draft = await protocol.getMetaItem({ type: 'app', name, state: 'draft' });
            expect(familyOf(draft.item)).toEqual(STAMPED);
            expect((await protocol.saveMetaItem({ type: 'app', name, item: { ...draft.item, label: 'Drafted again' }, mode: 'draft', writeFace })).success).toBe(true);
            await protocol.publishMetaItem({ type: 'app', name });
            expect(storedFamily('app', name)).toEqual(STAMPED);
            const del = await refusalOf(() => protocol.deleteMetaItem({ type: 'app', name }));
            expect(resolveThrownHttpError(del)).toMatchObject({ status: 403, code: 'ITEM_LOCKED' });
        });

        it("on a clone: an unlocked item's body saved under a new name is accepted; a clone carrying another item's lock is refused", async () => {
            const { protocol, storedFamily, rows } = makeProtocol();
            await protocol.saveMetaItem({ type: 'app', name: 'source_open', item: app('source_open'), writeFace });
            const open = await protocol.getMetaItem({ type: 'app', name: 'source_open' });
            const ok = await protocol.saveMetaItem({ type: 'app', name: 'clone_open', item: { ...open.item, name: 'clone_open' }, writeFace });
            expect(ok.success).toBe(true);
            expect(storedFamily('app', 'clone_open')).toEqual({});

            await stamp(protocol, 'source_locked');
            const locked = await protocol.getMetaItem({ type: 'app', name: 'source_locked' });
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'app', name: 'clone_locked', item: { ...locked.item, name: 'clone_locked' }, writeFace,
            }));
            expectLockFamilyRefusal(err, ['_lock', '_lockReason', '_lockSource'], 'set a lock on it');
            expect(rows('app', 'clone_locked')).toEqual([]);
        });
    });
}

describe('a lock a server face stamps still binds afterwards', () => {
    const faces = [
        { face: "`source: 'migrate-stored'`", extra: { source: 'migrate-stored', force: true } },
        { face: "`writeFace: 'package-duplicate'`", extra: { writeFace: 'package-duplicate' } },
    ] as const;

    for (const { face, extra } of faces) {
        it(`${face}: the stamp lands; an author save without a family keeps it, and the delete stays refused`, async () => {
            const { protocol, storedFamily } = makeProtocol();
            const name = 'stamped_app';
            const r = await protocol.saveMetaItem({ type: 'app', name, item: app(name, STAMPED), ...extra });
            expect(r.success).toBe(true);
            expect(storedFamily('app', name)).toEqual(STAMPED);
            for (const writeFace of AUTHOR_FACES) {
                const edit = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: `Edited on ${writeFace}` }), writeFace });
                expect(edit.success).toBe(true);
                expect(storedFamily('app', name)).toEqual(STAMPED);
            }
            const read = await protocol.getMetaItem({ type: 'app', name });
            expect(read).toMatchObject({ lock: 'no-delete', editable: true, deletable: false });
            const del = await refusalOf(() => protocol.deleteMetaItem({ type: 'app', name }));
            expect(resolveThrownHttpError(del)).toMatchObject({ status: 403, code: 'ITEM_LOCKED' });
        });
    }

    it("`full`, stamped: an author's next save answers 403 ITEM_LOCKED before any lock-family judgement", async () => {
        const { protocol } = makeProtocol();
        await stamp(protocol, 'full_app', { _lock: 'full', _lockReason: 'Stamped.' });
        for (const item of [app('full_app'), app('full_app', { _lock: 'none' })]) {
            const err = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name: 'full_app', item, writeFace: 'meta-envelope' }));
            expect(resolveThrownHttpError(err)).toMatchObject({ status: 403, code: 'ITEM_LOCKED' });
        }
    });
});

describe('CONTROLS — what the rule leaves as it was', () => {
    it('a body without a lock family saves as before: its row carries none, and the item stays editable and deletable', async () => {
        const { protocol, storedFamily } = makeProtocol();
        for (const writeFace of [...AUTHOR_FACES, undefined]) {
            const name = `plain_${writeFace ?? 'in_process'}`.replace(/-/g, '_');
            expect((await protocol.saveMetaItem({ type: 'app', name, item: app(name), ...(writeFace ? { writeFace } : {}) })).success).toBe(true);
            expect(storedFamily('app', name)).toEqual({});
            expect(await protocol.getMetaItem({ type: 'app', name })).toMatchObject({ lock: 'none', editable: true, deletable: true });
            expect((await protocol.deleteMetaItem({ type: 'app', name })).success).toBe(true);
        }
    });

    it("a family value the type's declaration refuses is still the parse's 422 INVALID_METADATA, and nothing is stored", async () => {
        const { protocol, metadataWrites } = makeProtocol();
        for (const family of [{ _lock: 'locked' }, { _lock: null }, { _lockSource: 'tenant' }, { _lock: 'full', _lockReason: 7 }]) {
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'app', name: 'bad_app', item: app('bad_app', family), writeFace: 'meta-envelope',
            }));
            expect(resolveThrownHttpError(err)).toMatchObject({ status: 422, code: 'INVALID_METADATA' });
        }
        expect(metadataWrites()).toEqual([]);
    });

    it('an in-process door that states no face meets the same rule', async () => {
        const { protocol, rows } = makeProtocol();
        const err = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name: 'door_app', item: app('door_app', { _lock: 'full' }) }));
        expectLockFamilyRefusal(err, ['_lock'], 'set a lock on it');
        expect(rows('app', 'door_app')).toEqual([]);
    });

    it('a type with no schema (`external_catalog`) is judged too: no parse would refuse the key there', async () => {
        const { protocol, rows } = makeProtocol();
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'external_catalog', name: 'probe_catalog', item: { name: 'probe_catalog', _lock: 'full' }, writeFace: 'meta-envelope',
        }));
        expectLockFamilyRefusal(err, ['_lock'], 'set a lock on it');
        expect(rows('external_catalog', 'probe_catalog')).toEqual([]);
    });
});
