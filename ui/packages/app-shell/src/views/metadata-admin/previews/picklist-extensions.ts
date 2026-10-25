// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The read side of the picklist page (objectui#10202), kept out of
 * `PicklistPreview.tsx` so that module exports components only.
 *
 * `GET /meta/picklist/NAME` serves the owning list only; the options other
 * packages add (`picklistExtensions`, `PicklistExtensionSchema`: `extend` +
 * `options`) are served on the package read instead, each in the manifest of
 * the package that declares it. {@link extensionsOf} reads them from there.
 */

/** One option as this page shows it: what the field offers, by label and value. */
export interface ShownOption {
  value: string;
  label: string;
}

/** One `picklistExtensions` entry that names this list, with its declaring package. */
export interface PicklistExtensionRow {
  packageId: string;
  packageName?: string;
  options: ShownOption[];
}

/** The option shape a list or an extension declares, read defensively (the draft is untrusted). */
export function shownOptions(raw: unknown): ShownOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o) => {
    if (!o || typeof o !== 'object') return [];
    const option = o as { value?: unknown; label?: unknown };
    if (option.value === undefined || option.value === null) return [];
    const value = String(option.value);
    return [{ value, label: typeof option.label === 'string' && option.label ? option.label : value }];
  });
}

/**
 * The `picklistExtensions` entries naming `picklist`, across every installed
 * package's manifest as `GET /meta/package` serves it.
 *
 * Exported for its pin: the row shape the package read serves is the input this
 * page depends on, so the pin feeds it the measured shape.
 */
export function extensionsOf(picklist: string, packages: readonly unknown[]): PicklistExtensionRow[] {
  const rows: PicklistExtensionRow[] = [];
  for (const raw of packages) {
    const row =
      raw && typeof raw === 'object' && 'item' in raw
        ? (raw as { item?: unknown }).item
        : raw;
    if (!row || typeof row !== 'object') continue;
    const manifest = ((row as { manifest?: unknown }).manifest ?? row) as Record<string, unknown>;
    const packageId = typeof manifest.id === 'string' ? manifest.id : undefined;
    if (!packageId || !Array.isArray(manifest.picklistExtensions)) continue;
    for (const ext of manifest.picklistExtensions) {
      if (!ext || typeof ext !== 'object') continue;
      const entry = ext as { extend?: unknown; options?: unknown };
      if (entry.extend !== picklist) continue;
      rows.push({
        packageId,
        packageName: typeof manifest.name === 'string' && manifest.name ? manifest.name : undefined,
        options: shownOptions(entry.options),
      });
    }
  }
  return rows;
}

