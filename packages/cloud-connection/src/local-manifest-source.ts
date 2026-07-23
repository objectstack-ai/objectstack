// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * LocalManifestSource — the local desired-state ledger for package installs
 * (cloud ADR-0007 step ⑤).
 *
 * A self-hosted / single-environment runtime OWNS its desired state: the
 * answer to "which packages should this runtime load" lives on the runtime's
 * own disk, one JSON file per installed manifest under
 * `<cwd>/.objectstack/installed-packages/`. This class is that ledger,
 * promoted to a first-class named seam.
 *
 * It is the LOCAL isomorph of what a cloud control plane does for managed
 * environments (`sys_package_installation` desired rows → compiled
 * artifact): same role — desired-state owner — different authority:
 *
 *   | Deployment        | Desired-state owner                  | Runtime truth        |
 *   |-------------------|--------------------------------------|----------------------|
 *   | Cloud-managed env | control plane (sys_package_installation → artifact) | env-local artifact cache |
 *   | Self-hosted env   | THIS ledger (LocalManifestSource)    | the same ledger (rehydrated at boot) |
 *
 * Nothing here talks to a network: reads and writes are synchronous local
 * file operations, so a runtime boots and serves its installed packages
 * with zero cloud dependency ("云崩环境不崩").
 *
 * Consumed by {@link MarketplaceInstallLocalPlugin} (the HTTP surface that
 * mutates the ledger) — exported so hosts and future reconcilers can read
 * the same ledger without going through HTTP.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** One installed-package entry — desired state + provenance. */
export interface InstalledManifestEntry {
    packageId: string;
    versionId: string;
    manifestId: string;
    version: string;
    manifest: any;
    installedAt: string;
    installedBy: string | null;
    /** Whether the bundled seed datasets have been loaded into the kernel
     *  database. True after install (seedNow=true) or an explicit reseed;
     *  false after a purge. Persisted so the UI can show "Add" vs "Re-seed". */
    withSampleData?: boolean;
    /** True only after an explicit purge-sample-data call. The rehydrate-time
     *  sample-data healer (see MarketplaceInstallLocalPlugin.maybeHealSampleData)
     *  must not resurrect demo rows the user deliberately removed — an empty
     *  table after a purge is desired state, not data loss. Cleared again by
     *  install/reseed runs that land rows. */
    sampleDataPurged?: boolean;
}

/** Default ledger location, relative to the runtime's working directory. */
export const DEFAULT_INSTALLED_PACKAGES_DIR = '.objectstack/installed-packages';

function safeFilename(manifestId: string): string {
    return manifestId.replace(/[^a-zA-Z0-9._-]/g, '_') + '.json';
}

export class LocalManifestSource {
    /** Resolved ledger directory. */
    readonly dir: string;

    constructor(storageDir?: string) {
        this.dir = storageDir
            ? resolve(storageDir)
            : resolve(process.cwd(), DEFAULT_INSTALLED_PACKAGES_DIR);
    }

    /** Every valid entry in the ledger (corrupt files are skipped). */
    list(): InstalledManifestEntry[] {
        if (!existsSync(this.dir)) return [];
        const out: InstalledManifestEntry[] = [];
        for (const name of readdirSync(this.dir)) {
            if (!name.endsWith('.json')) continue;
            try {
                const raw = readFileSync(join(this.dir, name), 'utf8');
                out.push(JSON.parse(raw));
            } catch { /* skip corrupt files */ }
        }
        return out;
    }

    /** Read one entry; null when absent or unreadable. */
    read(manifestId: string): InstalledManifestEntry | null {
        const file = this.fileFor(manifestId);
        if (!existsSync(file)) return null;
        try {
            return JSON.parse(readFileSync(file, 'utf8'));
        } catch {
            return null;
        }
    }

    /** Whether the ledger holds an entry for this manifest id. */
    has(manifestId: string): boolean {
        return existsSync(this.fileFor(manifestId));
    }

    /** Create or replace an entry (upsert by manifestId). */
    write(entry: InstalledManifestEntry): void {
        mkdirSync(this.dir, { recursive: true });
        writeFileSync(this.fileFor(entry.manifestId), JSON.stringify(entry, null, 2), 'utf8');
    }

    /** Remove an entry. Returns false when it was not present. */
    remove(manifestId: string): boolean {
        const file = this.fileFor(manifestId);
        if (!existsSync(file)) return false;
        unlinkSync(file);
        return true;
    }

    private fileFor(manifestId: string): string {
        return join(this.dir, safeFilename(manifestId));
    }
}
