// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The machine-readable-first change manifest, `spec-changes.json` (ADR-0087 D4).
 *
 * The Release workflow diffs the current `api-surface.json` against the
 * previously published one (reusing the ADR-0059 §3 gate artifact instead of
 * discarding it), then joins the conversion table (D2) and the migration set
 * (D3) into a single `{ from, to, added, converted, migrated, removed }` record.
 * Every downstream artifact is a projection of this: the generated upgrade
 * guide, and the P3 MCP `spec_changes` tool. Prose inverts from primary to
 * derived — a `rationale` anchor is the only prose, and it lives in the data.
 *
 * Per-major manifests **compose**: because the record is pure data, any tool can
 * fold a 10→11, 11→12, … series into a single 10→N view, so a cross-major
 * consumer gets one aggregate answer instead of N documents to reconcile.
 * {@link composeSpecChanges} is that fold, computed from the registries; the
 * `added`/`removed` arrays are supplied by the release-time api-surface diff.
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

/** The full `spec-changes.json` record for a `from → to` version pair. */
export const SpecChangesSchema = z
  .object({
    from: z.number().int().describe('The starting protocol major.'),
    to: z.number().int().describe('The target protocol major.'),
    added: z.array(SpecSurfaceAddSchema),
    converted: z.array(SpecConvertedSchema),
    migrated: z.array(SpecMigratedSchema),
    removed: z.array(SpecSurfaceRemoveSchema),
  })
  .describe('ADR-0087 D4 machine-readable change manifest for a protocol version pair.');

export type SpecSurfaceAdd = z.infer<typeof SpecSurfaceAddSchema>;
export type SpecSurfaceRemove = z.infer<typeof SpecSurfaceRemoveSchema>;
export type SpecConverted = z.infer<typeof SpecConvertedSchema>;
export type SpecMigrated = z.infer<typeof SpecMigratedSchema>;
export type SpecChanges = z.infer<typeof SpecChangesSchema>;

/** Release-time api-surface diff, supplied to {@link composeSpecChanges}. */
export interface SurfaceDiff {
  added?: SpecSurfaceAdd[];
  removed?: SpecSurfaceRemove[];
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
  };
}
