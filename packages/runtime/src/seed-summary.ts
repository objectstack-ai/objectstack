// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot-time seed outcome accumulator (#3415, extended #3430).
 *
 * SeedLoader's own result logs sit under the default `warn` level, so `os dev`
 * shows NOTHING about how seeding actually went — a fixture can silently lose
 * most of its rows, a marketplace package can rehydrate onto a fresh DB with
 * zero rows, and a partial row-level failure leaves no signal at all. (Seeds
 * also run inside the CLI's boot-quiet window, which hid them at every level
 * until framework#4012; the level gate is what still hides them.)
 *
 * Every seeding producer (AppPlugin's inline config-app seed, the
 * marketplace rehydrate/heal path) records a per-source outcome on the
 * kernel's `seed-summary` service via {@link recordSeedOutcome}; the CLI
 * reads it once after `runtime.start()` and prints a `Seeds:` line in the
 * ready banner that is immune to the log level. This module is the ONE
 * writer contract so those producers can't drift into separate shapes.
 */

/** One seed source's contribution to the boot summary. */
export interface SeedSourceOutcome {
    /** Display label — the config app id / marketplace manifest id that seeded. */
    source: string;
    /** True when the source is a marketplace package (vs a config-declared app). */
    marketplace?: boolean;
    /** Rows inserted this boot. */
    inserted: number;
    /** Rows updated this boot. */
    updated: number;
    /** Rows already present (upsert no-op). */
    skipped: number;
    /** Rows dropped by validation/reference errors — the silent-loss case. */
    rejected: number;
    /**
     * Reference FIELDS dropped from rows that were still written — "wrote the
     * row, lost the link" (framework#3932). A distinct loss from `rejected`:
     * the row is there, so a row count looks healthy while an association is
     * silently missing. Surfaced separately so the banner can say so.
     */
    droppedRefs?: number;
    /**
     * The rows were (re)seeded onto a fresh/empty database during rehydrate —
     * the "swap the DB out from under an installed package" self-heal. Surfaced
     * so that event is observable instead of confirmable only by querying the DB.
     */
    healed?: boolean;
    /**
     * A marketplace package rehydrated with seed datasets declared, yet every
     * seeded object came up empty (the heal ran and landed no rows, or could
     * not run). The "installed but 0 rows" state — must never pass silently.
     */
    emptyInstall?: boolean;
}

/**
 * Append (or merge) a per-source seed outcome onto the kernel's `seed-summary`
 * service. Best-effort: never throws, so a banner-only concern can't break boot.
 *
 * The kernel's `registerService` throws on a duplicate name, and `getService`
 * returns the SAME array reference, so we mutate the stored list in place and
 * only register the first time. Entries are keyed by (source, marketplace) so a
 * producer that runs twice accumulates rather than duplicating a row.
 */
export function recordSeedOutcome(ctx: unknown, outcome: SeedSourceOutcome): void {
    try {
        const c = ctx as {
            kernel?: { getService?: (n: string) => unknown; registerService?: (n: string, v: unknown) => unknown };
            getService?: (n: string) => unknown;
            registerService?: (n: string, v: unknown) => unknown;
        };
        const kernel = c?.kernel;

        const readSummary = (): unknown => {
            // Prefer the plugin context's own resolver; fall back to a raw kernel.
            // Both throw when the service is unregistered — swallow and treat as absent.
            if (typeof c?.getService === 'function') {
                try { return c.getService('seed-summary'); } catch { /* not registered */ }
            }
            if (typeof kernel?.getService === 'function') {
                try { return kernel.getService('seed-summary'); } catch { /* not registered */ }
            }
            return undefined;
        };

        const register = (value: unknown): void => {
            if (typeof kernel?.registerService === 'function') { kernel.registerService('seed-summary', value); return; }
            if (typeof c?.registerService === 'function') { c.registerService('seed-summary', value); }
        };

        const current = readSummary();
        const list: SeedSourceOutcome[] = Array.isArray(current) ? (current as SeedSourceOutcome[]) : [];

        const existing = list.find(
            (e) => e.source === outcome.source && Boolean(e.marketplace) === Boolean(outcome.marketplace),
        );
        if (existing) {
            existing.inserted += outcome.inserted;
            existing.updated += outcome.updated;
            existing.skipped += outcome.skipped;
            existing.rejected += outcome.rejected;
            existing.droppedRefs = (existing.droppedRefs ?? 0) + (outcome.droppedRefs ?? 0);
            existing.healed = existing.healed || outcome.healed;
            existing.emptyInstall = existing.emptyInstall || outcome.emptyInstall;
        } else {
            list.push({ ...outcome });
        }

        // getService returns the live reference we just mutated, so an existing
        // summary is already up to date — only a brand-new list needs registering.
        if (!Array.isArray(current)) register(list);
    } catch {
        /* banner summary is best-effort — never break boot */
    }
}
