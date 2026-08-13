// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Boot-time migration policy for the artifact-pinned boot (#8368, acceptance #5).
 *
 * The criterion has three clauses and each one is a different way of being
 * wrong, so each is asserted separately:
 *
 *   1. safe migrations RUN at boot — a gate that only refuses would satisfy a
 *      "does it refuse?" test while quietly leaving every loosening change
 *      unapplied, which is the state `os migrate` exists to avoid;
 *   2. a destructive change REFUSES the boot — with the changes named, because
 *      a refusal an operator cannot act on is a crash loop with extra steps;
 *   3. nothing is skipped in SILENCE — the driver declining a change is
 *      reported as its own event, not folded into "applied".
 *
 * The `needs_confirm` case is pinned deliberately: it is the boundary this gate
 * must not redraw. `os migrate apply` applies it without `--allow-destructive`
 * (`category !== 'destructive' || allowDestructive`), so a gate that refused on
 * it would be inventing a second, stricter opinion about which changes are
 * dangerous — and two opinions is how one of them ends up wrong.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ManagedDriftEntry } from '@objectstack/driver-sql';
import type { SqlDriverLike } from './schema-migrate.js';
import {
    formatDestructiveDriftRefusal,
    runArtifactBootMigrationGate,
} from './artifact-boot-migration.js';

const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

const ARTIFACT = 'https://artifacts.example.com/hotcrm-2.2.2.json';

function entry(
    category: ManagedDriftEntry['category'],
    over: Partial<ManagedDriftEntry> = {},
): ManagedDriftEntry {
    return {
        kind: 'missing_column',
        severity: category === 'destructive' ? 'error' : 'warning',
        table: 'crm_lead',
        column: 'legacy_score',
        category,
        op: { type: 'add_column', table: 'crm_lead', column: 'legacy_score' } as any,
        message: `${category} change on crm_lead.legacy_score`,
        ...over,
    };
}

/** A driver that reports `drift` and records what it was asked to apply. */
function fakeDriver(drift: ManagedDriftEntry[], opts: { skip?: ManagedDriftEntry[] } = {}) {
    const applyCalls: Array<{ entries: ManagedDriftEntry[]; allowDestructive?: boolean }> = [];
    const driver: SqlDriverLike = {
        detectManagedDrift: vi.fn(async () => drift),
        applyMigrationEntries: vi.fn(async (
            entries: ManagedDriftEntry[],
            o: { allowDestructive?: boolean },
        ) => {
            applyCalls.push({ entries, allowDestructive: o.allowDestructive });
            const skipped = opts.skip ?? [];
            const skippedSet = new Set<ManagedDriftEntry>(skipped);
            return { applied: entries.filter((e) => !skippedSet.has(e)), skipped };
        }),
    };
    return { driver, applyCalls };
}

describe('runArtifactBootMigrationGate — safe changes run', () => {
    it('applies safe drift at boot and reports each one', async () => {
        const safe = entry('safe');
        const { driver, applyCalls } = fakeDriver([safe]);
        const info: string[] = [];

        const verdict = await runArtifactBootMigrationGate({
            driver, artifactDisplay: ARTIFACT, info: (m) => info.push(m),
        });

        expect(verdict.ok).toBe(true);
        expect(verdict.applied).toEqual([safe]);
        // Applied, not merely detected: the driver was really called, and it
        // was called WITHOUT the destructive licence.
        expect(applyCalls).toHaveLength(1);
        expect(applyCalls[0]!.allowDestructive).toBe(false);
        expect(info.join('\n')).toContain('crm_lead.legacy_score');
    });

    it('applies needs_confirm alongside safe — the same boundary os migrate apply draws', async () => {
        const needsConfirm = entry('needs_confirm');
        const { driver, applyCalls } = fakeDriver([needsConfirm]);

        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });

        expect(verdict.ok).toBe(true);
        expect(applyCalls[0]!.entries).toEqual([needsConfirm]);
    });

    it('does nothing, and refuses nothing, when the schema is already in sync', async () => {
        const { driver, applyCalls } = fakeDriver([]);
        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });
        expect(verdict).toMatchObject({ ok: true, applied: [], destructive: [] });
        expect(applyCalls).toHaveLength(0);
    });
});

describe('runArtifactBootMigrationGate — destructive changes refuse the boot', () => {
    it('refuses, and names every destructive change plus the resolving command', async () => {
        const destructive = entry('destructive', {
            column: 'old_stage',
            message: 'crm_lead.old_stage is orphaned — "os migrate apply --allow-destructive" to drop it.',
        });
        const { driver } = fakeDriver([destructive]);

        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });

        expect(verdict.ok).toBe(false);
        expect(verdict.destructive).toEqual([destructive]);
        const refusal = plain(verdict.refusal!);
        expect(refusal).toContain('Refusing to boot');
        expect(refusal).toContain('crm_lead.old_stage');
        expect(refusal).toContain('os migrate apply --allow-destructive');
        // The artifact is named: on this boot path the operator's next question
        // is "which artifact asked for this?", and the answer is not in the cwd.
        expect(refusal).toContain(ARTIFACT);
    });

    it('still applies the safe half before refusing — never all-or-nothing', async () => {
        const safe = entry('safe');
        const destructive = entry('destructive', { column: 'old_stage' });
        const { driver, applyCalls } = fakeDriver([safe, destructive]);

        const verdict = await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });

        expect(verdict.ok).toBe(false);
        expect(verdict.applied).toEqual([safe]);
        // The destructive entry was never handed to the driver at all.
        expect(applyCalls[0]!.entries).toEqual([safe]);
        expect(applyCalls[0]!.entries).not.toContain(destructive);
    });

    it('never applies a destructive change on its own authority', async () => {
        const destructive = entry('destructive');
        const { driver, applyCalls } = fakeDriver([destructive]);
        await runArtifactBootMigrationGate({ driver, artifactDisplay: ARTIFACT });
        // Nothing safe to apply ⇒ the driver is not called at all, and it is
        // certainly never called with allowDestructive.
        expect(applyCalls.every((c) => c.allowDestructive !== true)).toBe(true);
    });
});

describe('runArtifactBootMigrationGate — nothing is skipped in silence', () => {
    it('warns when the DRIVER declines a change the gate asked for', async () => {
        const safe = entry('safe');
        const { driver } = fakeDriver([safe], { skip: [safe] });
        const warnings: string[] = [];

        const verdict = await runArtifactBootMigrationGate({
            driver, artifactDisplay: ARTIFACT, warn: (m) => warnings.push(m),
        });

        // Boot continues (an unsupported dialect operation is not a destructive
        // change) but the skip is an event, not a silence — and it is NOT
        // reported as applied.
        expect(verdict.ok).toBe(true);
        expect(verdict.applied).toEqual([]);
        expect(verdict.skipped).toEqual([safe]);
        expect(warnings.join('\n')).toContain('not applied by the driver');
    });

    it('warns and continues when drift detection itself fails', async () => {
        const driver: SqlDriverLike = {
            detectManagedDrift: vi.fn(async () => { throw new Error('table introspection exploded'); }),
            applyMigrationEntries: vi.fn(async () => ({ applied: [], skipped: [] })),
        };
        const warnings: string[] = [];

        const verdict = await runArtifactBootMigrationGate({
            driver, artifactDisplay: ARTIFACT, warn: (m) => warnings.push(m),
        });

        // Refusing here would make an unrelated database hiccup look identical
        // to a destructive change — the operator would go hunting for a schema
        // problem that does not exist.
        expect(verdict.ok).toBe(true);
        expect(warnings.join('\n')).toContain('table introspection exploded');
        expect(warnings.join('\n')).toContain('os migrate plan');
    });

    it('passes when there is no SQL driver — nothing issues managed DDL', async () => {
        const verdict = await runArtifactBootMigrationGate({ driver: null, artifactDisplay: ARTIFACT });
        expect(verdict).toMatchObject({ ok: true, applied: [], destructive: [] });
    });
});

describe('formatDestructiveDriftRefusal', () => {
    it('renders a table-scoped entry without a phantom column', async () => {
        const text = plain(formatDestructiveDriftRefusal(
            [entry('destructive', { column: undefined, table: 'crm_archive', message: 'table is orphaned' })],
            ARTIFACT,
        ));
        expect(text).toContain('crm_archive — table is orphaned');
        expect(text).not.toContain('crm_archive.undefined');
    });

    it('counts the changes and prescribes the review step before the apply step', () => {
        const text = plain(formatDestructiveDriftRefusal(
            [entry('destructive', { column: 'a' }), entry('destructive', { column: 'b' })],
            ARTIFACT,
        ));
        expect(text).toContain('2 destructive schema change(s)');
        expect(text.indexOf('os migrate plan')).toBeLessThan(text.indexOf('os migrate apply --allow-destructive'));
        expect(text).toContain('never skipped in silence');
    });
});
