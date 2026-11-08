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
 * - **Overrides of the base, as advice** (ADR-0146 D2, as amended by decision
 *   D2 on cloud#3652). Each item of a base's paired `<base>.custom` package
 *   that the reads serve over a base item — the protocol's served-override
 *   list ({@link PlanPackageUpgradeOptions.listOverrides}), never a second
 *   predicate — is read against the two versions of the base: an override
 *   whose base item the upgrade changes is listed as hiding that change, and
 *   an override whose `basedOn` is not the installed base version is listed
 *   as stale. Both are an advisory class: the install door's schema refusal
 *   never reads them, no finding-set token covers them, and nothing is
 *   refused, merged or rebased on them; the upgrade proceeds as it would
 *   without them.
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
  stackPackageBodies,
  temporalComparandKind,
  temporalStorageForm,
  type BlankAsNullReach,
  type TemporalComparandKind,
} from '@objectstack/core';
import {
  canonicalize,
  comparePackageVersions,
  itemDiscriminator,
  seedModeOverwritesMatchedRows,
  upgradePlanSeedDatasets,
  type PackageUpgradePlan,
  type PackageUpgradeSide,
} from '@objectstack/metadata-core';
import { FILE_REFERENCE_TYPES, isMaskedOnReadFieldType, isVirtualSearchField } from '@objectstack/spec/data';
import { ASSEMBLED_VIEW_ITEMS_KEY, expandViewContainer, isAggregatedViewContainer } from '@objectstack/spec';
import { pluralToSingular } from '@objectstack/spec/shared';
import { METADATA_ARRAY_KEYS, resolveMetadataItemName } from './engine-top-level.js';

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

/** What the upgrade does to the base item an override is served over. */
export type UpgradeOverriddenItemChange = 'changed' | 'removed' | 'added';

/**
 * One served override of a base item, listed as advice (ADR-0146 D2, as
 * amended). Never a refusal and never covered by a confirmation token.
 */
export interface UpgradeOverrideFinding {
  /** The base package whose item the override is served over. */
  package: string;
  /** The overriding item's metadata type, canonical singular (`view`, `dashboard`). */
  type: string;
  /** The item's name: the base's name it is served under. */
  name: string;
  /** The bundle member, for a type whose identity is a pair (`email_template`); absent otherwise. */
  member?: string;
  /** `overrides.basedOn` exactly as the override records it; absent when it records none. */
  basedOn?: string;
  /** The installed base's `version`; `null` when the installed body declares none. */
  installedVersion: string | null;
  /** The incoming base's `version`; `null` when the incoming body declares none. */
  incomingVersion: string | null;
  /** What the upgrade does to the base's item (a hiding finding only). */
  change?: UpgradeOverriddenItemChange;
  /** The next step, in Studio. */
  next: string;
}

/** The advisory class of the plan: overrides of the upgraded base. */
export interface UpgradeOverrideAdvisories {
  /** Overrides whose base item differs between the installed and the incoming version. */
  hidesChange: UpgradeOverrideFinding[];
  /** Overrides whose `basedOn` is not the installed base version: stale before this upgrade. */
  stale: UpgradeOverrideFinding[];
}

export interface PackageUpgradeEnvironment {
  columns: UpgradeColumnRows[];
  removedObjects: UpgradeObjectRows[];
  seeds: UpgradeSeedOverwrite[];
  /**
   * The advisory class: overrides that hide a change of this upgrade, and
   * overrides already stale. `null` when the overrides were not read — no
   * override reader was given, or the reading failed — never an empty answer
   * for a reading that did not happen.
   */
  overrides: UpgradeOverrideAdvisories | null;
}

/** One served override, as the protocol's served-override list answers it. */
export interface UpgradeServedOverride {
  type: string;
  name: string;
  member?: string;
  basedOn?: string;
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
  /**
   * The served overrides of one base package's items: the protocol's
   * `listServedOverrides` (`@objectstack/metadata-protocol`), the one reading
   * of "which item of the pair is served over this base item". Absent ⇒ the
   * overrides are not read and the advisory class is `null`.
   */
  listOverrides?: (basePackageId: string) => Promise<readonly UpgradeServedOverride[]>;
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
    overrides: await readOverrideAdvisories(installed, incoming, options),
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

// ── overrides of the base, as advice ───────────────────────────────────

/**
 * The package bodies an artifact delivers, each with its own id: the bodies
 * of its `packages` list, or the artifact itself when it carries none (the
 * one-package shape). A body without an id is not a base anything overrides.
 */
function packageBodiesById(artifact: unknown): Map<string, Bag> {
  const bodies = stackPackageBodies(artifact);
  const out = new Map<string, Bag>();
  for (const body of bodies.length > 0 ? bodies : isBag(artifact) ? [artifact] : []) {
    if (typeof body.id === 'string' && body.id !== '' && !out.has(body.id)) out.set(body.id, body);
  }
  return out;
}

function versionOf(body: Bag | undefined): string | null {
  return typeof body?.version === 'string' && body.version !== '' ? body.version : null;
}

/** An item's identity as the served-override list names it: type, name and bundle member. */
function itemKey(type: string, name: string, member: string | undefined): string {
  return `${type}\u0000${name}\u0000${member ?? ''}`;
}

/**
 * The document an item is compared by: its body without the loader's stamps
 * (`_packageId`, `_packageVersion`, `_provenance`, the expansion's
 * `_diagnostics`), which name the version the item came with and would make
 * every item of an upgrade differ.
 */
function itemText(item: Bag): string {
  const body: Bag = {};
  for (const [key, value] of Object.entries(item)) if (!key.startsWith('_')) body[key] = value;
  try {
    return canonicalize(body);
  } catch {
    return JSON.stringify(body) ?? 'undefined';
  }
}

/**
 * Every item one package body ships, by the identity the registry keys it
 * by: the collections and the name the engine's own registration reads
 * (`METADATA_ARRAY_KEYS`, `resolveMetadataItemName`), an aggregated view
 * container both under its object and as the view items it expands to, and
 * the assembled `viewItems` channel.
 */
function packageItemTexts(body: Bag): Map<string, string> {
  const out = new Map<string, string>();
  const put = (type: string, name: string, item: Bag) => {
    const key = itemKey(type, name, itemDiscriminator(type, item));
    if (!out.has(key)) out.set(key, itemText(item));
  };
  for (const key of METADATA_ARRAY_KEYS) {
    if (key === 'picklistExtensions') continue;
    const items = body[key];
    if (!Array.isArray(items)) continue;
    const type = pluralToSingular(key);
    for (const item of items) {
      if (!isBag(item)) continue;
      const name = resolveMetadataItemName(key, item);
      if (typeof name !== 'string' || name === '') continue;
      put(type, name, item);
      if (key === 'views' && isAggregatedViewContainer(item)) {
        for (const view of expandViewContainer(name, item)) {
          if (isBag(view) && typeof view.name === 'string' && view.name !== '') put('view', view.name, view);
        }
      }
    }
  }
  const assembled = body[ASSEMBLED_VIEW_ITEMS_KEY];
  for (const item of Array.isArray(assembled) ? assembled : []) {
    if (!isBag(item)) continue;
    const name = resolveMetadataItemName('views', item);
    if (typeof name === 'string' && name !== '') put('view', name, item);
  }
  return out;
}

function nextStepHiding(override: UpgradeServedOverride, change: UpgradeOverriddenItemChange, incomingVersion: string | null): string {
  const item = `the ${override.type} '${override.name}'`;
  const target = incomingVersion ?? 'the new version';
  if (change === 'removed') {
    return `Open ${item} in Studio: the new version of the base no longer ships it, and the override keeps serving the name. `
      + 'Keep it as your own, or restore the package original (which deletes the override). The upgrade installs either way.';
  }
  return `Open ${item} in Studio and compare the override with the base's document in ${target}: re-base it (take the new `
    + `document and record basedOn ${target}), or restore the package original to serve the base's document. The upgrade `
    + 'installs either way; until then the override keeps hiding this change.';
}

function nextStepStale(override: UpgradeServedOverride, installedVersion: string): string {
  return `Open the ${override.type} '${override.name}' in Studio: it was taken from ${override.basedOn}, not from the installed `
    + `${installedVersion}. Compare it with the base's document and re-base it, or restore the package original.`;
}

/**
 * The advisory class: for each base package the installed artifact delivers,
 * its served overrides read against the installed and the incoming body.
 * `null` when no reader was given, or a reading failed (told once).
 */
async function readOverrideAdvisories(
  installed: unknown,
  incoming: unknown,
  options: PlanPackageUpgradeOptions,
): Promise<UpgradeOverrideAdvisories | null> {
  if (typeof options.listOverrides !== 'function') return null;
  const advisories: UpgradeOverrideAdvisories = { hidesChange: [], stale: [] };
  const before = packageBodiesById(installed);
  if (before.size === 0) return advisories;
  const after = packageBodiesById(incoming);
  for (const [packageId, installedBody] of before) {
    let overrides: readonly UpgradeServedOverride[];
    try {
      overrides = await options.listOverrides(packageId);
    } catch (error) {
      options.warn?.('[planUpgrade] the overrides of an upgraded base could not be read; they are answered null, never none', {
        package: packageId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    if (overrides.length === 0) continue;
    const incomingBody = after.get(packageId);
    const installedVersion = versionOf(installedBody);
    const incomingVersion = versionOf(incomingBody);
    const installedItems = packageItemTexts(installedBody);
    const incomingItems = incomingBody ? packageItemTexts(incomingBody) : new Map<string, string>();
    for (const override of overrides) {
      const finding = (): UpgradeOverrideFinding => ({
        package: packageId,
        type: override.type,
        name: override.name,
        ...(override.member !== undefined ? { member: override.member } : {}),
        ...(override.basedOn !== undefined ? { basedOn: override.basedOn } : {}),
        installedVersion,
        incomingVersion,
        next: '',
      });
      const key = itemKey(override.type, override.name, override.member);
      const was = installedItems.get(key);
      const will = incomingItems.get(key);
      const change: UpgradeOverriddenItemChange | undefined = was === undefined
        ? (will === undefined ? undefined : 'added')
        : will === undefined ? 'removed' : was !== will ? 'changed' : undefined;
      if (change !== undefined) {
        advisories.hidesChange.push({ ...finding(), change, next: nextStepHiding(override, change, incomingVersion) });
      }
      // `basedOn` names the base version the override was taken from; one
      // that is not the installed version is stale before this upgrade runs.
      if (override.basedOn !== undefined && installedVersion !== null && override.basedOn !== installedVersion) {
        advisories.stale.push({ ...finding(), next: nextStepStale(override, installedVersion) });
      }
    }
  }
  return advisories;
}
