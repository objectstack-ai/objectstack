// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30626] The columns an `os migrate` value walk cannot read because the
 * package that adds them is disabled.
 *
 * The value walks scope by `engine.getObject(object)`, the SERVED fold. While a
 * package is disabled, the fields its `objectExtensions` add are withheld from
 * that fold (#30304) and `engine.find` refuses them (`INVALID_FIELD`), but their
 * columns and the values in them are kept: the STORAGE fold
 * (`SchemaRegistry.getStorageObject`) still has them. A run therefore skips
 * those columns, and without this list its report read as covering them.
 *
 * Named, not read: reading them needs a storage-fold read path in the engine
 * (#30626, out of scope). The operator enables the package and re-runs.
 */

/** One column a run did not read, and the disabled package that adds it. */
export interface WithheldColumn {
  object: string;
  field: string;
  /** The disabled package whose `objectExtensions` entry adds the field. */
  packageId: string;
}

/** The registry surface the list is read from (`SchemaRegistry`). */
export interface WithheldColumnsRegistry {
  getStorageObject?(name: string): unknown;
  getObjectContributors?(name: string): ReadonlyArray<{
    packageId?: string;
    ownership: string;
    definition?: { fields?: Record<string, unknown> };
  }>;
  isPackageDisabled?(packageId?: string): boolean;
}

export interface WithheldColumnsEngine {
  getObject(name: string): unknown;
  getConfigs?(): Record<string, unknown>;
  registry?: WithheldColumnsRegistry;
}

/**
 * The columns of `objects` (default: every loaded object) that a walk scoped
 * by `select` would cover on the storage fold but does not see on the served
 * fold, each with the disabled package that adds it. `select` is the walk's
 * own column rule, so a column the walk would not cover anyway is not named;
 * without it, every withheld field is.
 */
export function withheldColumns(
  engine: WithheldColumnsEngine,
  objects?: readonly string[],
  select?: (schema: unknown) => ReadonlyArray<{ name: string }>,
): WithheldColumn[] {
  const registry = engine.registry;
  if (
    typeof registry?.getStorageObject !== 'function'
    || typeof registry.getObjectContributors !== 'function'
    || typeof registry.isPackageDisabled !== 'function'
  ) return [];
  const names = (schema: unknown): string[] => select
    ? select(schema).map((c) => c.name)
    : Object.keys((schema as { fields?: Record<string, unknown> } | undefined)?.fields ?? {});
  const candidates = objects ?? (typeof engine.getConfigs === 'function' ? Object.keys(engine.getConfigs()) : []);

  const out: WithheldColumn[] = [];
  for (const object of candidates) {
    const disabled = registry.getObjectContributors(object)
      .filter((c) => c.ownership === 'extend' && registry.isPackageDisabled!(c.packageId));
    if (disabled.length === 0) continue;
    const served = new Set(names(engine.getObject(object)));
    for (const field of names(registry.getStorageObject(object))) {
      if (served.has(field)) continue;
      const by = disabled.find((c) => c.definition?.fields && Object.hasOwn(c.definition.fields, field));
      if (by?.packageId) out.push({ object, field, packageId: by.packageId });
    }
  }
  return out.sort((a, b) => a.object.localeCompare(b.object) || a.field.localeCompare(b.field));
}

/** The report lines naming them; none when the list is empty. */
export function formatWithheldColumns(columns: readonly WithheldColumn[]): string[] {
  if (columns.length === 0) return [];
  return [
    `⚠ ${columns.length} column(s) not read: the package that adds each is disabled. ` +
      'Enable the package and re-run to cover them:',
    ...columns.map((c) => `  • ${c.object}.${c.field} (package ${c.packageId})`),
  ];
}
