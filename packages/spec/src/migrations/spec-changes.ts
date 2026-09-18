// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The machine-readable-first change manifest, `spec-changes.json` (ADR-0087 D4).
 *
 * The Release workflow diffs the current api-surface snapshot against the
 * previously published one (reusing the ADR-0059 §3 gate artifact instead of
 * discarding it), then joins the conversion table (D2) and the migration set
 * (D3) into a single `{ from, to, added, converted, migrated, removed }` record.
 * Every downstream artifact is a projection of this: the generated upgrade
 * guide, and the P3 MCP `spec_changes` tool. Prose inverts from primary to
 * derived — a `rationale` anchor is the only prose, and it lives in the data.
 *
 * **Per-release section (`release`).** Per-major records answer "16 → 17"; the
 * launch-window convention ships breaking changes as MINORS, so that is the
 * wrong resolution for the consumer who actually has a question. The `release`
 * section answers `17.3.0 → 17.4.0` from the two published artifacts and is
 * written into the tarball at publish time only — see
 * {@link composeReleaseChanges} and `scripts/check-release-spec-changes.mjs`,
 * the gate that refuses to publish a release whose section disagrees with the
 * two tarballs.
 *
 * Per-major manifests **compose**: because the record is pure data, any tool can
 * fold a 10→11, 11→12, … series into a single 10→N view, so a cross-major
 * consumer gets one aggregate answer instead of N documents to reconcile.
 * {@link composeSpecChanges} is that fold, computed from the registries; the
 * `added`/`removed` arrays are supplied by the release-time api-surface diff.
 *
 * ⚠️ **Those two arrays are NOT at the record's `from` → `to` resolution**, and
 * that is what {@link SpecSurfaceScopeSchema} exists to say out loud: the diff
 * that fills them compares this artifact against the previously PUBLISHED one,
 * so they span one release, not the major range the record is keyed by. A record
 * whose arrays are non-empty carries `surfaceScope` naming that version pair,
 * and {@link surfaceScopeProblem} is what refuses one that does not.
 */

import { z } from 'zod';
import { CONVERSIONS_BY_MAJOR } from '../conversions/registry.js';
import { MIGRATIONS_BY_MAJOR } from './registry.js';

/** An export added to the public surface in this range (from the api-surface diff). */
export const SpecSurfaceAddSchema = z
  .object({
    surface: z.string().describe('The exported name, e.g. `applyConversions (function)`.'),
    since: z.number().int().describe('The protocol major that added it.'),
  })
  .describe('A newly added public export.');

/** An export removed from the public surface (from the api-surface diff). */
export const SpecSurfaceRemoveSchema = z
  .object({
    surface: z.string().describe('The removed export name.'),
    removedIn: z.number().int().describe('The protocol major that removed it.'),
    replacement: z.string().optional().describe('The canonical replacement, if any.'),
  })
  .describe('A removed public export.');

/**
 * The published-version pair a record's `added`/`removed` arrays were actually
 * diffed between (ADR-0087 D4).
 *
 * ## Why the arrays need this, and why a major on each entry was not enough
 *
 * `added`/`removed` are not registry-derived: they are supplied by a release-time
 * api-surface diff of the artifact being published against the previously
 * PUBLISHED one. That diff is **one release wide**. Under an aggregate record
 * keyed `from: 10, to: 17` the arrays therefore looked like the whole
 * major-boundary delta, while every entry carried only `since: 17` /
 * `removedIn: 17` — true of the entry (it did arrive in major 17) and false of
 * the array (major 17's earlier minors are not in it), with
 * `perMajor[16 → 17].added/removed` sitting at `0`/`0` beside it. A consumer had
 * no field to tell the two apart, which is the one thing a machine-readable
 * surface may not do.
 *
 * So the scope is declared once, on the record, rather than repeated on 400
 * entries — the same choice {@link SpecReleaseChangesSchema} already makes for
 * the same reason. Present means "these arrays span exactly this version pair";
 * absent means the record carries no export diff at all (the committed,
 * registry-only projection, and every `perMajor` record).
 *
 * ⛔ It is deliberately NOT enforced by {@link SpecChangesSchema}: a previously
 * published manifest carries unscoped arrays, and a schema that refused those
 * would narrow what an already-shipped artifact parses as. The producer
 * ({@link surfaceScopeProblem}, called by `scripts/build-spec-changes.ts`) and
 * the publish gate (`scripts/check-release-spec-changes.mjs`) are where it is
 * refused.
 */
export const SpecSurfaceScopeSchema = z
  .object({
    fromVersion: z
      .string()
      .describe('The previously published @objectstack/spec version the export diff started at.'),
    toVersion: z
      .string()
      .describe('The @objectstack/spec version this artifact ships — where every entry arrived or left.'),
  })
  .describe('The published-version pair an export-surface diff was computed between.');

/** A losslessly converted surface (from the D2 conversion table). */
export const SpecConvertedSchema = z
  .object({
    surface: z.string(),
    to: z.string().describe('The canonical shape it converts to.'),
    conversionId: z.string().describe('The D2 conversion id (also its graduated chain-step id).'),
    toMajor: z.number().int().describe('The major that introduced the canonical shape.'),
  })
  .describe('A lossless conversion applied at load (D2).');

/** A semantic (non-lossless) migration (from the D3 migration chain). */
export const SpecMigratedSchema = z
  .object({
    surface: z.string(),
    replacement: z.string(),
    migrationId: z.string().describe('The D3 semantic-migration id.'),
    toMajor: z.number().int(),
    rationale: z.string().describe('Why it is not losslessly convertible (the load-bearing prose).'),
  })
  .describe('A semantic migration requiring consumer judgment (D3).');

/**
 * One public export added or removed by a single RELEASE (ADR-0087 D4).
 *
 * Deliberately narrower than {@link SpecSurfaceAddSchema} / {@link
 * SpecSurfaceRemoveSchema}: those carry a protocol MAJOR (`since` /
 * `removedIn`), which is the only attribution the aggregate can honestly make.
 * Inside {@link SpecReleaseChangesSchema} the attribution is already exact and
 * lives on the section — every entry in `added` arrived in `toVersion` and
 * every entry in `removed` left in it — so repeating a major here would offer a
 * coarser number in the one place a finer one is known, which is the defect
 * this section exists to close. It stays an OBJECT rather than a bare string so
 * a later field (a replacement pointer) is an additive change.
 */
export const SpecReleaseSurfaceSchema = z
  .object({
    surface: z.string().describe('The exported name, e.g. `applyConversions (function)`.'),
  })
  .describe('A public export added or removed by one release.');

/**
 * The `release` section of `spec-changes.json` — the delta between the
 * previously published `@objectstack/spec` and the one this tarball ships, at
 * PACKAGE-VERSION resolution (ADR-0087 D4).
 *
 * Why it exists next to `aggregate`/`perMajor`: those are keyed to the protocol
 * major, while this repo's launch-window convention ships breaking changes in
 * MINORS. A consumer moving 17.3.0 → 17.4.0 therefore reads a manifest whose
 * finest question is "16 → 17", answered long ago, with `added`/`removed`
 * empty — which reads as "nothing changed" when 218 exports arrived and 51 left.
 *
 * It is generated at PUBLISH time only, never committed: it is a function of a
 * previously published tarball, so a committed copy could not stay
 * deterministic from the registries alone. The committed
 * `packages/spec/spec-changes.json` carries no `release` key at all, and
 * `check:spec-changes` keeps it that way.
 */
export const SpecReleaseChangesSchema = z
  .object({
    fromVersion: z.string().describe('The previously published @objectstack/spec version.'),
    toVersion: z.string().describe('The @objectstack/spec version this artifact ships.'),
    added: z.array(SpecReleaseSurfaceSchema).describe('Exports this release added.'),
    converted: z
      .array(SpecConvertedSchema)
      .describe('D2 conversions first registered in this release.'),
    migrated: z
      .array(SpecMigratedSchema)
      .describe('D3 semantic migrations first registered in this release.'),
    removed: z.array(SpecReleaseSurfaceSchema).describe('Exports this release removed.'),
  })
  .describe('ADR-0087 D4 per-release change manifest, at package-version resolution.');

/** The full `spec-changes.json` record for a `from → to` version pair. */
export const SpecChangesSchema = z
  .object({
    from: z.number().int().describe('The starting protocol major.'),
    to: z.number().int().describe('The target protocol major.'),
    added: z.array(SpecSurfaceAddSchema),
    converted: z.array(SpecConvertedSchema),
    migrated: z.array(SpecMigratedSchema),
    removed: z.array(SpecSurfaceRemoveSchema),
    surfaceScope: SpecSurfaceScopeSchema.optional().describe(
      'The published-version pair `added`/`removed` were diffed between. Absent exactly when ' +
        'this record carries no export diff — ⛔ `added`/`removed` are then empty and say nothing ' +
        'about the `from` → `to` range, and a non-empty array without this key is refused at publish.',
    ),
  })
  .describe('ADR-0087 D4 machine-readable change manifest for a protocol version pair.');

export type SpecSurfaceAdd = z.infer<typeof SpecSurfaceAddSchema>;
export type SpecSurfaceRemove = z.infer<typeof SpecSurfaceRemoveSchema>;
export type SpecConverted = z.infer<typeof SpecConvertedSchema>;
export type SpecMigrated = z.infer<typeof SpecMigratedSchema>;
export type SpecChanges = z.infer<typeof SpecChangesSchema>;
export type SpecSurfaceScope = z.infer<typeof SpecSurfaceScopeSchema>;
export type SpecReleaseSurface = z.infer<typeof SpecReleaseSurfaceSchema>;
export type SpecReleaseChanges = z.infer<typeof SpecReleaseChangesSchema>;

/** Release-time api-surface diff, supplied to {@link composeSpecChanges}. */
export interface SurfaceDiff {
  added?: SpecSurfaceAdd[];
  removed?: SpecSurfaceRemove[];
  /** The published-version pair `added`/`removed` were diffed between. */
  scope?: SpecSurfaceScope;
}

/**
 * Why a record's `added`/`removed` arrays cannot be published as they stand, or
 * `null` when they can.
 *
 * The one refusable shape is a non-empty export diff with no
 * {@link SpecSurfaceScopeSchema}: the arrays then sit under a MAJOR-keyed
 * `from` → `to` record carrying no statement of the range they really cover, so
 * a consumer reads one release's slice as the whole major-boundary delta. This
 * is a producer-side and publish-side assertion on purpose — see
 * {@link SpecSurfaceScopeSchema} for why {@link SpecChangesSchema} does not
 * refuse it.
 */
export function surfaceScopeProblem(record: SpecChanges): string | null {
  const entries = record.added.length + record.removed.length;
  if (entries === 0 || record.surfaceScope) return null;
  return (
    `the ${record.from} → ${record.to} record carries ${record.added.length} added and ` +
    `${record.removed.length} removed export(s) with no \`surfaceScope\`. Those arrays come from a ` +
    'ONE-RELEASE api-surface diff, so without the version pair they read as the whole ' +
    `${record.from} → ${record.to} delta — which they are not.`
  );
}

/**
 * Fold the conversion table (D2) and migration chain (D3) across every major in
 * `(fromMajor, toMajor]` into a single {@link SpecChanges} record, joined with
 * the release-time api-surface diff. Pure — derived entirely from the registries
 * plus the supplied `surfaceDiff`.
 */
export function composeSpecChanges(
  fromMajor: number,
  toMajor: number,
  surfaceDiff: SurfaceDiff = {},
): SpecChanges {
  const converted: SpecConverted[] = [];
  const migrated: SpecMigrated[] = [];

  for (let major = fromMajor + 1; major <= toMajor; major++) {
    for (const conversion of CONVERSIONS_BY_MAJOR[major] ?? []) {
      converted.push({
        surface: conversion.surface,
        to: conversion.summary,
        conversionId: conversion.id,
        toMajor: conversion.toMajor,
      });
    }
    const step = MIGRATIONS_BY_MAJOR[major];
    for (const semantic of step?.semantic ?? []) {
      migrated.push({
        surface: semantic.surface,
        replacement: semantic.replacement,
        migrationId: semantic.id,
        toMajor: major,
        rationale: semantic.reason,
      });
    }
  }

  return {
    from: fromMajor,
    to: toMajor,
    added: surfaceDiff.added ?? [],
    converted,
    migrated,
    removed: surfaceDiff.removed ?? [],
    // Spread, never `scope: undefined`: a record with no export diff must carry
    // no key at all, so the committed registry-only projection and every
    // `perMajor` record serialise exactly as they did before this field existed.
    ...(surfaceDiff.scope ? { surfaceScope: surfaceDiff.scope } : {}),
  };
}

/**
 * What the PREVIOUSLY published release already carried, read from its own
 * `spec-changes.json`. Ids only: the delta below is an id-set difference, and
 * reading anything else out of an immutable artifact would make this fold
 * depend on a shape we can no longer fix.
 */
export interface PreviousReleaseRegistries {
  conversionIds: readonly string[];
  migrationIds: readonly string[];
}

/** The release-time export-surface diff, already flattened to `entry: name` rows. */
export interface ReleaseSurfaceDiff {
  added: readonly string[];
  removed: readonly string[];
}

/**
 * Fold one release's delta into a {@link SpecReleaseChanges} record.
 *
 * Pure: `current` is this tree's aggregate projection, `previous` is the id set
 * the last published tarball carried, and `surfaceDiff` is the export diff of
 * the two artifacts. `converted`/`migrated` are the entries that are NEW in
 * this release — an id present now and absent then.
 *
 * ⚠️ An id that disappeared between the two releases (a conversion withdrawn
 * from the registry) is deliberately NOT reported here: ADR-0087 D4 names four
 * arrays and this record carries exactly those four. A withdrawal is visible by
 * comparing two published manifests, and nothing in this section claims
 * otherwise.
 */
export function composeReleaseChanges(
  fromVersion: string,
  toVersion: string,
  current: SpecChanges,
  previous: PreviousReleaseRegistries,
  surfaceDiff: ReleaseSurfaceDiff,
): SpecReleaseChanges {
  const priorConversions = new Set(previous.conversionIds);
  const priorMigrations = new Set(previous.migrationIds);
  return {
    fromVersion,
    toVersion,
    added: [...surfaceDiff.added].sort().map((surface) => ({ surface })),
    converted: current.converted.filter((c) => !priorConversions.has(c.conversionId)),
    migrated: current.migrated.filter((m) => !priorMigrations.has(m.migrationId)),
    removed: [...surfaceDiff.removed].sort().map((surface) => ({ surface })),
  };
}
