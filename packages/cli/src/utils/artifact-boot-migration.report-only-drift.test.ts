// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#11728] The BOOT CONSEQUENCE of a report-only drift entry, driven through
 * the real gate (follow-up to #11535).
 *
 * ## What this pins, and why asserting the category would not do it
 *
 * #11535's detection half — the stale multi-value column, emitted by
 * `driver-sql` as `manual_column_type_change` — is a *loud* finding that is
 * deliberately NOT allowed to stop a deployment from serving. Every deployment
 * the finding exists to help is, by that card's own account, currently serving
 * with the stale column; a finding that refused their boot would take them all
 * down at once, at `kernel:ready`, BEFORE the socket opens.
 *
 * What makes that safe is one asymmetry, and it is the whole subject of this
 * file:
 *
 *   - `severity` is read by NO boot gate. The entry below carries
 *     `severity: 'error'` and still boots.
 *   - `category === 'destructive'` IS read, by `runArtifactBootMigrationGate`,
 *     and it refuses the boot. The control below carries the *lower* severity
 *     (`'warning'`) and is the one that refuses.
 *
 * So severity and boot consequence run in OPPOSITE directions here, which is
 * exactly why neither can be inferred from the other by reading the emitter.
 *
 * The sibling suite (`artifact-boot-migration.test.ts`) already pins the
 * gate's treatment of the `needs_confirm` CATEGORY, using an entry it builds
 * itself. That is a fact about the gate. It is not this fact: an entry
 * hand-stamped `category: 'needs_confirm'` still says `ok === true` on the day
 * `schema-drift.ts` starts emitting this op as `destructive`, because nothing
 * connects the two. So every entry here comes from the REAL emitter
 * (`diffManagedTable`) and is driven through the REAL gate. The day the
 * emitted category moves, this file goes red — which is the only day the pin
 * is worth anything.
 *
 * ## Why it lives in `packages/cli`
 *
 * The gate is here and the driver package must not acquire a dependency on the
 * CLI to reach it, so nothing in `packages/drivers/driver-sql` can observe this
 * consequence. The edge that makes the file possible runs the other way:
 * `@objectstack/cli` already depends on `@objectstack/driver-sql`, and already
 * imports its drift surface at run time from a test
 * (`commands/migrate/multi-value-columns.dialect-probe.test.ts`), so this adds
 * no new package edge and nothing to the shrink-only
 * `KNOWN_UNALIASED_TEST_IMPORTS` ledger.
 *
 * ⚠️ That import resolves through `@objectstack/driver-sql`'s `exports` to its
 * **dist**, not to its source — there is no `resolve.alias` entry for it in
 * this package's `vitest.config.ts`, deliberately. So these cases read the
 * BUILT driver: a stale `dist/` makes this file a verdict about build state.
 * The gate itself is imported relatively and is therefore read from source.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    diffManagedTable,
    type ManagedDriftEntry,
    type PhysicalColumn,
} from '@objectstack/driver-sql';
import type { SqlDriverLike } from './schema-migrate.js';
import { runArtifactBootMigrationGate } from './artifact-boot-migration.js';

const ARTIFACT = 'https://artifacts.example.com/hotcrm-2.2.2.json';
const TABLE = 'proj_task';

/**
 * One real `diffManagedTable` call producing BOTH entries this file needs, on
 * one table:
 *
 *   - `tags` — metadata declares a multi-value field, the column is the
 *     `varchar` an older single-value declaration created: #11535's stale
 *     column, emitted as `manual_column_type_change`;
 *   - `legacy_stage` — a physical column no metadata field claims: an orphan,
 *     emitted as `drop_column`.
 *
 * Both come from the same emitter on the same call, so no fixture here can
 * agree with the gate while disagreeing with the engine.
 */
const STALE_TAGS: PhysicalColumn = {
    name: 'tags',
    type: 'character varying',
    nullable: true,
    maxLength: 255,
};
const ORPHANED_COLUMN: PhysicalColumn = {
    name: 'legacy_stage',
    type: 'character varying',
    nullable: true,
    maxLength: 64,
};

function engineDrift(): ManagedDriftEntry[] {
    return diffManagedTable({
        table: TABLE,
        fields: { tags: { type: 'lookup', multiple: true } as any },
        columns: [STALE_TAGS, ORPHANED_COLUMN],
        dialect: 'postgres',
    });
}

/**
 * Non-vacuity, checked before anything is asserted about a boot: if the engine
 * stopped emitting either shape, every gate assertion below would pass against
 * an empty drift set and this file would report coverage it does not have.
 */
function realEntry(op: 'manual_column_type_change' | 'drop_column'): ManagedDriftEntry {
    const found = engineDrift().filter((d) => d.op.type === op);
    expect(found, `engine no longer emits ${op} for this fixture`).toHaveLength(1);
    return found[0]!;
}

/** Records what the gate handed the driver; applies whatever it is given. */
function fakeDriver(drift: ManagedDriftEntry[]) {
    const applyCalls: Array<{ entries: ManagedDriftEntry[]; allowDestructive?: boolean }> = [];
    const driver: SqlDriverLike = {
        detectManagedDrift: vi.fn(async () => drift),
        applyMigrationEntries: vi.fn(async (
            entries: ManagedDriftEntry[],
            o: { allowDestructive?: boolean },
        ) => {
            applyCalls.push({ entries, allowDestructive: o.allowDestructive });
            return { applied: entries, skipped: [] };
        }),
    };
    return { driver, applyCalls };
}

describe('#11535 stale-column drift does not refuse an artifact-pinned boot (#11728)', () => {
    it('a REAL manual_column_type_change entry boots — the gate is what says so, not its category', async () => {
        const stale = realEntry('manual_column_type_change');
        // The asymmetry, stated as a fact about the real entry rather than a
        // comment: this is the HIGHEST severity the vocabulary has, and it
        // boots anyway, because no boot gate reads the field.
        expect(stale.severity).toBe('error');

        const { driver } = fakeDriver([stale]);
        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });

        // The criterion of #11728. Every deployment #11535 exists to help is
        // serving with this exact drift; `ok === false` here is all of them
        // failing to come back up after a restart.
        expect(verdict.ok).toBe(true);
        expect(verdict.destructive).toEqual([]);
        expect(verdict.refusal).toBeUndefined();
    });

    // ⭐ THE CONTROL, and it is not optional. The case above passes just as
    // green against a gate that has stopped refusing ANYTHING — the false
    // green this family keeps producing — and a one-armed pin here would be
    // worse than none, because it would read as coverage. This case fails on
    // that gate, so the two together say "boots" rather than "nothing is
    // checked". Deliberately a real entry of the LOWER severity ('warning'):
    // it refuses while the 'error' above boots, which is the asymmetry itself.
    it('CONTROL: a REAL destructive entry still refuses the boot — proving the gate can refuse', async () => {
        const orphan = realEntry('drop_column');
        expect(orphan.severity).toBe('warning');

        const { driver } = fakeDriver([orphan]);
        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });

        expect(verdict.ok).toBe(false);
        expect(verdict.destructive).toEqual([orphan]);
    });

    it('with both present the refusal is the orphan ALONE — the stale column is never a cause', async () => {
        const drift = engineDrift();
        const stale = realEntry('manual_column_type_change');
        const { driver, applyCalls } = fakeDriver(drift);

        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });

        // A refused boot is expected here — but only the orphan may be named
        // in it. If the stale column ever joins that list, the refusal message
        // starts telling operators to run `--allow-destructive` over a column
        // whose remedy is a different command entirely.
        expect(verdict.ok).toBe(false);
        expect(verdict.destructive.map((d) => d.op.type)).toEqual(['drop_column']);
        // ...and it still travelled to the driver as ordinary work, rather
        // than being dropped on the floor by the refusal. (What the REAL
        // driver then does with it is `skip`, never `apply` — pinned on that
        // side in driver-sql; this fake applies everything, so the claim here
        // is only about what the GATE handed over.)
        expect(applyCalls).toHaveLength(1);
        expect(applyCalls[0]!.entries.map((d) => d.op.type)).toEqual(['manual_column_type_change']);
        expect(applyCalls[0]!.allowDestructive).toBe(false);
        expect(stale.op.type).toBe('manual_column_type_change');
    });
});
