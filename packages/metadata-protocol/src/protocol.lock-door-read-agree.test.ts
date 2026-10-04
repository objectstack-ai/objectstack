// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21694, ADR-0010 §3.3 / §5] One fact — "is this item locked?" — reported
 * three ways, and the three must agree on every topology:
 *
 *  - the WRITE DOORS (`saveMetaItem` / `deleteMetaItem` / `publishMetaItem`),
 *    whose ADR-0010 `_lock` gate used to return no refusal on a kernel with no
 *    `environmentId` — the host-config shape the CLI assembles for a stack
 *    with instantiated plugins, which is the showcase's own boot;
 *  - the item READ's protection envelope (`lock` / `editable` / `deletable`),
 *    which reported the declared `_lock` on every kernel;
 *  - the per-type `locked` count of `getMetaDiagnostics`, which counted the
 *    declared `_lock` only, so a packaged base the doors refuse in place (and
 *    whose envelope reads locked since #21670) was missing from the tile.
 *
 * Pins, each against the real door and the real read:
 *
 *  1. on a host-config kernel, an overlay item with a declared `_lock` reads
 *     and saves consistently — refused where the read says not editable,
 *     admitted past the gate where it says editable — and deletes
 *     consistently too, including a packaged item the package door lets
 *     through to the `_lock` gate (an `app`, the platform's own locked shape);
 *  2. the per-type locked count equals the number of items whose envelope
 *     reads locked, including an item locked only by the package door;
 *  3. an environment-bound kernel is unchanged: the same refusal codes, the
 *     same envelope.
 *
 * The `_lock` gate ranks BELOW the package door on both kernels, so a
 * packaged base keeps its `NOT_OVERRIDABLE` on a host-config kernel too — the
 * gate must not pre-empt it there only (pinned with pin 3's twin).
 *
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const PACKAGE_ID = 'com.example.pkg';
const ENV_ID = 'env_1';
const LOCKS = ['none', 'no-overlay', 'no-delete', 'full'] as const;
type Lock = typeof LOCKS[number];

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

type Artifacts = Record<string, Record<string, Record<string, unknown>>>;

/** A tenant-authored `sys_metadata` row — what an author's save of a body declaring `_lock` leaves at rest. */
const overlayRow = (type: string, name: string, lock: Lock): StoredRow => ({
    id: `r_${type}_${name}`,
    type,
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({
        name,
        label: name,
        object: 'account',
        _provenance: 'org',
        ...(lock === 'none' ? {} : { _lock: lock }),
    }),
});

/** What a code package's loader registered: package-stamped, with an optional `_lock`. */
const packaged = (name: string, lock: Lock, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    name,
    label: name,
    _packageId: PACKAGE_ID,
    _provenance: 'package',
    ...(lock === 'none' ? {} : { _lock: lock }),
    ...extra,
});

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, a registry
 * whose artifact lookup answers what the loader registered, and an `insert`
 * that keeps nothing (the `_lock` gate records its denial through it). No
 * write verbs beyond that — an admitted write is read off the gate itself.
 */
function harness(environmentId: string | undefined, rows: StoredRow[] = [], artifacts: Artifacts = {}) {
    const registry = {
        getArtifactItem(type: string, name: string) {
            const hit = artifacts[type]?.[name];
            return hit && isCodeArtifactBody(hit) ? hit : undefined;
        },
        getItem(type: string, name: string) {
            return artifacts[type]?.[name];
        },
        listItems(type: string) {
            return Object.values(artifacts[type] ?? {});
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        async insert() {
            return {};
        },
        registry,
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
}

const settle = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

type Verdict = { refused: { code: unknown; status: unknown } } | 'admitted';

/**
 * The door, end to end. Refused ⇔ a 403 lock-family envelope came back.
 * Admitted ⇔ the ADR-0010 `_lock` gate was reached and answered no refusal;
 * whatever the write does after that (validation, a double that persists
 * nothing) is not a lock verdict and is not read as one.
 */
async function door(
    protocol: ObjectStackProtocolImplementation, type: string, name: string, operation: 'save' | 'delete',
    item: Record<string, unknown> = { name, label: name, object: 'account' },
): Promise<Verdict> {
    const gate = vi.spyOn(protocol as any, operation === 'save' ? 'assertLockAllowsWrite' : 'assertLockAllowsDelete');
    try {
        const outcome: any = await settle(operation === 'save'
            ? protocol.saveMetaItem({ type, name, item })
            : protocol.deleteMetaItem({ type, name }));
        if (outcome instanceof Error && (outcome as any).status === 403
            && ((outcome as any).code === 'ITEM_LOCKED' || (outcome as any).code === 'NOT_OVERRIDABLE')) {
            return { refused: { code: (outcome as any).code, status: (outcome as any).status } };
        }
        expect(gate, `${type}/${name} ${operation}: not refused, yet the _lock gate was never reached`).toHaveBeenCalledTimes(1);
        expect(await gate.mock.results[0]?.value).toBeNull();
        return 'admitted';
    } finally {
        gate.mockRestore();
    }
}

async function envelope(protocol: ObjectStackProtocolImplementation, type: string, name: string) {
    const pick = (r: any) => ({ lock: r.lock, editable: r.editable, deletable: r.deletable });
    return {
        byName: pick(await protocol.getMetaItem({ type, name })),
        layered: pick(await protocol.getMetaItemLayered({ type, name })),
    };
}

const ITEM_LOCKED = { refused: { code: 'ITEM_LOCKED', status: 403 } };
const NOT_OVERRIDABLE = { refused: { code: 'NOT_OVERRIDABLE', status: 403 } };

afterEach(() => vi.restoreAllMocks());

describe('[#21694] pin 1 — a host-config kernel: the _lock door and the read agree', () => {
    for (const lock of LOCKS) {
        it(`an overlay view declaring _lock=${lock}: save and delete do what editable / deletable say`, async () => {
            const name = `ov_${lock.replace('-', '_')}`;
            const rows = [overlayRow('view', name, lock)];
            const { byName, layered } = await envelope(harness(undefined, rows), 'view', name);
            expect(layered).toEqual(byName);
            expect(byName.lock).toBe(lock);

            const save = await door(harness(undefined, rows), 'view', name, 'save');
            const del = await door(harness(undefined, rows), 'view', name, 'delete');
            expect(save).toEqual(byName.editable ? 'admitted' : ITEM_LOCKED);
            expect(del).toEqual(byName.deletable ? 'admitted' : ITEM_LOCKED);
        });
    }

    it('a publish of a _lock=full overlay item is refused there too (the shared write gate)', async () => {
        const rows = [overlayRow('view', 'ov_pub', 'full')];
        const err: any = await settle(harness(undefined, rows).publishMetaItem({ type: 'view', name: 'ov_pub' }));
        expect(err).toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status }).toEqual({ code: 'ITEM_LOCKED', status: 403 });
    });

    it('a packaged app declaring _lock=full: the package door lets its removal through (#6960), and the _lock gate refuses it', async () => {
        const artifacts: Artifacts = { app: { pkg_app: packaged('pkg_app', 'full') } };
        const { byName } = await envelope(harness(undefined, [], artifacts), 'app', 'pkg_app');
        expect(byName).toEqual({ lock: 'full', editable: false, deletable: false });
        expect(await door(harness(undefined, [], artifacts), 'app', 'pkg_app', 'delete')).toEqual(ITEM_LOCKED);
        const harnessed = harness(undefined, [], artifacts);
        // …and its save keeps the package door's code: the `_lock` gate ranks
        // below it. (A valid app body, so the write reaches the repository,
        // where this kernel answers that door.)
        const gate = vi.spyOn(harnessed, 'assertLockAllowsWrite' as never);
        expect(await door(harnessed, 'app', 'pkg_app', 'save', { name: 'pkg_app', label: 'pkg_app' })).toEqual(NOT_OVERRIDABLE);
        expect(gate).not.toHaveBeenCalled();
    });
});

describe('[#21694] pin 2 — the per-type locked count is the count of envelopes that read locked', () => {
    // Three types, each mixing the limbs: a package-door lock with no `_lock`
    // (flow, action), a declared `_lock` on a packaged item (app) and on an
    // overlay row (view), and items that read unlocked.
    const artifacts: Artifacts = {
        flow: { pkg_flow: packaged('pkg_flow', 'none') },
        action: { pkg_action: packaged('pkg_action', 'none') },
        app: { pkg_app_locked: packaged('pkg_app_locked', 'full'), pkg_app_open: packaged('pkg_app_open', 'none') },
        view: { pkg_view: packaged('pkg_view', 'none', { object: 'account' }) },
    };
    const rows = [
        overlayRow('view', 'ov_full', 'full'),
        overlayRow('view', 'ov_no_delete', 'no-delete'),
        overlayRow('view', 'ov_open', 'none'),
        overlayRow('flow', 'org_flow', 'none'),
    ];

    for (const environmentId of [undefined, ENV_ID]) {
        const kernel = environmentId ? 'environment' : 'host-config';
        it(`stats[type].locked equals the envelopes' count, type by type (${kernel} kernel)`, async () => {
            const protocol = harness(environmentId, rows, artifacts);
            const measured: Record<string, { tile: number; envelopes: number; declared: number; names: string[] }> = {};
            for (const type of ['flow', 'action', 'app', 'view']) {
                const diag = await protocol.getMetaDiagnostics({ type, severity: 'warning' });
                const listed = await protocol.getMetaItems({ type });
                const names = (listed.items as Array<{ name: string }>).map((i) => i.name).sort();
                const declared = (listed.items as Array<{ _lock?: unknown }>)
                    .filter((i) => i._lock !== undefined && i._lock !== 'none').length;
                let envelopes = 0;
                for (const name of names) {
                    if ((await protocol.getMetaItem({ type, name }) as any).lock !== 'none') envelopes += 1;
                }
                measured[type] = { tile: diag.stats[type]!.locked, envelopes, declared, names };
            }
            for (const [type, m] of Object.entries(measured)) {
                expect(m.tile, `${type}: tile ${m.tile} vs envelopes ${m.envelopes} over ${m.names.join(',')}`).toBe(m.envelopes);
            }
            // Lit control: the fixture reached every limb, so equality above is not 0 = 0.
            // flow / action: one packaged item each, locked by the package door alone.
            // app: one declared `_lock: full`, and one packaged app with none, which
            // the package door refuses in place (save) but lets go (removal, #6960).
            // view: overlay rows declaring `full` and `no-delete`; the packaged view
            // and the unlocked row read open (`view` has an overlay channel).
            expect(Object.fromEntries(Object.entries(measured).map(([t, m]) => [t, m.tile])))
                .toEqual({ flow: 1, action: 1, app: 2, view: 2 });
            // …and the package-door-only items are exactly the ones a count of the
            // declared `_lock` missed — the disagreement this pin closes.
            expect(Object.fromEntries(Object.entries(measured).map(([t, m]) => [t, m.declared])))
                .toEqual({ flow: 0, action: 0, app: 1, view: 2 });
            expect(measured.flow!.names).toEqual(['org_flow', 'pkg_flow']);
        });
    }
});

describe('[#21694] pin 3 — an environment-bound kernel is unchanged', () => {
    it('an overlay view declaring _lock=full reads locked and is refused ITEM_LOCKED on save and delete', async () => {
        const rows = [overlayRow('view', 'ov_full', 'full')];
        const { byName, layered } = await envelope(harness(ENV_ID, rows), 'view', 'ov_full');
        expect(byName).toEqual({ lock: 'full', editable: false, deletable: false });
        expect(layered).toEqual(byName);
        expect(await door(harness(ENV_ID, rows), 'view', 'ov_full', 'save')).toEqual(ITEM_LOCKED);
        expect(await door(harness(ENV_ID, rows), 'view', 'ov_full', 'delete')).toEqual(ITEM_LOCKED);
    });

    it('an overlay view declaring _lock=no-delete: save passes the gate, delete is refused', async () => {
        const rows = [overlayRow('view', 'ov_nd', 'no-delete')];
        const { byName } = await envelope(harness(ENV_ID, rows), 'view', 'ov_nd');
        expect(byName).toEqual({ lock: 'no-delete', editable: true, deletable: false });
        expect(await door(harness(ENV_ID, rows), 'view', 'ov_nd', 'save')).toBe('admitted');
        expect(await door(harness(ENV_ID, rows), 'view', 'ov_nd', 'delete')).toEqual(ITEM_LOCKED);
    });

    it('a packaged app declaring _lock=full keeps NOT_OVERRIDABLE on save and ITEM_LOCKED on delete — the same codes the host-config kernel now gives', async () => {
        const artifacts: Artifacts = { app: { pkg_app: packaged('pkg_app', 'full') } };
        expect(await door(harness(ENV_ID, [], artifacts), 'app', 'pkg_app', 'save', { name: 'pkg_app', label: 'pkg_app' })).toEqual(NOT_OVERRIDABLE);
        expect(await door(harness(ENV_ID, [], artifacts), 'app', 'pkg_app', 'delete')).toEqual(ITEM_LOCKED);
    });
});
