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

import type { GlobalUniqueAttestation } from '@objectstack/types';

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
    /**
     * [ADR-0120 D5e] The installer's answer to the `isolated`-posture question
     * about this package's installation-wide (`'global'`) uniques — recorded
     * ADR-0104 attestation style: the fact affirmed, by whom, when, and under
     * which posture it was asked.
     *
     * This is what makes the hard stop a ONE-TIME ceremony rather than a
     * recurring prompt: `unconfirmedGlobalUniques` subtracts these ids from the
     * findings, so a reinstall or upgrade only ever asks about constraints
     * nobody has answered for yet. The ledger is the right home because it is
     * the desired-state record that survives restarts — a memory-only
     * confirmation would re-ask on every process boot, which is precisely the
     * boot-time nagging #4884 forbids.
     */
    globalUniqueAttestation?: GlobalUniqueAttestation;
}

/**
 * One ledger file {@link LocalManifestSource.list} could not turn into an entry
 * (#5413).
 *
 * The `cause` is the thrown object itself, never a string this class invented:
 * `ENOENT`, `EACCES` and `Unexpected end of JSON input` are three different
 * operational facts with three different fixes, and the thrower words each of
 * them better than any sentence here could. Consumers quote it (`os doctor`
 * folds it onto a report row) or log it — that decision is theirs, which is the
 * whole reason this is returned rather than logged in place.
 */
export interface SkippedManifestEntry {
    /** The ledger file's basename, as it sits on disk (e.g. `com.acme.crm.json`). */
    file: string;
    /** What reading or parsing that file threw. Never re-wrapped, never stringified. */
    cause: unknown;
}

/**
 * What {@link LocalManifestSource.list} hands back — what it READ, and what it
 * could NOT (#5413).
 *
 * Skipping a corrupt file is deliberate and stays that way: one truncated
 * manifest must not stop a runtime from booting the packages that are fine.
 * The defect was skipping it **silently**. `list()` used to return a bare
 * array, so a short list was indistinguishable from a complete one — no
 * difference in the return value, no log, no count — and all three consumers
 * gave a confidently wrong answer: `rehydrate()` dropped an installed app out
 * of the runtime with no line in the log, `handleList()` served the console a
 * list that looked whole, and `os doctor` printed `✓ Unique scope` over
 * packages it had never seen.
 *
 * Reporting is the CALLER's job, not this class's: a boot wants a `warn`, an
 * HTTP handler wants a log line without changing its wire shape, and `os
 * doctor` wants a `HealthCheckResult` row — not stderr. Returning the fact
 * (rather than taking a logger, or an optional `onSkip` callback that defaults
 * to silence) is what makes "I read only half the ledger" impossible to ignore
 * by accident: it is in the type, so a consumer that drops it has to say so.
 */
export interface InstalledManifestListing {
    /** Every file that parsed into an entry. */
    entries: InstalledManifestEntry[];
    /** Every `.json` file in the ledger that did not, and why. */
    skipped: SkippedManifestEntry[];
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

    /**
     * Read the ledger: every entry that parsed, AND every file that did not
     * (#5413).
     *
     * Corrupt files are still skipped — deliberately, and that has not changed.
     * What changed is that they are now **reported** in the return value
     * instead of vanishing into an un-bound `catch`. See
     * {@link InstalledManifestListing} for why this is the caller's fact to
     * report rather than something logged here.
     *
     * ⚠️ Note what is NOT in `skipped`: a failure to enumerate the DIRECTORY
     * still throws out of this method. That is a different fact — nothing at
     * all was read, not "some of it" — and `os doctor` already distinguishes
     * the two (#5412). Do not wrap `readdirSync` in a `try` here to make this
     * method total; the throw is the signal.
     */
    list(): InstalledManifestListing {
        if (!existsSync(this.dir)) return { entries: [], skipped: [] };
        const entries: InstalledManifestEntry[] = [];
        const skipped: SkippedManifestEntry[] = [];
        for (const name of readdirSync(this.dir)) {
            if (!name.endsWith('.json')) continue;
            try {
                const raw = readFileSync(join(this.dir, name), 'utf8');
                entries.push(JSON.parse(raw));
            } catch (cause) {
                skipped.push({ file: name, cause });
            }
        }
        return { entries, skipped };
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
