// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [epic cloud#3652 Q3 「默认拒绝，需显式映射（推荐）」 and D3 「写进清单 renamedFrom」,
 * #30885] The install door's side of a declared rename: which columns this
 * install carries, read and judged before any write, then carried right before
 * the new version registers, and put back if it does not.
 *
 * The rule is the SQL driver's (`planDeclaredRenames`, driver-sql
 * `declared-rename.ts`): a field `b` declaring `renamedFrom: ['a']` is carried
 * from `a` when the table has a column for `a`, none for `b`, and the object
 * as the upgrade leaves it no longer declares `a`. This module adds what only
 * the door can know, because only the door knows which package is installing:
 *
 * - **The object as the upgrade leaves it.** The served object, less the keys
 *   the installing package contributes now (its owner declaration, or its
 *   extension's fields), plus the keys it brings. A key another package's
 *   extension still declares stays live, and the driver refuses it
 *   (`live_key`).
 * - **The carry stays inside the declaring package.** Only the installing
 *   package's own declarations are carried or judged here. An extension's field
 *   may carry only a key the installed version of the SAME package contributed
 *   to that object (`outside_package`): the owner's just-dropped column, or one
 *   another extension left, is never the extension's to take.
 * - **A destructive type change** on a declared rename (the upgrade plan's
 *   `destructive`: the new type stores no column) is refused
 *   (`destructive_type`); the driver judges the column itself on the rest.
 * - **A transport that renames no column** (a driver with no
 *   `planDeclaredRenames`, or one that answers `transport`) is refused by name
 *   when a rename is pending, never when nothing is left to carry.
 *
 * Nothing here writes: {@link carryInstallDeclaredRenames} and
 * {@link reverseInstallDeclaredRenames} are the door's two writes, each one
 * call per table through the driver.
 */

import { resolveStackCollection } from '@objectstack/core';
import { StorageNameMapping } from '@objectstack/spec/system';

/** One column a declared rename carries, as the driver plans it. */
export interface InstallRenameCarry {
    table: string;
    from: string;
    to: string;
}

/** Why the door refuses a declared rename: the driver's reasons, and the door's own `outside_package`. */
export type InstallRenameRefusalReason =
    | 'platform_column'
    | 'live_key'
    | 'claimed_twice'
    | 'both_columns'
    | 'several_old_columns'
    | 'destructive_type'
    | 'index_cannot_follow'
    | 'transport'
    | 'outside_package';

/** One refused declaration: the object, the field, the old key(s) and the reason, in words. */
export interface InstallRenameRefusal {
    object: string;
    field: string;
    from: string[];
    reason: InstallRenameRefusalReason;
    message: string;
}

/** The driver members the door asks: `SqlDriver`'s, duck-typed (this package does not depend on driver-sql). */
export interface InstallRenameDriver {
    planDeclaredRenames(
        table: string,
        object: { fields?: Record<string, unknown>; indexes?: unknown[] },
        opts?: { liveKeys?: Iterable<string> },
    ): Promise<{
        carries: InstallRenameCarry[];
        refusals: Array<{ table: string; field: string; from: string[]; reason: string; message: string }>;
    }>;
    carryDeclaredRenames(
        table: string,
        object: { fields?: Record<string, unknown>; indexes?: unknown[] },
        opts?: { liveKeys?: Iterable<string> },
    ): Promise<InstallRenameCarry[]>;
    reverseDeclaredRenames(carries: ReadonlyArray<InstallRenameCarry>): Promise<void>;
}

/** One table this install carries into: what the carry is asked with, and what the plan said it does. */
export interface InstallRenameTable {
    object: string;
    table: string;
    driver: InstallRenameDriver;
    /** The installing package's contribution to the object: the only declarations carried. */
    fields: Record<string, unknown>;
    indexes?: unknown[];
    liveKeys: string[];
    carries: InstallRenameCarry[];
}

/** The engine members the door reads, duck-typed. */
export interface InstallRenameEngine {
    getDriverForObject?(name: string): unknown;
    registry?: {
        getStorageObject?(name: string): unknown;
        getObject?(name: string): unknown;
        getObjectOwner?(name: string): { definition?: unknown } | undefined;
    };
}

/** A type change the upgrade plan lists, as far as this module reads it. */
export interface InstallRenameTypeChange {
    object: string;
    field: string;
    from: string;
    to: string;
    category: string;
    renamedFrom?: string;
}

/** The `renamedFrom` entries a field declares, strings only, in order. */
export function renamedFromOf(def: unknown): string[] {
    const list = (def as { renamedFrom?: unknown } | null | undefined)?.renamedFrom;
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string' && k !== '') : [];
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const fieldsOf = (def: unknown): Record<string, unknown> => {
    const fields = (def as { fields?: unknown } | null | undefined)?.fields;
    return isRecord(fields) ? fields : {};
};
const extensionTarget = (ext: Record<string, unknown>): string | undefined => {
    for (const key of ['extend', 'object', 'objectName', 'target', 'name', 'extends']) {
        if (typeof ext[key] === 'string' && ext[key] !== '') return ext[key] as string;
    }
    return undefined;
};

/** What one package body contributes to each object: its own declarations, and its extensions' fields. */
interface Contribution {
    /** The object's own declaration, when the package owns it. */
    own?: Record<string, unknown>;
    /** Every field the package contributes to the object (own and extension), by key. */
    fields: Record<string, unknown>;
    /** The keys contributed through `objectExtensions` (an object the package does not own). */
    extensionKeys: Set<string>;
}

function contributionsOf(body: unknown): Map<string, Contribution> {
    const out = new Map<string, Contribution>();
    const slot = (name: string): Contribution => {
        let c = out.get(name);
        if (!c) out.set(name, c = { fields: {}, extensionKeys: new Set() });
        return c;
    };
    for (const object of resolveStackCollection(body, 'objects')) {
        if (!isRecord(object) || typeof object.name !== 'string' || object.name === '') continue;
        const c = slot(object.name);
        c.own = object;
        Object.assign(c.fields, fieldsOf(object));
    }
    for (const ext of resolveStackCollection(body, 'objectExtensions')) {
        if (!isRecord(ext)) continue;
        const target = extensionTarget(ext);
        if (target === undefined) continue;
        const c = slot(target);
        for (const [key, def] of Object.entries(fieldsOf(ext))) {
            c.fields[key] = def;
            if (!c.own) c.extensionKeys.add(key);
        }
    }
    return out;
}

const quote = (keys: readonly string[]): string => keys.map((k) => `'${k}'`).join(', ');

/**
 * Plan this install's declared renames, before any write.
 *
 * `installed` is the installed version's body, converted forward: `null` for a
 * fresh install (nothing installed), `undefined` when this runtime holds no
 * readable body of it (no comparison can tell what it contributed).
 */
export async function planInstallDeclaredRenames(args: {
    manifestId: string;
    incoming: unknown;
    installed: unknown | null | undefined;
    engine: InstallRenameEngine | undefined;
    typeChanges: readonly InstallRenameTypeChange[];
}): Promise<{ tables: InstallRenameTable[]; refusals: InstallRenameRefusal[] }> {
    const { incoming, installed, engine } = args;
    const tables: InstallRenameTable[] = [];
    const refusals: InstallRenameRefusal[] = [];
    const before = installed === null || installed === undefined ? undefined : contributionsOf(installed);

    for (const t of args.typeChanges) {
        if (t.renamedFrom === undefined || t.category !== 'destructive') continue;
        refusals.push({
            object: t.object,
            field: t.field,
            from: [t.renamedFrom],
            reason: 'destructive_type',
            message: `${t.object}.${t.field} declares \`renamedFrom\` '${t.renamedFrom}' and changes type ${t.from} → ${t.to}, `
                + 'which stores no column: the values the old column holds would have nowhere to go. Keep a stored '
                + 'type for the renamed field, or carry the values by hand.',
        });
    }
    const refusedFields = new Set(refusals.map((r) => `${r.object}.${r.field}`));

    for (const [object, mine] of contributionsOf(incoming)) {
        const declaring = Object.entries(mine.fields).filter(([key, def]) =>
            renamedFromOf(def).length > 0 && !refusedFields.has(`${object}.${key}`));
        if (declaring.length === 0) continue;
        const prior = before?.get(object);
        // A rename the package's own record says is pending: the installed
        // version declared an old key this version renames. With no readable
        // record, every declaration is taken as pending.
        const pending = declaring.filter(([, def]) =>
            installed === undefined || renamedFromOf(def).some((old) => prior !== undefined && old in prior.fields));

        const driver = engine?.getDriverForObject?.(object) as Partial<InstallRenameDriver> | undefined;
        if (!driver || typeof driver.planDeclaredRenames !== 'function' || typeof driver.carryDeclaredRenames !== 'function'
            || typeof driver.reverseDeclaredRenames !== 'function') {
            for (const [field, def] of pending) {
                refusals.push({
                    object,
                    field,
                    from: renamedFromOf(def),
                    reason: 'transport',
                    message: `${object}.${field} declares \`renamedFrom\` ${quote(renamedFromOf(def))}, and the driver serving `
                        + `'${object}' renames no column, so the values would stay behind in the old column. Nothing was `
                        + 'changed.',
                });
            }
            continue;
        }

        const registry = engine?.registry;
        const served = (registry?.getStorageObject?.(object) ?? registry?.getObject?.(object)) as Record<string, unknown> | undefined;
        // The object as the upgrade leaves it: the served fields, less what
        // this package contributes now, plus what it brings.
        const leaving = new Set<string>(Object.keys(prior?.fields ?? {}));
        if (mine.own) for (const key of Object.keys(fieldsOf(registry?.getObjectOwner?.(object)?.definition))) leaving.add(key);
        const after: Record<string, unknown> = {};
        for (const [key, def] of Object.entries(fieldsOf(served))) if (!leaving.has(key)) after[key] = def;
        Object.assign(after, mine.fields);
        const liveKeys = Object.keys(after);
        const table = StorageNameMapping.resolveTableName((served ?? mine.own ?? { name: object }) as any);
        const indexes = (mine.own as { indexes?: unknown[] } | undefined)?.indexes
            ?? (served as { indexes?: unknown[] } | undefined)?.indexes;

        const plan = await driver.planDeclaredRenames(table, { fields: after, ...(indexes ? { indexes } : {}) }, { liveKeys });
        const mineKeys = new Set(declaring.map(([key]) => key));
        const claimedByMine = new Set(declaring.flatMap(([, def]) => renamedFromOf(def)));
        for (const r of plan.refusals) {
            if (!mineKeys.has(r.field) && !(r.reason === 'claimed_twice' && r.from.some((k) => claimedByMine.has(k)))) continue;
            refusals.push({ object, field: r.field, from: r.from, reason: r.reason as InstallRenameRefusalReason, message: r.message });
        }
        const carries: InstallRenameCarry[] = [];
        for (const c of plan.carries) {
            if (!mineKeys.has(c.to)) continue;
            if (mine.extensionKeys.has(c.to) && !(prior !== undefined && c.from in prior.fields)) {
                refusals.push({
                    object,
                    field: c.to,
                    from: [c.from],
                    reason: 'outside_package',
                    message: `${table}.${c.to} declares \`renamedFrom\` '${c.from}', but '${c.from}' is not a field the installed `
                        + `version of this package added to '${object}'${prior === undefined && installed === undefined
                            ? ' (its install record cannot be read, so that cannot be told)' : ''}: an extension carries only `
                        + 'its own earlier keys, never a column the object\'s owner or another extension left. Remove the '
                        + 'entry from `renamedFrom`.',
                });
                continue;
            }
            carries.push(c);
        }
        if (carries.length > 0) {
            tables.push({
                object,
                table,
                driver: driver as InstallRenameDriver,
                fields: Object.fromEntries(declaring),
                ...(indexes ? { indexes } : {}),
                liveKeys,
                carries,
            });
        }
    }
    return { tables, refusals };
}

/**
 * Carry each planned table, in order. A table that throws stops the carry:
 * the tables already carried are put back ({@link reverseInstallDeclaredRenames})
 * and the error is rethrown with them restored, so the version that serves
 * finds its columns where it left them.
 */
export async function carryInstallDeclaredRenames(
    tables: readonly InstallRenameTable[],
    onReverseFailure: (table: InstallRenameTable, err: unknown) => void,
): Promise<Array<{ table: InstallRenameTable; carries: InstallRenameCarry[] }>> {
    const done: Array<{ table: InstallRenameTable; carries: InstallRenameCarry[] }> = [];
    for (const t of tables) {
        try {
            const carries = await t.driver.carryDeclaredRenames(
                t.table,
                { fields: t.fields, ...(t.indexes ? { indexes: t.indexes } : {}) },
                { liveKeys: t.liveKeys },
            );
            done.push({ table: t, carries });
        } catch (err) {
            await reverseInstallDeclaredRenames(done, onReverseFailure);
            throw err;
        }
    }
    return done;
}

/** Put back what {@link carryInstallDeclaredRenames} carried, last table first. A failure is reported, never thrown. */
export async function reverseInstallDeclaredRenames(
    done: ReadonlyArray<{ table: InstallRenameTable; carries: InstallRenameCarry[] }>,
    onReverseFailure: (table: InstallRenameTable, err: unknown) => void,
): Promise<void> {
    for (const { table, carries } of [...done].reverse()) {
        if (carries.length === 0) continue;
        try {
            await table.driver.reverseDeclaredRenames(carries);
        } catch (err) {
            onReverseFailure(table, err);
        }
    }
}
