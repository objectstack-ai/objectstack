// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which customization mark an item of a base's lists carries, and the
 * per-type numbers the All metadata directory draws (objectstack ADR-0146 D3,
 * "On top, one surface"). Pure, so the rules are pinned without a render; the
 * one component that draws a mark is `CustomizationMark.tsx`.
 *
 * ## The facts it reads, and only those
 *
 *  - The base's customization read (`GET /api/v1/packages/:id/customizations`,
 *    ADR-0146 D8 item 4): the overrides its paired `<base>.custom` package
 *    declares and the server serves, and the members that pair adds to the
 *    base's objects.
 *  - The `_packageId` a list row is served under. A served override is served
 *    as the base's item, under the base's id (ADR-0146 D8 item 2); an item of
 *    the pair that overrides nothing is served under the pair's id.
 *
 * ⛔ Nothing is computed from the documents: no diff against the base and no
 * `basedOn` verdict (ADR-0146 D2, D6). An item the read lists as an override
 * is "customized"; any other item of the pair is "added". A row of the base
 * the read does not list carries no mark.
 */

import { customizationBasePackageId, customizationPackageId } from '@objectstack/spec/kernel';
import type { PackageCustomizations } from './packageCustomizations-io.js';

/** The marks an item of a base's lists can carry. */
export type CustomizationMarkKind = 'customized' | 'added';

/** One list row, as the marks read it. */
export interface CustomizationMarkRow {
  type: string;
  name: string;
  /** The bundle member of a type identified by a pair (`email_template`'s locale). */
  member?: string | null;
  /** The package the row is served under (`_packageId`). */
  packageId?: string | null;
}

const overrideKey = (type: string, name: string, member: string | null | undefined) =>
  JSON.stringify([type, name, member ?? null]);

/** A base's read, indexed for the list's marks. */
export interface CustomizationMarkIndex {
  baseId: string;
  /** The base's paired `<base>.custom` id. */
  pairId: string;
  overrides: ReadonlySet<string>;
}

/**
 * Index a base's served read. `null` when the base derives no pair id (a
 * customization package itself, or an id the pair grammar refuses): such a
 * package has no customizations to mark.
 */
export function indexCustomizations(baseId: string, read: PackageCustomizations): CustomizationMarkIndex | null {
  const pair = customizationPackageId(baseId);
  if (!pair.ok) return null;
  return {
    baseId,
    pairId: pair.value,
    overrides: new Set(read.overrides.map((o) => overrideKey(o.type, o.name, o.member))),
  };
}

/**
 * The mark one row carries, or `null`:
 *  - "customized" — the read lists it as an override (type, name and, for a
 *    pair-identified type, its member), served under the base or the pair;
 *  - "added" — any other item served under the pair;
 *  - nothing — every other row, the base's own items among them.
 */
export function customizationMarkOf(
  row: CustomizationMarkRow,
  index: CustomizationMarkIndex,
): CustomizationMarkKind | null {
  const pkg = row.packageId ?? null;
  if (pkg !== index.baseId && pkg !== index.pairId) return null;
  if (index.overrides.has(overrideKey(row.type, row.name, row.member))) return 'customized';
  return pkg === index.pairId ? 'added' : null;
}

/**
 * The customization count each directory tile draws, by type: the read's
 * overrides of the type, and on `object` the read's extensions (members, not
 * objects — the read's own count). A type with none is absent.
 */
export function customizationCountsByType(read: PackageCustomizations): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of read.overrides) out[o.type] = (out[o.type] ?? 0) + 1;
  if (read.counts.extensions > 0) out.object = (out.object ?? 0) + read.counts.extensions;
  return out;
}

/** The base's total the directory header draws: the served overrides plus the served extensions. */
export function customizationTotal(read: PackageCustomizations): number {
  return read.counts.overrides + read.counts.extensions;
}

/**
 * The base a row of the cross-package leg is a customization of, or `null`:
 * the row is served under a paired `<base>.custom` id (`customizationBasePackageId`).
 */
export function customizationBaseOfRow(packageId: unknown): string | null {
  return customizationBasePackageId(packageId);
}
