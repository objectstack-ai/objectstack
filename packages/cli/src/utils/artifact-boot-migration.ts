// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot-time migration policy for the artifact-pinned boot (#8368, acceptance #5).
 *
 * ## Why the artifact-pinned boot needs its own policy
 *
 * The two-axis deployment model — fixed runtime image, app artifact named by
 * `OS_ARTIFACT_URL` — makes "upgrade the app" an env change plus a restart.
 * That is precisely the moment the physical schema and the metadata can
 * disagree, and it happens with no operator at a terminal: a container simply
 * comes up carrying a different artifact than the one that shaped the database.
 *
 * The standing production policy is deliberately hands-off — `autoMigrate:
 * 'safe'` is ignored under `NODE_ENV=production` and every divergence is
 * warned about, because the operator is assumed to be running `os migrate`
 * deliberately. On this path there is nobody to read a warning at the moment it
 * matters, so the acceptance list asks for something stricter and more
 * decidable:
 *
 *   - **safe (loosening) drift is applied** at boot, the same set
 *     `os migrate apply` applies without `--allow-destructive`;
 *   - **destructive drift refuses the boot**, with a message naming every
 *     change and the command that resolves it;
 *   - **nothing is skipped silently** — the third state, "shrug and serve", is
 *     the one this gate exists to delete.
 *
 * `needs_confirm` drift is applied along with `safe`: `os migrate apply`'s own
 * split is `category !== 'destructive' || allowDestructive`, so "the
 * `--allow-destructive` class" the acceptance names is exactly
 * `category === 'destructive'` and nothing else. Re-deriving that boundary here
 * would be a second opinion about which changes are dangerous, and two opinions
 * is how one of them ends up wrong.
 *
 * ## Where it runs
 *
 * On the `kernel:ready` hook (Phase 3): after every plugin's `start()`, so
 * ObjectQL's schema sync has already created tables and added columns, and
 * before Phase 4 opens the HTTP socket. A throw from a boot-path hook
 * propagates and fails the boot, so "refuse to boot" is literal here — the port
 * never binds.
 *
 * Phase 3 also makes the verdict safe to record: every provider has registered
 * by then, so this is not the #4777 "judge a registry mid-fill" shape. The
 * drift set is final for this boot.
 */

import chalk from 'chalk';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import type { SqlDriverLike } from './schema-migrate.js';

/** What the gate decided, in a form a test can assert without booting a kernel. */
export interface ArtifactBootMigrationVerdict {
    /** `false` means: refuse the boot and print {@link refusal}. */
    ok: boolean;
    /** Safe/needs-confirm entries this gate actually applied. */
    applied: ManagedDriftEntry[];
    /** Entries the gate wanted to apply but the driver skipped. */
    skipped: ManagedDriftEntry[];
    /** Destructive entries — non-empty implies `ok === false`. */
    destructive: ManagedDriftEntry[];
    /** Operator-facing refusal text; set only when `ok === false`. */
    refusal?: string;
}

/** One drift entry as a bullet — `table.column: message`, or `table: message`. */
function describeEntry(entry: ManagedDriftEntry): string {
    const where = entry.column ? `${entry.table}.${entry.column}` : entry.table;
    return `    • ${where} — ${entry.message}`;
}

/**
 * The operator message for a refused boot.
 *
 * Pure and exported so the wording is testable without a database: a refusal
 * whose text nobody checks drifts into "an error occurred", and this one is the
 * only thing standing between an operator and an unexplained crash-loop.
 */
export function formatDestructiveDriftRefusal(
    destructive: ManagedDriftEntry[],
    artifactDisplay: string,
): string {
    return [
        chalk.red(`  ✗ Refusing to boot — ${destructive.length} destructive schema change(s) required.`),
        '',
        chalk.dim(`     Artifact: ${artifactDisplay}`),
        chalk.dim('     The artifact this runtime was told to boot needs changes that can destroy'),
        chalk.dim('     data (dropping a column or table, tightening a constraint). Safe changes'),
        chalk.dim('     were applied; these were NOT, and the boot stops rather than serving an'),
        chalk.dim('     app whose schema silently disagrees with its metadata.'),
        '',
        ...destructive.map((d) => chalk.yellow(describeEntry(d))),
        '',
        chalk.dim('     Resolve deliberately, with a backup taken first:'),
        chalk.dim('       os migrate plan                          # review'),
        chalk.dim('       os migrate apply --allow-destructive     # apply'),
        '',
        chalk.dim('     Then restart this runtime. A destructive change is never applied'),
        chalk.dim('     automatically at boot, and never skipped in silence.'),
    ].join('\n');
}

/**
 * Run the artifact-pinned boot's migration policy against a live SQL driver.
 *
 * Returns a verdict rather than throwing, so the caller owns how a refusal
 * travels (this one becomes a thrown boot failure; a test just reads it).
 */
export async function runArtifactBootMigrationGate(opts: {
    driver: SqlDriverLike | null;
    artifactDisplay: string;
    info?: (message: string) => void;
    warn?: (message: string) => void;
}): Promise<ArtifactBootMigrationVerdict> {
    const { driver, artifactDisplay } = opts;
    const info = opts.info ?? (() => {});
    const warn = opts.warn ?? (() => {});

    // No SQL driver (memory / mongo) — nothing issues managed DDL, so there is
    // no drift to classify and nothing for this policy to decide.
    if (!driver) return { ok: true, applied: [], skipped: [], destructive: [] };

    let drift: ManagedDriftEntry[];
    try {
        drift = await driver.detectManagedDrift();
    } catch (err: any) {
        // Refusing on an introspection failure would make an unrelated database
        // hiccup indistinguishable from a destructive change. Warn — loudly,
        // this is the one path where the gate did not run.
        warn(
            `  ⚠ Could not check the physical schema against the artifact `
            + `(${err?.message ?? err}). Boot continues; run 'os migrate plan' to verify.`,
        );
        return { ok: true, applied: [], skipped: [], destructive: [] };
    }

    const destructive = drift.filter((d) => d.category === 'destructive');
    const safe = drift.filter((d) => d.category !== 'destructive');

    let applied: ManagedDriftEntry[] = [];
    let skipped: ManagedDriftEntry[] = [];
    if (safe.length > 0) {
        const result = await driver.applyMigrationEntries(safe, { allowDestructive: false });
        applied = result.applied;
        skipped = result.skipped;
        for (const d of applied) {
            info(`  ↪ migrated ${d.op.type} on ${d.column ? `${d.table}.${d.column}` : d.table}`);
        }
        // A skip here is the driver declining (unsupported on this dialect), not
        // this gate's policy — say so rather than let it pass as applied.
        for (const d of skipped) {
            warn(`  ⚠ schema change not applied by the driver: ${describeEntry(d).trim()}`);
        }
    }

    if (destructive.length === 0) return { ok: true, applied, skipped, destructive };

    return {
        ok: false,
        applied,
        skipped,
        destructive,
        refusal: formatDestructiveDriftRefusal(destructive, artifactDisplay),
    };
}
