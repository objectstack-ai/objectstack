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
 * ## [#21761] The address is an input column: the package axis
 *
 * The `overlay` layer is selected from the item's ADDRESS
 * (`ITEM_ADDRESS_FIELDS`: type, name, organization, package) by one function,
 * `resolveOverlayLockLayer`, which the reads and the door both call: the
 * strictest lock among the item's stored rows in scope, whichever package each
 * is bound to. So the table's overlay axes are the rows that exist (a
 * package-less row, and a row bound to the request's package) and the address
 * (organization present or absent, `packageId` present or absent), and every
 * address field has an axis, checked by name. Every row runs under both
 * orders the store can return the two stored rows in, so no answer depends on
 * which row `findOne` returns first.
 *
 *  4. Arrangement 1, named: a package-less `'none'` row and the package's
 *     `'full'` row. Both orders: the reads and the door agree on `'full'`.
 *  5. Arrangement 2, named: the package's `'none'` row and a package-less
 *     `'full'` row. Both orders: the reads and the door agree on `'full'`,
 *     never `'none'` (an explicit `'none'` is not a grant over a stored lock).
 *  6. The #5706 outage: when the rows in scope cannot be read, the door still
 *     refuses with 503, with or without a package in the address.
 *  7. A third package's row of the same name is in scope too: before #21761
 *     the gate asked with no package and could bind it, so leaving it out
 *     would admit writes the gate refused under some row order.
 *
 * ## [#21803] The family's enumeration pin: every position, by layer and axis
 *
 * This card is the family's sixth position: the `artifact` layer on the
 * package axis. Two installed code packages may ship one `(type, name)`
 * (ADR-0048 §3.4); the gate bound the first package registered while the reads
 * bound the request's package. Now the `artifact` layer is every installed
 * package that ships the name (`resolveArtifactLockLayer`), and the lock is the
 * strictest of the per-package answers (`resolveItemLock`).
 *
 * The table is now the family's enumeration: one oracle and one completeness
 * check over named POSITIONS, each a layer of the resolution × one of the
 * family's axes (topology, organization, package). A position names the table
 * axes that open it and the card that measured it. The check fails by name when
 * a layer of `ITEM_LOCK_LAYERS` or a family axis has no position, when a
 * position is opened by no slice of the table, or when an axis of the table
 * belongs to no position. The rows are the union of SLICES, each slice a full
 * product of its axes' values, so a position's axes vary together while the
 * rest are held at the family product's values:
 *
 *  - the family product (PR #21801's 16 320 rows, checked by title: no row of
 *    it is lost);
 *  - the artifact layer × package: another installed package ships the name,
 *    each lock level, crossed with the package's own artifact, the env-wide
 *    stored row's lock, every address and topology, each run under BOTH
 *    registration orders;
 *  - the stored rows × package (5988387087 on #21803): another package's
 *    env-wide row stands beside the package's own, so the content a request
 *    naming the package is served (its own row) and the lock's scope (every
 *    env-wide row) part. The served body states the envelope's lock.
 *    [ADR-0131 D6/D7] A stored row carries no organization: the family
 *    declares no organization column, so the organization-scoped stored rows
 *    this table once held are no state the store can be in.
 *
 * Every row also asserts that the served body (`getMetaItem`'s `item`, the
 * layered read's `effective`) states the lock the envelope reports.
 *
 *  8. The card's measured case, named: package B ships `_lock: 'full'`,
 *     package A ships no lock. Under both registration orders, a read naming
 *     A, B or no package reports the lock the door enforces.
 *  9. Never a widening, named: A ships no lock, B ships `'no-delete'`, the
 *     stored row declares `'no-overlay'`. The door refused the save when A was
 *     registered first and the delete when B was; both are refused under both
 *     orders now, and the reads say so.
 * 10. A DISABLED package is still installed: its packaged lock binds.
 *
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 * The real `SchemaRegistry`'s enumeration is pinned beside it
 * (`packages/objectql/src/protocol-lock-artifact-package-axis.test.ts`).
 *
 * ## [#23182] What the table costs, and what it shares
 *
 * The table is 16 320 rows, 28 848 runs of (reads, then a door) once each row's
 * two store orders and two registration orders are counted, so the file's wall
 * is the protocol's own cost times that count. The two reads take no
 * organization and no verb, so the rows that differ only in those two (four of
 * them) share one instance and one pair of reads (`readScenario`); each row
 * still asserts, for itself, that the reads report the rule's lock and that
 * its own door answers the rule. Nothing the table enumerates is dropped: the
 * same 16 360 tests run, in the same order, under the same titles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MetadataLockSchema,
    evaluateLockForDelete,
    evaluateLockForWrite,
} from '@objectstack/spec/kernel';
import type { ObjectStackProtocolImplementation } from './protocol.js';
import {
    ITEM_ADDRESS_FIELDS,
    ITEM_LOCK_LAYERS,
    resolveArtifactLockLayer,
    resolveItemLock,
    resolveOverlayLockLayer,
} from './item-lock.js';
import {
    ABSENT,
    ADDRESS_AXES,
    ARTIFACT_VALUES,
    AXIS_VALUES,
    CALLER_AXES,
    ENV_ID,
    FAMILY_AXES,
    ITEM_LOCKED,
    NAME,
    NO_ROW,
    ORG,
    OTHER_PACKAGE,
    PACKAGE_ID,
    PACKAGE_ROW_VALUES,
    PIN_1_TITLE,
    POSITIONS,
    SLICES,
    STORED_ROW_VALUES,
    TABLE,
    door,
    envelope,
    expectedLock,
    harness,
    packagedView,
    registryDouble,
    settle,
    storedRow,
    titleOf,
    type ArtifactAxis,
    type AxisName,
    type Lock,
    type StoredRow,
} from './protocol.lock-one-resolution.kit.test.js';

afterEach(() => vi.restoreAllMocks());

// ── 1. The generated pin ─────────────────────────────────────────────────────

describe(PIN_1_TITLE, () => {
    it('completeness: every layer × family axis is a position, every position is opened by a slice, every axis belongs to a position, and the resolution takes nothing else', () => {
        // Every layer the resolution reads, on every axis the family has, is a
        // position here, by name.
        const unpositioned = ITEM_LOCK_LAYERS.flatMap((layer) => FAMILY_AXES
            .filter((axis) => !POSITIONS.some((p) => p.layer === layer && p.axis === axis))
            .map((axis) => `${layer} × ${axis}`));
        expect(unpositioned, 'layer × family axis with no position in this table').toEqual([]);
        const stale = POSITIONS.filter((p) => !(ITEM_LOCK_LAYERS as readonly string[]).includes(p.layer))
            .map((p) => `${p.layer} × ${p.axis}`);
        expect(stale, 'positions for a layer the resolution no longer reads').toEqual([]);
        // Every position is OPENED by a slice: all its axes vary together there.
        const unopened = POSITIONS.filter((p) => !SLICES.some((slice) =>
            p.opensWith.every((axis) => slice.values[axis].length > 1)))
            .map((p) => `${p.layer} × ${p.axis} (${p.card}): ${p.opensWith.join(', ')}`);
        expect(unopened, 'positions no slice of the table varies').toEqual([]);
        // Every axis of the table belongs to a position or is the caller's own.
        const used = new Set<AxisName>([...POSITIONS.flatMap((p) => p.opensWith), ...CALLER_AXES]);
        const orphaned = (Object.keys(AXIS_VALUES) as AxisName[]).filter((axis) => !used.has(axis));
        expect(orphaned, 'axes that open no position').toEqual([]);
        // The resolution takes its layers record, and each layer's selection
        // takes the address and a reader (and the overlay's spelling option).
        expect(resolveItemLock.length, 'resolveItemLock takes exactly its layers record').toBe(1);
        expect(resolveOverlayLockLayer.length, 'resolveOverlayLockLayer takes (address, rowsIn, options)').toBe(3);
        expect(resolveArtifactLockLayer.length, 'resolveArtifactLockLayer takes (address, artifactsOf)').toBe(2);
        // The table is the union of its slices, each its full product.
        const sizes = SLICES.map((slice) => (Object.keys(AXIS_VALUES) as AxisName[])
            .reduce((n, axis) => n * slice.values[axis].length, 1));
        expect(TABLE).toHaveLength(sizes.reduce((a, b) => a + b, 0));
        expect(new Set(TABLE.map(titleOf)).size, 'row titles are unique').toBe(TABLE.length);
        // Every lock level is an axis value on both layers (read off the schema itself).
        expect(MetadataLockSchema.options).toEqual(['none', 'no-overlay', 'no-delete', 'full']);
        expect(PACKAGE_ROW_VALUES.filter((v) => v.row === 'stored').map((v) => (v as { lock: Lock }).lock))
            .toEqual(MetadataLockSchema.options);
        // [#21761] Every field of the item's ADDRESS has an axis, by name, and
        // each such axis is an axis of a position (or the caller's spelling).
        const unaddressed = ITEM_ADDRESS_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(ADDRESS_AXES, field));
        expect(unaddressed, 'address fields with no axis in this table').toEqual([]);
        const staleAddress = Object.keys(ADDRESS_AXES).filter((field) => !(ITEM_ADDRESS_FIELDS as readonly string[]).includes(field));
        expect(staleAddress, 'axes for an address field the selection no longer takes').toEqual([]);
        for (const field of ITEM_ADDRESS_FIELDS) {
            const axis = ADDRESS_AXES[field];
            if (axis === 'one item') continue;
            expect([...used], `address field ${field}'s axis ${axis}`).toContain(axis);
        }
        expect(AXIS_VALUES.requestPackage, 'packageId absent, the package\'s own, another package').toEqual([undefined, PACKAGE_ID, OTHER_PACKAGE]);
    });

    it('PR #21801\'s generated product (8 640 rows since ADR-0131 D7) is a subset of this table, by its own titles: no row is lost', () => {
        const titles = new Set(TABLE.map(titleOf));
        // PR #21801's axes and title, frozen here as they were: the product
        // regenerated from them must be found in this table under the very
        // titles it ran under. [ADR-0131 D6/D7] Its 16 320 rows lose the
        // 7 680 whose stored row was organization-scoped: no stored row can be.
        const before: string[] = [];
        for (const artifact of ARTIFACT_VALUES) for (const storedRowValue of STORED_ROW_VALUES)
            for (const packageRow of PACKAGE_ROW_VALUES) for (const requestScope of [undefined, ORG])
                for (const requestPackage of [undefined, PACKAGE_ID]) for (const topology of AXIS_VALUES.topology)
                    for (const requestSpelling of ['view', 'views']) for (const operation of ['save', 'delete']) {
                        before.push([
                            `${topology.kernel} kernel`,
                            artifact.artifact === 'declared' ? `artifact _lock=${artifact.lock}` : `artifact ${artifact.artifact}`,
                            storedRowValue.row === 'none'
                                ? 'no stored row'
                                : `${storedRowValue.scope} row _lock=${storedRowValue.lock} (${storedRowValue.spelling} spelling)`,
                            packageRow.row === 'none' ? '' : `env-wide package row _lock=${packageRow.lock}`,
                            `request: ${requestScope ? `organization ${requestScope}` : 'no organization'}`
                                + (requestPackage ? `, package ${requestPackage}` : ''),
                            `/meta/${requestSpelling}`,
                            operation,
                        ].filter((part) => part !== '').join(' · '));
                    }
        expect(before).toHaveLength(8640);
        expect(new Set(before).size).toBe(8640);
        expect(before.filter((t) => !titles.has(t))).toEqual([]);
    });

    it('PR #21737\'s enumeration (topology × row scope × request scope × lock × operation; 32 rows since ADR-0131 D7) is a subset of this table', () => {
        const titles = new Set(TABLE.map(titleOf));
        const folded: string[] = [];
        for (const topology of AXIS_VALUES.topology) for (const scope of ['env-wide'] as const)
            for (const requestScope of AXIS_VALUES.requestScope) for (const lock of MetadataLockSchema.options)
                for (const operation of AXIS_VALUES.operation) {
                    folded.push(titleOf({
                        artifact: ABSENT,
                        otherArtifact: ABSENT,
                        storedRow: { row: 'stored', scope, lock, spelling: 'canonical' },
                        packageRow: NO_ROW,
                        otherPackageRow: NO_ROW,
                        requestScope,
                        requestPackage: undefined,
                        topology, requestSpelling: 'view', operation,
                    }));
                }
        expect(folded).toHaveLength(32);
        expect(folded.filter((t) => !titles.has(t))).toEqual([]);
    });

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
        // The residue difference is the ONLY one: a row whose reads and door
        // differ always holds a row stored under the other spelling.
        expect(locks.filter((l) => l.reads !== l.door
            && !(l.row.storedRow.row === 'stored' && l.row.storedRow.spelling !== 'canonical'))).toEqual([]);
        // [#21761] The package axis reaches both directions: the package row
        // binds over a looser package-less row (arrangement 1's shape), and a
        // package-less row binds over the package row's explicit 'none'
        // (arrangement 2's), with the package named and not.
        for (const requestPackage of [undefined, PACKAGE_ID]) {
            expect(locks.some((l) => l.row.requestPackage === requestPackage && l.row.artifact.artifact === 'absent'
                && l.row.storedRow.row === 'stored' && l.row.storedRow.lock === 'none'
                && l.row.packageRow.row === 'stored' && l.row.packageRow.lock === 'full' && l.door === 'full')).toBe(true);
            expect(locks.some((l) => l.row.requestPackage === requestPackage && l.row.artifact.artifact === 'absent'
                && l.row.storedRow.row === 'stored' && l.row.storedRow.lock === 'full'
                && l.row.packageRow.row === 'stored' && l.row.packageRow.lock === 'none' && l.door === 'full')).toBe(true);
        }
        // Two rows refusing different verbs join to 'full'.
        expect(locks.some((l) => l.row.storedRow.row === 'stored' && l.row.storedRow.lock === 'no-overlay'
            && l.row.packageRow.row === 'stored' && l.row.packageRow.lock === 'no-delete'
            && l.row.artifact.artifact === 'absent' && l.door === 'full')).toBe(true);
        // [#21803] The artifact layer's package axis reaches every direction,
        // with each request shape: the other package's lock binds over the
        // package's own unlocked artifact; the package's own lock binds over the
        // other's; and a per-package answer from the OVERLAY (an unlocked
        // artifact) joins one from the other package's ARTIFACT into a lock
        // neither package gives alone.
        for (const requestPackage of AXIS_VALUES.requestPackage) {
            const at = (l: (typeof locks)[number]) => l.row.requestPackage === requestPackage && l.row.storedRow.row === 'none';
            expect(locks.some((l) => at(l) && l.row.artifact.artifact === 'no _lock'
                && l.row.otherArtifact.artifact === 'declared' && l.row.otherArtifact.lock === 'full' && l.door === 'full')).toBe(true);
            expect(locks.some((l) => at(l) && l.row.artifact.artifact === 'declared' && l.row.artifact.lock === 'full'
                && l.row.otherArtifact.artifact === 'no _lock' && l.door === 'full')).toBe(true);
        }
        expect(locks.some((l) => l.row.artifact.artifact === 'no _lock'
            && l.row.otherArtifact.artifact === 'declared' && l.row.otherArtifact.lock === 'no-delete'
            && l.row.storedRow.row === 'stored' && l.row.storedRow.lock === 'no-overlay' && l.door === 'full')).toBe(true);
        // [#21803, ADR-0131 D6] The folded position is closed: another
        // package's env-wide row is in the lock's scope, never the content's,
        // so the package's own row's 'full' binds the request naming the
        // package, whatever organization the request names.
        expect(locks.some((l) => l.row.otherPackageRow.row === 'stored' && l.row.otherPackageRow.lock === 'none'
            && l.row.packageRow.row === 'stored' && l.row.packageRow.lock === 'full'
            && l.row.requestScope === ORG && l.row.requestPackage === PACKAGE_ID && l.reads === 'full')).toBe(true);
    });

    it('lit control: an org-scoped request is served the env-wide row and reads its lock', async () => {
        const protocol = harness(undefined, [storedRow('view', 'full', 'env-wide row')]);
        const read = await envelope(protocol, 'view', ORG);
        expect({ lock: read.lock, served: read.byName.item?.label, overlayScope: read.layered.overlayScope })
            .toEqual({ lock: 'full', served: 'env-wide row', overlayScope: 'env' });
    });

    it('lit control: the registry double answers the first package registered when asked with no package, and the asked package\'s own when asked with one', () => {
        const a = packagedView({ artifact: 'no _lock' })!;
        const b = packagedView({ artifact: 'declared', lock: 'full' }, NAME, OTHER_PACKAGE)!;
        for (const order of [[a, b], [b, a]]) {
            const registry = registryDouble(order);
            expect(registry.getArtifactItem('view', NAME)).toBe(order[0]);
            expect(registry.getArtifactItem('view', NAME, PACKAGE_ID)).toBe(a);
            expect(registry.getArtifactItem('view', NAME, OTHER_PACKAGE)).toBe(b);
        }
        const disabled = registryDouble([a, b], [{ id: OTHER_PACKAGE, enabled: false }]);
        expect(disabled.listItems('view')).toEqual([a]);
        expect(disabled.getArtifactItem('view', NAME, OTHER_PACKAGE)).toBe(b);
    });
});
// ── 2. Position 1, named ─────────────────────────────────────────────────────

describe('[#21738] pin 2 — position 1: an artifact\'s explicit _lock: \'none\' does not override a stored env-wide \'full\'', () => {
    const artifact = packagedView({ artifact: 'declared', lock: 'none' }, 'v_pos1')!;
    const rows = () => [storedRow('view', 'full', 'env-wide row', 'v_pos1')];

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
    const rows = () => [storedRow('view', 'full', 'env-wide row', 'v_pos2')];

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

// ── 4–7. [#21761] The package axis, named ───────────────────────────────────

/** The two stored rows of an arrangement, package-less first, in both orders. */
function bothOrders(pkgless: Lock, ofPackage: Lock, name: string): Array<{ order: string; rows: StoredRow[] }> {
    const rows = [
        storedRow('view', pkgless, 'package-less row', name),
        storedRow('view', ofPackage, 'package row', name, PACKAGE_ID),
    ];
    return [
        { order: 'package-less row returned first', rows },
        { order: 'package row returned first', rows: [...rows].reverse() },
    ];
}

/** The reads and the door for `request`, on one protocol instance. */
async function readsAndDoor(protocol: ObjectStackProtocolImplementation, name: string, packageId: string | undefined) {
    const read = await envelope(protocol, 'view', undefined, name, packageId);
    return {
        reads: { lock: read.lock, editable: read.editable, deletable: read.deletable },
        servedLabel: read.byName.item?.label,
        bodyLock: read.byName.item?._lock,
        effectiveLock: read.layered.effective?._lock,
        save: await door(protocol, 'view', 'save', undefined, name, packageId),
        delete: await door(protocol, 'view', 'delete', undefined, name, packageId),
    };
}

describe('[#21761] pin 4 — arrangement 1: a package-less \'none\' row and the package\'s \'full\' row', () => {
    for (const { order, rows } of bothOrders('none', 'full', 'v_arr1')) {
        for (const packageId of [PACKAGE_ID, undefined]) {
            it(`${order} · request ${packageId ? `naming package ${packageId}` : 'naming no package'}: the reads and the door agree on 'full'`, async () => {
                const protocol = harness(ENV_ID, rows);
                const got = await readsAndDoor(protocol, 'v_arr1', packageId);
                expect(got.reads).toEqual({ lock: 'full', editable: false, deletable: false });
                expect(got.save).toEqual(ITEM_LOCKED);
                expect(got.delete).toEqual(ITEM_LOCKED);
                // The served body states the lock the envelope reports, and
                // the layered read's `effective` (what getMetaItem returns) too.
                expect(got.bodyLock).toBe('full');
                expect(got.effectiveLock).toBe('full');
                // Content stays prefer-local (ADR-0048): a request naming the
                // package is served the package's own row.
                if (packageId) expect(got.servedLabel).toBe('package row');
            });
        }
    }
});

describe('[#21761] pin 5 — arrangement 2: the package\'s \'none\' row and a package-less \'full\' row', () => {
    for (const { order, rows } of bothOrders('full', 'none', 'v_arr2')) {
        for (const packageId of [PACKAGE_ID, undefined]) {
            it(`${order} · request ${packageId ? `naming package ${packageId}` : 'naming no package'}: the reads and the door agree on 'full', never 'none'`, async () => {
                const protocol = harness(ENV_ID, rows);
                const got = await readsAndDoor(protocol, 'v_arr2', packageId);
                // The package row's explicit 'none' is not a grant over the
                // package-less row's lock: the strictest in scope binds.
                expect(got.reads.lock).not.toBe('none');
                expect(got.reads).toEqual({ lock: 'full', editable: false, deletable: false });
                expect(got.save).toEqual(ITEM_LOCKED);
                expect(got.delete).toEqual(ITEM_LOCKED);
                expect(got.bodyLock).toBe('full');
                expect(got.effectiveLock).toBe('full');
                // The served CONTENT is still the package's own row, and its
                // envelope reports the binding row's prose.
                if (packageId) expect(got.servedLabel).toBe('package row');
                const read: any = await protocol.getMetaItem({ type: 'view', name: 'v_arr2', ...(packageId ? { packageId } : {}) });
                expect(read.lockReason).toBe('Stored lock (full).');
            });
        }
    }

    it('the refusal names the binding lock and is audited, with the package named', async () => {
        const protocol = harness(ENV_ID, bothOrders('full', 'none', 'v_arr2')[1]!.rows);
        const err: any = await settle(protocol.saveMetaItem({
            type: 'view', name: 'v_arr2', item: { name: 'v_arr2', label: 'x', object: 'account' }, packageId: PACKAGE_ID,
        }));
        expect(err).toBeInstanceOf(Error);
        expect({ code: err.code, status: err.status, lock: err.lock }).toEqual({ code: 'ITEM_LOCKED', status: 403, lock: 'full' });
        expect(err.lockReason).toBe('Stored lock (full).');
    });
});

describe('[#21761] pin 6 — the #5706 outage: a failing row read in scope still refuses', () => {
    /** The rows of arrangement 2, behind a store whose `sys_metadata` reads all fail. */
    function failingHarness() {
        const protocol = harness(ENV_ID, bothOrders('full', 'none', 'v_out')[0]!.rows);
        const engine = (protocol as any).engine;
        const outage = () => Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
        engine.find = async (table: string) => {
            if (table === 'sys_metadata') throw outage();
            return [];
        };
        engine.findOne = async (table: string) => {
            if (table === 'sys_metadata') throw outage();
            return null;
        };
        return protocol;
    }

    for (const packageId of [PACKAGE_ID, undefined]) {
        it(`save ${packageId ? 'naming the package' : 'naming no package'} and delete answer 503, never an admission from 'none'`, async () => {
            const protocol = failingHarness();
            const gateLock = vi.spyOn(protocol as any, 'getEffectiveLock');
            for (const operation of ['save', 'delete'] as const) {
                const err: any = await settle(operation === 'save'
                    ? protocol.saveMetaItem({
                        type: 'view', name: 'v_out', item: { name: 'v_out', label: 'x', object: 'account' },
                        ...(packageId ? { packageId } : {}),
                    })
                    : protocol.deleteMetaItem({ type: 'view', name: 'v_out' }));
                expect(err, operation).toBeInstanceOf(Error);
                expect({ code: err.code, status: err.status }, operation).toEqual({ code: 'SERVICE_UNAVAILABLE', status: 503 });
            }
            // It was the gate's own read that refused, not a later layer.
            expect(gateLock).toHaveBeenCalledTimes(2);
            for (const result of gateLock.mock.results) {
                await expect(result.value).rejects.toMatchObject({ status: 503 });
            }
        });
    }
});

describe('[#21761] pin 7 — a third package\'s row is in scope: no write the gate refused before is admitted', () => {
    const OTHER = 'com.example.other';
    const rows = () => [
        storedRow('view', 'none', 'package row', 'v_third', PACKAGE_ID),
        storedRow('view', 'full', 'other package row', 'v_third', OTHER),
    ];

    for (const reversed of [false, true]) {
        it(`${reversed ? 'the other package\'s row returned first' : 'the package\'s row returned first'}: a save naming the package is refused, and the reads say so`, async () => {
            const protocol = harness(ENV_ID, reversed ? rows().reverse() : rows());
            const got = await readsAndDoor(protocol, 'v_third', PACKAGE_ID);
            // Before #21761 the gate asked with no package, so under the second
            // order it bound the other package's 'full' and refused, while the
            // reads said 'none'. Leaving that row out of scope would admit it.
            expect(got.reads).toEqual({ lock: 'full', editable: false, deletable: false });
            expect(got.save).toEqual(ITEM_LOCKED);
            expect(got.delete).toEqual(ITEM_LOCKED);
            expect(got.servedLabel).toBe('package row');
        });
    }

    it('the list item and the directory tile report the same lock as the item\'s envelope', async () => {
        const protocol = harness(ENV_ID, bothOrders('full', 'none', 'v_list')[1]!.rows);
        for (const packageId of [PACKAGE_ID, undefined]) {
            const listed: any = await protocol.getMetaItems({ type: 'view', ...(packageId ? { packageId } : {}) });
            const items = listed.items.filter((i: any) => i.name === 'v_list');
            expect(items.length, `list ${packageId ?? 'unscoped'}`).toBeGreaterThan(0);
            for (const item of items) expect(item._lock, `list ${packageId ?? 'unscoped'}`).toBe('full');
            const diag: any = await protocol.getMetaDiagnostics({ type: 'view', severity: 'warning', ...(packageId ? { packageId } : {}) } as any);
            expect(diag.stats.view.locked, `tile ${packageId ?? 'unscoped'}`).toBe(diag.stats.view.count);
        }
    });
});

// ── 8–11. [#21803] The artifact layer's package axis, named ─────────────────

/** Package A ships the view with `a`, package B (another installed package) with `b`, in both registration orders. */
function twoPackages(a: ArtifactAxis, b: ArtifactAxis, name: string) {
    const ofA = () => packagedView(a, name, PACKAGE_ID)!;
    const ofB = () => packagedView(b, name, OTHER_PACKAGE)!;
    return [
        { order: 'package B registered first', artifacts: () => [ofB(), ofA()] },
        { order: 'package A registered first', artifacts: () => [ofA(), ofB()] },
    ];
}

const REQUESTS = [
    { request: 'naming package A', packageId: PACKAGE_ID },
    { request: 'naming package B', packageId: OTHER_PACKAGE },
    { request: 'naming no package', packageId: undefined },
] as const;

describe('[#21803] pin 8 — the card\'s case: B ships _lock \'full\', A ships no lock; every read reports the lock the door enforces', () => {
    for (const { order, artifacts } of twoPackages({ artifact: 'no _lock' }, { artifact: 'declared', lock: 'full' }, 'v_art')) {
        for (const { request, packageId } of REQUESTS) {
            it(`${order} · request ${request}`, async () => {
                const protocol = harness(ENV_ID, [], artifacts());
                const read = await envelope(protocol, 'view', undefined, 'v_art', packageId);
                expect({ lock: read.lock, editable: read.editable, deletable: read.deletable })
                    .toEqual({ lock: 'full', editable: false, deletable: false });
                // The prose is B's: B's is the only package whose lock is the strictest.
                expect(read.byName.lockReason).toBe(`Packaged lock of ${OTHER_PACKAGE} (full).`);
                expect(read.layered.lockReason).toBe(`Packaged lock of ${OTHER_PACKAGE} (full).`);
                // Content stays prefer-local (ADR-0048): a read naming A is
                // served A's artifact, under A's provenance, carrying B's lock.
                if (packageId !== undefined) {
                    expect({ served: read.byName.item?.label, packageId: read.byName.packageId })
                        .toEqual({ served: `packaged by ${packageId}`, packageId });
                }
                expect(read.byName.item?._lock).toBe('full');
                expect(read.layered.effective?._lock).toBe('full');
                // The door refuses both verbs, with the binding package's prose.
                const err: any = await settle(protocol.saveMetaItem({
                    type: 'view', name: 'v_art', item: { name: 'v_art', label: 'x', object: 'account' },
                    ...(packageId ? { packageId } : {}),
                }));
                expect(err).toBeInstanceOf(Error);
                expect({ code: err.code, status: err.status, lock: err.lock }).toEqual({ code: 'ITEM_LOCKED', status: 403, lock: 'full' });
                expect(err.lockReason).toBe(`Packaged lock of ${OTHER_PACKAGE} (full).`);
                expect(await door(protocol, 'view', 'delete', undefined, 'v_art')).toEqual(ITEM_LOCKED);
            });
        }

        it(`${order} · the list and the directory tile report the item's lock for every package's slot`, async () => {
            const protocol = harness(ENV_ID, [], artifacts());
            for (const packageId of [undefined, PACKAGE_ID, OTHER_PACKAGE]) {
                const listed: any = await protocol.getMetaItems({ type: 'view', ...(packageId ? { packageId } : {}) });
                const items = listed.items.filter((i: any) => i.name === 'v_art');
                expect(items.length, `list ${packageId ?? 'unscoped'}`).toBeGreaterThan(0);
                for (const item of items) expect(item._lock, `list ${packageId ?? 'unscoped'}: ${item._packageId}`).toBe('full');
                const diag: any = await protocol.getMetaDiagnostics({ type: 'view', severity: 'warning', ...(packageId ? { packageId } : {}) } as any);
                expect(diag.stats.view.locked, `tile ${packageId ?? 'unscoped'}`).toBe(diag.stats.view.count);
            }
        });
    }
});

describe('[#21803] pin 9 — never a widening: A ships no lock, B ships \'no-delete\', the stored row declares \'no-overlay\'', () => {
    // Before #21803 the door refused the save when A was registered first (A's
    // artifact does not bind, the row's 'no-overlay' does) and the delete when
    // B was (B's 'no-delete' binds). Neither is admitted under either order now.
    for (const { order, artifacts } of twoPackages({ artifact: 'no _lock' }, { artifact: 'declared', lock: 'no-delete' }, 'v_join')) {
        for (const { request, packageId } of REQUESTS) {
            it(`${order} · request ${request}: the reads say 'full' and the door refuses both verbs`, async () => {
                const protocol = harness(ENV_ID, [storedRow('view', 'no-overlay', 'env-wide row', 'v_join')], artifacts());
                const read = await envelope(protocol, 'view', undefined, 'v_join', packageId);
                expect({ lock: read.lock, editable: read.editable, deletable: read.deletable })
                    .toEqual({ lock: 'full', editable: false, deletable: false });
                // No single package's answer is 'full' (A's is the row's
                // 'no-overlay', B's its own 'no-delete'), so no prose is
                // borrowed from either.
                expect(read.byName.lockReason).toBeUndefined();
                expect(read.byName.item?._lock).toBe('full');
                expect(await door(protocol, 'view', 'save', undefined, 'v_join', packageId)).toEqual(ITEM_LOCKED);
                expect(await door(protocol, 'view', 'delete', undefined, 'v_join')).toEqual(ITEM_LOCKED);
            });
        }
    }
});

describe('[#21803] pin 10 — a disabled package is still installed: its packaged lock binds', () => {
    for (const { order, artifacts } of twoPackages({ artifact: 'no _lock' }, { artifact: 'declared', lock: 'full' }, 'v_dis')) {
        it(`${order}: B disabled, a read naming A and the door both say 'full'`, async () => {
            const protocol = harness(ENV_ID, [], artifacts(), [{ id: OTHER_PACKAGE, enabled: false }]);
            // The listing hides B's entry; the lock does not depend on it.
            expect(((protocol as any).engine.registry.listItems('view') as any[]).map((i) => i._packageId)).toEqual([PACKAGE_ID]);
            const read = await envelope(protocol, 'view', undefined, 'v_dis', PACKAGE_ID);
            expect({ lock: read.lock, editable: read.editable, deletable: read.deletable })
                .toEqual({ lock: 'full', editable: false, deletable: false });
            expect(await door(protocol, 'view', 'save', undefined, 'v_dis', PACKAGE_ID)).toEqual(ITEM_LOCKED);
            expect(await door(protocol, 'view', 'delete', undefined, 'v_dis')).toEqual(ITEM_LOCKED);
        });
    }
});
