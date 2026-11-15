// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33724] The NOT NULL relax a package install or upgrade owes its own
 * declarations.
 *
 * A package field that was `storage: { notNull: true }` and is now `storage: {
 * notNull: false }` leaves the column NOT NULL on every database the earlier
 * version built: the schema sync is additive (ADR-0104), and the boot never
 * applies the relax (ADR-0113 D5, `needs_confirm`). For a runtime-authored
 * object the publish of the declaration applies it
 * (`SqlDriver.applyPublishedColumnChanges`). A package object is sealed, so no
 * publish of it can ask: until this step, every write that left the field
 * empty was refused by the database, and only `os migrate apply` on the
 * environment's own database could relax it.
 *
 * The managed install or upgrade of the package is the deliberate act for it,
 * as a publish is for a runtime-authored object. After the install's schema
 * sync, this relaxes the NOT NULL of each column whose field the INSTALLING
 * package's own body declares `storage: { notNull: false }` in words — its own
 * objects and the fields its `objectExtensions` contribute — through the
 * driver's `relaxDeclaredNotNull`, which also asks the served declaration to
 * say `false`. So:
 *
 * - a column another package or a customization declares is never this
 *   install's to relax;
 * - an undeclared NOT NULL (no `storage`, or `storage` without `notNull`) is
 *   left alone, as D5 leaves it;
 * - no other drift kind is applied: no `safe` widening, no index, nothing
 *   `destructive`.
 *
 * ⛔ Never called from a boot or a rehydrate: those are not an act of
 * anybody's (ADR-0113 D5).
 *
 * The engine and the driver are read structurally, as the declared-rename
 * carry reads them (this package does not depend on driver-sql), so a host's
 * own install door can call {@link relaxInstallDeclaredNotNull} with the same
 * data engine after its schema sync.
 */

import { isFederatedObject } from '@objectstack/core';
import { StorageNameMapping } from '@objectstack/spec/system';
import { contributionsOf } from './marketplace-install-declared-renames.js';

/** One drift entry the driver applied or skipped, as far as this module reads it. */
export interface InstallRelaxEntry {
    table: string;
    column?: string;
    op: { type: string };
    message?: string;
}

/** The driver member this step asks: `SqlDriver.relaxDeclaredNotNull`, duck-typed. */
export interface InstallRelaxDriver {
    relaxDeclaredNotNull(
        obj: { name: string; fields?: Record<string, unknown>; indexes?: unknown[] },
        columns: Iterable<string>,
        opts?: { packageId?: string },
    ): Promise<{ applied: InstallRelaxEntry[]; skipped: InstallRelaxEntry[] }>;
}

/** The engine members this step reads, duck-typed. */
export interface InstallRelaxEngine {
    getDriverForObject?(name: string): unknown;
    registry?: {
        getStorageObject?(name: string): unknown;
        getObject?(name: string): unknown;
    };
}

/** What the step did: the entries applied and skipped, each with the object it belongs to. */
export interface InstallRelaxReport {
    applied: Array<InstallRelaxEntry & { object: string }>;
    skipped: Array<InstallRelaxEntry & { object: string }>;
    /** Objects with a declared relax whose driver has no `relaxDeclaredNotNull` (a non-SQL driver). A federated object is skipped, not listed. */
    unsupported: string[];
}

const declaresNullable = (def: unknown): boolean =>
    (def as { storage?: { notNull?: unknown } } | null | undefined)?.storage?.notNull === false;

/**
 * The columns the package body `incoming` declares `storage: { notNull: false }`
 * for, by object: its own objects' fields and its extensions' fields.
 */
export function declaredNullableColumns(incoming: unknown): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const [object, mine] of contributionsOf(incoming)) {
        const keys = Object.entries(mine.fields).filter(([, def]) => declaresNullable(def)).map(([key]) => key);
        if (keys.length > 0) out.set(object, keys);
    }
    return out;
}

/**
 * Relax, after the install's schema sync, the NOT NULL columns `incoming` (the
 * installing package's body, converted forward) declares nullable. Reads the
 * object the registry serves — the declaration the drift is diffed against —
 * under the table its sync resolved. A driver error rejects; the caller decides
 * how the install reports it.
 */
export async function relaxInstallDeclaredNotNull(args: {
    manifestId: string;
    incoming: unknown;
    engine: InstallRelaxEngine | undefined;
}): Promise<InstallRelaxReport> {
    const { manifestId, incoming, engine } = args;
    const report: InstallRelaxReport = { applied: [], skipped: [], unsupported: [] };
    for (const [object, columns] of declaredNullableColumns(incoming)) {
        const registry = engine?.registry;
        const served = (registry?.getStorageObject?.(object) ?? registry?.getObject?.(object)) as
            { name?: string; fields?: Record<string, unknown>; indexes?: unknown[] } | undefined;
        // The remote owns a federated object's schema: nothing here alters it.
        if (!served || isFederatedObject(served)) continue;
        const driver = engine?.getDriverForObject?.(object) as Partial<InstallRelaxDriver> | undefined;
        if (!driver || typeof driver.relaxDeclaredNotNull !== 'function') {
            report.unsupported.push(object);
            continue;
        }
        const table = StorageNameMapping.resolveTableName(served as any);
        const result = await driver.relaxDeclaredNotNull(
            { ...served, name: table },
            columns,
            { packageId: manifestId },
        );
        report.applied.push(...result.applied.map((e) => ({ ...e, object })));
        report.skipped.push(...result.skipped.map((e) => ({ ...e, object })));
    }
    return report;
}
