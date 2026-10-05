// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21738, ADR-0010 §3.3 / §5, ADR-0005] The lock family's acceptance pin: ONE
 * item-lock resolution (`resolveItemLock`, `item-lock.ts`) answers the write
 * doors' `_lock` gate and both reads' envelopes, so for every input the
 * resolution reads, `getMetaItem` equals `getMetaItemLayered` equals the door.
 *
 * The family so far: #21670 (the package door's verdict), #21694 (the topology
 * axis), #21716 (the organization axis, PR #21737's 64-row enumeration pin).
 * This card closes it by STRUCTURE instead of by a longer hand-named list:
 *
 *  1. The generated pin. Its rows are the product of the axes that decide each
 *     layer of the resolution (`ITEM_LOCK_LAYERS`), plus the caller's own
 *     axes. A completeness check turns red, naming the layer, when the
 *     resolution reads a layer this table has no axis for — or takes an input
 *     other than its layers. Every row asserts, on ONE protocol instance, that
 *     the two reads agree, that both report the lock the declared rule gives
 *     (an oracle written from the rule, not from the code), and that the door
 *     admits a save / delete exactly when the envelope says `editable` /
 *     `deletable`. PR #21737's 64 rows are a subset of this table, checked by
 *     name (they moved here from `protocol.lock-org-axis-agree.test.ts`, whose
 *     pins 2–4 stay where they are).
 *  2. Position 1, named: an artifact declaring `_lock: 'none'` over a stored
 *     env-wide `'full'`. `'none'` declares no lock; the stored lock binds, on
 *     both reads, on the served body, on the diagnostics tile and at the door.
 *  3. Position 2, named: a packaged item with no `_lock` and a stored `'full'`
 *     reads locked on `getMetaItemLayered`, as on `getMetaItem`.
 *
 * ## The one declared difference: a row stored under the other spelling
 *
 * The reads still serve a row stored under the type's other (plural) spelling
 * when no canonical row is in scope (pre-#4432 at-rest residue); the `_lock`
 * gate addresses the canonical spelling only (#4432's write-side rule, answer A
 * on PR #21737; `findServedOverlayRow`'s `otherSpelling`). Those rows are IN
 * the table: the reads report the residue's lock, and the door binds what the
 * canonical layers give. Each such row asserts that difference, by name, and
 * flips the day the reads' fallback is retired.
 *
 * ## Not an axis here
 *
 * A request naming a package (`?package=`, ADR-0048 prefer-local) selects the
 * stored row by package on the reads while the gate asks package-agnostic.
 * That is the row SELECTION, not the resolution, and is recorded on the PR as
 * an acceptance note; this table names no package.
 *
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataLockSchema, evaluateLockForDelete, evaluateLockForWrite } from '@objectstack/spec/kernel';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { ITEM_LOCK_LAYERS, resolveItemLock, type ItemLockLayer } from './item-lock.js';

const ENV_ID = 'env_1';
const ORG = 'org_a';
const PACKAGE_ID = 'com.example.pkg';
const NAME = 'v_lock';
type Lock = (typeof MetadataLockSchema.options)[number];

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

// ── The axes ─────────────────────────────────────────────────────────────────

/** What the loader registered for the item: nothing, an artifact with no `_lock`, or one declaring each level. */
type ArtifactAxis = { artifact: 'absent' } | { artifact: 'no _lock' } | { artifact: 'declared'; lock: Lock };
const ARTIFACT_VALUES: readonly ArtifactAxis[] = [
    { artifact: 'absent' },
    { artifact: 'no _lock' },
    ...MetadataLockSchema.options.map((lock) => ({ artifact: 'declared' as const, lock })),
];

/** The one stored row in the table: none, or env-wide / org-scoped, declaring each level, under either spelling. */
type StoredRowAxis =
    | { row: 'none' }
    | { row: 'stored'; scope: 'env-wide' | 'org-scoped'; lock: Lock; spelling: 'canonical' | 'other (residue)' };
const STORED_ROW_VALUES: readonly StoredRowAxis[] = [
    { row: 'none' },
    ...(['env-wide', 'org-scoped'] as const).flatMap((scope) => MetadataLockSchema.options.flatMap((lock) =>
        (['canonical', 'other (residue)'] as const).map((spelling) => ({ row: 'stored' as const, scope, lock, spelling })))),
];

const AXIS_VALUES = {
    artifact: ARTIFACT_VALUES,
    storedRow: STORED_ROW_VALUES,
    requestScope: [undefined, ORG] as const,
    topology: [{ kernel: 'environment', environmentId: ENV_ID }, { kernel: 'host-config', environmentId: undefined }] as const,
    requestSpelling: ['view', 'views'] as const,
    operation: ['save', 'delete'] as const,
};
type AxisName = keyof typeof AXIS_VALUES;

/**
 * Per layer of the one resolution, the axes that decide the document the layer
 * contributes. Keyed by `ItemLockLayer`, so a layer added to the resolution
 * without an entry here fails the typecheck, and the completeness check below
 * fails the run, naming it.
 */
const LAYER_AXES: { readonly [L in ItemLockLayer]: readonly AxisName[] } = {
    artifact: ['artifact'],
    overlay: ['storedRow', 'requestScope'],
};
/** The caller's own axes: which kernel, how the request spells the type, which verb. */
const CALLER_AXES: readonly AxisName[] = ['topology', 'requestSpelling', 'operation'];

interface Row {
    artifact: ArtifactAxis;
    storedRow: StoredRowAxis;
    requestScope: string | undefined;
    topology: (typeof AXIS_VALUES.topology)[number];
    requestSpelling: (typeof AXIS_VALUES.requestSpelling)[number];
    operation: (typeof AXIS_VALUES.operation)[number];
}

const TABLE: Row[] = AXIS_VALUES.artifact.flatMap((artifact) => AXIS_VALUES.storedRow.flatMap((storedRow) =>
    AXIS_VALUES.requestScope.flatMap((requestScope) => AXIS_VALUES.topology.flatMap((topology) =>
        AXIS_VALUES.requestSpelling.flatMap((requestSpelling) => AXIS_VALUES.operation.map((operation) => ({
            artifact, storedRow, requestScope, topology, requestSpelling, operation,
        })))))));

function describeArtifact(a: ArtifactAxis): string {
    return a.artifact === 'declared' ? `artifact _lock=${a.lock}` : `artifact ${a.artifact}`;
}
function describeRow(r: StoredRowAxis): string {
    return r.row === 'none' ? 'no stored row' : `${r.scope} row _lock=${r.lock} (${r.spelling} spelling)`;
}
function titleOf(row: Row): string {
    return [
        `${row.topology.kernel} kernel`,
        describeArtifact(row.artifact),
        describeRow(row.storedRow),
        `request: ${row.requestScope ? `organization ${row.requestScope}` : 'no organization'}`,
        `/meta/${row.requestSpelling}`,
        row.operation,
    ].join(' · ');
}

// ── The oracle: the declared rule, per layer, in the resolution's own order ──

/** Is the stored row served for this request scope? (ADR-0005: org row to its organization, env-wide row to every request.) */
function rowServed(row: Row): boolean {
    if (row.storedRow.row === 'none') return false;
    return row.storedRow.scope === 'env-wide' || row.requestScope === ORG;
}

/**
 * The lock each layer declares for `side` — the reads, or the door. The door
 * differs on exactly one input: it does not see a row stored under the other
 * spelling.
 */
const DECLARED: { readonly [L in ItemLockLayer]: (row: Row, side: 'reads' | 'door') => Lock } = {
    artifact: (row) => (row.artifact.artifact === 'declared' ? row.artifact.lock : 'none'),
    overlay: (row, side) => {
        if (!rowServed(row) || row.storedRow.row === 'none') return 'none';
        if (side === 'door' && row.storedRow.spelling !== 'canonical') return 'none';
        return row.storedRow.lock;
    },
};

/** The rule: the first layer, in `ITEM_LOCK_LAYERS` order, whose declared lock is not `'none'` binds. */
function expectedLock(row: Row, side: 'reads' | 'door'): Lock {
    for (const layer of ITEM_LOCK_LAYERS) {
        const lock = DECLARED[layer](row, side);
        if (lock !== 'none') return lock;
    }
    return 'none';
}

// ── The harness ──────────────────────────────────────────────────────────────

function storedRow(type: string, organizationId: string | null, lock: Lock, label: string, name = NAME): StoredRow {
    return {
        id: `r_${type}_${organizationId ?? 'env'}`,
        type,
        name,
        organization_id: organizationId,
        package_id: null,
        state: 'active',
        metadata: JSON.stringify({
            name,
            label,
            object: 'account',
            _provenance: 'org',
            ...(lock === 'none' ? {} : { _lock: lock, _lockReason: `Stored lock (${lock}).` }),
        }),
    };
}

/** What a code package's loader registers: package-stamped, with the envelope `applyProtection` writes. */
function packagedView(a: ArtifactAxis, name = NAME): Record<string, unknown> | undefined {
    if (a.artifact === 'absent') return undefined;
    return {
        name,
        label: 'packaged',
        object: 'account',
        _packageId: PACKAGE_ID,
        _provenance: 'package',
        ...(a.artifact === 'declared'
            ? { _lock: a.lock, _lockReason: `Packaged lock (${a.lock}).`, _lockSource: 'package' }
            : {}),
    };
}

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, a registry
 * whose artifact lookup answers what the loader registered, and an `insert`
 * that keeps nothing (the gate writes its denial row through it).
 */
function harness(environmentId: string | undefined, rows: StoredRow[], artifact?: Record<string, unknown>) {
    const items: Record<string, Record<string, unknown>> = artifact ? { [String(artifact.name)]: artifact } : {};
    const registry = {
        getArtifactItem(type: string, name: string) {
            const hit = type === 'view' ? items[name] : undefined;
            return hit && isCodeArtifactBody(hit) ? hit : undefined;
        },
        getItem(type: string, name: string) {
            return type === 'view' ? items[name] : undefined;
        },
        listItems(type: string) {
            return type === 'view' ? Object.values(items) : [];
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

function harnessFor(row: Row) {
    const rows = row.storedRow.row === 'none'
        ? []
        : [storedRow(
            row.storedRow.spelling === 'canonical' ? 'view' : 'views',
            row.storedRow.scope === 'env-wide' ? null : ORG,
            row.storedRow.lock,
            `${row.storedRow.scope} row`,
        )];
    return harness(row.topology.environmentId, rows, packagedView(row.artifact));
}

const settle = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

type Verdict = { refused: { code: unknown; status: unknown } } | 'admitted';
const ITEM_LOCKED: Verdict = { refused: { code: 'ITEM_LOCKED', status: 403 } };

/**
 * The door, end to end. Refused ⇔ the ADR-0112 `ITEM_LOCKED` / 403 envelope
 * came back. Admitted ⇔ the ADR-0010 `_lock` gate was reached and answered no
 * refusal; whatever the write does after that is not a lock verdict.
 */
async function door(
    protocol: ObjectStackProtocolImplementation, type: string, operation: 'save' | 'delete', organizationId?: string,
    name = NAME,
): Promise<Verdict> {
    const gate = vi.spyOn(protocol as any, operation === 'save' ? 'assertLockAllowsWrite' : 'assertLockAllowsDelete');
    try {
        const scope = organizationId ? { organizationId } : {};
        const outcome: any = await settle(operation === 'save'
            ? protocol.saveMetaItem({ type, name, item: { name, label: name, object: 'account' }, ...scope })
            : protocol.deleteMetaItem({ type, name, ...scope }));
        if (outcome instanceof Error && (outcome as any).code === 'ITEM_LOCKED') {
            return { refused: { code: (outcome as any).code, status: (outcome as any).status } };
        }
        expect(gate, `${type}/${name} ${operation}: not refused, yet the _lock gate was never reached`).toHaveBeenCalledTimes(1);
        expect(await gate.mock.results[0]?.value).toBeNull();
        return 'admitted';
    } finally {
        gate.mockRestore();
    }
}

/** Both reads' envelopes for one request; they must agree with each other first. */
async function envelope(protocol: ObjectStackProtocolImplementation, type: string, organizationId?: string, name = NAME) {
    const scope = organizationId ? { organizationId } : {};
    const byName: any = await protocol.getMetaItem({ type, name, ...scope });
    const layered: any = await protocol.getMetaItemLayered({ type, name, ...scope });
    const pick = (r: any) => ({ lock: r.lock, editable: r.editable, deletable: r.deletable });
    expect(pick(layered), `${type}/${name}: getMetaItemLayered disagrees with getMetaItem`).toEqual(pick(byName));
    return { ...pick(byName), byName, layered };
}

/** The envelope's flags for a lock, read off the lock algebra itself. */
const flagsOf = (lock: Lock) => ({
    lock,
    editable: evaluateLockForWrite(lock) === null,
    deletable: evaluateLockForDelete(lock) === null,
});

afterEach(() => vi.restoreAllMocks());

// ── 1. The generated pin ─────────────────────────────────────────────────────

describe('[#21738] pin 1 — generated from the resolution\'s inputs: getMetaItem = getMetaItemLayered = the door', () => {
    it('completeness: every layer the resolution reads has an axis here, and the resolution takes nothing else', () => {
        const missing = ITEM_LOCK_LAYERS.filter((layer) => !Object.prototype.hasOwnProperty.call(LAYER_AXES, layer));
        expect(missing, 'resolution layers with no axis in this table').toEqual([]);
        const stale = Object.keys(LAYER_AXES).filter((layer) => !(ITEM_LOCK_LAYERS as readonly string[]).includes(layer));
        expect(stale, 'axes for a layer the resolution no longer reads').toEqual([]);
        expect(resolveItemLock.length, 'resolveItemLock takes exactly its layers record').toBe(1);
        // Every axis is used, exactly once, and the table is their full product.
        const used = [...Object.values(LAYER_AXES).flat(), ...CALLER_AXES];
        expect([...used].sort()).toEqual((Object.keys(AXIS_VALUES) as AxisName[]).sort());
        expect(new Set(used).size).toBe(used.length);
        const product = (Object.keys(AXIS_VALUES) as AxisName[])
            .reduce((n, axis) => n * AXIS_VALUES[axis].length, 1);
        expect(TABLE).toHaveLength(product);
        expect(new Set(TABLE.map(titleOf)).size, 'row titles are unique').toBe(TABLE.length);
        // Every lock level is an axis value on both layers (read off the schema itself).
        expect(MetadataLockSchema.options).toEqual(['none', 'no-overlay', 'no-delete', 'full']);
    });

    it('PR #21737\'s 64-row enumeration (topology × row scope × request scope × lock × operation) is a subset of this table', () => {
        const titles = new Set(TABLE.map(titleOf));
        const folded: string[] = [];
        for (const topology of AXIS_VALUES.topology) for (const scope of ['env-wide', 'org-scoped'] as const)
            for (const requestScope of AXIS_VALUES.requestScope) for (const lock of MetadataLockSchema.options)
                for (const operation of AXIS_VALUES.operation) {
                    folded.push(titleOf({
                        artifact: { artifact: 'absent' },
                        storedRow: { row: 'stored', scope, lock, spelling: 'canonical' },
                        requestScope, topology, requestSpelling: 'view', operation,
                    }));
                }
        expect(folded).toHaveLength(64);
        expect(folded.filter((t) => !titles.has(t))).toEqual([]);
    });

    for (const row of TABLE) {
        const title = titleOf(row);
        it(title, async () => {
            const protocol = harnessFor(row);
            const read = await envelope(protocol, row.requestSpelling, row.requestScope);
            // Both reads report the declared rule's lock.
            expect({ lock: read.lock, editable: read.editable, deletable: read.deletable }, `${title}: the reads`)
                .toEqual(flagsOf(expectedLock(row, 'reads')));
            // The door binds the rule's lock over the layers IT sees.
            const verdict = await door(protocol, row.requestSpelling, row.operation, row.requestScope);
            const doorAllows = row.operation === 'save'
                ? evaluateLockForWrite(expectedLock(row, 'door')) === null
                : evaluateLockForDelete(expectedLock(row, 'door')) === null;
            expect(verdict, `${title}: the door`).toEqual(doorAllows ? 'admitted' : ITEM_LOCKED);
            // …and the two agree: the door admits exactly when the envelope says
            // it may. Except on the one declared difference
            // (`findServedOverlayRow`'s `otherSpelling`): a row stored under the
            // other spelling is served by the reads and not seen by the door,
            // which the two oracle assertions above already state row by row —
            // so those rows flip, by name, the day the reads' fallback retires.
            const residue = row.storedRow.row === 'stored' && row.storedRow.spelling !== 'canonical';
            if (!residue) {
                const readAllows = row.operation === 'save' ? read.editable : read.deletable;
                expect(verdict, `${title}: the door and the read envelope (lock ${read.lock}) disagree`)
                    .toEqual(readAllows ? 'admitted' : ITEM_LOCKED);
            }
        });
    }

    it('lit control: the table holds refusals and admissions on both verbs, both layers bind somewhere, and the residue difference is reachable', () => {
        const locks = TABLE.map((row) => ({ row, reads: expectedLock(row, 'reads'), door: expectedLock(row, 'door') }));
        expect(locks.some((l) => l.row.operation === 'save' && evaluateLockForWrite(l.door) !== null)).toBe(true);
        expect(locks.some((l) => l.row.operation === 'save' && evaluateLockForWrite(l.door) === null)).toBe(true);
        expect(locks.some((l) => l.row.operation === 'delete' && evaluateLockForDelete(l.door) !== null)).toBe(true);
        expect(locks.some((l) => l.row.operation === 'delete' && evaluateLockForDelete(l.door) === null)).toBe(true);
        // An artifact's explicit `'none'` under a binding stored lock (position 1)
        // and an artifact with no `_lock` under one (position 2) are both rows.
        expect(locks.some((l) => l.row.artifact.artifact === 'declared' && l.row.artifact.lock === 'none' && l.reads === 'full')).toBe(true);
        expect(locks.some((l) => l.row.artifact.artifact === 'no _lock' && l.reads === 'full')).toBe(true);
        expect(locks.filter((l) => l.reads !== l.door).length).toBeGreaterThan(0);
    });

    it('lit control: an org-scoped request is served the env-wide row and reads its lock; an org-scoped row is never served to a request naming none', async () => {
        const protocol = harness(undefined, [storedRow('view', null, 'full', 'env-wide row')]);
        const read = await envelope(protocol, 'view', ORG);
        expect({ lock: read.lock, served: read.byName.item?.label, overlayScope: read.layered.overlayScope })
            .toEqual({ lock: 'full', served: 'env-wide row', overlayScope: 'env' });
        const other = harness(undefined, [storedRow('view', ORG, 'full', 'org row')]);
        const unscoped = await envelope(other, 'view');
        expect({ lock: unscoped.lock, overlayScope: unscoped.layered.overlayScope }).toEqual({ lock: 'none', overlayScope: null });
        expect(await door(other, 'view', 'save')).toBe('admitted');
        expect(await door(other, 'view', 'delete')).toBe('admitted');
    });
});

// ── 2. Position 1, named ─────────────────────────────────────────────────────

describe('[#21738] pin 2 — position 1: an artifact\'s explicit _lock: \'none\' does not override a stored env-wide \'full\'', () => {
    const artifact = packagedView({ artifact: 'declared', lock: 'none' }, 'v_pos1')!;
    const rows = () => [storedRow('view', null, 'full', 'env-wide row', 'v_pos1')];

    for (const { kernel, environmentId } of AXIS_VALUES.topology) {
        it(`${kernel} kernel: both reads say locked, the served body and the tile say so too, and save / delete are refused ITEM_LOCKED (403)`, async () => {
            const protocol = harness(environmentId, rows(), artifact);
            const read = await envelope(protocol, 'view', undefined, 'v_pos1');
            expect({ lock: read.lock, editable: read.editable, deletable: read.deletable })
                .toEqual({ lock: 'full', editable: false, deletable: false });
            // The prose is the binding layer's — the stored row's, never the artifact's 'none'.
            expect(read.byName.lockReason).toBe('Stored lock (full).');
            expect(read.layered.lockReason).toBe('Stored lock (full).');
            // Provenance is still the artifact's (mergeArtifactProtection's other fields, unchanged).
            expect({ provenance: read.byName.provenance, packageId: read.byName.packageId })
                .toEqual({ provenance: 'package', packageId: PACKAGE_ID });
            expect({ provenance: read.layered.provenance, packageId: read.layered.packageId })
                .toEqual({ provenance: 'package', packageId: PACKAGE_ID });
            // The served body carries the binding lock, not the artifact's 'none'.
            expect(read.byName.item?._lock).toBe('full');
            const listed: any = await protocol.getMetaItems({ type: 'view' });
            expect(listed.items.find((i: any) => i.name === 'v_pos1')?._lock).toBe('full');
            const diag: any = await protocol.getMetaDiagnostics({ type: 'view', severity: 'warning' } as any);
            expect(diag.stats.view.locked).toBe(1);

            for (const operation of ['save', 'delete'] as const) {
                const err: any = await settle(operation === 'save'
                    ? protocol.saveMetaItem({ type: 'view', name: 'v_pos1', item: { name: 'v_pos1', label: 'x', object: 'account' } })
                    : protocol.deleteMetaItem({ type: 'view', name: 'v_pos1' }));
                expect(err, operation).toBeInstanceOf(Error);
                expect({ code: err.code, status: err.status, lock: err.lock }, operation)
                    .toEqual({ code: 'ITEM_LOCKED', status: 403, lock: 'full' });
            }
        });
    }
});

// ── 3. Position 2, named ─────────────────────────────────────────────────────

describe('[#21738] pin 3 — position 2: getMetaItemLayered reads a stored lock under a packaged item with no _lock', () => {
    const artifact = packagedView({ artifact: 'no _lock' }, 'v_pos2')!;
    const rows = () => [storedRow('view', null, 'full', 'env-wide row', 'v_pos2')];

    for (const { kernel, environmentId } of AXIS_VALUES.topology) {
        it(`${kernel} kernel: the layered read says locked, as getMetaItem does, and the door refuses`, async () => {
            const protocol = harness(environmentId, rows(), artifact);
            const layered: any = await protocol.getMetaItemLayered({ type: 'view', name: 'v_pos2' });
            expect({ lock: layered.lock, editable: layered.editable, deletable: layered.deletable })
                .toEqual({ lock: 'full', editable: false, deletable: false });
            // The code layer is still reported as the package shipped it.
            expect(layered.code).toMatchObject({ name: 'v_pos2', _packageId: PACKAGE_ID });
            expect(layered.code._lock).toBeUndefined();
            const byName: any = await protocol.getMetaItem({ type: 'view', name: 'v_pos2' });
            expect({ lock: byName.lock, editable: byName.editable, deletable: byName.deletable })
                .toEqual({ lock: layered.lock, editable: layered.editable, deletable: layered.deletable });
            expect(await door(protocol, 'view', 'save', undefined, 'v_pos2')).toEqual(ITEM_LOCKED);
            expect(await door(protocol, 'view', 'delete', undefined, 'v_pos2')).toEqual(ITEM_LOCKED);
        });
    }
});
