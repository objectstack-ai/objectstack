// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A permission set's name is its identity across the whole deployment: a grant
 * (`sys_user_permission_set.permission_set`) resolves its set by that name
 * alone (ADR-0131 D4) and the security catalog answers one definition per name,
 * so the metadata door must let exactly one owner hold a name. This file pins
 * the hardening at both doors a second set of a name can reach `active` through
 * — the save door (`saveMetaItem`, draft and publish mode) and the draft→active
 * promotion shared by the per-item publish and the package publish
 * (`publishPackageDrafts`) — with `RESOURCE_CONFLICT` / 409 and nothing written
 * (`permissionSetNameCollisionRefusal`). A package never writes into a record
 * another owns (ADR-0086 D4); `permission` takes no environment overlay
 * (ADR-0005), so the predicate is symmetric on the OWNER (`package_id` /
 * `_packageId`, or `null` for an environment author), and the same-owner edit
 * path is untouched.
 *
 * Each refusal is paired with a CONTROL through the same door, so a door that
 * refused everything could not pass. The draft the publish door refuses is
 * staged the way it sits in a deployment: authored while no other owner held
 * the name, then another owner publishes it — the race the publish door exists
 * to catch, since the save door now refuses the draft once the active holder
 * exists.
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
        },
    };
    return { engine, rows, historyRows, registered, serveCommit: (c: unknown) => { commit = c; } };
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
    expect(error.code).toBe('RESOURCE_CONFLICT');
    expect(error.status).toBe(409);
}

async function attempt<T>(run: () => Promise<T>): Promise<{ result: T | null; error: any }> {
    try {
        return { result: await run(), error: null };
    } catch (error) {
        return { result: null, error };
    }
}

afterEach(() => vi.restoreAllMocks());

const SET = 'project_editor';

// ═══════════════════════════════════════════════════════════════════════════
// 1. The save door — a draft/publish save of a name another owner's active set holds
// ═══════════════════════════════════════════════════════════════════════════

describe('the save door refuses a permission set whose name another owner already holds', () => {
    it.each(['draft', 'publish'] as const)('%s mode: owner B holds the active set; owner A cannot save a second of that name — refused 409, nothing of A\'s stored', async (mode) => {
        const h = makeProtocol();
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A, mode,
        }));

        expectConflict(error);
        expect(error.message).toContain(`'${SET}'`);
        expect(error.message).toContain(`package '${OWNER_B}'`);
        // Only B's active row remains — nothing of A's landed, draft or active.
        expect(storedSets(h)).toEqual([{ row: SET, state: 'active', binding: OWNER_B }]);
        expect(keys(h)).toEqual([SET]);
    });

    it('an environment author (no package) cannot create a runtime set whose name a package ships — permission takes no environment overlay (ADR-0005)', async () => {
        // The holder is code-shipped (registry only, no stored row), so a
        // package-less save does not inherit a binding to edit — it is a fresh
        // environment-authored set, and its name belongs to a package.
        const h = makeProtocol();
        h.engine.registry.registerItem('permission', { name: SET, label: 'Shipped', objects: {}, _packageId: OWNER_B });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET),
        }));

        expectConflict(error);
        expect(error.message).toContain('this environment cannot');
        expect(error.message).toContain(`package '${OWNER_B}'`);
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

    it('a name only a DIFFERENT owner ships in code (registry, no stored row) is refused too', async () => {
        const h = makeProtocol();
        // A code-declared set of owner B, materialized in the registry with its
        // provenance stamp — no stored row.
        h.engine.registry.registerItem('permission', { name: SET, label: 'Shipped', objects: {}, _packageId: OWNER_B });

        const { error } = await attempt(() => h.protocol.saveMetaItem({
            type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A,
        }));

        expectConflict(error);
        expect(error.message).toContain(`package '${OWNER_B}'`);
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
// 2. The draft→active promotion (per-item publish and publishPackageDrafts)
// ═══════════════════════════════════════════════════════════════════════════

describe('the draft promotion refuses a permission-set draft whose name another owner published since', () => {
    /** A's draft of the name, authored while nobody held it; then B publishes the name to active. */
    async function aDraftThenBPublishes(h: Harness) {
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_A, mode: 'draft' });
        await h.protocol.saveMetaItem({ type: 'permission', name: SET, item: perm(SET), packageId: OWNER_B });
        h.saveDoor.mockClear();
    }

    it('publishMetaItem: A\'s draft cannot be promoted now that B holds the active name — refused 409, the draft kept, nothing of A\'s live', async () => {
        const h = makeProtocol();
        await aDraftThenBPublishes(h);

        const { error } = await attempt(() => h.protocol.publishMetaItem({ type: 'permission', name: SET, packageId: OWNER_A }));

        expectConflict(error);
        expect(error.message).toContain(`package '${OWNER_B}'`);
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
        expect(refused).toMatchObject({ type: 'permission', code: 'RESOURCE_CONFLICT' });
        expect(refused.error).toContain(`package '${OWNER_B}'`);
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
