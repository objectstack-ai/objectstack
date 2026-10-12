// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010 §3.5 and Phase 4.3] The save door refuses a `protection` block.
 *
 * `protection` is the package author's lock declaration. ADR-0010 states one
 * door for it: a code package's loader translates it into the private `_lock`
 * envelope at load time and strips it (`applyProtection`). An item the save
 * door writes is authored in the environment, and ADR-0010 §3.5 states that
 * such an item takes no package lock. The door used to store the block
 * verbatim, so the item was served with `protection.lock: 'full'` while it read
 * `lock: 'none'` and every edit and delete succeeded.
 *
 * The pins:
 *
 *  - the `app` and `dashboard` probes are refused with a located
 *    `400 VALIDATION_ERROR`, and no row is stored;
 *  - draft mode, a malformed block and the unmanaged import's face meet the
 *    same refusal;
 *  - an overlay of a packaged item that declares no lock meets it too;
 *  - the server-stated rewrites of stored rows (`source: 'migrate-stored'`,
 *    `writeFace: 'package-duplicate'`) strip the block instead, so the row they
 *    write carries none and the rewrite is not failed over a key that never
 *    bound;
 *  - CONTROL: a body without `protection` saves as before, its row carries no
 *    `protection`, and the item stays editable and deletable;
 *  - CONTROL: the packaged item's `protection` still binds — the artifact the
 *    loader translated refuses an overlay save with `403 ITEM_LOCKED`, which
 *    still answers before this refusal;
 *  - CONTROL: on a type whose schema does not declare `protection`, the parse's
 *    own `422 INVALID_METADATA` answers, as before.
 *
 * Refusals are asserted as the envelope an HTTP boundary answers with
 * (`resolveThrownHttpError`), never as a bare throw.
 *
 * The engine below is a stub: this package cannot import `@objectstack/objectql`
 * (that package depends on this one). It keeps real rows, so the REAL save door
 * runs against it, and its write verbs route through the producer's own
 * dispatch predicates.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate, assertEngineUpdateDispatch, isCodeArtifactBody } from '@objectstack/metadata-core';
import { applyProtection } from '@objectstack/spec/shared';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation, overlaySchemaDeclaredKey } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

type Row = Record<string, any>;

const PACKAGE_ID = 'com.example.dash';
const LOCK = { lock: 'full', reason: 'probe: locked by hand' } as const;

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
            // The caller's bound, after the filter, by presence — as the engine applies it.
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
    const metadataWrites = () => writes.filter((w) => w.table === 'sys_metadata');
    const stored = (type: string, name: string) => table('sys_metadata').filter((r) => r.type === type && r.name === name);
    return { protocol, table, writes, metadataWrites, stored };
}

/** A dashboard a code package ships, as its loader registers it: `protection` translated and stripped. */
function packagedDashboard(name: string, protection?: { lock: string; reason: string }): { type: string; item: Record<string, unknown> } {
    const item: Record<string, unknown> = { name, label: `Packaged ${name}`, widgets: [], ...(protection ? { protection } : {}) };
    applyProtection(item, { packageId: PACKAGE_ID, packageVersion: '1.0.0' });
    return { type: 'dashboard', item };
}

/** The card's probes: the hand-authored bodies of the measured `PUT`s. */
const PROBES = [
    { type: 'app', name: 'probe_locked_app', body: (extra: Record<string, unknown> = {}) => ({ name: 'probe_locked_app', label: 'Probe Locked', ...extra }) },
    { type: 'dashboard', name: 'probe_locked_dash', body: (extra: Record<string, unknown> = {}) => ({ name: 'probe_locked_dash', label: 'Probe Locked Dash', widgets: [], ...extra }) },
] as const;

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    try {
        await run();
    } catch (e) {
        return e;
    }
    throw new Error('expected the call to be refused, but it resolved');
}

/** The refusal's envelope, and its location: the key named in the message and as the one issue's path. */
function expectProtectionRefusal(err: any): void {
    const envelope = resolveThrownHttpError(err);
    expect(envelope.status).toBe(400);
    expect(envelope.code).toBe('VALIDATION_ERROR');
    expect(err.issues).toEqual([expect.objectContaining({ path: 'protection' })]);
    expect(err.message).toContain('Remove the `protection` block');
    // It names the door ADR-0010 does state, and no private envelope key.
    expect(err.message).toContain("code package's source");
    expect(err.message).not.toMatch(/`_lock/);
}

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

describe('the save door refuses a `protection` block — the card\'s probes', () => {
    for (const probe of PROBES) {
        it(`${probe.type}: refused with a located 400 VALIDATION_ERROR, and no row is stored`, async () => {
            const { protocol, metadataWrites, stored } = makeProtocol();
            expect(overlaySchemaDeclaredKey(probe.type, 'protection')).toBeDefined();
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: probe.type, name: probe.name, item: probe.body({ protection: LOCK }),
            }));
            expectProtectionRefusal(err);
            expect(err.message).toContain(`${probe.type} '${probe.name}'`);
            expect(stored(probe.type, probe.name)).toEqual([]);
            expect(metadataWrites()).toEqual([]);
        });

        it(`${probe.type}: CONTROL — the same body without \`protection\` saves, its row carries none, and the item stays editable and deletable`, async () => {
            const { protocol, stored } = makeProtocol();
            const first = await protocol.saveMetaItem({ type: probe.type, name: probe.name, item: probe.body() });
            expect(first.success).toBe(true);
            const [row] = stored(probe.type, probe.name).filter((r) => r.state === 'active');
            const body = JSON.parse(row!.metadata);
            expect(body).not.toHaveProperty('protection');
            expect(body.label).toBe(probe.body().label);
            const second = await protocol.saveMetaItem({
                type: probe.type, name: probe.name, item: probe.body({ label: 'Edited' }),
            });
            expect(second.success).toBe(true);
            const removed = await protocol.deleteMetaItem({ type: probe.type, name: probe.name });
            expect(removed.success).toBe(true);
        });
    }
});

describe('the save door refuses a `protection` block — every way it arrives', () => {
    const app = PROBES[0];

    it('in draft mode', async () => {
        const { protocol, metadataWrites } = makeProtocol();
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: app.type, name: app.name, item: app.body({ protection: LOCK }), mode: 'draft',
        }));
        expectProtectionRefusal(err);
        expect(metadataWrites()).toEqual([]);
    });

    it('malformed: the block is refused by this refusal, not judged by the parse first', async () => {
        const { protocol, metadataWrites } = makeProtocol();
        for (const protection of [{ lock: 'sealed', reason: 'r' }, { lock: 'full' }, null]) {
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: app.type, name: app.name, item: app.body({ protection }),
            }));
            expectProtectionRefusal(err);
        }
        expect(metadataWrites()).toEqual([]);
    });

    it('on the unmanaged import\'s face, which hands a block it cannot parse to this door to be refused', async () => {
        const { protocol, metadataWrites } = makeProtocol();
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: app.type, name: app.name, item: app.body({ protection: { lock: 'sealed', reason: 'r' } }),
            writeFace: 'package-unmanaged-import',
        }));
        expectProtectionRefusal(err);
        expect(metadataWrites()).toEqual([]);
    });

    it('on an overlay of a packaged item that declares no lock', async () => {
        const { protocol, metadataWrites } = makeProtocol([packagedDashboard('pkg_open_dash')]);
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'dashboard', name: 'pkg_open_dash', item: { name: 'pkg_open_dash', label: 'Overlay', widgets: [], protection: LOCK },
        }));
        expectProtectionRefusal(err);
        expect(metadataWrites()).toEqual([]);
        // CONTROL: the same overlay without the block saves.
        const ok = await protocol.saveMetaItem({
            type: 'dashboard', name: 'pkg_open_dash', item: { name: 'pkg_open_dash', label: 'Overlay', widgets: [] },
        });
        expect(ok.success).toBe(true);
    });
});

describe('the server-stated rewrites strip the block instead — a row stored before the refusal may carry one', () => {
    const app = PROBES[0];
    const rewrites = [
        { face: '`source: \'migrate-stored\'` (the stored migration, the flow credential move)', extra: { source: 'migrate-stored', force: true } },
        { face: '`writeFace: \'package-duplicate\'`', extra: { writeFace: 'package-duplicate' } },
    ] as const;

    for (const rewrite of rewrites) {
        it(`${rewrite.face}: the rewrite lands, and the row carries no \`protection\``, async () => {
            const { protocol, stored } = makeProtocol();
            const item: Record<string, unknown> = app.body({ protection: LOCK });
            const result = await protocol.saveMetaItem({ type: app.type, name: app.name, item, ...rewrite.extra });
            expect(result.success).toBe(true);
            const [row] = stored(app.type, app.name).filter((r) => r.state === 'active');
            const body = JSON.parse(row!.metadata);
            expect(body).not.toHaveProperty('protection');
            expect(body.label).toBe(app.body().label);
            // The caller's own body is never mutated.
            expect(item.protection).toEqual(LOCK);
        });
    }
});

describe('CONTROLS — what the refusal leaves as it was', () => {
    it('the packaged item\'s `protection` still binds: the loader translated it, and an overlay save is refused 403 ITEM_LOCKED', async () => {
        const artifact = packagedDashboard('pkg_locked_dash', LOCK);
        // The loader's translation: the block became the private envelope and was stripped.
        expect(artifact.item).not.toHaveProperty('protection');
        expect(artifact.item).toMatchObject({ _lock: 'full', _lockSource: 'package', _packageId: PACKAGE_ID });
        const { protocol, stored } = makeProtocol([artifact]);
        for (const extra of [{}, { protection: LOCK }]) {
            const err = await refusalOf(() => protocol.saveMetaItem({
                type: 'dashboard', name: 'pkg_locked_dash', item: { name: 'pkg_locked_dash', label: 'Overlay', widgets: [], ...extra },
            }));
            // The lock gate answers first, with or without a block in the body.
            const envelope = resolveThrownHttpError(err);
            expect(envelope.status).toBe(403);
            expect(envelope.code).toBe('ITEM_LOCKED');
        }
        expect(stored('dashboard', 'pkg_locked_dash')).toEqual([]);
    });

    it('a type whose schema does not declare `protection` keeps the parse\'s own 422 INVALID_METADATA', async () => {
        expect(overlaySchemaDeclaredKey('page', 'protection')).toBeUndefined();
        const { protocol, metadataWrites } = makeProtocol();
        const err = await refusalOf(() => protocol.saveMetaItem({
            type: 'page', name: 'probe_page', item: { name: 'probe_page', label: 'Page', type: 'app', regions: [], protection: LOCK },
        }));
        const envelope = resolveThrownHttpError(err);
        expect(envelope.status).toBe(422);
        expect(envelope.code).toBe('INVALID_METADATA');
        expect(err.message).toContain('protection');
        expect(metadataWrites()).toEqual([]);
    });
});
