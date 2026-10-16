// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23182 row 1, step B] The shared helper of the lock family's acceptance pin
 * (`protocol.lock-one-resolution.test.ts`): the generated table, the oracle,
 * the engine and registry doubles, the door and the reads, `readScenario` and
 * `agree`, and the partition of the table's rows over the shard files that run
 * them (`protocol.lock-one-resolution.shard-N.test.ts`).
 *
 * ## Why the table runs as four shards
 *
 * The table is 16 320 rows, and its wall is the protocol's own cost: with the
 * reads taken once per distinct read request (`readScenario`) the single file
 * still read about 8.4 s alone and 27.5 s in a CI-shaped package run, over the
 * 10 s line of a test file (#22998). Its time is the CPU of 7 212 distinct
 * reads and 28 848 doors, with nothing waited on, so the cut that remains is
 * across files: each shard file runs a quarter of the rows in its own worker.
 *
 * ## How the rows are partitioned
 *
 * The rows that share a read request (they differ only in `requestScope` and
 * `operation`, which no read takes) are ONE group (`readGroupOf`: the row's
 * title with those two axes blanked). Groups are numbered in the table's own
 * order, and group n is run by shard (n mod 4) + 1. A group is never split, so
 * `readScenario`'s four-to-one memo holds inside every shard, and the table's
 * order puts the groups with the most runs (the store-order and
 * registration-order variants) on every shard in turn. The partition is a pure
 * function of the table: a row, a slice or an axis added to it lands in a shard
 * by this rule with nothing else to edit.
 *
 * ## Why this helper is a `.test.ts` file
 *
 * Three gates read engine doubles, and each one walks `*.test.ts` files only:
 * `check:engine-double-contract` (this double's `findOne` is pinned to the
 * real engine's predicate, its ledger row is `scripts/engine-double-contract
 * .pinned.json`), `check:where-matcher` (its WHERE matcher refuses a
 * combinator) and `check:objectql-double-limit` (its `find` applies the
 * caller's bound). A double in a `*.testkit.ts` file would leave all three
 * without saying so, and the first of them would call the leaving row a
 * defect. A `*.test.ts` file imported by other test files is this repository's
 * way of sharing a double (`impersonation-bearer-rotation.test` is imported by
 * fifteen sibling tests in plugin-auth). What an import must not do is run the helper's own
 * tests again in the importer: its tests are registered only when it is the
 * file vitest was started on (`expect.getState().testPath`), and a path that
 * is neither a shard file nor this one is refused loudly.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MetadataLockSchema,
    evaluateLockForDelete,
    evaluateLockForWrite,
    extractProtection,
} from '@objectstack/spec/kernel';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { ITEM_LOCK_LAYERS, type ItemAddressField, type ItemLockLayer } from './item-lock.js';

export const ENV_ID = 'env_1';
export const ORG = 'org_a';
export const PACKAGE_ID = 'com.example.pkg';
/** [#21803] Another installed package, shipping the same name. */
export const OTHER_PACKAGE = 'com.example.other';
export const NAME = 'v_lock';
export type Lock = (typeof MetadataLockSchema.options)[number];

export interface StoredRow {
    id: string;
    type: string;
    name: string;
    package_id: string | null;
    state: string;
    metadata: string;
}

// ── The axes ─────────────────────────────────────────────────────────────────

/** What a package's loader registered for the item: nothing, an artifact with no `_lock`, or one declaring each level. */
export type ArtifactAxis = { artifact: 'absent' } | { artifact: 'no _lock' } | { artifact: 'declared'; lock: Lock };
export const ARTIFACT_VALUES: readonly ArtifactAxis[] = [
    { artifact: 'absent' },
    { artifact: 'no _lock' },
    ...MetadataLockSchema.options.map((lock) => ({ artifact: 'declared' as const, lock })),
];

/**
 * The package-less stored row: none, or env-wide, declaring each level, under
 * either spelling. [ADR-0131 D6/D7] No stored row is organization-scoped: the
 * family declares no organization column.
 */
type StoredRowAxis =
    | { row: 'none' }
    | { row: 'stored'; scope: 'env-wide'; lock: Lock; spelling: 'canonical' | 'other (residue)' };
export const STORED_ROW_VALUES: readonly StoredRowAxis[] = [
    { row: 'none' },
    ...(['env-wide'] as const).flatMap((scope) => MetadataLockSchema.options.flatMap((lock) =>
        (['canonical', 'other (residue)'] as const).map((spelling) => ({ row: 'stored' as const, scope, lock, spelling })))),
];

/**
 * [#21761] The row bound to the package (ADR-0048): none, or an env-wide
 * canonical row declaring each level. [#21803] The same shape serves the other
 * package's env-wide row.
 */
type PackageRowAxis = { row: 'none' } | { row: 'stored'; lock: Lock };
export const PACKAGE_ROW_VALUES: readonly PackageRowAxis[] = [
    { row: 'none' },
    ...MetadataLockSchema.options.map((lock) => ({ row: 'stored' as const, lock })),
];

export const AXIS_VALUES = {
    artifact: ARTIFACT_VALUES,
    /** [#21803] What ANOTHER installed package registered under the same name. */
    otherArtifact: ARTIFACT_VALUES,
    storedRow: STORED_ROW_VALUES,
    packageRow: PACKAGE_ROW_VALUES,
    /** [#21803] Another package's env-wide canonical row of the item. */
    otherPackageRow: PACKAGE_ROW_VALUES,
    requestScope: [undefined, ORG] as const,
    requestPackage: [undefined, PACKAGE_ID, OTHER_PACKAGE] as const,
    topology: [{ kernel: 'environment', environmentId: ENV_ID }, { kernel: 'host-config', environmentId: undefined }] as const,
    requestSpelling: ['view', 'views'] as const,
    operation: ['save', 'delete'] as const,
};
export type AxisName = keyof typeof AXIS_VALUES;
type AxisValue<A extends AxisName> = (typeof AXIS_VALUES)[A][number];

/** The caller's own axes, which decide no layer: how the request spells the type, which verb. */
export const CALLER_AXES: readonly AxisName[] = ['requestSpelling', 'operation'];

/**
 * [#21803] The axes the family has been measured on. A layer × one of these
 * is a POSITION; every one has a row below.
 */
export const FAMILY_AXES = ['topology', 'organization', 'package'] as const;
type FamilyAxis = (typeof FAMILY_AXES)[number];

/**
 * [#21803] The family's positions: a layer of the one resolution × a family
 * axis, the table axes that open it (every one of them varies in some slice),
 * and the card that measured it. A layer added to `ITEM_LOCK_LAYERS`, or an
 * axis added to `FAMILY_AXES`, with no position here fails the completeness
 * check, naming the pair.
 */
export const POSITIONS: ReadonlyArray<{
    readonly layer: ItemLockLayer;
    readonly axis: FamilyAxis;
    readonly opensWith: readonly AxisName[];
    readonly card: string;
}> = [
    { layer: 'artifact', axis: 'topology', opensWith: ['artifact', 'topology'], card: '#21694' },
    { layer: 'artifact', axis: 'organization', opensWith: ['artifact', 'requestScope'], card: '#21738' },
    { layer: 'artifact', axis: 'package', opensWith: ['artifact', 'otherArtifact', 'requestPackage'], card: '#21803' },
    { layer: 'overlay', axis: 'topology', opensWith: ['storedRow', 'topology'], card: '#21694' },
    { layer: 'overlay', axis: 'organization', opensWith: ['storedRow', 'requestScope'], card: '#21716' },
    { layer: 'overlay', axis: 'package', opensWith: ['storedRow', 'packageRow', 'requestPackage'], card: '#21761' },
    {
        layer: 'overlay', axis: 'package',
        opensWith: ['packageRow', 'otherPackageRow', 'requestScope', 'requestPackage'],
        card: '#21803 (5988387087: the content scope and the lock scope part)',
    },
];

/**
 * [#21761] Per field of the item's address (`ITEM_ADDRESS_FIELDS`), the axis
 * that varies it, or `'one item'` for the name every row addresses. Keyed by
 * `ItemAddressField`, so a field added to the address without an entry here
 * fails the typecheck, and the completeness check below fails the run, naming
 * it.
 */
export const ADDRESS_AXES: { readonly [F in ItemAddressField]: AxisName | 'one item' } = {
    type: 'requestSpelling',
    name: 'one item',
    packageId: 'requestPackage',
};

interface Row {
    artifact: ArtifactAxis;
    otherArtifact: ArtifactAxis;
    storedRow: StoredRowAxis;
    packageRow: PackageRowAxis;
    otherPackageRow: PackageRowAxis;
    requestScope: AxisValue<'requestScope'>;
    requestPackage: AxisValue<'requestPackage'>;
    topology: AxisValue<'topology'>;
    requestSpelling: AxisValue<'requestSpelling'>;
    operation: AxisValue<'operation'>;
}

type SliceValues = { readonly [A in AxisName]: ReadonlyArray<AxisValue<A>> };

export const ABSENT: ArtifactAxis = ARTIFACT_VALUES[0]!;
export const NO_ROW: PackageRowAxis = PACKAGE_ROW_VALUES[0]!;
const present = (v: ArtifactAxis): boolean => v.artifact !== 'absent';
const storedOnly = (v: PackageRowAxis): boolean => v.row === 'stored';

/**
 * [#21803] The table's slices. Each is a full product of its axes' values; an
 * axis a slice does not open is held at the family product's value.
 */
export const SLICES: ReadonlyArray<{ readonly name: string; readonly values: SliceValues }> = [
    {
        name: 'the family product (PR #21801)',
        values: {
            ...AXIS_VALUES,
            otherArtifact: [ABSENT],
            otherPackageRow: [NO_ROW],
            requestPackage: [undefined, PACKAGE_ID],
        },
    },
    {
        name: '[#21803] the artifact layer × package: another installed package ships the name',
        values: {
            ...AXIS_VALUES,
            otherArtifact: ARTIFACT_VALUES.filter(present),
            // The overlay layer at its locks, env-wide and canonical: every
            // per-package answer the artifact layer can join with.
            storedRow: STORED_ROW_VALUES.filter((v) => v.row === 'none' || (v.scope === 'env-wide' && v.spelling === 'canonical')),
            packageRow: [NO_ROW],
            otherPackageRow: [NO_ROW],
        },
    },
    {
        name: '[#21803] the stored rows × package: another package\'s env-wide row beside the package\'s own',
        values: {
            ...AXIS_VALUES,
            artifact: [ABSENT],
            otherArtifact: [ABSENT],
            storedRow: [STORED_ROW_VALUES[0]!],
            otherPackageRow: PACKAGE_ROW_VALUES.filter(storedOnly),
            requestSpelling: ['view'],
        },
    },
];

function productOf(values: SliceValues): Row[] {
    return values.artifact.flatMap((artifact) => values.otherArtifact.flatMap((otherArtifact) =>
        values.storedRow.flatMap((storedRow) => values.packageRow.flatMap((packageRow) =>
            values.otherPackageRow.flatMap((otherPackageRow) => values.requestScope.flatMap((requestScope) =>
                values.requestPackage.flatMap((requestPackage) => values.topology.flatMap((topology) =>
                    values.requestSpelling.flatMap((requestSpelling) => values.operation.map((operation) => ({
                        artifact, otherArtifact, storedRow, packageRow, otherPackageRow,
                        requestScope, requestPackage, topology, requestSpelling, operation,
                    })))))))))));
}

export const TABLE: Row[] = SLICES.flatMap((slice) => productOf(slice.values));

function describeArtifact(a: ArtifactAxis): string {
    return a.artifact === 'declared' ? `artifact _lock=${a.lock}` : `artifact ${a.artifact}`;
}
function describeOtherArtifact(a: ArtifactAxis): string {
    if (a.artifact === 'absent') return '';
    return a.artifact === 'declared'
        ? `other package's artifact _lock=${a.lock}`
        : `other package's artifact ${a.artifact}`;
}
function describeRow(r: StoredRowAxis): string {
    return r.row === 'none' ? 'no stored row' : `${r.scope} row _lock=${r.lock} (${r.spelling} spelling)`;
}
function describePackageRow(r: PackageRowAxis): string {
    return r.row === 'none' ? '' : `env-wide package row _lock=${r.lock}`;
}
function describeOtherPackageRow(r: PackageRowAxis): string {
    return r.row === 'none' ? '' : `env-wide other package's row _lock=${r.lock}`;
}
export function titleOf(row: Row): string {
    return [
        `${row.topology.kernel} kernel`,
        describeArtifact(row.artifact),
        describeOtherArtifact(row.otherArtifact),
        describeRow(row.storedRow),
        describePackageRow(row.packageRow),
        describeOtherPackageRow(row.otherPackageRow),
        `request: ${row.requestScope ? `organization ${row.requestScope}` : 'no organization'}`
            + (row.requestPackage ? `, package ${row.requestPackage}` : ''),
        `/meta/${row.requestSpelling}`,
        row.operation,
    ].filter((part) => part !== '').join(' · ');
}

// ── The oracle: the declared rule, per layer, in the resolution's own order ──

/** The stored rows of the row's arrangement, as the oracle reads them. */
interface OracleRow { scope: 'env-wide'; spelling: 'canonical' | 'other (residue)'; lock: Lock }
function oracleRows(row: Row): OracleRow[] {
    const rows: OracleRow[] = [];
    if (row.storedRow.row === 'stored') {
        rows.push({ scope: row.storedRow.scope, spelling: row.storedRow.spelling, lock: row.storedRow.lock });
    }
    if (row.packageRow.row === 'stored') rows.push({ scope: 'env-wide', spelling: 'canonical', lock: row.packageRow.lock });
    if (row.otherPackageRow.row === 'stored') {
        rows.push({ scope: 'env-wide', spelling: 'canonical', lock: row.otherPackageRow.lock });
    }
    return rows;
}

/**
 * The strictest of `locks`, written from the rule: a write is refused when any
 * of them refuses it, a delete likewise, and the lock is the state with exactly
 * those two refusals.
 */
function strictestOf(locks: readonly Lock[]): Lock {
    const refusesWrite = locks.some((l) => evaluateLockForWrite(l) !== null);
    const refusesDelete = locks.some((l) => evaluateLockForDelete(l) !== null);
    return MetadataLockSchema.options.find((state) =>
        (evaluateLockForWrite(state) !== null) === refusesWrite
        && (evaluateLockForDelete(state) !== null) === refusesDelete)!;
}

const declaredLockOf = (a: ArtifactAxis): Lock => (a.artifact === 'declared' ? a.lock : 'none');

/**
 * What each layer declares for `side` — the reads, or the door.
 *
 *  - `artifact`: [#21803] one lock per installed package that ships the name
 *    (the package's own, another package's), `'none'` for an artifact that
 *    declares no lock; no entry for a package that ships nothing.
 *  - `overlay`: the strictest lock among the rows in scope (ADR-0131 D6: the
 *    environment's rows, whatever organization the request comes from; any
 *    package). The door differs on exactly one input: it does not see a row
 *    stored under the other spelling, which the reads see only when no
 *    canonical row is in that scope. The request's package selects nothing.
 */
const DECLARED: {
    readonly artifact: (row: Row) => Lock[];
    readonly overlay: (row: Row, side: 'reads' | 'door') => Lock;
} = {
    artifact: (row) => [row.artifact, row.otherArtifact].filter(present).map(declaredLockOf),
    overlay: (row, side) => {
        const scopes: Array<OracleRow['scope']> = ['env-wide'];
        for (const scope of scopes) {
            const inScope = oracleRows(row).filter((r) => r.scope === scope);
            let visible = inScope.filter((r) => r.spelling === 'canonical');
            if (visible.length === 0 && side === 'reads') visible = inScope;
            if (visible.length > 0) return strictestOf(visible.map((r) => r.lock));
        }
        return 'none';
    },
};

/**
 * The rule: per installed package that ships the name (or once, when none
 * does), the first layer in `ITEM_LOCK_LAYERS` order whose declared lock is not
 * `'none'` binds; [#21803] the item's lock is the strictest of those answers.
 */
export function expectedLock(row: Row, side: 'reads' | 'door'): Lock {
    const shipped = DECLARED.artifact(row);
    const perPackage = (shipped.length > 0 ? shipped : ['none' as Lock]).map((artifactLock) => {
        for (const layer of ITEM_LOCK_LAYERS) {
            const lock = layer === 'artifact' ? artifactLock : DECLARED.overlay(row, side);
            if (lock !== 'none') return lock;
        }
        return 'none' as Lock;
    });
    return strictestOf(perPackage);
}

// ── The harness ──────────────────────────────────────────────────────────────

export function storedRow(
    type: string, lock: Lock, label: string, name = NAME, packageId: string | null = null,
): StoredRow {
    return {
        id: `r_${type}_env_${packageId ?? 'pkgless'}`,
        type,
        name,
        package_id: packageId,
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
export function packagedView(a: ArtifactAxis, name = NAME, packageId = PACKAGE_ID): Record<string, unknown> | undefined {
    if (a.artifact === 'absent') return undefined;
    return {
        name,
        label: `packaged by ${packageId}`,
        object: 'account',
        _packageId: packageId,
        _provenance: 'package',
        ...(a.artifact === 'declared'
            ? { _lock: a.lock, _lockReason: `Packaged lock of ${packageId} (${a.lock}).`, _lockSource: 'package' }
            : {}),
    };
}

/**
 * [#21803] The registry double, after `SchemaRegistry`: each package's item
 * under its composite key `<packageId>:<name>`, in REGISTRATION order (the Map
 * iterates in it, as the registry's does).
 *
 *  - `getArtifactItem` (`SchemaRegistry.getArtifactItem`): the asked package's
 *    own entry (prefer-local, ADR-0048), else the FIRST package registered
 *    that ships the name;
 *  - `getItem`: the same order, without the code-artifact test;
 *  - `listItems`: every entry, a disabled package's hidden;
 *  - `getAllPackages` / `getPackage` / `isPackageDisabled`: the packages the
 *    test installs (none by default: the family's rows install no package).
 */
export function registryDouble(
    artifacts: ReadonlyArray<Record<string, unknown>>,
    installed: ReadonlyArray<{ id: string; enabled: boolean }> = [],
) {
    const entries = new Map<string, Record<string, unknown>>();
    for (const artifact of artifacts) entries.set(`${String(artifact._packageId)}:${String(artifact.name)}`, artifact);
    const disabled = (id: unknown) => installed.some((p) => p.id === id && !p.enabled);
    const ordered = (name: string, packageId?: string) => {
        const local = packageId ? entries.get(`${packageId}:${name}`) : undefined;
        const composites = [...entries].filter(([key]) => key.endsWith(`:${name}`)).map(([, item]) => item);
        return local ? [local, ...composites] : composites;
    };
    return {
        getArtifactItem(type: string, name: string, packageId?: string) {
            return type === 'view' ? ordered(name, packageId).find((item) => isCodeArtifactBody(item)) : undefined;
        },
        getItem(type: string, name: string, packageId?: string) {
            return type === 'view' ? ordered(name, packageId)[0] : undefined;
        },
        listItems(type: string) {
            return type === 'view' ? [...entries.values()].filter((item) => !disabled(item._packageId)) : [];
        },
        getAllPackages: () => installed.map((p) => ({ manifest: { id: p.id }, enabled: p.enabled })),
        getPackage: (id: string) => {
            const p = installed.find((candidate) => candidate.id === id);
            return p ? { manifest: { id: p.id }, enabled: p.enabled } : undefined;
        },
        isPackageDisabled: (id?: string) => disabled(id),
        getObject: () => undefined,
        registerObject: () => undefined,
        applyNavContributions: (app: unknown) => app,
    };
}

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, the registry
 * double above over the packages' artifacts (one artifact, a list of them in
 * registration order, or none), and an `insert` that keeps nothing (the gate
 * writes its denial row through it).
 */
export function harness(
    environmentId: string | undefined,
    rows: StoredRow[],
    artifacts?: Record<string, unknown> | ReadonlyArray<Record<string, unknown>>,
    installed?: ReadonlyArray<{ id: string; enabled: boolean }>,
) {
    const registered = artifacts === undefined ? [] : Array.isArray(artifacts) ? artifacts : [artifacts];
    const registry = registryDouble(registered as ReadonlyArray<Record<string, unknown>>, installed);
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

/**
 * [#21761] The row's stored rows, in each order the store can return them: one
 * order when there is at most one row, both when there are two.
 */
function rowOrdersFor(row: Row): StoredRow[][] {
    const rows: StoredRow[] = [];
    if (row.storedRow.row === 'stored') {
        rows.push(storedRow(
            row.storedRow.spelling === 'canonical' ? 'view' : 'views',
            row.storedRow.lock,
            `${row.storedRow.scope} row`,
        ));
    }
    if (row.packageRow.row === 'stored') {
        rows.push(storedRow('view', row.packageRow.lock, 'package row', NAME, PACKAGE_ID));
    }
    if (row.otherPackageRow.row === 'stored') {
        rows.push(storedRow('view', row.otherPackageRow.lock, 'env-wide row of the other package', NAME, OTHER_PACKAGE));
    }
    return rows.length < 2 ? [rows] : [rows, [...rows].reverse()];
}

/**
 * [#21803] The row's artifacts, in each order the packages can be registered
 * in: one order when at most one package ships the name, both when two do.
 */
function registrationOrdersFor(row: Row): Array<Array<Record<string, unknown>>> {
    const artifacts = [packagedView(row.artifact), packagedView(row.otherArtifact, NAME, OTHER_PACKAGE)]
        .filter((a): a is Record<string, unknown> => a !== undefined);
    return artifacts.length < 2 ? [artifacts] : [artifacts, [...artifacts].reverse()];
}

export const settle = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

type Verdict = { refused: { code: unknown; status: unknown } } | 'admitted';
export const ITEM_LOCKED: Verdict = { refused: { code: 'ITEM_LOCKED', status: 403 } };
/** [ADR-0131 D6] Every organization-scoped write is refused first, before the `_lock` gate is reached. */
const NOT_OVERRIDABLE: Verdict = { refused: { code: 'NOT_OVERRIDABLE', status: 403 } };

/**
 * The door, end to end. Refused ⇔ the ADR-0112 `ITEM_LOCKED` / 403 envelope
 * came back (or, for an organization-scoped request, `NOT_OVERRIDABLE` / 403). Admitted ⇔ the ADR-0010 `_lock` gate was reached and answered no
 * refusal; whatever the write does after that is not a lock verdict.
 */
export async function door(
    protocol: ObjectStackProtocolImplementation, type: string, operation: 'save' | 'delete', organizationId?: string,
    name = NAME, packageId?: string,
): Promise<Verdict> {
    const gate = vi.spyOn(protocol as any, operation === 'save' ? 'assertLockAllowsWrite' : 'assertLockAllowsDelete');
    try {
        const scope = organizationId ? { organizationId } : {};
        // [#21761] A save carries the request's package (`?package=`); a delete
        // has none to carry (`DeleteMetaItemRequest` declares no package).
        const outcome: any = await settle(operation === 'save'
            ? protocol.saveMetaItem({
                type, name, item: { name, label: name, object: 'account' }, ...scope, ...(packageId ? { packageId } : {}),
            })
            : protocol.deleteMetaItem({ type, name, ...scope }));
        if (outcome instanceof Error && ['ITEM_LOCKED', 'NOT_OVERRIDABLE'].includes((outcome as any).code)) {
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
export async function envelope(
    // [ADR-0131 D6] The caller's organization reaches no read: the reads take
    // none, so the request's organization changes nothing here.
    protocol: ObjectStackProtocolImplementation, type: string, _callerOrganization?: string, name = NAME, packageId?: string,
) {
    const scope = { ...(packageId ? { packageId } : {}) };
    const byName: any = await protocol.getMetaItem({ type, name, ...scope });
    const layered: any = await protocol.getMetaItemLayered({ type, name, ...scope });
    const pick = (r: any) => ({ lock: r.lock, editable: r.editable, deletable: r.deletable });
    expect(pick(layered), `${type}/${name}: getMetaItemLayered disagrees with getMetaItem`).toEqual(pick(byName));
    return { ...pick(byName), byName, layered };
}

/**
 * [#23182] One protocol instance per distinct READ REQUEST, its reads taken
 * once. `envelope` takes no organization and no verb, so the table's rows that
 * differ only in `requestScope` and `operation` (four of them, everywhere the
 * table varies both) ask the same two reads of the same data: those reads ran
 * four times each, 28 848 times in all against 7 212 distinct requests. The
 * key is the request's real inputs (the instance's environment, its stored
 * rows and artifacts in the order the store and the registry return them, the
 * type spelling and the package the request names), never a description of a
 * row, so two rows share an instance only when every input the reads take is
 * byte-equal.
 *
 * The instance each row's door then runs on is the one its reads ran on (the
 * header's "ONE protocol instance": a read must not poison the gate that
 * answers after it). Every row still asserts, for itself, that those reads
 * equal the declared rule's lock and that its own door answers the rule.
 */
interface ReadScenario {
    protocol: ObjectStackProtocolImplementation;
    read: Awaited<ReturnType<typeof envelope>>;
}
const readScenarios = new Map<string, Promise<ReadScenario>>();
function readScenario(
    environmentId: string | undefined, rows: StoredRow[], artifacts: Array<Record<string, unknown>>,
    type: string, packageId: string | undefined,
): Promise<ReadScenario> {
    const key = JSON.stringify([environmentId ?? null, rows, artifacts, type, packageId ?? null]);
    let scenario = readScenarios.get(key);
    if (scenario === undefined) {
        const protocol = harness(environmentId, rows, artifacts);
        scenario = envelope(protocol, type, undefined, NAME, packageId).then((read) => ({ protocol, read }));
        readScenarios.set(key, scenario);
    }
    return scenario;
}

/**
 * `expect(actual, message).toEqual(expected)` for the table's hot path.
 * `isDeepStrictEqual` implies `toEqual`'s equality, so when the two are strictly
 * equal the matcher would pass, and it is not built: a matcher costs about
 * 10 µs and the table makes well over a hundred thousand of them. When they
 * differ the real matcher runs, and fails with the message and the diff it
 * always gave. Nothing that failed before passes now.
 */
function agree(actual: unknown, expected: unknown, message: string): void {
    if (!isDeepStrictEqual(actual, expected)) expect(actual, message).toEqual(expected);
}

/** The envelope's flags for a lock, read off the lock algebra itself. */
const flagsOf = (lock: Lock) => ({
    lock,
    editable: evaluateLockForWrite(lock) === null,
    deletable: evaluateLockForDelete(lock) === null,
});

// ── [#23182] The table's rows, as shard files ────────────────────────────────

/** How many shard files run the table's rows. A shard file is `shardFileName(1)` … `shardFileName(ROW_SHARDS)`. */
export const ROW_SHARDS = 4;
export const shardFileName = (shard: number): string => `protocol.lock-one-resolution.shard-${shard}.test.ts`;
const SHARD_FILE = /\.shard-(\d+)\.test\.ts$/;
const KIT_FILE = 'protocol.lock-one-resolution.kit.test.ts';
const SRC_DIR = dirname(fileURLToPath(import.meta.url));

/** The title of the describe the table's rows run under, in the shard files and (for its named tests) in the main file. */
export const PIN_1_TITLE = '[#21738, #21803] pin 1 — the family\'s enumeration, generated from the resolution\'s inputs: getMetaItem = getMetaItemLayered = the door';

/** A row's read group: its title with the two axes no read takes blanked, so the rows that ask the same read share it. */
export const readGroupOf = (row: Row): string => titleOf({ ...row, requestScope: undefined, operation: 'save' });

/** Each row's shard, 1-based, parallel to `TABLE`: the row's read group, numbered in the table's order, modulo the shard count. */
export const SHARD_OF: readonly number[] = (() => {
    const ordinals = new Map<string, number>();
    return TABLE.map((row) => {
        const group = readGroupOf(row);
        let ordinal = ordinals.get(group);
        if (ordinal === undefined) {
            ordinal = ordinals.size;
            ordinals.set(group, ordinal);
        }
        return (ordinal % ROW_SHARDS) + 1;
    });
})();

export const rowsOfShard = (shard: number): Row[] => TABLE.filter((_, index) => SHARD_OF[index] === shard);

/**
 * Register the rows of the shard THIS file is, read off its own name. A shard
 * file is this call and nothing else; a file that is not named
 * `protocol.lock-one-resolution.shard-N.test.ts` for an N in 1…ROW_SHARDS
 * fails at collection, so a rename cannot leave rows unrun.
 */
export function registerRowShard(): void {
    const path = expect.getState().testPath ?? '';
    const shard = Number(SHARD_FILE.exec(basename(path))?.[1]);
    if (!Number.isInteger(shard) || shard < 1 || shard > ROW_SHARDS) {
        throw new Error(
            `registerRowShard() is called from a file named ${shardFileName(1)} … ${shardFileName(ROW_SHARDS)}; this one is ${path || '(unknown)'}.`,
        );
    }
    afterEach(() => vi.restoreAllMocks());
    describe(PIN_1_TITLE, () => {
        for (const row of rowsOfShard(shard)) {
            const title = titleOf(row);
            it(title, async () => {
                // The rule's answers are a function of the row alone, not of an order.
                const readsLock = expectedLock(row, 'reads');
                const readsFlags = flagsOf(readsLock);
                const doorLock = expectedLock(row, 'door');
                const doorAllows = row.operation === 'save'
                    ? evaluateLockForWrite(doorLock) === null
                    : evaluateLockForDelete(doorLock) === null;
                // [#21761] Under every order the store can return the rows in, and
                // [#21803] every order the packages can be registered in.
                for (const [order, rows] of rowOrdersFor(row).entries()) {
                    for (const [registration, artifacts] of registrationOrdersFor(row).entries()) {
                        const at = `${title} (row order ${order + 1}, registration order ${registration + 1})`;
                        const { protocol, read } = await readScenario(
                            row.topology.environmentId, rows, artifacts, row.requestSpelling, row.requestPackage,
                        );
                        // Both reads report the declared rule's lock.
                        agree({ lock: read.lock, editable: read.editable, deletable: read.deletable }, readsFlags, `${at}: the reads`);
                        // [#21803] …and a body they serve states it, no more. (A
                        // request can be served no body while a row in the lock's
                        // scope binds: content never serves another package's row.)
                        if (read.byName.item != null) {
                            agree(extractProtection(read.byName.item).lock, read.lock, `${at}: getMetaItem's body`);
                        }
                        if (read.layered.effective != null) {
                            agree(extractProtection(read.layered.effective).lock, read.lock, `${at}: the layered read's effective`);
                        }
                        // The door binds the rule's lock over the layers IT sees.
                        const verdict = await door(
                            protocol, row.requestSpelling, row.operation, row.requestScope, NAME, row.requestPackage,
                        );
                        // [ADR-0131 D6] An organization-scoped request never reaches
                        // the `_lock` gate: every org-scoped write is refused first.
                        agree(verdict, row.requestScope ? NOT_OVERRIDABLE : doorAllows ? 'admitted' : ITEM_LOCKED, `${at}: the door`);
                        // …and the two agree: the door admits exactly when the envelope
                        // says it may. Except on the one declared difference
                        // (`overlayLockLayerAt`'s `otherSpelling`): a row stored under
                        // the other spelling is in the reads' scope and not the door's,
                        // which the two oracle assertions above already state row by
                        // row — so those rows flip, by name, the day the reads'
                        // fallback retires.
                        const residue = readsLock !== doorLock;
                        if (!residue && !row.requestScope) {
                            const readAllows = row.operation === 'save' ? read.editable : read.deletable;
                            agree(verdict, readAllows ? 'admitted' : ITEM_LOCKED, `${at}: the door and the read envelope (lock ${read.lock}) disagree`);
                        }
                    }
                }
            });
        }
    });
}

// ── The shard set's own pin: registered only when this file is the one run ──

if (basename(expect.getState().testPath ?? '') === KIT_FILE) {
    describe('[#23182] the row shards: the shard set is the whole table', () => {
        it('every row of the table is in exactly one shard, and the rows that share a read request stay together', () => {
            const titles = TABLE.map(titleOf);
            const shards = Array.from({ length: ROW_SHARDS }, (_, n) => rowsOfShard(n + 1).map(titleOf));
            const ran = shards.flat();
            // Count and identity: the shards' rows are the table's, once each.
            expect(ran, 'rows run by some shard, counted with repeats').toHaveLength(titles.length);
            const seen = new Set(ran);
            expect(seen.size, 'rows run by more than one shard').toBe(titles.length);
            expect(titles.filter((title) => !seen.has(title)), 'rows no shard runs').toEqual([]);
            expect(shards.map((rows, n) => (rows.length > 0 ? '' : `shard ${n + 1} runs no row`)).filter(Boolean)).toEqual([]);
            // The memo's four-to-one survives the cut: a read group is whole and in one shard.
            const groups = new Map<string, { rows: number; shards: Set<number> }>();
            TABLE.forEach((row, index) => {
                const group = groups.get(readGroupOf(row)) ?? { rows: 0, shards: new Set<number>() };
                group.rows += 1;
                group.shards.add(SHARD_OF[index]!);
                groups.set(readGroupOf(row), group);
            });
            const perGroup = AXIS_VALUES.requestScope.length * AXIS_VALUES.operation.length;
            expect([...groups].filter(([, g]) => g.shards.size !== 1).map(([key]) => key), 'read groups split over shards').toEqual([]);
            expect([...groups].filter(([, g]) => g.rows !== perGroup).map(([key]) => key), `read groups other than ${perGroup} rows`).toEqual([]);
        });

        it('every shard file exists, registers its shard, and no other shard file does', () => {
            const expected = Array.from({ length: ROW_SHARDS }, (_, n) => shardFileName(n + 1)).sort();
            const onDisk = readdirSync(SRC_DIR).filter((name) => SHARD_FILE.test(name)).sort();
            expect(onDisk, 'the shard files in src').toEqual(expected);
            for (const name of expected) {
                expect(existsSync(join(SRC_DIR, name)), `${name} exists`).toBe(true);
                expect(readFileSync(join(SRC_DIR, name), 'utf8'), `${name} calls registerRowShard()`).toMatch(/^registerRowShard\(\);$/m);
            }
        });
    });
}
