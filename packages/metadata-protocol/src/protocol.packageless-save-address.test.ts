// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23165, ADR-0048] Where a direct save that names no package writes.
 *
 * A `sys_metadata` row is keyed `(org, type, name, package_id)`. A save that
 * named no package wrote the package-unbound row, always: for an item a
 * package owns (`PUT /api/v1/meta/app/lanebapp_app` with no `?package=`, after
 * the item was saved into `com.qa.lanebapp`), it minted a second, package-less
 * row beside the package's and answered `200` "Saved app 'lanebapp_app'
 * (env-wide, state=active)", while the item read kept serving the package's
 * row. Measured on a booted showcase: the console's "Disable" showed success
 * and nothing changed. The draft save already resolved its address from the
 * package of the item's active row (#11087, `resolveWriteHead`); the direct
 * save did not.
 *
 * Pinned here, through the real save and read doors:
 *
 *  - the round trip: a package-less save of a single-package item writes the
 *    package's row, the item read serves it next, no second row is minted, and
 *    the receipt names the package;
 *  - the item read's `version` names the row that save writes, so a read
 *    followed by a save with the served token is accepted;
 *  - an item two packages hold: the package-less save is refused,
 *    `409 RESOURCE_CONFLICT`, naming both, and nothing is written; naming one
 *    package saves. The two-package state is measured reachable through the
 *    door first;
 *  - the save is a save naming the resolved package: the row keeps its stored
 *    lock family, and a read-only package answers what `?package=` naming it
 *    answers;
 *  - CONTROL: an item with no package binding keeps the package-unbound row,
 *    and its receipt reads byte for byte as before;
 *  - `packageId: null` names no package, as `undefined` does (the request
 *    contract states both);
 *  - CONTROL: a package-less row minted beside a package's row before the fix
 *    stays as it is, and a server-stated rewrite of that row (the
 *    stored-metadata migration passes `packageId: null`) still writes it;
 *  - an item a code package ships, with no stored row: the package-less save
 *    writes the package-unbound overlay and the read serves it, as before; with
 *    an overlay row already bound to the code package, it writes that row;
 *  - the draft path: a package-less draft save still inherits the package
 *    (its own suite, `sys-metadata-repository.draft-package-inherit.test.ts`,
 *    holds the rest).
 *  - [#23291] the read naming no package serves the row that save writes,
 *    with a package-unbound row stored beside the package's: the card's five
 *    steps, both storage orders, the draft reads, the stand-in for another
 *    package, and an item another package holds too.
 *
 * Refusals are asserted as the envelope an HTTP boundary answers with
 * (`resolveThrownHttpError`): `code` and `status`, never a bare throw.
 *
 * The engine below is a stub: this package cannot import `@objectstack/objectql`
 * (that package depends on this one). It keeps real rows, so the REAL save and
 * read doors run against it, and its write verbs route through the producer's
 * own dispatch predicates.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch, isCodeArtifactBody } from '@objectstack/metadata-core';
import { applyProtection } from '@objectstack/spec/shared';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

type Row = Record<string, any>;

/** A writable runtime package: no manifest booted it, and no read-only scope. */
const WRITABLE = 'com.qa.lanebapp';
const OTHER_WRITABLE = 'com.qa.otherapp';
/** A code package: its manifest was booted, so it is read-only (ADR-0070). */
const CODE_PACKAGE = 'com.example.showcase';
/** An installed package with a read-only manifest scope. */
const INSTALLED_READ_ONLY = 'com.vendor.installed';

/** Equality and `null`; any other operator is refused, so a matcher that ignored one cannot prove anything. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key.startsWith('$')) throw new Error(`stub engine: unsupported operator ${key}`);
        if (want !== null && typeof want === 'object') throw new Error(`stub engine: unsupported operator on ${key}`);
        if ((row[key] ?? null) !== want) return false;
    }
    return true;
}

/**
 * A stub engine that keeps rows, and a registry holding what a code package's
 * loader registered (each artifact as `applyProtection` leaves it).
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
        manifests: new Set([CODE_PACKAGE]),
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
            getPackage: (id: string) => (id === INSTALLED_READ_ONLY ? { manifest: { id, scope: 'cloud' } } : undefined),
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map()) as any;
    const metadataWrites = () => writes.filter((w) => w.table === 'sys_metadata' && w.op !== 'delete');
    const rows = (type: string, name: string, state = 'active') =>
        table('sys_metadata').filter((r) => r.type === type && r.name === name && r.state === state);
    /** A row as an older build left it, written straight into the table. */
    const seedRow = (row: Row) => {
        nextId += 1;
        table('sys_metadata').push({ id: `seed_${nextId}`, organization_id: null, state: 'active', version: 1, ...row });
    };
    return { protocol, metadataWrites, rows, seedRow };
}

const app = (name: string, extra: Record<string, unknown> = {}) => ({ name, label: `App ${name}`, ...extra });

/** The stored body of each row, by binding: `null` for the package-unbound row. */
function bodiesByBinding(rows: Row[]): Record<string, Record<string, unknown>> {
    return Object.fromEntries(rows.map((r) => [String(r.package_id ?? null), JSON.parse(r.metadata)]));
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

/** A view a code package ships, as its loader registers it. */
function packagedView(name: string) {
    const item: Record<string, unknown> = {
        name, label: `Packaged ${name}`, object: 'task', viewKind: 'list', columns: [{ field: 'name', label: 'Name' }],
    };
    applyProtection(item, { packageId: CODE_PACKAGE, packageVersion: '1.0.0' });
    return { type: 'view', item };
}

const viewBody = (name: string, label: string) => ({
    name, label, object: 'task', viewKind: 'list', columns: [{ field: 'name', label: 'Name' }],
});

const ENV_KEYS = ['OS_TENANCY_POSTURE', 'OS_MULTI_ORG_ENABLED', 'OS_METADATA_WRITABLE'] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    for (const k of ENV_KEYS) delete process.env[k];
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k];
        else process.env[k] = savedEnv[k];
    }
    resetEnvWritableMetadataTypes();
});

describe('a package-less direct save of an item ONE package owns writes that package\'s row', () => {
    it('the card\'s probe: the write is what the item read serves next, no second row, and the receipt names the package', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'lanebapp_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });

        const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { active: false }) });

        expect(saved.success).toBe(true);
        expect(saved.message).toBe(`Saved app '${name}' (env-wide, package=${WRITABLE}, state=active) [seq=${saved.seq}]`);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([WRITABLE]);
        expect(bodiesByBinding(rows('app', name))[WRITABLE]).toMatchObject({ active: false });
        const read = await protocol.getMetaItem({ type: 'app', name });
        expect(read.item).toMatchObject({ active: false, _packageId: WRITABLE });
        // The read naming the package serves the same row.
        expect((await protocol.getMetaItem({ type: 'app', name, packageId: WRITABLE })).item).toMatchObject({ active: false });
    });

    it('packageId: null names no package too, as the request contract states', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'null_named_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
        const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Edited' }), packageId: null });
        expect(saved.message).toContain(`package=${WRITABLE}`);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([WRITABLE]);
    });

    it('both author faces resolve the same address', async () => {
        for (const writeFace of ['meta-envelope', 'meta-dispatch'] as const) {
            const { protocol, rows } = makeProtocol();
            const name = `face_${writeFace.replace('-', '_')}`;
            await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE, writeFace });
            await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Edited' }), writeFace });
            expect(rows('app', name).map((r) => r.package_id ?? null), writeFace).toEqual([WRITABLE]);
            expect((await protocol.getMetaItem({ type: 'app', name })).item.label, writeFace).toBe('Edited');
        }
    });

    it('the item read\'s version names the row that save writes, so read → save with the served token is accepted', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'token_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });

        const read = await protocol.getMetaItem({ type: 'app', name });
        expect(read.version).toEqual(expect.any(String));
        // The same token the read naming the package serves: one address.
        expect((await protocol.getMetaItem({ type: 'app', name, packageId: WRITABLE })).version).toBe(read.version);

        const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Pinned' }), parentVersion: read.version });
        expect(saved.success).toBe(true);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([WRITABLE]);

        // The token it replaced is stale now, and a create assertion meets a
        // row that exists: both are the optimistic lock's 409.
        for (const parentVersion of [read.version, null]) {
            const envelope = resolveThrownHttpError(await refusalOf(() => protocol.saveMetaItem({
                type: 'app', name, item: app(name, { label: 'Stale' }), parentVersion,
            })));
            expect(envelope.status, String(parentVersion)).toBe(409);
            expect(envelope.code, String(parentVersion)).toBe('METADATA_CONFLICT');
        }
        expect(rows('app', name)).toHaveLength(1);
    });

    it('the save is a save naming that package: the row keeps the lock family it stores', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'stamped_app';
        const stamped = { _lock: 'no-delete', _lockReason: 'Stamped by the platform.', _lockSource: 'package' };
        // A server face stamps the family onto the package's row.
        await protocol.saveMetaItem({
            type: 'app', name, item: app(name, stamped), packageId: WRITABLE, source: 'migrate-stored', force: true,
        });

        // An author save that says nothing about the lock.
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Edited' }) });

        expect(rows('app', name)).toHaveLength(1);
        expect(bodiesByBinding(rows('app', name))[WRITABLE]).toMatchObject({ label: 'Edited', ...stamped });
        const read = await protocol.getMetaItem({ type: 'app', name });
        expect(read).toMatchObject({ lock: 'no-delete', deletable: false });
    });

    it('a read-only package answers what ?package= naming it answers', async () => {
        const { protocol, rows, seedRow, metadataWrites } = makeProtocol();
        const name = 'installed_app';
        seedRow({ type: 'app', name, package_id: INSTALLED_READ_ONLY, metadata: JSON.stringify(app(name)), checksum: 'sha-installed' });

        const named = resolveThrownHttpError(await refusalOf(() => protocol.saveMetaItem({
            type: 'app', name, item: app(name, { label: 'Edited' }), packageId: INSTALLED_READ_ONLY,
        })));
        const unnamed = resolveThrownHttpError(await refusalOf(() => protocol.saveMetaItem({
            type: 'app', name, item: app(name, { label: 'Edited' }),
        })));

        expect(named).toMatchObject({ status: 422, code: 'WRITABLE_PACKAGE_REQUIRED' });
        expect(unnamed).toMatchObject({ status: named.status, code: named.code });
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([INSTALLED_READ_ONLY]);
        expect(metadataWrites()).toEqual([]);
    });
});

describe('an item TWO packages hold: a save naming neither is refused', () => {
    async function twoPackageItem(name: string) {
        const fixture = makeProtocol();
        // Reachable through the door: each package-scoped save writes its own row.
        await fixture.protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'A' }), packageId: WRITABLE });
        await fixture.protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'B' }), packageId: OTHER_WRITABLE });
        return fixture;
    }

    it('two package-scoped saves leave one active row per package', async () => {
        const { rows } = await twoPackageItem('shared_app');
        expect(rows('app', 'shared_app').map((r) => r.package_id).sort()).toEqual([WRITABLE, OTHER_WRITABLE].sort());
    });

    it('409 RESOURCE_CONFLICT naming both packages, and nothing is written', async () => {
        const name = 'shared_app';
        const { protocol, rows, metadataWrites } = await twoPackageItem(name);
        const before = metadataWrites().length;
        const bodiesBefore = bodiesByBinding(rows('app', name));

        const err = await refusalOf(() => protocol.saveMetaItem({ type: 'app', name, item: app(name, { active: false }) }));

        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(409);
        expect(envelope.code).toBe('RESOURCE_CONFLICT');
        expect(err.message).toContain(`'${WRITABLE}'`);
        expect(err.message).toContain(`'${OTHER_WRITABLE}'`);
        expect(err.message).toContain('?package=');
        expect(metadataWrites()).toHaveLength(before);
        expect(rows('app', name)).toHaveLength(2);
        expect(bodiesByBinding(rows('app', name))).toEqual(bodiesBefore);
    });

    it('naming one of them saves that package\'s row', async () => {
        const name = 'shared_app';
        const { protocol, rows } = await twoPackageItem(name);
        const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'A2' }), packageId: WRITABLE });
        expect(saved.message).toContain(`package=${WRITABLE}`);
        expect(bodiesByBinding(rows('app', name))).toMatchObject({ [WRITABLE]: { label: 'A2' }, [OTHER_WRITABLE]: { label: 'B' } });
    });
});

describe('CONTROL: what the resolution leaves alone', () => {
    it('an item with no package binding keeps the package-unbound row, and its receipt reads as before', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'plain_app';
        const first = await protocol.saveMetaItem({ type: 'app', name, item: app(name) });
        const second = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Edited' }) });

        expect(first.message).toBe(`Saved app '${name}' (env-wide, state=active) [seq=${first.seq}]`);
        expect(second.message).toBe(`Saved app '${name}' (env-wide, state=active) [seq=${second.seq}]`);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([null]);
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('Edited');
    });

    it('a package-less row minted beside the package\'s row stays as it is; the save writes the package\'s row', async () => {
        const { protocol, rows, seedRow } = makeProtocol();
        const name = 'residue_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
        seedRow({ type: 'app', name, package_id: null, metadata: JSON.stringify(app(name, { active: false })), checksum: 'sha-residue' });

        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Edited' }) });

        const bodies = bodiesByBinding(rows('app', name));
        expect(Object.keys(bodies).sort()).toEqual([WRITABLE, 'null'].sort());
        expect(bodies[WRITABLE]).toMatchObject({ label: 'Edited' });
        expect(bodies.null).toEqual(app(name, { active: false }));
    });

    it('a server-stated rewrite of the package-unbound row (the stored-metadata migration, packageId: null) still writes that row', async () => {
        const { protocol, rows, seedRow } = makeProtocol();
        const name = 'residue_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
        seedRow({ type: 'app', name, package_id: null, metadata: JSON.stringify(app(name)), checksum: 'sha-residue' });

        await protocol.saveMetaItem({
            type: 'app', name, item: app(name, { label: 'Rewritten' }), packageId: null, source: 'migrate-stored', force: true,
        });

        const bodies = bodiesByBinding(rows('app', name));
        expect(bodies.null).toMatchObject({ label: 'Rewritten' });
        expect(bodies[WRITABLE]).toEqual(app(name));
    });

    it('a package-less DRAFT save still inherits the package of the active row (#11087)', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'draft_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });

        const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Pending' }), mode: 'draft' });

        expect(saved.state).toBe('draft');
        expect(rows('app', name, 'draft').map((r) => r.package_id ?? null)).toEqual([WRITABLE]);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([WRITABLE]);
    });
});

describe('an item a CODE package ships', () => {
    it('with no stored row: the package-less save writes the package-unbound overlay, and the read serves it', async () => {
        const name = 'showcase_task_grid';
        const { protocol, rows } = makeProtocol([packagedView(name)]);

        const saved = await protocol.saveMetaItem({ type: 'view', name, item: viewBody(name, 'Overlaid') });

        expect(saved.message).toBe(
            `Saved customization overlay (env-wide, state=active) — type=view, name=${name} [seq=${saved.seq}]`,
        );
        expect(rows('view', name).map((r) => r.package_id ?? null)).toEqual([null]);
        expect((await protocol.getMetaItem({ type: 'view', name })).item.label).toBe('Overlaid');
    });

    it('with an overlay row bound to the code package: the package-less save writes that row', async () => {
        const name = 'showcase_task_grid';
        const { protocol, rows } = makeProtocol([packagedView(name)]);
        // The overlay a save naming the package writes (ADR-0005: an overlay of
        // a code-shipped item names the package it customizes).
        await protocol.saveMetaItem({ type: 'view', name, item: viewBody(name, 'Named'), packageId: CODE_PACKAGE });

        const saved = await protocol.saveMetaItem({ type: 'view', name, item: viewBody(name, 'Unnamed') });

        expect(saved.message).toContain(`package=${CODE_PACKAGE}`);
        expect(rows('view', name).map((r) => r.package_id ?? null)).toEqual([CODE_PACKAGE]);
        expect((await protocol.getMetaItem({ type: 'view', name })).item.label).toBe('Unnamed');
    });
});

/**
 * [#23165, ADR-0048] The DELETE door takes the same address.
 *
 * `deleteMetaItem` handed the repository no package, so its probe and its
 * delete each took the first row a package-agnostic `findOne` met: one
 * package's row of an item two packages hold (the other package's row then
 * served, while the receipt said "it no longer exists"), or the package's row
 * when a package-less row sat beside it. Named, a delete now removes that
 * package's row and no other; naming none, it resolves through the save
 * door's function: one binding removes that row, two or more are refused,
 * none removes the package-unbound row as before.
 */
describe('a delete that names no package removes the row the save door addresses', () => {
    it('the round trip: a package-less delete of an item ONE package owns removes that row, and the read serves nothing', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'deleted_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });

        const receipt = await protocol.deleteMetaItem({ type: 'app', name });

        expect(receipt).toMatchObject({ success: true, reset: true });
        expect(receipt.message).toContain(`package=${WRITABLE}`);
        expect(receipt.message).toContain('it no longer exists');
        expect(rows('app', name)).toEqual([]);
        const read = await protocol.getMetaItem({ type: 'app', name }).catch((e: unknown) => e);
        expect(read?.item ?? null).toBeNull();
    });

    it('the item read\'s version names the row that delete removes, so read → delete with the served token is accepted', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'pinned_delete_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
        const { version } = await protocol.getMetaItem({ type: 'app', name });
        expect(version).toEqual(expect.any(String));

        const receipt = await protocol.deleteMetaItem({ type: 'app', name, parentVersion: version });

        expect(receipt.reset).toBe(true);
        expect(rows('app', name)).toEqual([]);
    });

    it('a draft discard naming no package removes the draft the package-less draft save put in the package', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'draft_discard_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Pending' }), mode: 'draft' });
        expect(rows('app', name, 'draft').map((r) => r.package_id ?? null)).toEqual([WRITABLE]);

        const receipt = await protocol.deleteMetaItem({ type: 'app', name, state: 'draft' });

        expect(receipt.reset).toBe(true);
        expect(rows('app', name, 'draft')).toEqual([]);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([WRITABLE]);
    });
});

describe('an item TWO packages hold: a delete naming neither is refused', () => {
    async function twoPackageItem(name: string) {
        const fixture = makeProtocol();
        await fixture.protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'A' }), packageId: WRITABLE });
        await fixture.protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'B' }), packageId: OTHER_WRITABLE });
        return fixture;
    }

    it('409 RESOURCE_CONFLICT naming both packages, and nothing is deleted', async () => {
        const name = 'shared_delete_app';
        const { protocol, rows } = await twoPackageItem(name);
        const bodiesBefore = bodiesByBinding(rows('app', name));

        const err = await refusalOf(() => protocol.deleteMetaItem({ type: 'app', name }));

        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(409);
        expect(envelope.code).toBe('RESOURCE_CONFLICT');
        expect(err.message).toContain(`'${WRITABLE}'`);
        expect(err.message).toContain(`'${OTHER_WRITABLE}'`);
        expect(err.message).toContain('?package=');
        expect(bodiesByBinding(rows('app', name))).toEqual(bodiesBefore);
    });

    it('a draft discard naming no package is refused when drafts sit in both packages', async () => {
        const name = 'shared_draft_app';
        const { protocol, rows } = await twoPackageItem(name);
        for (const packageId of [WRITABLE, OTHER_WRITABLE]) {
            await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: `Draft ${packageId}` }), packageId, mode: 'draft' });
        }

        const envelope = resolveThrownHttpError(await refusalOf(() => protocol.deleteMetaItem({ type: 'app', name, state: 'draft' })));

        expect(envelope).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        expect(rows('app', name, 'draft')).toHaveLength(2);
    });

    it('naming one removes that package\'s row only, the other is served, and the receipt names what remains', async () => {
        const name = 'shared_delete_app';
        const { protocol, rows } = await twoPackageItem(name);

        const receipt = await protocol.deleteMetaItem({ type: 'app', name, packageId: WRITABLE });

        expect(receipt.reset).toBe(true);
        expect(rows('app', name).map((r) => r.package_id)).toEqual([OTHER_WRITABLE]);
        expect(receipt.message).toContain(`package=${WRITABLE}`);
        expect(receipt.message).toContain(`'${OTHER_WRITABLE}'`);
        expect(receipt.message).not.toContain('no longer exists');
        expect((await protocol.getMetaItem({ type: 'app', name })).item).toMatchObject({ label: 'B', _packageId: OTHER_WRITABLE });
    });

    it('naming a package that holds no row removes nothing and says the other rows remain', async () => {
        const name = 'shared_delete_app';
        const { protocol, rows } = await twoPackageItem(name);

        const receipt = await protocol.deleteMetaItem({ type: 'app', name, packageId: 'com.qa.thirdapp' });

        expect(receipt).toMatchObject({ success: true, reset: false });
        expect(receipt.message).toContain(`'${WRITABLE}'`);
        expect(receipt.message).toContain(`'${OTHER_WRITABLE}'`);
        expect(receipt.message).not.toContain('nothing to delete');
        expect(rows('app', name)).toHaveLength(2);
    });

    it('uninstalling one package removes its row, never the other package\'s', async () => {
        const name = 'shared_uninstall_app';
        const { protocol, rows } = await twoPackageItem(name);

        const out = await protocol.deletePackage({ packageId: OTHER_WRITABLE, keepData: true });

        expect(out.failed ?? []).toEqual([]);
        expect(rows('app', name).map((r) => r.package_id)).toEqual([WRITABLE]);
        expect(bodiesByBinding(rows('app', name))[WRITABLE]).toMatchObject({ label: 'A' });
    });

    it('discarding one package\'s drafts removes its draft, never the other package\'s', async () => {
        const name = 'shared_discard_app';
        const { protocol, rows } = await twoPackageItem(name);
        for (const packageId of [WRITABLE, OTHER_WRITABLE]) {
            await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: `Draft ${packageId}` }), packageId, mode: 'draft' });
        }

        const out = await protocol.discardPackageDrafts({ packageId: OTHER_WRITABLE });

        expect(out).toMatchObject({ discardedCount: 1, failedCount: 0 });
        expect(rows('app', name, 'draft').map((r) => r.package_id)).toEqual([WRITABLE]);
    });
});

describe('CONTROL: what the delete resolution leaves alone', () => {
    it('an item with no package binding: the package-unbound row is removed, and the receipt reads as before', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'plain_delete_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name) });

        const receipt = await protocol.deleteMetaItem({ type: 'app', name });

        expect(receipt.message).toBe(`Deleted app '${name}' — it no longer exists. [seq=${receipt.seq}]`);
        expect(rows('app', name)).toEqual([]);
    });

    it('a package-less row beside the package\'s row stays: the delete removes the package\'s row and says the other remains', async () => {
        const { protocol, rows, seedRow } = makeProtocol();
        const name = 'residue_delete_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
        seedRow({ type: 'app', name, package_id: null, metadata: JSON.stringify(app(name, { active: false })), checksum: 'sha-residue' });

        const receipt = await protocol.deleteMetaItem({ type: 'app', name });

        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([null]);
        expect(receipt.message).toContain(`package=${WRITABLE}`);
        expect(receipt.message).toContain('package-less row');
        expect(receipt.message).not.toContain('no longer exists');
        expect((await protocol.getMetaItem({ type: 'app', name })).item).toMatchObject({ active: false });
    });
});

/**
 * [#23297, ADR-0048] The DRAFT save naming no package, of an item two packages
 * hold.
 *
 * The draft save resolves its address in the repository: a draft that names no
 * package is stored in the package of the item's active row (#11087,
 * `SysMetadataRepository.resolveWriteHead`). That resolution read ONE active
 * row with a package-agnostic `findOne`, so with two packages' rows the draft
 * went into whichever package the store returned first, and the save answered
 * `200` "(env-wide, state=draft)" without naming it. Measured on a booted
 * showcase (SQLite): the draft landed in the package whose id sorts first,
 * whichever package was saved first. The direct save and the delete refuse
 * that request since #23165; the draft save now refuses it the same way, with
 * the same `409 RESOURCE_CONFLICT` and the same `?package=` remedy.
 *
 * Both orders are pinned, so a fix that merely flips which package wins
 * cannot pass: the draft is refused under both.
 */
describe('[#23297] an item TWO packages hold: a DRAFT save naming neither is refused', () => {
    const ORDERS = [
        { order: `${WRITABLE} saved first`, packages: [WRITABLE, OTHER_WRITABLE] },
        { order: `${OTHER_WRITABLE} saved first`, packages: [OTHER_WRITABLE, WRITABLE] },
    ] as const;

    for (const { order, packages } of ORDERS) {
        it(`409 RESOURCE_CONFLICT naming both packages, and no draft is written (${order})`, async () => {
            const name = 'shared_draft_save_app';
            const { protocol, rows, metadataWrites } = makeProtocol();
            for (const packageId of packages) {
                await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: `Active ${packageId}` }), packageId });
            }
            const before = metadataWrites().length;

            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'app', name, item: app(name, { label: 'Pending' }), mode: 'draft',
            }));

            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(409);
            expect(envelope.code).toBe('RESOURCE_CONFLICT');
            expect(err.message).toContain(`'${WRITABLE}'`);
            expect(err.message).toContain(`'${OTHER_WRITABLE}'`);
            expect(err.message).toContain('?package=');
            expect(rows('app', name, 'draft')).toEqual([]);
            expect(metadataWrites()).toHaveLength(before);
        });
    }

    it('naming one of them saves that package\'s draft, and the other package has none', async () => {
        const name = 'shared_draft_save_app';
        const { protocol, rows } = makeProtocol();
        for (const packageId of [WRITABLE, OTHER_WRITABLE]) {
            await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: `Active ${packageId}` }), packageId });
        }

        const saved = await protocol.saveMetaItem({
            type: 'app', name, item: app(name, { label: 'Pending' }), mode: 'draft', packageId: OTHER_WRITABLE,
        });

        expect(saved.state).toBe('draft');
        expect(rows('app', name, 'draft').map((r) => r.package_id ?? null)).toEqual([OTHER_WRITABLE]);
    });
});

/**
 * [#23297] CONTROL: with ONE package the draft still inherits it (#11087), and
 * now whichever row the store returns first. A package-less active row beside
 * the package's is not a second package (#23165's rule for the direct save):
 * the draft goes into the package. Before, the inheritance read one active row,
 * so with the package-less row first in storage the draft stayed package-less.
 */
describe('[#23297] CONTROL: one package and a package-less active row — the draft inherits the package in either storage order', () => {
    for (const residueFirst of [false, true]) {
        it(`the package-less row stored ${residueFirst ? 'first' : 'second'}`, async () => {
            const { protocol, rows, seedRow } = makeProtocol();
            const name = 'residue_draft_app';
            const residue = () => seedRow({
                type: 'app', name, package_id: null, metadata: JSON.stringify(app(name, { active: false })), checksum: 'sha-residue',
            });
            if (residueFirst) residue();
            await protocol.saveMetaItem({ type: 'app', name, item: app(name), packageId: WRITABLE });
            if (!residueFirst) residue();

            const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'Pending' }), mode: 'draft' });

            expect(saved.state).toBe('draft');
            expect(rows('app', name, 'draft').map((r) => r.package_id ?? null)).toEqual([WRITABLE]);
        });
    }
});

/**
 * [#23291, ADR-0048 §3.3, ADR-0070 TL;DR 1] The read that names no package
 * serves the row a save naming none writes.
 *
 * A save naming a package, of an item whose only row is the package-unbound
 * one, stores the package's row beside it, the unbound row first. The read
 * naming no package took the first row of any package, so it kept serving the
 * unbound body while the package-less save wrote the package's row (#23165),
 * the package-less delete removed it, the list served it, and the read's own
 * `version` named it: one name, two rows.
 *
 * The read now resolves the address the save and the delete resolve
 * (`packagelessAddress`): for an item bound to exactly one package it serves
 * what the read naming that package serves. The package-unbound row is kept:
 * ADR-0070 leaves it as a read-side detail and a migration source, and it still
 * stands in for every package with no row of its own (ADR-0048 prefer-local),
 * which `protocol.org-scoped-write-refused.test.ts` pins for view containers.
 *
 * Each step's read is asserted against the address its save resolved.
 */
describe('[#23291] the read naming no package serves the row the save naming none writes', () => {
    it('the card\'s five steps: every read serves the row the save addressed', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 's6_app';

        // 1. A package-less save of an item with no binding: the unbound row.
        const first = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'unbound' }) });
        expect(first.message).toBe(`Saved app '${name}' (env-wide, state=active) [seq=${first.seq}]`);
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([null]);
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('unbound');

        // 2. A save naming the package writes the package's row; the unbound row stays, first.
        const named = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'pkg' }), packageId: WRITABLE });
        expect(named.message).toContain(`package=${WRITABLE}`);
        expect(rows('app', name).map((r) => [r.package_id ?? null, JSON.parse(r.metadata).label]))
            .toEqual([[null, 'unbound'], [WRITABLE, 'pkg']]);

        // 3. The read naming no package serves the package's row, with the
        //    content and the version token of the read naming the package.
        const unnamedRead = await protocol.getMetaItem({ type: 'app', name });
        const namedRead = await protocol.getMetaItem({ type: 'app', name, packageId: WRITABLE });
        expect(unnamedRead.item).toMatchObject({ label: 'pkg', _packageId: WRITABLE });
        expect(namedRead.item).toMatchObject({ label: 'pkg' });
        expect(unnamedRead.version).toEqual(expect.any(String));
        expect(unnamedRead.version).toBe(namedRead.version);

        // 4. A package-less save, pinned to that token, writes the package's
        //    row (#23165), and the reads and the list serve what it wrote.
        const third = await protocol.saveMetaItem({
            type: 'app', name, item: app(name, { label: 'third' }), parentVersion: unnamedRead.version,
        });
        expect(third.message).toBe(`Saved app '${name}' (env-wide, package=${WRITABLE}, state=active) [seq=${third.seq}]`);
        expect(bodiesByBinding(rows('app', name))).toEqual({ null: app(name, { label: 'unbound' }), [WRITABLE]: app(name, { label: 'third' }) });
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('third');
        expect((await protocol.getMetaItem({ type: 'app', name, packageId: WRITABLE })).item.label).toBe('third');
        const listed = (await protocol.getMetaItems({ type: 'app' })).items.filter((i: any) => i?.name === name);
        expect(listed.map((i: any) => i.label)).toEqual(['third']);

        // 5. A package-less delete removes the package's row and says the
        //    package-less row remains; that row is now the address of the
        //    read and of the next package-less save alike.
        const receipt = await protocol.deleteMetaItem({ type: 'app', name });
        expect(receipt.message).toBe(
            `Deleted app '${name}' (package=${WRITABLE}), and it still exists: its package-less row remains. [seq=${receipt.seq}]`,
        );
        expect(rows('app', name).map((r) => r.package_id ?? null)).toEqual([null]);
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('unbound');
        const after = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'unbound again' }) });
        expect(after.message).toBe(`Saved app '${name}' (env-wide, state=active) [seq=${after.seq}]`);
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('unbound again');
        // And a second package-less delete removes it: the item is gone.
        const last = await protocol.deleteMetaItem({ type: 'app', name });
        expect(last.message).toBe(`Deleted app '${name}' — it no longer exists. [seq=${last.seq}]`);
        expect(rows('app', name)).toEqual([]);
    });

    for (const unboundFirst of [true, false]) {
        it(`whichever order the store holds the two rows in (package-unbound row ${unboundFirst ? 'first' : 'second'})`, async () => {
            const { protocol, seedRow } = makeProtocol();
            const name = 's6_order_app';
            const unbound = () => seedRow({ type: 'app', name, package_id: null, metadata: JSON.stringify(app(name, { label: 'unbound' })), checksum: 'sha-unbound' });
            if (unboundFirst) unbound();
            seedRow({ type: 'app', name, package_id: WRITABLE, metadata: JSON.stringify(app(name, { label: 'pkg' })), checksum: 'sha-pkg' });
            if (!unboundFirst) unbound();

            const read = await protocol.getMetaItem({ type: 'app', name });

            expect(read.item).toMatchObject({ label: 'pkg', _packageId: WRITABLE });
            expect(read.version).toBe((await protocol.getMetaItem({ type: 'app', name, packageId: WRITABLE })).version);
        });
    }

    it('the package-unbound row still stands in for a package with no row of its own (ADR-0048 prefer-local)', async () => {
        const { protocol } = makeProtocol();
        const name = 's6_standin_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'unbound' }) });
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'pkg' }), packageId: WRITABLE });

        expect((await protocol.getMetaItem({ type: 'app', name, packageId: OTHER_WRITABLE })).item.label).toBe('unbound');
    });

    it('the draft reads serve the draft a package-less draft save writes: the package\'s', async () => {
        const { protocol, rows, seedRow } = makeProtocol();
        const name = 's6_draft_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'unbound' }) });
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'pkg' }), packageId: WRITABLE });
        // Drafts stored before this: the package-unbound one first, the package's beside it.
        seedRow({ type: 'app', name, state: 'draft', package_id: null, metadata: JSON.stringify(app(name, { label: 'unbound draft' })), checksum: 'sha-ud' });
        seedRow({ type: 'app', name, state: 'draft', package_id: WRITABLE, metadata: JSON.stringify(app(name, { label: 'pkg draft' })), checksum: 'sha-pd' });

        const strict = await protocol.getMetaItem({ type: 'app', name, state: 'draft' });
        expect(strict.item.label).toBe('pkg draft');
        expect(strict.version).toBe((await protocol.getMetaItem({ type: 'app', name, state: 'draft', packageId: WRITABLE })).version);
        expect((await protocol.getMetaItem({ type: 'app', name, previewDrafts: true })).item).toMatchObject({ label: 'pkg draft', _draft: true });

        // The package-less draft save, pinned to that token, writes that draft
        // (it inherits the package of the active rows, #11087).
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'pkg draft 2' }), mode: 'draft', parentVersion: strict.version });
        expect(bodiesByBinding(rows('app', name, 'draft'))).toEqual({
            null: app(name, { label: 'unbound draft' }),
            [WRITABLE]: app(name, { label: 'pkg draft 2' }),
        });
        expect((await protocol.getMetaItem({ type: 'app', name, state: 'draft' })).item.label).toBe('pkg draft 2');
    });

    it('edge: another package holds a row too — the read is ADR-0048 §3.3\'s best effort, and the package-less save and delete are refused', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 's6_shared_app';
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'unbound' }) });
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'pkg' }), packageId: WRITABLE });
        await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'other' }), packageId: OTHER_WRITABLE });
        const before = bodiesByBinding(rows('app', name));
        expect(Object.keys(before).sort()).toEqual([WRITABLE, OTHER_WRITABLE, 'null'].sort());

        // No package-less write address exists, so neither write is guessed.
        for (const run of [
            () => protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'x' }) }),
            () => protocol.deleteMetaItem({ type: 'app', name }),
        ]) {
            expect(resolveThrownHttpError(await refusalOf(run))).toMatchObject({ status: 409, code: 'RESOURCE_CONFLICT' });
        }
        expect(bodiesByBinding(rows('app', name))).toEqual(before);
        // Each read naming a package serves its own row; the read naming none serves a stored row.
        expect((await protocol.getMetaItem({ type: 'app', name, packageId: WRITABLE })).item.label).toBe('pkg');
        expect((await protocol.getMetaItem({ type: 'app', name, packageId: OTHER_WRITABLE })).item.label).toBe('other');
        expect(['unbound', 'pkg', 'other']).toContain((await protocol.getMetaItem({ type: 'app', name })).item.label);

        // A delete naming one package leaves a one-package item: the reads and
        // the package-less doors address that package's row again.
        await protocol.deleteMetaItem({ type: 'app', name, packageId: OTHER_WRITABLE });
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('pkg');
        const saved = await protocol.saveMetaItem({ type: 'app', name, item: app(name, { label: 'pkg 2' }) });
        expect(saved.message).toContain(`package=${WRITABLE}`);
        expect((await protocol.getMetaItem({ type: 'app', name })).item.label).toBe('pkg 2');
    });
});
