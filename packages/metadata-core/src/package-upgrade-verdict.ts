// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The schema upgrade verdict: which findings of a package upgrade plan stop a
 * managed upgrade until the installer confirms them, and the token of that
 * finding set (epic cloud#3652, ruling Q3 「默认拒绝，需显式映射（推荐）」).
 *
 * ## Why it lives here
 *
 * The comparison ({@link comparePackageVersions}) decides nothing; this module
 * is the one rule an install door applies to its plan. Two doors apply it: the
 * install-local door (`@objectstack/cloud-connection`) and a host's install
 * door — the hosted control plane installing a version into an environment
 * from the two stored versions. The rule and the token are one, so the same
 * pair of versions is refused with the same findings and the same token
 * whichever door installs it, and a host forwards the platform's verdict
 * instead of keeping a second reading of it.
 *
 * Pure: a plan in, a verdict out. It reads no registry, no database and no
 * ledger, so whether an upgrade is refused is decided by the two package
 * bodies, never by a reading that could fail (ruling record 6709061297, C3).
 * The door adds what only it knows: the rows behind each finding, its own
 * sentence, and where it records a confirmation.
 */

import { createHash } from 'node:crypto';
import type { PackageUpgradePlan, UpgradeDriftCategory } from './package-upgrade-plan.js';

/**
 * The refusal code of a managed upgrade whose plan carries a finding this
 * verdict lists (`error-code-ledger.zod.ts` declares it). 409, before any
 * write, until the same request carries the finding set's token. Its own code,
 * beside `ACCESS_UPGRADE_CONFIRMATION_REQUIRED`: its findings and its token are
 * its own, so neither confirmation answers the other's question.
 */
export const SCHEMA_UPGRADE_CONFIRMATION_REQUIRED = 'SCHEMA_UPGRADE_CONFIRMATION_REQUIRED';

/** The status the refusal answers with. */
export const SCHEMA_UPGRADE_CONFIRMATION_STATUS = 409;

/** The token's topic: a finding set token reads as what it confirms. */
export const SCHEMA_UPGRADE_TOPIC = 'schema-upgrade';

/**
 * The drift categories a type change must be confirmed under (ruling record
 * 6709061297, (ii)). A `safe` change — the installed field had no stored
 * column — loses nothing and is reported by a dry run, never refused.
 */
export const SCHEMA_UPGRADE_CONFIRMED_CATEGORIES: ReadonlySet<UpgradeDriftCategory> = new Set(['needs_confirm', 'destructive']);

/**
 * A finding a door adds when it has no installed side to compare: the
 * comparison did not run, which is never taken for "no finding". The door
 * writes the sentence (what it could not read is its own); the identity is
 * the kind, plus the unreadable record's name.
 */
export type SchemaUpgradeUnavailableFinding =
    | {
        /** The door's record of the installed version exists and would not parse. */
        kind: 'installed_record_unreadable';
        /** The record's name, as the door knows it (install-local: the ledger file's basename). */
        file: string;
        /** The reader's own words. */
        cause: string;
        describe: string;
    }
    | {
        /** The door holds no package body of the installed version. */
        kind: 'installed_record_missing';
        describe: string;
    };

/**
 * One finding of the schema upgrade verdict, as a refusal names it in
 * `details.findings`: what the comparison found and one readable sentence.
 * `rows` is the door's reading of the installed column (`null`: the reading
 * failed), added when it has one; the verdict never reads it.
 */
export type SchemaUpgradeFinding =
    | {
        kind: 'suspected_rename';
        object: string;
        /** The removed (installed) key. */
        field: string;
        type?: string;
        candidates: Array<{ field: string; type?: string }>;
        describe: string;
        rows?: number | null;
    }
    | {
        kind: 'type_change';
        object: string;
        /** The key in the incoming version. */
        field: string;
        from: string;
        to: string;
        category: UpgradeDriftCategory;
        /** Set when the change rides on a declared rename: the installed key. */
        renamedFrom?: string;
        describe: string;
        rows?: number | null;
    }
    | SchemaUpgradeUnavailableFinding;

/** The verdict: the findings that need the installer's confirmation, and their token. */
export interface SchemaUpgradeVerdict {
    findings: SchemaUpgradeFinding[];
    /** `schema-upgrade:` and 32 hex ({@link schemaUpgradeFindingSet}). */
    findingSet: string;
}

/**
 * The verdict of a plan.
 *
 * - A declared rename (`renamedFrom`) is no finding: the schema sync carries
 *   its column, or the door refuses the install before it asks this verdict.
 * - A suspected rename always needs confirming.
 * - A type change needs confirming when its category is `needs_confirm` or
 *   `destructive` — on a declared rename too: a declared rename never stands
 *   in for a type-change confirmation.
 * - Removed fields, removed objects, `safe` type changes and seed changes are
 *   reported by a dry run and refused by nothing.
 *
 * No finding means the upgrade proceeds unchanged. `packageId` is the
 * package's manifest id: it is in the token, so a token issued for one package
 * never confirms the same findings on another.
 */
export function schemaUpgradeVerdict(packageId: string, plan: PackageUpgradePlan): SchemaUpgradeVerdict {
    const findings: SchemaUpgradeFinding[] = [];
    for (const s of plan.suspectedRenames) {
        const candidates = s.candidates.map((c) => ({ field: c.field, ...(c.type !== undefined ? { type: c.type } : {}) }));
        const added = candidates.map((c) => `${s.object}.${c.field}${c.type ? ` (${c.type})` : ''}`).join(', ');
        findings.push({
            kind: 'suspected_rename',
            object: s.object,
            field: s.field,
            ...(s.type !== undefined ? { type: s.type } : {}),
            candidates,
            describe: `${s.object}.${s.field}${s.type ? ` (${s.type})` : ''} is removed while ${added} `
                + `${candidates.length === 1 ? 'is' : 'are'} added, and no \`renamedFrom\` links them: if this is a rename, `
                + 'the new field starts empty and the data stays in the old column, which nothing reads any more.',
        });
    }
    for (const t of plan.typeChanges) {
        if (!SCHEMA_UPGRADE_CONFIRMED_CATEGORIES.has(t.category)) continue;
        const what = t.category === 'destructive'
            ? 'the new type stores no column, so the values the existing column holds are no longer read'
            : 'the existing column keeps its type under the new declaration, and nothing converts the values it holds';
        findings.push({
            kind: 'type_change',
            object: t.object,
            field: t.field,
            from: t.from,
            to: t.to,
            category: t.category,
            ...(t.renamedFrom !== undefined ? { renamedFrom: t.renamedFrom } : {}),
            describe: `${t.object}.${t.field}${t.renamedFrom !== undefined ? ` (renamed from ${t.renamedFrom})` : ''} `
                + `changes type ${t.from} → ${t.to} (${t.category}): ${what}.`,
        });
    }
    return { findings, findingSet: schemaUpgradeFindingSet(packageId, findings) };
}

/**
 * The verdict when the door has no installed side to compare. The upgrade's
 * renames and type changes against the installed version cannot be known, and
 * a comparison that did not run is never taken for "no finding": the one
 * finding names what is missing, and its token admits the re-install —
 * confirmed and recorded, one round trip, never silently.
 */
export function installedRecordUnavailableVerdict(
    packageId: string,
    finding: SchemaUpgradeUnavailableFinding,
): SchemaUpgradeVerdict {
    return { findings: [finding], findingSet: schemaUpgradeFindingSet(packageId, [finding]) };
}

/**
 * The finding set's token: `schema-upgrade:` and 32 hex of a SHA-256 over the
 * package id and the findings' identities, string-sorted — never their
 * sentences or row counts. Order-free, so the same two versions always yield
 * the same token, and any change to the finding set yields another.
 */
export function schemaUpgradeFindingSet(packageId: string, findings: readonly SchemaUpgradeFinding[]): string {
    const identities = findings
        .map((f) => JSON.stringify(
            f.kind === 'suspected_rename'
                ? [f.kind, f.object, f.field, f.type ?? null, f.candidates.map((c) => [c.field, c.type ?? null]).sort()]
                : f.kind === 'type_change'
                    ? [f.kind, f.object, f.field, f.from, f.to, f.category, f.renamedFrom ?? null]
                    : f.kind === 'installed_record_unreadable'
                        ? [f.kind, f.file]
                        : [f.kind],
        ))
        .sort();
    const digest = createHash('sha256').update(JSON.stringify([packageId, identities])).digest('hex').slice(0, 32);
    return `${SCHEMA_UPGRADE_TOPIC}:${digest}`;
}
