// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28905, ADR-0146 D1, D11] The write NAMING the read-only base itself
 * (`?package=<base>`) onto an item of one of the five overlay types it ships.
 *
 * D1 puts every customization of a read-only package in its paired
 * `<base>.custom`, and #28576 closed the write naming no package. The write
 * naming the base was still accepted: a save (draft or active), a publish (the
 * per-item one and the package batch) and a rollback each landed a row bound
 * to the base with no declaration, served at the base's address in place of
 * its document, outside the pair, and never seen by
 * `os migrate packageless-overlays` (its census reads package-less rows).
 * Measured through the doors below before the close.
 *
 * Pinned here, through the real doors over a stub engine:
 *
 *  - each of the five types: the save naming the base, active and draft, is
 *    refused `403 NOT_OVERRIDABLE` with #28576's fix (the pair, its
 *    `?package=` address, the declaration), under the REST door's
 *    500-character bound, and writes nothing; the read serves the base's own
 *    document;
 *  - the per-item publish and `publishPackageDrafts` of a draft bound to the
 *    base (stored before the close): refused with the publish sentence, the
 *    draft stays a draft and no active row is written;
 *  - the rollback of a row bound to the base: refused, the row unchanged;
 *  - CONTROLS, open as on `main`: a delete naming the base removes such a row
 *    (the one way to clear it: the ceremony moves package-less rows only), a
 *    draft discard naming it, the pair's declared save (served over a row
 *    bound to the base), a server-stated rewrite (`source` set), a writable
 *    package's same name, a name the base does not ship (ADR-0070 D1's own
 *    refusal), a base whose pair cannot be ensured, and a body carrying
 *    `overrides` (the D2 gate's sentence, unchanged).
 *
 * Refusals are asserted as the envelope an HTTP boundary answers with
 * (`resolveThrownHttpError`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { namedBaseOverlayWriteRefusal } from './protocol-packaged-base-refusal.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

/** A booted code package: read-only, with the namespace and version its pair is ensured from. */
const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const BASE_VERSION = '3.2.0';
/** A read-only code package with no namespace: its pair cannot be ensured (ADR-0146 D3). */
const NO_PAIR_BASE = 'com.legacy.app';
/** A writable runtime package: no manifest booted it. */
const WRITABLE = 'com.acme.workspace';

const MANIFESTS: Record<string, Record<string, unknown>> = {
    [BASE]: { dependencies: {}, version: BASE_VERSION, namespace: 'acme' },
    [PAIR]: { dependencies: { [BASE]: '^3' }, version: '0.1.0', namespace: 'acme_custom' },
    [NO_PAIR_BASE]: { dependencies: {}, version: '1.0.0' },
    [WRITABLE]: { dependencies: {} },
};

/** One item of each overlay type the base ships, and a body a write carries. */
const ITEMS: Array<{ type: string; name: string; body: (label: string) => Record<string, unknown> }> = [
    {
        type: 'view', name: 'task.crm_list',
        body: (label) => ({ name: 'task.crm_list', label, object: 'task', viewKind: 'list', columns: [{ field: 'title', label: 'Title' }] }),
    },
    { type: 'dashboard', name: 'crm_board', body: (label) => ({ name: 'crm_board', label, widgets: [] }) },
    {
        type: 'report', name: 'crm_report',
        body: (label) => ({ name: 'crm_report', label, type: 'summary', dataset: 'crm_metrics', rows: ['month'], values: ['amount_sum'] }),
    },
    { type: 'translation', name: 'crm_fr', body: (label) => ({ name: 'crm_fr', label, locale: 'fr', messages: { save: 'Enregistrer' } }) },
    { type: 'email_template', name: 'crm_welcome', body: (label) => ({ name: 'crm_welcome', label, subject: 'Welcome', bodyHtml: '<p>Hi</p>' }) },
];
const VIEW = ITEMS[0]!;
const SHIPPED = [
    ...ITEMS.map((i) => ({ type: i.type, name: i.name, pkg: BASE })),
    { type: 'dashboard', name: 'legacy_board', pkg: NO_PAIR_BASE },
];
const PACKAGED = 'Packaged';

type Row = Record<string, any>;

function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    return Object.entries(where).every(([k, v]) => {
        if (v === undefined) return true;
        if (k === '$or') return (v as Array<Record<string, unknown>>).some((c) => matches(row, c));
        if (v !== null && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            return (v as { $in: unknown[] }).$in.includes(row[k] ?? null);
        }
        if (v !== null && typeof v === 'object') throw new Error(`stub engine: unsupported operator on ${k}`);
        return (row[k] ?? null) === v;
    });
}

function makeProtocol() {
    const tables = new Map<string, Row[]>();
    const table = (n: string) => {
        if (!tables.has(n)) tables.set(n, []);
        return tables.get(n)!;
    };
    let nextId = 0;
    const artifact = (type: string, name: string) => {
        const hit = SHIPPED.find((i) => i.type === type && i.name === name);
        return hit ? { ...ITEMS.find((i) => i.type === type && i.name === name)?.body(PACKAGED), name, label: PACKAGED, _packageId: hit.pkg, _provenance: 'package' } : undefined;
    };
    const packageRecord = (id: string) => (MANIFESTS[id] ? { manifest: { id, ...MANIFESTS[id] } } : undefined);
    const engine: any = {
        // A booted code package is read-only (`isWritablePackage` reads `manifests` first).
        manifests: new Map([[BASE, {}], [NO_PAIR_BASE, {}]]),
        async find(t: string, q?: { where?: Record<string, unknown>; limit?: number }) {
            const rows = table(t).filter((r) => matches(r, q?.where));
            return typeof q?.limit === 'number' ? rows.slice(0, q.limit) : rows;
        },
        async findOne(t: string, q: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(t, q);
            return table(t).find((r) => matches(r, q.where)) ?? null;
        },
        async insert(t: string, data: Row) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...data };
            table(t).push(row);
            return { ...row };
        },
        async update(t: string, data: Row, q?: { where?: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, q);
            const hit = table(t).filter((r) => matches(r, q?.where));
            for (const r of hit) Object.assign(r, data);
            return { id: hit[0]?.id ?? null };
        },
        async delete(t: string, q?: { where?: Record<string, unknown> }) {
            assertEngineDeleteDispatch(q);
            const keep = table(t).filter((r) => !matches(r, q?.where));
            const deleted = table(t).length - keep.length;
            tables.set(t, keep);
            return { deleted };
        },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { return true; },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            unregisterItem: () => {},
            listItems: (type: string) => (type === 'object'
                ? [{ name: 'task', fields: { name: { type: 'text' }, title: { type: 'text' } } }]
                : SHIPPED.filter((i) => i.type === type).map((i) => artifact(i.type, i.name))),
            getItem: (type: string, name: string) => artifact(type, name),
            getObject: () => undefined,
            getPackage: packageRecord,
            getAllPackages: () => Object.keys(MANIFESTS).map(packageRecord),
            isPackageDisabled: () => false,
            getArtifactItem: artifact,
            applyNavContributions: (a: unknown) => a,
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_1') as any;
    const rows = (type: string, name: string) => table('sys_metadata')
        .filter((r) => r.type === type && r.name === name)
        .map((r) => ({ package_id: r.package_id ?? null, state: r.state, label: JSON.parse(r.metadata).label }));
    /** A draft bound to the base, as a save naming it left one before the close. */
    const seedBaseDraft = (type: string, name: string, body: Record<string, unknown>) => {
        nextId += 1;
        table('sys_metadata').push({
            id: `seed_${nextId}`, type, name, organization_id: null, package_id: BASE, state: 'draft',
            version: 1, metadata: JSON.stringify(body), checksum: `sha-${nextId}`,
        });
    };
    /**
     * A row bound to the base, as a save naming it left one before the close:
     * written through the server-stated rewrite (`source` set), the one write
     * naming the base the close does not judge, so its history is the door's.
     */
    const storeBaseRow = (type: string, name: string, body: Record<string, unknown>) =>
        protocol.saveMetaItem({ type, name, item: body, packageId: BASE, source: 'migrate-stored', force: true });
    return { protocol, rows, seedBaseDraft, storeBaseRow };
}

const thrown = (run: () => Promise<unknown>) => run().then(() => undefined, (e: any) => e);

/** The named-base close's envelope, its fix (#28576's, one spelling) and its bound. */
function expectClosed(e: any, type: string, name: string, verb: 'save' | 'publish' | 'rollback') {
    expect(e, 'expected the write naming the base to be refused').toBeInstanceOf(Error);
    expect(resolveThrownHttpError(e)).toMatchObject({ status: 403, code: 'NOT_OVERRIDABLE' });
    expectClosedSentence(String(e.message), type, name, verb);
}

function expectClosedSentence(message: string, type: string, name: string, verb: 'save' | 'publish' | 'rollback') {
    expect(message).toContain(`'${type}/${name}' ships in '${BASE}'`);
    expect(message).toContain(`'${PAIR}' (?package=${PAIR})`);
    expect(message).toContain(`overrides: { package: '${BASE}', basedOn }`);
    expect(message).toContain('ADR-0146 D1, D11');
    if (verb === 'rollback') expect(message).toContain('a rollback of its row bound to the read-only base is closed');
    else expect(message).toContain(`${verb} it into '${PAIR}'`);
    // The REST door cuts a refusal's text at 500 characters
    // (`CLIENT_MESSAGE_MAX`, `@objectstack/types`): the whole sentence fits.
    expect(message.length).toBeLessThan(500);
}

beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
    vi.useRealTimers();
});

describe('a write naming the read-only base itself is closed: its customization lands in the pair (ADR-0146 D1, D11)', () => {
    for (const { type, name, body } of ITEMS) {
        it(`${type}: the save naming the base, active and draft, is refused naming the pair, and nothing is written`, async () => {
            const { protocol, rows } = makeProtocol();

            const active = await thrown(() => protocol.saveMetaItem({ type, name, item: body('NamedBase'), packageId: BASE }));
            const draft = await thrown(() => protocol.saveMetaItem({ type, name, item: body('NamedBaseDraft'), packageId: BASE, mode: 'draft' }));

            expectClosed(active, type, name, 'save');
            expectClosed(draft, type, name, 'save');
            expect(rows(type, name)).toEqual([]);
            expect((await protocol.getMetaItem({ type, name, packageId: BASE })).item.label).toBe(PACKAGED);
        });
    }

    it('the per-item publish of a draft bound to the base is refused naming the pair; the draft stays a draft', async () => {
        const { protocol, rows, seedBaseDraft } = makeProtocol();
        seedBaseDraft(VIEW.type, VIEW.name, VIEW.body('BaseDraft'));

        const refused = await thrown(() => protocol.publishMetaItem({ type: VIEW.type, name: VIEW.name, packageId: BASE }));

        expectClosed(refused, VIEW.type, VIEW.name, 'publish');
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'draft', label: 'BaseDraft' }]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe(PACKAGED);
    });

    it('the package batch publish (`publishPackageDrafts`) of the base\'s drafts promotes none of them', async () => {
        const { protocol, rows, seedBaseDraft } = makeProtocol();
        seedBaseDraft(VIEW.type, VIEW.name, VIEW.body('BaseDraft'));

        const result = await protocol.publishPackageDrafts({ packageId: BASE });

        // The batch is all-or-nothing (ADR-0067 D2): refused, naming the item and the close.
        expect(result).toMatchObject({ success: false, outcome: 'refused', publishedCount: 0, published: [] });
        expect(result.failed).toEqual([expect.objectContaining({ type: VIEW.type, name: VIEW.name, code: 'NOT_OVERRIDABLE' })]);
        expectClosedSentence(result.failed[0].error, VIEW.type, VIEW.name, 'publish');
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'draft', label: 'BaseDraft' }]);
    });

    it('the rollback of a row bound to the base is refused naming the pair; the row is unchanged', async () => {
        const { protocol, rows, storeBaseRow } = makeProtocol();
        await storeBaseRow(VIEW.type, VIEW.name, VIEW.body('First'));
        await storeBaseRow(VIEW.type, VIEW.name, VIEW.body('Second'));

        const refused = await thrown(() => protocol.rollbackMetaItem({ type: VIEW.type, name: VIEW.name, toVersion: 1, actor: 'admin' }));

        expectClosed(refused, VIEW.type, VIEW.name, 'rollback');
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'active', label: 'Second' }]);
    });

    it('a 30-character base id and a 40-character name keep each sentence under the 500-character bound', () => {
        const closed = { base: 'com.objectstack.enterprise_crm', pair: 'com.objectstack.enterprise_crm.custom' };
        const request = { type: 'email_template', name: `crm_${'x'.repeat(36)}` };
        for (const op of ['save', 'publish', 'rollback'] as const) {
            const named = namedBaseOverlayWriteRefusal(request, closed, op).message;
            expect(named.length, `${op}: ${named}`).toBeLessThan(500);
        }
    });
});

describe('CONTROLS: the writes the close leaves open, as on main', () => {
    it('a delete naming the base removes a row bound to it (stored before the close); the read serves the base again', async () => {
        const { protocol, rows, storeBaseRow } = makeProtocol();
        await storeBaseRow(VIEW.type, VIEW.name, VIEW.body('StoredBefore'));
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('StoredBefore');

        const receipt = await protocol.deleteMetaItem({ type: VIEW.type, name: VIEW.name, packageId: BASE });

        expect(receipt).toMatchObject({ success: true });
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe(PACKAGED);
    });

    it('a draft discard naming the base removes a draft bound to it', async () => {
        const { protocol, rows, seedBaseDraft } = makeProtocol();
        seedBaseDraft(VIEW.type, VIEW.name, VIEW.body('BaseDraft'));

        const receipt = await protocol.deleteMetaItem({ type: VIEW.type, name: VIEW.name, packageId: BASE, state: 'draft' });

        expect(receipt).toMatchObject({ success: true });
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);
    });

    it('the fix the refusal names is taken: the pair\'s declared save is accepted and served over a row bound to the base', async () => {
        const { protocol, rows, storeBaseRow } = makeProtocol();
        await storeBaseRow(VIEW.type, VIEW.name, VIEW.body('StoredBefore'));

        const saved = await protocol.saveMetaItem({
            type: VIEW.type, name: VIEW.name, packageId: PAIR,
            item: { ...VIEW.body('PairDeclared'), overrides: { package: BASE, basedOn: BASE_VERSION } },
        });

        expect(saved).toMatchObject({ success: true });
        expect(rows(VIEW.type, VIEW.name)).toEqual(expect.arrayContaining([
            { package_id: PAIR, state: 'active', label: 'PairDeclared' },
            { package_id: BASE, state: 'active', label: 'StoredBefore' },
        ]));
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('PairDeclared');
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name, packageId: BASE })).item.label).toBe('PairDeclared');
    });

    it('a server-stated rewrite naming the base (`source` set) still writes the row it names', async () => {
        const { rows, storeBaseRow } = makeProtocol();

        await storeBaseRow(VIEW.type, VIEW.name, VIEW.body('Rewritten'));

        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'active', label: 'Rewritten' }]);
    });

    it('a writable package\'s save of the same name is not this close\'s', async () => {
        const { protocol, rows } = makeProtocol();

        const saved = await protocol.saveMetaItem({ type: VIEW.type, name: VIEW.name, item: VIEW.body('Workspace'), packageId: WRITABLE });

        expect(saved).toMatchObject({ success: true });
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: WRITABLE, state: 'active', label: 'Workspace' }]);
    });

    it('a name the base does not ship keeps ADR-0070 D1\'s answer, not this close\'s', async () => {
        const { protocol, rows } = makeProtocol();
        const name = 'task.not_shipped';

        const e = await thrown(() => protocol.saveMetaItem({ type: 'view', name, item: { ...VIEW.body('New'), name }, packageId: BASE }));

        expect(resolveThrownHttpError(e)).not.toMatchObject({ code: 'NOT_OVERRIDABLE' });
        expect(resolveThrownHttpError(e)).toMatchObject({ code: 'WRITABLE_PACKAGE_REQUIRED' });
        expect(rows('view', name)).toEqual([]);
    });

    it('a read-only base whose pair cannot be ensured keeps the write naming it: the refusal would name no door', async () => {
        const { protocol, rows } = makeProtocol();

        const saved = await protocol.saveMetaItem({
            type: 'dashboard', name: 'legacy_board', item: { name: 'legacy_board', label: 'Legacy', widgets: [] }, packageId: NO_PAIR_BASE,
        });

        expect(saved).toMatchObject({ success: true });
        expect(rows('dashboard', 'legacy_board')).toEqual([{ package_id: NO_PAIR_BASE, state: 'active', label: 'Legacy' }]);
    });

    it('a body carrying `overrides` keeps the D2 gate\'s sentence: only the pair declares one', async () => {
        const { protocol, rows } = makeProtocol();

        const e = await thrown(() => protocol.saveMetaItem({
            type: VIEW.type, name: VIEW.name, packageId: BASE,
            item: { ...VIEW.body('Declared'), overrides: { package: BASE, basedOn: BASE_VERSION } },
        }));

        expect(resolveThrownHttpError(e)).toMatchObject({ status: 403, code: 'NOT_OVERRIDABLE' });
        expect(String(e.message)).toContain(`only '${PAIR}' may declare an override of '${BASE}'`);
        expect(String(e.message)).not.toContain('ADR-0146 D1, D11');
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);
    });
});

/**
 * [#29390] The commit doors. A commit the base recorded before the close (a
 * draft naming the base, published by `publishPackageDrafts` with the close
 * shadowed on this instance only, which is what a build before #28905 did)
 * can carry an item that EDITED the row bound to the base. Its revert restores
 * a stored version into that row, so it is refused per item, as the per-item
 * rollback of the same row is: the restore limb asks the same close on the
 * same key (the binding the restore writes) with the same sentence. An item
 * the commit CREATED is reverted by removing the row, which writes nothing and
 * stays open.
 */
describe('the commit doors: restoring a row bound to the base is closed, removing one stays open (#29390)', () => {
    /** Each commit a second apart, so the package rollback's "strictly newer" reads an order. */
    let clock = Date.parse('2026-11-02T00:00:00.000Z');
    const tick = () => { clock += 1000; vi.setSystemTime(clock); };

    /** Publish `item` into `packageId` as one commit; `beforeClose` shadows the close on this instance only. */
    async function publishCommit(protocol: any, packageId: string, item: Record<string, unknown>, beforeClose = false): Promise<string> {
        tick();
        if (beforeClose) protocol.namedBaseOverlayWriteRefusal = () => null;
        try {
            const saved = await protocol.saveMetaItem({ type: VIEW.type, name: VIEW.name, item, packageId, mode: 'draft' });
            expect(saved).toMatchObject({ success: true });
            const published = await protocol.publishPackageDrafts({ packageId });
            expect(published, JSON.stringify(published)).toMatchObject({ success: true });
            expect(typeof published.commitId).toBe('string');
            return published.commitId;
        } finally {
            if (beforeClose) delete protocol.namedBaseOverlayWriteRefusal;
        }
    }
    const intoBaseBeforeClose = (protocol: any, label: string) => publishCommit(protocol, BASE, VIEW.body(label), true);
    const declared = (label: string) => ({ ...VIEW.body(label), overrides: { package: BASE, basedOn: BASE_VERSION } });

    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
    });

    it('a revert of the base\'s commit that edited its row is refused per item naming the pair, and nothing is written', async () => {
        const { protocol, rows } = makeProtocol();
        await intoBaseBeforeClose(protocol, 'First');
        const edit = await intoBaseBeforeClose(protocol, 'Second');
        // The close is live again on this instance: the save naming the base is refused.
        expectClosed(await thrown(() => protocol.saveMetaItem({ type: VIEW.type, name: VIEW.name, item: VIEW.body('After'), packageId: BASE })), VIEW.type, VIEW.name, 'save');

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: BASE, actor: 'admin' });

        expect(result).toMatchObject({ success: false, revertedCount: 0, failedCount: 1, reverted: [] });
        expect(result.failed).toEqual([expect.objectContaining({ type: VIEW.type, name: VIEW.name, code: 'NOT_OVERRIDABLE' })]);
        expectClosedSentence(result.failed[0].error, VIEW.type, VIEW.name, 'rollback');
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'active', label: 'Second' }]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('Second');
    });

    it('a package rollback through those commits reports each refused item and continues; the row is unchanged', async () => {
        const { protocol, rows } = makeProtocol();
        const created = await intoBaseBeforeClose(protocol, 'First');
        const second = await intoBaseBeforeClose(protocol, 'Second');
        const third = await intoBaseBeforeClose(protocol, 'Third');

        tick();
        const result = await protocol.rollbackToPackageCommit({ commitId: created, packageId: BASE, actor: 'admin' });

        expect(result.success).toBe(false);
        expect(result.revertedCommits).toEqual([third, second]);
        expect(result.failed.map((f: { commitId: string }) => f.commitId)).toEqual([third, second]);
        for (const f of result.failed) {
            expect(f.error).toContain(`Item '${VIEW.type}/${VIEW.name}' was not reverted: `);
            expectClosedSentence(f.error.slice(f.error.indexOf(': ') + 2), VIEW.type, VIEW.name, 'rollback');
        }
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'active', label: 'Third' }]);
    });

    it('CONTROL: a revert of the base\'s commit that created its row removes it (the delete stays open); the base is served again', async () => {
        const { protocol, rows } = makeProtocol();
        const created = await intoBaseBeforeClose(protocol, 'First');

        tick();
        const result = await protocol.revertCommit({ commitId: created, packageId: BASE, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'removed' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe(PACKAGED);
    });

    it('CONTROL: a writable package\'s commit of the same item reverts its row in place', async () => {
        const { protocol, rows } = makeProtocol();
        await publishCommit(protocol, WRITABLE, VIEW.body('First'));
        const edit = await publishCommit(protocol, WRITABLE, VIEW.body('Second'));

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: WRITABLE, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'restored' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: WRITABLE, state: 'active', label: 'First' }]);
    });

    it('CONTROL: the pair\'s own commit (no row bound to the base) reverts its row in place', async () => {
        const { protocol, rows } = makeProtocol();
        await publishCommit(protocol, PAIR, declared('PairFirst'));
        const edit = await publishCommit(protocol, PAIR, declared('PairSecond'));

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: PAIR, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'restored' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: PAIR, state: 'active', label: 'PairFirst' }]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('PairFirst');
    });

    // [#29414] The plan and both revert limbs address the committing package's
    // own row. Before, each read any package's active row, so the pair's
    // commit beside a row bound to the base addressed the base row.
    const planOf = async (protocol: any, packageId: string, commitId: string) =>
        ((await protocol.listCommits({ packageId })) as Array<{ id: string; items: unknown[] }>).find((c) => c.id === commitId)?.items;

    it('[#29414] the pair\'s first commit beside a row bound to the base records a create, and its revert removes the pair row; the base row is served again', async () => {
        const { protocol, rows } = makeProtocol();
        await intoBaseBeforeClose(protocol, 'BaseRow');
        const created = await publishCommit(protocol, PAIR, declared('PairFirst'));
        expect(await planOf(protocol, PAIR, created)).toEqual([
            expect.objectContaining({ type: VIEW.type, name: VIEW.name, existedBefore: false, prevVersion: null }),
        ]);

        tick();
        const result = await protocol.revertCommit({ commitId: created, packageId: PAIR, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'removed' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: BASE, state: 'active', label: 'BaseRow' }]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('BaseRow');
    });

    it('[#29414] the pair\'s edit commit beside a row bound to the base restores the pair\'s own row; the base row is untouched', async () => {
        const { protocol, rows } = makeProtocol();
        await intoBaseBeforeClose(protocol, 'BaseRow');
        await publishCommit(protocol, PAIR, declared('PairFirst'));
        const edit = await publishCommit(protocol, PAIR, declared('PairSecond'));
        expect(await planOf(protocol, PAIR, edit)).toEqual([
            expect.objectContaining({ type: VIEW.type, name: VIEW.name, existedBefore: true }),
        ]);

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: PAIR, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'restored' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([
            { package_id: BASE, state: 'active', label: 'BaseRow' },
            { package_id: PAIR, state: 'active', label: 'PairFirst' },
        ]);
    });

    it('[#29414] a revert of the base\'s edit commit whose row was since deleted restores into the base\'s own row, so the named-base close refuses it; nothing is written', async () => {
        const { protocol, rows } = makeProtocol();
        await intoBaseBeforeClose(protocol, 'First');
        const edit = await intoBaseBeforeClose(protocol, 'Second');
        expect(await protocol.deleteMetaItem({ type: VIEW.type, name: VIEW.name, packageId: BASE })).toMatchObject({ success: true });
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: BASE, actor: 'admin' });

        expect(result).toMatchObject({ success: false, revertedCount: 0, failedCount: 1, reverted: [] });
        expect(result.failed).toEqual([expect.objectContaining({ type: VIEW.type, name: VIEW.name, code: 'NOT_OVERRIDABLE' })]);
        expectClosedSentence(result.failed[0].error, VIEW.type, VIEW.name, 'rollback');
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe(PACKAGED);
    });

    it('[#29414] a pair commit recorded before #29414 beside a row bound to the base names the base row\'s version: its revert is refused by the override write gate, and the pair\'s declared row is unchanged', async () => {
        const { protocol, rows } = makeProtocol();
        await intoBaseBeforeClose(protocol, 'BaseRow');
        const created = await publishCommit(protocol, PAIR, declared('PairFirst'));
        // The plan such a commit recorded before #29414: the base row's version, read off any package's row.
        const engine = protocol.engine;
        const baseVersion = (await engine.findOne('sys_metadata', { where: { type: VIEW.type, name: VIEW.name, state: 'active', package_id: BASE } })).version;
        expect(typeof baseVersion).toBe('number');
        await engine.update('sys_metadata_commit', {
            items: JSON.stringify([{ type: VIEW.type, name: VIEW.name, existedBefore: true, prevVersion: baseVersion }]),
        }, { where: { id: created } });
        expect(await planOf(protocol, PAIR, created)).toEqual([
            expect.objectContaining({ existedBefore: true, prevVersion: baseVersion }),
        ]);

        tick();
        const result = await protocol.revertCommit({ commitId: created, packageId: PAIR, actor: 'admin' });

        expect(result).toMatchObject({ success: false, revertedCount: 0, failedCount: 1, reverted: [] });
        expect(result.failed).toEqual([expect.objectContaining({ type: VIEW.type, name: VIEW.name, code: 'NOT_OVERRIDABLE' })]);
        expect(rows(VIEW.type, VIEW.name)).toEqual([
            { package_id: BASE, state: 'active', label: 'BaseRow' },
            { package_id: PAIR, state: 'active', label: 'PairFirst' },
        ]);
        const pairRow = await engine.findOne('sys_metadata', { where: { type: VIEW.type, name: VIEW.name, state: 'active', package_id: PAIR } });
        expect(JSON.parse(pairRow.metadata).overrides).toEqual({ package: BASE, basedOn: BASE_VERSION });
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('PairFirst');
    });

    it('[#29414] CONTROL: the pair\'s edit commit whose row was since deleted restores the pair\'s declared row again', async () => {
        const { protocol, rows } = makeProtocol();
        await publishCommit(protocol, PAIR, declared('PairFirst'));
        const edit = await publishCommit(protocol, PAIR, declared('PairSecond'));
        expect(await protocol.deleteMetaItem({ type: VIEW.type, name: VIEW.name, packageId: PAIR })).toMatchObject({ success: true });
        expect(rows(VIEW.type, VIEW.name)).toEqual([]);

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: PAIR, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'restored' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: PAIR, state: 'active', label: 'PairFirst' }]);
        expect((await protocol.getMetaItem({ type: VIEW.type, name: VIEW.name })).item.label).toBe('PairFirst');
    });

    it('[#29414] CONTROL: a writable package\'s edit commit whose row was since deleted restores into that package\'s row, never a package-less one', async () => {
        const { protocol, rows } = makeProtocol();
        await publishCommit(protocol, WRITABLE, VIEW.body('First'));
        const edit = await publishCommit(protocol, WRITABLE, VIEW.body('Second'));
        expect(await protocol.deleteMetaItem({ type: VIEW.type, name: VIEW.name, packageId: WRITABLE })).toMatchObject({ success: true });

        tick();
        const result = await protocol.revertCommit({ commitId: edit, packageId: WRITABLE, actor: 'admin' });

        expect(result).toMatchObject({ success: true, revertedCount: 1, failed: [], reverted: [{ type: VIEW.type, name: VIEW.name, action: 'restored' }] });
        expect(rows(VIEW.type, VIEW.name)).toEqual([{ package_id: WRITABLE, state: 'active', label: 'First' }]);
    });
});
