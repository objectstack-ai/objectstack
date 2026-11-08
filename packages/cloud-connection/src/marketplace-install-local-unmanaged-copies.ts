// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30808] The install-local door's private record of the unmanaged copies it
 * made itself — what lets its purge tell "a copy this door made" apart from
 * every other writable base.
 *
 * ## Why the door keeps a record of its own
 *
 * An unmanaged copy is an ordinary writable base once it lands: the import
 * stores no marker on the base manifest, the `-copy` default is also the
 * Studio duplicate's default id, and the copy writes no install-ledger entry.
 * Without a record, the purge's receipt read would reach every writable base's
 * `seed` items — a Studio-authored base's own seed rows included. So the door
 * records each base it copied, in the same act as the copy, and its purge
 * reaches only a base in this record; any other id keeps the purge's 404.
 *
 * ## Where it lives, and for how long
 *
 * One JSON file per base under `<ledger dir>/unmanaged-copies/`, beside the
 * install ledger. The ledger reads only the `.json` files at its own top
 * level, so the subdirectory is never read as an install entry. A record is:
 *   - written by the door when the copy lands, with or without sample data
 *     (`seeded` says which, so the purge can answer "no sample data was
 *     copied" instead of "not a copy");
 *   - removed when the base is uninstalled, through the protocol's uninstall
 *     cleanups;
 *   - lost with the ledger directory, as the managed ledger entries are.
 * A copy made before this record existed has none, so the purge does not
 * reach it.
 *
 * ## Tied to the base instance, not only to its id
 *
 * "This door once copied this id" can outlive the base: a protocol without the
 * cleanup registry, a removal that failed, a base removed by another replica,
 * or an uninstall racing the record write. A later base under the same id —
 * a Studio duplicate also defaults to `<sourceId>-copy` — must not inherit
 * the purge. So the record also keeps the base's `instance`: the `version` and
 * `created_at` of the base's row in the package store (`sys_packages`, read
 * through the `package` service's `get`). The store mints `created_at` when it
 * first inserts the row, keeps it when the same base is published again, and
 * an uninstall deletes the row, so a later base under the same id gets a row of
 * its own. The purge reads the row again and answers 404 when it is gone or its
 * `created_at` differs.
 *
 * What it leaves:
 *   - a runtime with no `package` service persists no base row; the record
 *     then holds no `instance`, and the purge's reach is by id alone — the
 *     condition above stays open there (such a base does not survive a
 *     restart either);
 *   - `created_at` is the store's `CURRENT_TIMESTAMP`, so a base uninstalled
 *     and re-created under the same id within the same second shares it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** The subdirectory of the ledger directory the records live in. */
export const UNMANAGED_COPIES_SUBDIR = 'unmanaged-copies';

/** One base the door copied. */
export interface UnmanagedCopyRecordEntry {
    /** The new base's package id. */
    baseId: string;
    /** The package it was copied from. */
    sourcePackageId: string;
    sourceVersion?: string;
    /** Whether the copy took the package's sample data (`seedSampleData: true`). */
    seeded: boolean;
    /** When the copy landed (ISO 8601). */
    copiedAt: string;
    /** The installer's user id, when the request named one. */
    copiedBy?: string;
    /**
     * The base's row in the package store when the copy landed — absent on a
     * runtime with no `package` service (see the module docblock).
     */
    instance?: UnmanagedCopyInstance;
}

/** The base instance a record is tied to: its `sys_packages` row's `version` and `created_at`. */
export interface UnmanagedCopyInstance {
    version: string;
    createdAt: string;
}

/** The `package` service's read of one stored base row (`service-package`'s `get`), named by shape. */
export interface UnmanagedCopyPackageStore {
    get(packageId: string, version?: string): Promise<{ version?: unknown; created_at?: unknown } | null>;
}

/**
 * The base instance as the package store holds it now: the row's `version` and
 * `created_at`, `null` when the store holds no row of it, `undefined` when the
 * row carries no readable stamp.
 */
export async function readUnmanagedCopyInstance(
    store: UnmanagedCopyPackageStore,
    baseId: string,
    version?: string,
): Promise<UnmanagedCopyInstance | null | undefined> {
    const row = await store.get(baseId, version ?? 'latest');
    if (row === null || row === undefined) return null;
    const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at;
    if (typeof row.version !== 'string' || typeof createdAt !== 'string' || createdAt === '') return undefined;
    return { version: row.version, createdAt };
}

/** A record read: the entry, `null` for no record, or why the record could not be read. */
export type UnmanagedCopyRecordRead =
    | { entry: UnmanagedCopyRecordEntry; failure?: undefined }
    | { entry: null; failure?: undefined }
    | { entry?: undefined; failure: string };

function recordFilename(baseId: string): string {
    return baseId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}

function isRecordEntry(value: unknown, baseId: string): value is UnmanagedCopyRecordEntry {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const v = value as Record<string, unknown>;
    const instance = v.instance as Record<string, unknown> | undefined;
    return v.baseId === baseId
        && typeof v.sourcePackageId === 'string'
        && typeof v.seeded === 'boolean'
        && typeof v.copiedAt === 'string'
        && (instance === undefined
            || (instance !== null && typeof instance === 'object'
                && typeof instance.version === 'string' && typeof instance.createdAt === 'string'));
}

export class UnmanagedCopyRecord {
    /** The directory the records live in. */
    readonly dir: string;

    /** The record file of `baseId` — named in an answer about that file. */
    fileOf(baseId: string): string {
        return this.fileFor(baseId);
    }

    constructor(ledgerDir: string) {
        this.dir = join(ledgerDir, UNMANAGED_COPIES_SUBDIR);
    }

    private fileFor(baseId: string): string {
        return join(this.dir, recordFilename(baseId));
    }

    /** Write the record of `entry.baseId`, replacing any earlier one (written whole, then renamed into place). */
    write(entry: UnmanagedCopyRecordEntry): void {
        mkdirSync(this.dir, { recursive: true });
        const file = this.fileFor(entry.baseId);
        const staging = `${file}.${randomBytes(6).toString('hex')}.tmp`;
        writeFileSync(staging, JSON.stringify(entry, null, 2) + '\n', 'utf8');
        renameSync(staging, file);
    }

    /**
     * The record of `baseId`. A file that exists but does not read as this
     * base's record is a `failure`, never "no record": the caller decides what
     * an unreadable record refuses.
     */
    read(baseId: string): UnmanagedCopyRecordRead {
        const file = this.fileFor(baseId);
        if (!existsSync(file)) return { entry: null };
        let parsed: unknown;
        try {
            parsed = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err: any) {
            return { failure: `the unmanaged-copy record ${file} could not be read: ${err?.message ?? err}` };
        }
        if (!isRecordEntry(parsed, baseId)) {
            return { failure: `the unmanaged-copy record ${file} is not a record of '${baseId}'` };
        }
        return { entry: parsed };
    }

    /** Remove the record of `baseId`. Answers whether there was one. */
    remove(baseId: string): boolean {
        const file = this.fileFor(baseId);
        if (!existsSync(file)) return false;
        rmSync(file, { force: true });
        return true;
    }
}
