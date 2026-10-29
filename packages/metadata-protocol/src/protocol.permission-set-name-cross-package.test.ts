// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A permission set's name is its identity across the whole deployment: a grant
 * (`sys_user_permission_set.permission_set`) resolves its set by that name
 * alone (ADR-0131 D4), so positions, permission sets and capabilities each hold
 * one name per deployment (maintainer ruling Q4 = A, record 6050490870). This
 * file pins that rule at every metadata door a set reaches `active` through —
 * the save door (`saveMetaItem`, draft and publish mode), the draft→active
 * promotion shared by the per-item publish and the package publish
 * (`publishPackageDrafts`), and the restore door (`rollbackMetaItem`) — with
 * the registry's envelope, `NAMESPACE_CONFLICT` / 422, and nothing written
 * (`permissionSetNameCollisionRefusal`; ruling A, record 6063176077: one name,
 * one holder, on every path).
 *
 * The owner a write is judged as is the binding it LANDS IN: a draft save that
 * names no package over package B's active set is B's draft (the repository's
 * #11087 inheritance), so it is B's own edit, not a foreign write. A
 * package-less row stored beside exactly one package's row is that package's
 * (#23165's rule, applied to ownership). The holders are the stored rows and
 * the registry's own package-held reading (ruling letter B, record
 * 6074838935), which this file's double answers from its install claims; the
 * objectql suite `protocol-permission-set-name-registry-reading.test.ts` drives
 * the same doors over a real `SchemaRegistry`.
 *
 * Each refusal is paired with a CONTROL through the same door, so a door that
 * refused everything could not pass. A shape a deployment can only hold from
 * before this hardening (two owners of one name, a package-less row beside a
 * package's) is staged through the real write path with the predicate
 * switched off for the staging writes alone.
 *
 * The engine double is `protocol.item-name-every-door.test.ts`'s — a store of
 * rows plus a registry keyed by name — copied, not imported, so each pin can
 * fail on its own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertEngineDeleteDispatch,
    assertEngineUpdateDispatch,
    assertEngineFindOnePredicate,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The owners these cases publish into, installed (a save naming an uninstalled package is refused first). */
const OWNER_A = 'app.owner_a';
const OWNER_B = 'app.owner_b';
const INSTALLED_PACKAGES: ReadonlySet<string> = new Set([OWNER_A, OWNER_B]);
const installedPackage = (id: string) => (INSTALLED_PACKAGES.has(id) ? { manifest: { id } } : undefined);

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
}

interface HistoryRow {
    id: string;
    type: string;
    name: string;
    version: number;
    organization_id: string | null;
    operation_type: string;
    metadata?: string | null;
}

/** ADR-0048 overlay key — (type, name, org, state, package_id). */
const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            const clauses = v as Array<Record<string, unknown>>;
            if (!clauses.some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if ((r as unknown as Record<string, unknown>)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const historyRows: HistoryRow[] = [];
    const registered = new Map<string, Map<string, unknown>>();
    /** Install claims: permission-set name → the package whose install declared it. */
    const claims = new Map<string, string>();
    let nextId = 0;
    let commit: unknown = null;

    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            if (r) return { key: k, row: r };
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };

    const matchesHistory = (h: HistoryRow, w: Record<string, unknown>): boolean => {
        if (w.organization_id !== undefined && h.organization_id !== w.organization_id) return false;
        if (w.type !== undefined && h.type !== w.type) return false;
        if (w.name !== undefined && h.name !== w.name) return false;
        if (w.version !== undefined && h.version !== w.version) return false;
        if (w.operation_type !== undefined && h.operation_type !== w.operation_type) return false;
        return true;
    };

    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_commit') return commit;
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesHistory(h, opts.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            const bound = <T>(all: T[]): T[] =>
                typeof opts?.limit === 'number' ? all.slice(0, opts.limit) : all;
            if (table === 'sys_metadata_history') {
                return bound(historyRows.filter((h) => matchesHistory(h, opts?.where ?? {})));
            }
            if (table !== 'sys_metadata') return [];
            return bound(Array.from(rows.values()).filter((r) => matchesWhere(r, opts?.where ?? {})));
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                nextId += 1;
                const h = { ...(data as unknown as HistoryRow), id: `h_${nextId}` };
                historyRows.push(h);
                return { id: h.id };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            nextId += 1;
            const row = { ...(data as unknown as Row), id: `r_${nextId}` };
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as unknown as Row) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async count() { return 0; },
        async transaction<T>(cb: (ctx: unknown, info: { owned: boolean }) => Promise<T>): Promise<T> {
            const rowsAtBegin = new Map(rows);
            const historyAtBegin = historyRows.slice();
            try {
                return await cb(undefined, { owned: true });
            } catch (error) {
                rows.clear();
                for (const [k, r] of rowsAtBegin) rows.set(k, r);
                historyRows.splice(0, historyRows.length, ...historyAtBegin);
                throw error;
            }
        },
        async syncObjectSchema() { return true; },
        async dropObjectSchema() { return true; },
        registry: {
            registerItem: (type: string, item: any) => {
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(item?.name, item);
            },
            unregisterItem: (type: string, name: string) => { registered.get(type)?.delete(name); },
            registerObject: () => {},
            unregisterObject: () => true,
            removeObjectOverlay: () => {},
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => true,
            listItems: (type: string) => Array.from(registered.get(type)?.values() ?? []),
            getItem: (type: string, name: string) => registered.get(type)?.get(name),
            getObject: () => undefined,
            getPackage: installedPackage,
            getArtifactItem: () => undefined,
            isPackageDisabled: () => false,
            // The registry's own package-held reading — the member
            // `findPackageHeldSecurityCatalogNames` (`@objectstack/objectql`)
            // answers — over this double's install claims.
            packageHeldSecurityCatalogNames: () => Array.from(claims, ([name, packageId]) => ({
                catalogType: 'permission', name, packageIds: [packageId],
            })),
        },
    };
    return {
        engine,
        rows,
        historyRows,
        registered,
        /** A package's install declares `name` (a claim: no stored row, no registered item). */
        claim: (name: string, packageId: string) => { claims.set(name, packageId); },
        serveCommit: (c: unknown) => { commit = c; },
    };
}

function makeProtocol() {
    const h = makeStubEngine();
    const protocol = new ObjectStackProtocolImplementation(h.engine, () => new Map(), undefined) as any;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    const saveDoor = vi.spyOn(protocol, 'saveMetaItem');
    return { protocol, saveDoor, ...h };
}

type Harness = ReturnType<typeof makeProtocol>;

const perm = (name: string, packageId?: string) =>
    ({ name, label: 'Set', objects: {}, ...(packageId === undefined ? {} : { packageId }) });

/** Every stored permission row as `{ row, state, binding }`. */
const storedSets = (h: Harness) => Array.from(h.rows.values())
    .filter((r) => r.type === 'permission')
    .map((r) => ({ row: r.name, state: r.state, binding: r.package_id ?? null }));
const keys = (h: Harness) => Array.from(h.registered.get('permission')?.keys() ?? []);

/** The minimum a rejection pin asserts: the ADR-0112 envelope, not "it threw". */
function expectConflict(error: any) {
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NAMESPACE_CONFLICT');
    expect(error.status).toBe(422);
}

async function attempt<T>(run: () => Promise<T>): Promise<{ result: T | null; error: any }> {
    try {
        return { result: await run(), error: null };
    } catch (error) {
        return { result: null, error };
    }
}

/**
 * Stage a state a deployment can only hold from before this hardening: run
 * `writes` through the real save door with the name predicate switched off,
 * then switch it back on.
 */
async function stagedBeforeTheHardening(h: Harness, writes: () => Promise<unknown>) {
    const off = vi.spyOn(h.protocol, 'permissionSetNameCollisionRefusal').mockResolvedValue(undefined);
    try {
        await writes();
    } finally {
        off.mockRestore();
    }
    h.saveDoor.mockClear();
}

afterEach(() => vi.restoreAllMocks());

const SET = 'project_editor';

// ═══════════════════════════════════════════════════════════════════════════
// 1. The save door — a draft/publish save of a name another owner holds
// ═══════════════════════════════════════════════════════════════════════════

describe('the save door refuses a permission set whose name another owner already holds', () => {
    it.each(['draft', 'publish'] as const)('%s mode: owner B holds the active set; owner A cannot save a second of that name — refused 422, nothing of A\'s stored', async (mode) => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A, mode,
        }));

        expectConflict(error);
        expect(error.message).toContain(`"${SET}"`);
        expect(error.message).toContain(`package "${OWNER_B}"`);
        // Only B's active row remains — nothing of A's landed, draft or active.
        expect(storedSets(h)).toEqual([{ row: SET, state: 'active', binding: OWNER_B }]);
        expect(keys(h)).toEqual([SET]);
    });

    it('an environment author (no package) cannot create a runtime set whose name a package\'s install declares — permission takes no environment overlay (ADR-0005)', async () => {
        // The holder is the registry's package half alone (an install claim, no
        // stored row), so a package-less save inherits no binding — it is a
        // fresh environment-authored set, and its name belongs to a package.
        const h = makeProtocol();
        h.claim(SET, OWNER_B);

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET),
        }));

        expectConflict(error);
        expect(error.message).toContain('this environment');
        expect(error.message).toContain(`package "${OWNER_B}"`);
        expect(storedSets(h)).toEqual([]);
    });

    it('the create precondition does not smuggle a cross-owner save: `If-None-Match: *` (parentVersion null) is still refused before it is evaluated', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A, mode: 'draft', parentVersion: null,
        }));

        expectConflict(error);
        expect(storedSets(h)).toEqual([{ row: SET, state: 'active', binding: OWNER_B }]);
    });

    it('a name only a DIFFERENT package\'s install declares (the registry\'s reading, no stored row) is refused too', async () => {
        const h = makeProtocol();
        h.claim(SET, OWNER_B);

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A,
        }));

        expectConflict(error);
        expect(error.message).toContain(`package "${OWNER_B}"`);
        expect(storedSets(h)).toEqual([]);
    });

    it('CONTROL: the owning package re-authors its own set (edit), and a brand-new name of A\'s, both save', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });

        // B edits its own set — same owner, not foreign.
        const edit = await h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: { ...perm(SET), label: 'Edited' }, packageId: OWNER_B, mode: 'draft',
        });
        expect(edit.success).toBe(true);
        // A authors a new name nobody holds.
        const fresh = await h.protocol.saveMetaItem({ type: 'permission', name: 'owner_a_editor', item: perm('owner_a_editor'), packageId: OWNER_A });
        expect(fresh.success).toBe(true);

        expect(storedSets(h)).toEqual([
            { row: SET, state: 'active', binding: OWNER_B },
            { row: SET, state: 'draft', binding: OWNER_B },
            { row: 'owner_a_editor', state: 'active', binding: OWNER_A },
        ]);
    });

    it('CONTROL: an environment author owns and edits its own runtime set', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: 'env_editor', item: perm('env_editor') });
        const edit = await h.protocol.saveMetaItem({ type: 'permission', name: 'env_editor', item: { ...perm('env_editor'), label: 'Edited' } });
        expect(edit.success).toBe(true);
        expect(storedSets(h)).toEqual([{ row: 'env_editor', state: 'active', binding: null }]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The owner is the binding the write LANDS IN
// ═══════════════════════════════════════════════════════════════════════════

describe('the save door judges the binding the write lands in, not the request\'s spelling', () => {
    it('a draft save naming no package, body without packageId, over package B\'s active set is B\'s own edit: it saves, and the draft is bound to B', async () => {
        // The console's plain `?mode=draft` save: the repository writes it into
        // the package of the item's active row (#11087), so it is B's write.
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });

        const res = await h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: { ...perm(SET), label: 'Edited' }, mode: 'draft',
        });

        expect(res.success).toBe(true);
        expect(storedSets(h)).toEqual([
            { row: SET, state: 'active', binding: OWNER_B },
            { row: SET, state: 'draft', binding: OWNER_B },
        ]);
    });

    it('CONTROL: the same save in publish mode lands in B through the package-less address, and saves', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });

        const res = await h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: { ...perm(SET), label: 'Edited' },
        });

        expect(res.success).toBe(true);
        expect(storedSets(h)).toEqual([{ row: SET, state: 'active', binding: OWNER_B }]);
    });

    it('a draft save naming no package over a name two packages already hold has no row to land in: refused as the repository refuses it, nothing written', async () => {
        const h = makeProtocol();
        await stagedBeforeTheHardening(h, async () => {
            await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A });
            await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });
        });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), mode: 'draft',
        }));

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe('RESOURCE_CONFLICT');
        expect(error.status).toBe(409);
        expect(error.message).toContain(`'${OWNER_A}'`);
        expect(error.message).toContain(`'${OWNER_B}'`);
        expect(storedSets(h)).toEqual([
            { row: SET, state: 'active', binding: OWNER_A },
            { row: SET, state: 'active', binding: OWNER_B },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. A package-less row beside one package's row is that package's (#23165)
// ═══════════════════════════════════════════════════════════════════════════

describe('a package-less row stored beside exactly one package\'s row is not a second owner', () => {
    /** The residue of the direct save before #23165: an environment-wide row of the name, then B's row beside it. */
    async function residueBesideB(h: Harness) {
        await stagedBeforeTheHardening(h, async () => {
            await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET) });
            await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });
        });
        expect(storedSets(h)).toEqual([
            { row: SET, state: 'active', binding: null },
            { row: SET, state: 'active', binding: OWNER_B },
        ]);
    }

    it('the owning package edits its own set — naming its package, naming none in publish mode, naming none as a draft — and each saves', async () => {
        const h = makeProtocol();
        await residueBesideB(h);

        const named = await h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: { ...perm(SET), label: 'named' }, packageId: OWNER_B,
        });
        expect(named.success).toBe(true);
        const unnamed = await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: { ...perm(SET), label: 'unnamed' } });
        expect(unnamed.success).toBe(true);
        const draft = await h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: { ...perm(SET), label: 'draft' }, mode: 'draft',
        });
        expect(draft.success).toBe(true);

        expect(storedSets(h)).toEqual([
            { row: SET, state: 'active', binding: null },
            { row: SET, state: 'active', binding: OWNER_B },
            { row: SET, state: 'draft', binding: OWNER_B },
        ]);
    });

    it('a different package is still refused, and the refusal names the package alone — the residue row is not the environment\'s', async () => {
        const h = makeProtocol();
        await residueBesideB(h);

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A,
        }));

        expectConflict(error);
        expect(error.message).toContain(`package "${OWNER_B}"`);
        expect(error.message).not.toContain('the environment catalog');
        expect(storedSets(h)).toEqual([
            { row: SET, state: 'active', binding: null },
            { row: SET, state: 'active', binding: OWNER_B },
        ]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. The draft→active promotion (per-item publish and publishPackageDrafts)
// ═══════════════════════════════════════════════════════════════════════════

describe('the draft promotion refuses a permission-set draft whose name another owner published since', () => {
    /** A's draft of the name, authored while nobody held it; then B publishes the name to active. */
    async function aDraftThenBPublishes(h: Harness) {
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A, mode: 'draft' });
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });
        h.saveDoor.mockClear();
    }

    it('publishMetaItem: A\'s draft cannot be promoted now that B holds the active name — refused 422, the draft kept, nothing of A\'s live', async () => {
        const h = makeProtocol();
        await aDraftThenBPublishes(h);

        const { error } = await attempt(() => h.protocol.publishMetaItem({ type: 'permission', name: SET, packageId: OWNER_A }));

        expectConflict(error);
        expect(error.message).toContain(`package "${OWNER_B}"`);
        expect(storedSets(h)).toEqual([
            { row: SET, state: 'draft', binding: OWNER_A },
            { row: SET, state: 'active', binding: OWNER_B },
        ]);
        // Only B's set is registered live; A's never reached the registry.
        expect(keys(h)).toEqual([SET]);
    });

    it('publishPackageDrafts: A\'s batch aborts on the collision, reported with the envelope\'s code; nothing of A\'s goes live', async () => {
        const h = makeProtocol();
        await aDraftThenBPublishes(h);
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = await h.protocol.publishPackageDrafts({ packageId: OWNER_A });

        expect(res.success).toBe(false);
        expect(res.publishedCount).toBe(0);
        const refused = res.failed.find((f: any) => f.name === SET);
        expect(refused).toMatchObject({ type: 'permission', code: 'NAMESPACE_CONFLICT' });
        expect(refused.error).toContain(`package "${OWNER_B}"`);
        // B's active row is untouched; A's draft stays a draft.
        expect(storedSets(h)).toEqual([
            { row: SET, state: 'draft', binding: OWNER_A },
            { row: SET, state: 'active', binding: OWNER_B },
        ]);
    });

    it('CONTROL: the owning package publishes its own first set, and later re-publishes its own draft of it', async () => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B, mode: 'draft' });
        // First publish: no other owner holds it.
        const first = await h.protocol.publishMetaItem({ type: 'permission', name: SET, packageId: OWNER_B });
        expect(first.success).toBe(true);
        // A re-edit by the same owner, then re-published.
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: { ...perm(SET), label: 'v2' }, packageId: OWNER_B, mode: 'draft' });
        const again = await h.protocol.publishMetaItem({ type: 'permission', name: SET, packageId: OWNER_B });
        expect(again.success).toBe(true);
        expect(storedSets(h)).toEqual([{ row: SET, state: 'active', binding: OWNER_B }]);
        expect(keys(h)).toEqual([SET]);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The restore door (rollbackMetaItem → refuseRestoredBodyTheSaveDoorRefuses)
// ═══════════════════════════════════════════════════════════════════════════

describe('the restore door refuses to make a set a second holder of a name', () => {
    /** The environment's set, saved and then deleted: its first version stays in the history. */
    async function savedThenDeleted(h: Harness): Promise<number> {
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET) });
        await h.protocol.deleteMetaItem({ type: 'permission', name: SET });
        expect(storedSets(h)).toEqual([]);
        const first = h.historyRows.find((row) => row.name === SET && typeof row.metadata === 'string');
        expect(first).toBeDefined();
        return first!.version;
    }

    it('rollbackMetaItem: the deleted set\'s version is not restored once a package\'s install declares the name — refused 422, nothing written', async () => {
        const h = makeProtocol();
        const version = await savedThenDeleted(h);
        h.claim(SET, OWNER_B);

        const { error } = await attempt(() => h.protocol.rollbackMetaItem({ type: 'permission', name: SET, toVersion: version }));

        expectConflict(error);
        expect(error.message).toContain('this environment');
        expect(error.message).toContain(`package "${OWNER_B}"`);
        expect(storedSets(h)).toEqual([]);
    });

    it('CONTROL: with no other holder, the same rollback restores the environment\'s set', async () => {
        const h = makeProtocol();
        const version = await savedThenDeleted(h);

        const res = await h.protocol.rollbackMetaItem({ type: 'permission', name: SET, toVersion: version });

        expect(res.success).toBe(true);
        expect(storedSets(h)).toEqual([{ row: SET, state: 'active', binding: null }]);
    });
});
