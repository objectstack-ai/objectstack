// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment half of the package upgrade plan (epic cloud#3652 Q3,
 * objectstack#30884): what only the running environment knows about an
 * upgrade from the installed version of a package to an incoming one.
 *
 * The comparison itself is `comparePackageVersions`
 * (`@objectstack/metadata-core`), pure and shared with `os diff`. This module
 * adds two readings of the data the installed version left behind:
 *
 * - **Rows in a touched column.** For every stored column the upgrade
 *   removes, renames (declared or suspected) or retypes, the rows that hold a
 *   value in it, and for every object it removes, the rows it holds. Upgrade
 *   schema sync is additive (`schema-drift.ts`): none of these columns is
 *   dropped or carried, so these are the rows a rename leaves behind and a
 *   type change keeps under a declaration of another type.
 * - **Rows a customer edited that the seed replay overwrites.** An upgrade
 *   replays every dataset of the incoming version. A dataset whose mode writes
 *   over a row it matches (`seedModeOverwritesMatchedRows`: `upsert`,
 *   `update`) puts the incoming values back over every row it matches. A row
 *   whose current value differs from the value the INSTALLED version seeded,
 *   in a column the replay writes with another value, is a customer's edit
 *   the replay erases. Counted for every such dataset the installed version
 *   also declares, changed or not: an unchanged `upsert` dataset overwrites
 *   the same edits.
 *
 * Read-only: every read is a `count` or a `find` with the system context, across
 * every organization (a package upgrade replaces the package for all of them).
 * A reading that fails is answered `null` and never taken for zero.
 *
 * The comparison of a seed value with a stored one follows the replay's own
 * (`SeedLoaderService.isNoOpReplay`, `@objectstack/metadata-protocol`): a
 * temporal column in its stored form and a seed blank in the form the write
 * door stores it, through the same `@objectstack/core` rules; a credential, a
 * file, a reference (resolved from a natural key on write) and an expression
 * (evaluated on each load) are never compared, so they count no row.
 */

import {
  blankAsNullColumns,
  blankStorageForm,
  resolveStackCollection,
  temporalComparandKind,
  temporalStorageForm,
  type BlankAsNullReach,
  type TemporalComparandKind,
} from '@objectstack/core';
import {
  comparePackageVersions,
  seedModeOverwritesMatchedRows,
  upgradePlanSeedDatasets,
  type PackageUpgradePlan,
  type PackageUpgradeSide,
} from '@objectstack/metadata-core';
import { FILE_REFERENCE_TYPES, isMaskedOnReadFieldType, isVirtualSearchField } from '@objectstack/spec/data';

/** Why a column is read: what the upgrade does to it. */
export type UpgradeColumnReason = 'removed' | 'renamed' | 'suspected_rename' | 'type_change';

/** Rows holding a value in one installed column the upgrade touches. */
export interface UpgradeColumnRows {
  object: string;
  /** The INSTALLED key: the column the rows are in. */
  field: string;
  reasons: UpgradeColumnReason[];
  /** Rows whose value is not null; `null` when the reading failed. */
  rows: number | null;
}

/** Rows of an object the upgrade removes. */
export interface UpgradeObjectRows {
  object: string;
  /** `null` when the reading failed. */
  rows: number | null;
}

/** One overwriting dataset the installed version also declares. */
export interface UpgradeSeedOverwrite {
  key: string;
  object: string;
  /** The incoming mode (the one the replay runs). */
  mode: string;
  /** Does the plan list the dataset as changed? */
  changed: boolean;
  /** Rows the replay matches by `externalId`; `null` when the reading failed. */
  matchedRows: number | null;
  /** Of those, rows a customer edited that the replay overwrites; `null` when the reading failed. */
  editedRows: number | null;
  /** The natural keys of the first edited rows ({@link EDITED_KEYS_SHOWN} at most). */
  editedKeys: string[];
}

export interface PackageUpgradeEnvironment {
  columns: UpgradeColumnRows[];
  removedObjects: UpgradeObjectRows[];
  seeds: UpgradeSeedOverwrite[];
}

/** The comparison and the environment's readings of it, as `planUpgrade` answers. */
export interface PackageUpgradePlanReading {
  plan: PackageUpgradePlan;
  environment: PackageUpgradeEnvironment;
}

/** The engine reads this module takes. `ObjectQL` satisfies it. */
export interface UpgradeEnvironmentEngine {
  count(object: string, query?: any, options?: any): Promise<number>;
  find(object: string, query?: any, options?: any): Promise<any[]>;
}

export interface PlanPackageUpgradeOptions {
  /** The object definition the environment serves now (the installed version's). */
  getObject?: (name: string) => unknown;
  /** Told once per failed reading. */
  warn?: (message: string, meta?: Record<string, unknown>) => void;
}

/** How many edited rows an answer names by key. */
export const EDITED_KEYS_SHOWN = 20;

const SYSTEM_READ = { context: { isSystem: true } } as const;
/** Columns a seed names by a natural key that the write resolves to an id. */
const REFERENCE_TYPES: ReadonlySet<string> = new Set(['lookup', 'master_detail', 'user']);

type Bag = Record<string, any>;
const isBag = (value: unknown): value is Bag => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One side as the comparison reads it: a multi-package artifact folded by the platform's one reader. */
function sideOf(artifact: unknown): PackageUpgradeSide {
  return { objects: resolveStackCollection(artifact, 'objects'), data: resolveStackCollection(artifact, 'data') };
}

/**
 * Compare the installed version of a package with the incoming one and read
 * the environment for what the comparison touches. Both artifacts are taken
 * as the registry reads them (a caller holding a published artifact converts
 * it forward first, as it does to register it).
 */
export async function planPackageUpgrade(
  engine: UpgradeEnvironmentEngine,
  installed: unknown,
  incoming: unknown,
  options: PlanPackageUpgradeOptions = {},
): Promise<PackageUpgradePlanReading> {
  const installedSide = sideOf(installed);
  const incomingSide = sideOf(incoming);
  const plan = comparePackageVersions(installedSide, incomingSide);
  const environment: PackageUpgradeEnvironment = {
    columns: await readTouchedColumns(engine, plan, options),
    removedObjects: [],
    seeds: await readSeedOverwrites(engine, plan, installedSide, incomingSide, options),
  };
  for (const object of plan.objects.removed) {
    environment.removedObjects.push({ object, rows: await reading(options, { object }, () => engine.count(object, {}, SYSTEM_READ)) });
  }
  return { plan, environment };
}

async function reading<T>(options: PlanPackageUpgradeOptions, meta: Record<string, unknown>, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    options.warn?.('[planUpgrade] a reading of the installed data failed; it is answered null, never zero', {
      ...meta,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readTouchedColumns(
  engine: UpgradeEnvironmentEngine,
  plan: PackageUpgradePlan,
  options: PlanPackageUpgradeOptions,
): Promise<UpgradeColumnRows[]> {
  const touched = new Map<string, UpgradeColumnRows>();
  const touch = (object: string, field: string, reason: UpgradeColumnReason) => {
    const id = `${object}\u0000${field}`;
    const entry = touched.get(id) ?? { object, field, reasons: [], rows: null };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    touched.set(id, entry);
  };
  // A removed computed field held no column: nothing to count.
  for (const f of plan.fields.removed) if (f.stored) touch(f.object, f.field, 'removed');
  for (const r of plan.declaredRenames) touch(r.object, r.from, 'renamed');
  for (const s of plan.suspectedRenames) touch(s.object, s.field, 'suspected_rename');
  for (const t of plan.typeChanges) {
    // Retyped from a computed field: the installed version stored nothing.
    if (t.category === 'safe') continue;
    touch(t.object, t.renamedFrom ?? t.field, 'type_change');
  }
  const out = [...touched.values()];
  for (const entry of out) {
    entry.rows = await reading(options, { object: entry.object, field: entry.field }, () =>
      engine.count(entry.object, { where: { [entry.field]: { $ne: null } } }, SYSTEM_READ));
  }
  return out;
}

// ── seeds ───────────────────────────────────────────────────────────────

interface Dataset {
  key: string;
  object: string;
  externalId: string | string[];
  mode: string;
  records: Bag[];
  createOnly: Set<string>;
}

/** One side's datasets, paired by the plan's own keys (`upgradePlanSeedDatasets`). */
function datasetsByKey(side: PackageUpgradeSide): Map<string, Dataset> {
  const out = new Map<string, Dataset>();
  for (const [key, read] of upgradePlanSeedDatasets(side)) {
    const keyFields = new Set(Array.isArray(read.externalId) ? read.externalId : [read.externalId]);
    // `applyOn: 'create'` takes a column out of every write to a matched row
    // (the loader's `createOnlySeedColumns`); a match-key column stays in.
    const createOnly = new Set<string>();
    if (isBag(read.raw.columns)) {
      for (const [column, policy] of Object.entries(read.raw.columns)) {
        if (isBag(policy) && policy.applyOn === 'create' && !keyFields.has(column)) createOnly.add(column);
      }
    }
    out.set(key, {
      key,
      object: read.object,
      externalId: read.externalId,
      mode: read.mode,
      records: Array.isArray(read.raw.records) ? read.raw.records.filter(isBag) : [],
      createOnly,
    });
  }
  return out;
}

/** The natural key of a record or row, `''` when a part is missing (the loader's `externalIdKey`). */
function naturalKey(record: Bag, externalId: string | string[]): string {
  const parts: string[] = [];
  for (const field of Array.isArray(externalId) ? externalId : [externalId]) {
    const value = record[field];
    if (value === undefined || value === null || value === '') return '';
    parts.push(String(value));
  }
  return parts.join('\u0000');
}

/** A seed value evaluated on each load (`cel\`…\``), whose value no stored one is compared with. */
function isExpressionValue(value: unknown): boolean {
  return isBag(value) && typeof value.dialect === 'string';
}

interface Comparands {
  temporal: Map<string, TemporalComparandKind>;
  blankAsNull: ReadonlyMap<string, BlankAsNullReach>;
  /** Columns never compared: computed, credential, file, reference. */
  skipped: Set<string>;
}

function comparandsOf(definition: unknown): Comparands {
  const object = isBag(definition) ? definition : undefined;
  const fields = isBag(object?.fields) ? object!.fields as Record<string, Bag | undefined> : {};
  const temporal = new Map<string, TemporalComparandKind>();
  const skipped = new Set<string>();
  for (const [name, def] of Object.entries(fields)) {
    const type = def?.type;
    const kind = temporalComparandKind(type);
    if (kind) temporal.set(name, kind);
    if (typeof type !== 'string') continue;
    if (
      isVirtualSearchField({ type } as Parameters<typeof isVirtualSearchField>[0])
      || isMaskedOnReadFieldType(type, object?.managedBy)
      || FILE_REFERENCE_TYPES.has(type)
      || REFERENCE_TYPES.has(type)
    ) skipped.add(name);
  }
  return { temporal, blankAsNull: blankAsNullColumns(object as Parameters<typeof blankAsNullColumns>[0]), skipped };
}

/** Would the replay's comparison call these the same stored value? (the loader's `seedValueEquals`) */
function sameStoredValue(seed: unknown, stored: unknown, kind: TemporalComparandKind | undefined): boolean {
  if (seed === stored) return true;
  if (seed == null || stored == null) return seed == null && stored == null;
  if (kind) {
    const form = temporalStorageForm(seed, kind);
    return typeof form === 'string' && form === temporalStorageForm(stored, kind);
  }
  if (typeof seed === 'boolean' || typeof stored === 'boolean') {
    const toNum = (v: unknown) => (typeof v === 'boolean' ? Number(v) : Number(String(v)));
    return toNum(seed) === toNum(stored);
  }
  if (seed instanceof Date || stored instanceof Date) {
    const toTime = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v)));
    const a = toTime(seed);
    const b = toTime(stored);
    return Number.isFinite(a) && Number.isFinite(b) && a === b;
  }
  if (typeof seed === 'object' || typeof stored === 'object') {
    try {
      return JSON.stringify(seed) === JSON.stringify(stored);
    } catch {
      return false;
    }
  }
  return String(seed) === String(stored);
}

/**
 * Is `row` a customer's edit the replay of `incoming` erases? Some column the
 * replay writes holds a value other than the one `installed` seeded, and the
 * replay writes another value still.
 */
function isOverwrittenEdit(row: Bag, installed: Bag, incoming: Bag, dataset: Dataset, comparands: Comparands): boolean {
  const keyFields = new Set(Array.isArray(dataset.externalId) ? dataset.externalId : [dataset.externalId]);
  for (const [column, value] of Object.entries(incoming)) {
    if (column === 'id' || keyFields.has(column) || dataset.createOnly.has(column) || comparands.skipped.has(column)) continue;
    if (!(column in installed)) continue;
    if (isExpressionValue(value) || isExpressionValue(installed[column])) continue;
    const kind = comparands.temporal.get(column);
    const reach = comparands.blankAsNull.get(column);
    const stored = row[column];
    const seededAsInstalled = sameStoredValue(blankStorageForm(installed[column], reach), stored, kind);
    const replayKeeps = sameStoredValue(blankStorageForm(value, reach), stored, kind);
    if (!seededAsInstalled && !replayKeeps) return true;
  }
  return false;
}

async function readSeedOverwrites(
  engine: UpgradeEnvironmentEngine,
  plan: PackageUpgradePlan,
  installedSide: PackageUpgradeSide,
  incomingSide: PackageUpgradeSide,
  options: PlanPackageUpgradeOptions,
): Promise<UpgradeSeedOverwrite[]> {
  const before = datasetsByKey(installedSide);
  const after = datasetsByKey(incomingSide);
  const changedKeys = new Set(plan.seeds.changed.map((d) => d.key));
  const out: UpgradeSeedOverwrite[] = [];
  for (const [key, dataset] of after) {
    const prior = before.get(key);
    if (!prior || !seedModeOverwritesMatchedRows(dataset.mode)) continue;
    const entry: UpgradeSeedOverwrite = {
      key, object: dataset.object, mode: dataset.mode, changed: changedKeys.has(key), matchedRows: null, editedRows: null, editedKeys: [],
    };
    out.push(entry);

    const installedByKey = new Map<string, Bag>();
    for (const record of prior.records) {
      const k = naturalKey(record, prior.externalId);
      if (k !== '') installedByKey.set(k, record);
    }
    const incomingByKey = new Map<string, Bag>();
    for (const record of dataset.records) {
      const k = naturalKey(record, dataset.externalId);
      if (k !== '') incomingByKey.set(k, record);
    }
    if (incomingByKey.size === 0) {
      entry.matchedRows = 0;
      entry.editedRows = 0;
      continue;
    }
    const first = Array.isArray(dataset.externalId) ? dataset.externalId[0] : dataset.externalId;
    const firstValues = [...new Set(dataset.records.map((r) => r[first]).filter((v) => v !== undefined && v !== null && v !== ''))];
    const rows = await reading(options, { object: dataset.object, dataset: key }, () =>
      engine.find(dataset.object, { where: { [first]: { $in: firstValues } } }, SYSTEM_READ));
    if (rows === null) continue;

    const comparands = comparandsOf(options.getObject?.(dataset.object));
    let matched = 0;
    let edited = 0;
    for (const row of rows) {
      if (!isBag(row)) continue;
      const k = naturalKey(row, dataset.externalId);
      const incomingRecord = incomingByKey.get(k);
      if (!incomingRecord) continue;
      matched++;
      const installedRecord = installedByKey.get(k);
      // A row the installed version did not seed has no seeded value to have been edited from.
      if (!installedRecord) continue;
      if (isOverwrittenEdit(row, installedRecord, incomingRecord, dataset, comparands)) {
        edited++;
        if (entry.editedKeys.length < EDITED_KEYS_SHOWN) entry.editedKeys.push(k.split('\u0000').join('+'));
      }
    }
    entry.matchedRows = matched;
    entry.editedRows = edited;
  }
  return out;
}
