// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package upgrade plan: ONE comparison of the version of a package that is
 * installed with the version about to replace it (epic cloud#3652, Phase 2
 * "change preview before install"; ruling Q3 「默认拒绝，需显式映射（推荐）」 and
 * D3 「写进清单 renamedFrom」).
 *
 * ## Why one function
 *
 * Every reader of "what will this upgrade change" calls this: `os diff`
 * (two config files), the install-local door's dry run and its upgrade
 * verdict, and the `manifest` service's `planUpgrade`, which a host such as a
 * hosted install door calls. Two comparisons would disagree about the same
 * pair of versions, and the one an installer saw would not be the one that
 * decided.
 *
 * It is pure: two package bodies in, findings out. It reads no registry, no
 * database and no ledger. What only the running environment knows (rows in a
 * column, rows a customer edited) is the `manifest` service's half.
 *
 * ## What it reads
 *
 * Each side is ONE flat package body, as far as this function is concerned:
 * its `objects` (each an object with a `name` and a `fields` map), its
 * `objectExtensions` (fields it adds to an object, its own or another
 * package's) and its `data` (seed datasets). A multi-package artifact is
 * folded by the caller with the platform's one collection reader
 * (`resolveStackCollection` in `@objectstack/core`; `os diff` folds through
 * the CLI's union stack), so this module holds no second reading of
 * `packages[]`.
 *
 * ## Extension fields count like owned ones (#34095)
 *
 * An upgrade adds the columns of every field its `objectExtensions` add, so a
 * comparison that read `objects` alone listed none of them: a preview showed
 * no added field while the upgrade added seven columns. Each side's fields of
 * an object are therefore the object as the registry serves it from that
 * side: the owner's declaration with each extension's `fields` merged over it
 * BY NAME, a later writer replacing the whole field, in ascending `priority`
 * (`ext.priority ?? 200`), equal priorities in the order the side lists them
 * (`mergeObjectDefinitions` in `@objectstack/objectql`, applied by the
 * registry's fold). The target is the object whose `name` is the `extend`
 * string verbatim, the registry's own key. From there every rule below
 * applies unchanged: an extension field added, removed, retyped or renamed is
 * listed, and judged by the verdict, exactly as an owned one is.
 *
 * An object a side reaches ONLY through extensions (another package owns it)
 * is compared by the fields the extensions add, and it is never listed as an
 * added or removed object: the upgrade neither creates nor drops it. Its
 * owner's own fields are not on either side, so they are never listed.
 * `fieldPatches` change display keys only and store no column: not compared.
 *
 * ## What it reports
 *
 * - objects added and removed, by name;
 * - fields added and removed, by key, within an object both versions declare
 *   (or that a version reaches only through its extensions);
 * - type changes: a field both versions declare whose `type` differs, with a
 *   drift category ({@link typeChangeCategory});
 * - declared renames: a field of the new version whose `renamedFrom` names a
 *   field of the installed version that the new version no longer declares.
 *   The pair is a rename, so neither key is listed as added or removed. When
 *   the two types differ, the rename is ALSO a type change, judged on its own:
 *   a declared rename never stands in for a type-change confirmation
 *   (the card's scope note, objectstack#30884 comment 6685166393);
 * - suspected renames: within one object, a stored field removed while a
 *   stored field is added, with no `renamedFrom` linking them. One finding per
 *   removed field, naming every unlinked added field as a candidate. Both keys
 *   stay listed as removed and added: nothing declares otherwise;
 * - seed datasets added, removed and changed, each with its mode.
 *
 * ⛔ It decides nothing. Which findings stop an install is the door's call.
 */

import { SeedSchema, isVirtualSearchField } from '@objectstack/spec/data';
import { canonicalize } from './canonicalize.js';

/**
 * The drift categories of `@objectstack/driver-sql`'s `schema-drift.ts`
 * (`DriftCategory`), the same three words: this package cannot depend on a
 * driver, so the union is restated here and held equal to the driver's by a
 * type-level pin in the CLI's tests, which depend on both.
 *
 *   - `safe`          loosening that cannot lose data and cannot fail;
 *   - `needs_confirm` a change a human should look at, that destroys nothing;
 *   - `destructive`   a drop or tightening that can lose data or fail.
 */
export type UpgradeDriftCategory = 'safe' | 'needs_confirm' | 'destructive';

/** One side of the comparison: a flat package body's three collections. */
export interface PackageUpgradeSide {
  /** The body's object definitions (`{ name, fields }`). */
  objects?: readonly unknown[];
  /**
   * The body's object extensions (`ObjectExtensionSchema`: `{ extend, fields,
   * priority? }`), whose `fields` merge onto the object `extend` names.
   */
  objectExtensions?: readonly unknown[];
  /** The body's seed datasets (`SeedSchema`). */
  data?: readonly unknown[];
}

/** A field one side declares and the other does not. */
export interface UpgradePlanField {
  object: string;
  field: string;
  type?: string;
  /** `required: true` on the declaration. */
  required: boolean;
  /** The field has a stored column (not a computed-on-read type). */
  stored: boolean;
}

/** A field whose declared type differs between the two versions. */
export interface UpgradePlanTypeChange {
  object: string;
  /** The field's key in the NEW version. */
  field: string;
  from: string;
  to: string;
  category: UpgradeDriftCategory;
  /** Set when the change rides on a declared rename: the installed key. */
  renamedFrom?: string;
}

/** A rename the new version declares with `renamedFrom`. */
export interface UpgradePlanDeclaredRename {
  object: string;
  /** The installed key. */
  from: string;
  /** The new key. */
  to: string;
  fromType?: string;
  toType?: string;
}

/** A stored field removed while stored fields are added, with nothing linking them. */
export interface UpgradePlanSuspectedRename {
  object: string;
  /** The removed (installed) key. */
  field: string;
  type?: string;
  /** Every added stored field of the same object no `renamedFrom` links. */
  candidates: Array<{ field: string; type?: string }>;
}

/** A seed dataset, as the plan names it. */
export interface UpgradePlanSeedDataset {
  /** `object`, plus the match key and the locale scope when they are not the defaults. */
  key: string;
  object: string;
  externalId: string | string[];
  /** The mode, the spec default (`ignore`) when the dataset declares none. */
  mode: string;
  records: number;
}

/** A dataset both versions declare under one key, with what differs. */
export interface UpgradePlanSeedChange extends UpgradePlanSeedDataset {
  /** The installed version's mode. */
  fromMode: string;
  /** The installed version's record count. */
  fromRecords: number;
  /** What differs: the records, the mode, the column policies, the environments. */
  changed: Array<'records' | 'mode' | 'columns' | 'env'>;
}

export interface PackageUpgradePlan {
  objects: { added: string[]; removed: string[] };
  fields: { added: UpgradePlanField[]; removed: UpgradePlanField[] };
  typeChanges: UpgradePlanTypeChange[];
  declaredRenames: UpgradePlanDeclaredRename[];
  suspectedRenames: UpgradePlanSuspectedRename[];
  seeds: { added: UpgradePlanSeedDataset[]; removed: UpgradePlanSeedDataset[]; changed: UpgradePlanSeedChange[] };
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The registry's default `priority` of an extension (the `objectExtensions` loop of `registerApp`). */
const DEFAULT_EXTENSION_PRIORITY = 200;

/** One side's objects as the registry serves them from that side. */
interface SideObjects {
  /** Every object the side reaches, owned or extended, by name, its fields merged. */
  byName: Map<string, Bag>;
  /** The names the side OWNS (declares in `objects`): the only ones listed as added or removed. */
  owned: Set<string>;
}

/**
 * Objects by name, the LAST declaration of a name winning (`os diff`'s
 * reading), each with the side's extensions merged over its fields (see the
 * module header, *Extension fields count like owned ones*).
 */
function objectsByName(side: PackageUpgradeSide | undefined): SideObjects {
  const byName = new Map<string, Bag>();
  for (const item of side?.objects ?? []) {
    if (isBag(item) && typeof item.name === 'string' && item.name !== '') byName.set(item.name, item);
  }
  const owned = new Set(byName.keys());
  const extensions = (side?.objectExtensions ?? [])
    .filter((ext): ext is Bag => isBag(ext) && typeof ext.extend === 'string' && ext.extend !== '' && isBag(ext.fields))
    .map((ext, order) => ({ ext, order, priority: typeof ext.priority === 'number' ? ext.priority : DEFAULT_EXTENSION_PRIORITY }))
    .sort((a, b) => a.priority - b.priority || a.order - b.order);
  for (const { ext } of extensions) {
    const target = ext.extend as string;
    const base = byName.get(target) ?? { name: target, fields: {} };
    byName.set(target, { ...base, fields: { ...(isBag(base.fields) ? base.fields : {}), ...(ext.fields as Bag) } });
  }
  return { byName, owned };
}

function fieldsOf(object: Bag | undefined): Map<string, Bag> {
  const out = new Map<string, Bag>();
  const fields = object?.fields;
  if (!isBag(fields)) return out;
  for (const [key, def] of Object.entries(fields)) out.set(key, isBag(def) ? def : {});
  return out;
}

function typeOf(field: Bag | undefined): string | undefined {
  return typeof field?.type === 'string' && field.type !== '' ? field.type : undefined;
}

/** Has the field a stored column? The spec's storage predicate, never a type list kept here. */
function isStored(field: Bag | undefined): boolean {
  return !isVirtualSearchField({ type: typeOf(field) } as Parameters<typeof isVirtualSearchField>[0]);
}

function describeField(object: string, field: string, def: Bag | undefined): UpgradePlanField {
  const type = typeOf(def);
  return { object, field, ...(type !== undefined ? { type } : {}), required: def?.required === true, stored: isStored(def) };
}

/**
 * The drift category of a declared type change, in `schema-drift.ts`'s
 * vocabulary and by its reading of the same physical facts. A package upgrade
 * syncs the schema ADDITIVELY: it adds missing columns and never alters or
 * drops one, so a retyped field keeps its existing column.
 *
 * - The installed field had no stored column (computed on read): there is
 *   nothing stored to lose, and the new column is one the additive sync adds.
 *   `safe`.
 * - The new field has no stored column and the installed one had: the column
 *   stops being declared, which the drift detector reports as an orphan whose
 *   operation is a column drop. `destructive`.
 * - Both stored: the column keeps its old type under a declaration of another
 *   type. The detector reports a base-type divergence as report-only, applied
 *   by no reconciler (`manual_column_type_change`). `needs_confirm`.
 */
export function typeChangeCategory(from: { type?: unknown }, to: { type?: unknown }): UpgradeDriftCategory {
  const fromStored = isStored(from as Bag);
  const toStored = isStored(to as Bag);
  if (!fromStored) return 'safe';
  if (!toStored) return 'destructive';
  return 'needs_confirm';
}

// ── seeds ───────────────────────────────────────────────────────────────

const DEFAULT_SEED_MODE: string = SeedSchema.shape.mode.parse(undefined);
const DEFAULT_SEED_EXTERNAL_ID: string | string[] = SeedSchema.shape.externalId.parse(undefined);

/**
 * Does a replay of a dataset in this mode write its columns over a row it
 * MATCHED by `externalId`? `upsert` and `update` do (a column declaring
 * `applyOn: 'create'` excepted); `ignore` never touches a matched row. The
 * retired `insert` and `replace` (#34613) matched no row, and a replay now
 * refuses a dataset that still declares one. The rows a customer edited that
 * an upgrade's replay would overwrite are counted for these modes only.
 */
export function seedModeOverwritesMatchedRows(mode: string): boolean {
  return mode === 'upsert' || mode === 'update';
}

/** A dataset as the plan reads it, with the declaration it was read from. */
export interface UpgradePlanSeedDatasetRead extends UpgradePlanSeedDataset {
  raw: Record<string, unknown>;
}

function stableText(value: unknown): string {
  try {
    return canonicalize(value);
  } catch {
    // A value canonical JSON refuses (NaN, Infinity) still compares by its
    // plain serialisation rather than throwing the whole plan away.
    return JSON.stringify(value) ?? 'undefined';
  }
}

/**
 * One side's seed datasets under the keys the plan names them by: `object`,
 * plus its match key and its locales when they are not the defaults, and
 * ` #n` on a second dataset under one key. Exported so a reader of the
 * environment (`planUpgrade`) pairs datasets exactly as the plan does.
 */
export function upgradePlanSeedDatasets(side: PackageUpgradeSide | undefined): Map<string, UpgradePlanSeedDatasetRead> {
  const out = new Map<string, UpgradePlanSeedDatasetRead>();
  for (const item of side?.data ?? []) {
    if (!isBag(item) || typeof item.object !== 'string' || item.object === '') continue;
    const externalId = typeof item.externalId === 'string' || Array.isArray(item.externalId)
      ? (item.externalId as string | string[])
      : DEFAULT_SEED_EXTERNAL_ID;
    const mode = typeof item.mode === 'string' ? item.mode : DEFAULT_SEED_MODE;
    const locale = Array.isArray(item.locale) ? [...item.locale].map(String).sort().join(',') : '';
    let key = item.object;
    if (stableText(externalId) !== stableText(DEFAULT_SEED_EXTERNAL_ID)) key += ` by ${Array.isArray(externalId) ? externalId.join('+') : externalId}`;
    if (locale !== '') key += ` [${locale}]`;
    // Two datasets under one key in one version are told apart by position.
    let unique = key;
    for (let n = 2; out.has(unique); n++) unique = `${key} #${n}`;
    const records = Array.isArray(item.records) ? item.records.length : 0;
    out.set(unique, { key: unique, object: item.object, externalId, mode, records, raw: item });
  }
  return out;
}

function publicDataset(d: UpgradePlanSeedDatasetRead): UpgradePlanSeedDataset {
  return { key: d.key, object: d.object, externalId: d.externalId, mode: d.mode, records: d.records };
}

function compareSeeds(installed: PackageUpgradeSide | undefined, incoming: PackageUpgradeSide | undefined): PackageUpgradePlan['seeds'] {
  const before = upgradePlanSeedDatasets(installed);
  const after = upgradePlanSeedDatasets(incoming);
  const seeds: PackageUpgradePlan['seeds'] = { added: [], removed: [], changed: [] };
  for (const [key, d] of before) if (!after.has(key)) seeds.removed.push(publicDataset(d));
  for (const [key, d] of after) {
    const prior = before.get(key);
    if (!prior) {
      seeds.added.push(publicDataset(d));
      continue;
    }
    const changed: UpgradePlanSeedChange['changed'] = [];
    if (stableText(prior.raw.records ?? []) !== stableText(d.raw.records ?? [])) changed.push('records');
    if (prior.mode !== d.mode) changed.push('mode');
    if (stableText(prior.raw.columns ?? {}) !== stableText(d.raw.columns ?? {})) changed.push('columns');
    if (stableText(prior.raw.env ?? null) !== stableText(d.raw.env ?? null)) changed.push('env');
    if (changed.length > 0) {
      seeds.changed.push({ ...publicDataset(d), fromMode: prior.mode, fromRecords: prior.records, changed });
    }
  }
  return seeds;
}

// ── the comparison ──────────────────────────────────────────────────────

/**
 * Compare the installed version of a package with the incoming one. Lists
 * are ordered as the versions declare: removed objects, fields and type
 * changes in the installed version's order, added ones in the incoming
 * version's order, objects one after another.
 */
export function comparePackageVersions(installed: PackageUpgradeSide | undefined, incoming: PackageUpgradeSide | undefined): PackageUpgradePlan {
  const { byName: before, owned: ownedBefore } = objectsByName(installed);
  const { byName: after, owned: ownedAfter } = objectsByName(incoming);
  const plan: PackageUpgradePlan = {
    objects: { added: [], removed: [] },
    fields: { added: [], removed: [] },
    typeChanges: [],
    declaredRenames: [],
    suspectedRenames: [],
    seeds: compareSeeds(installed, incoming),
  };

  // Owned objects only: an object a side only extends is neither created nor
  // dropped by this upgrade.
  for (const name of ownedBefore) if (!ownedAfter.has(name)) plan.objects.removed.push(name);
  for (const name of ownedAfter) if (!ownedBefore.has(name)) plan.objects.added.push(name);

  // An object one side reaches only through extensions and the other does not
  // reach at all is compared with no fields on that other side: the
  // extensions' fields are what the upgrade adds or leaves behind. An OWNED
  // object one side lacks is an added or removed object, listed above.
  const unreached = (object: string): Bag => ({ name: object, fields: {} });
  const names = [...before.keys(), ...[...after.keys()].filter((name) => !before.has(name))];
  for (const object of names) {
    const beforeObject = before.get(object) ?? (ownedAfter.has(object) ? undefined : unreached(object));
    const afterObject = after.get(object) ?? (ownedBefore.has(object) ? undefined : unreached(object));
    if (!beforeObject || !afterObject) continue;
    const beforeFields = fieldsOf(beforeObject);
    const afterFields = fieldsOf(afterObject);

    // Declared renames: a NEW key whose `renamedFrom` names an installed key
    // the new version no longer declares. The first such entry is the rename
    // (the spec refuses an old key two fields claim, and a field renamed
    // twice names at most one key this installed version has).
    const renamedTo = new Map<string, string>(); // installed key → new key
    for (const [key, def] of afterFields) {
      if (beforeFields.has(key) || !Array.isArray(def.renamedFrom)) continue;
      for (const old of def.renamedFrom) {
        if (typeof old !== 'string' || !beforeFields.has(old) || afterFields.has(old) || renamedTo.has(old)) continue;
        renamedTo.set(old, key);
        break;
      }
    }
    const renameTargets = new Set(renamedTo.values());

    const removed: string[] = [];
    for (const key of beforeFields.keys()) {
      if (afterFields.has(key) || renamedTo.has(key)) continue;
      removed.push(key);
      plan.fields.removed.push(describeField(object, key, beforeFields.get(key)));
    }
    const added: string[] = [];
    for (const key of afterFields.keys()) {
      if (beforeFields.has(key) || renameTargets.has(key)) continue;
      added.push(key);
      plan.fields.added.push(describeField(object, key, afterFields.get(key)));
    }

    for (const [key, beforeDef] of beforeFields) {
      const target = afterFields.has(key) ? key : renamedTo.get(key);
      if (target === undefined) continue;
      const afterDef = afterFields.get(target);
      const from = typeOf(beforeDef);
      const to = typeOf(afterDef);
      if (target !== key) {
        plan.declaredRenames.push({
          object, from: key, to: target,
          ...(from !== undefined ? { fromType: from } : {}),
          ...(to !== undefined ? { toType: to } : {}),
        });
      }
      if (from !== undefined && to !== undefined && from !== to) {
        plan.typeChanges.push({
          object, field: target, from, to,
          category: typeChangeCategory(beforeDef, afterDef ?? {}),
          ...(target !== key ? { renamedFrom: key } : {}),
        });
      }
    }

    const storedAdded = added.filter((key) => isStored(afterFields.get(key)));
    if (storedAdded.length > 0) {
      for (const key of removed) {
        const def = beforeFields.get(key);
        if (!isStored(def)) continue;
        const type = typeOf(def);
        plan.suspectedRenames.push({
          object, field: key, ...(type !== undefined ? { type } : {}),
          candidates: storedAdded.map((candidate) => {
            const candidateType = typeOf(afterFields.get(candidate));
            return { field: candidate, ...(candidateType !== undefined ? { type: candidateType } : {}) };
          }),
        });
      }
    }
  }

  return plan;
}

/** Does the plan list nothing at all? */
export function isEmptyPackageUpgradePlan(plan: PackageUpgradePlan): boolean {
  return plan.objects.added.length === 0
    && plan.objects.removed.length === 0
    && plan.fields.added.length === 0
    && plan.fields.removed.length === 0
    && plan.typeChanges.length === 0
    && plan.declaredRenames.length === 0
    && plan.suspectedRenames.length === 0
    && plan.seeds.added.length === 0
    && plan.seeds.removed.length === 0
    && plan.seeds.changed.length === 0;
}
