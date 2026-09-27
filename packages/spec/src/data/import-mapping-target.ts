// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20150] What may an import mapping's `fieldMapping[].target` name?
 *
 * `ImportFieldMappingSchema.target` (`mapping.zod.ts`) is declared as "Target
 * object field(s)". This module is the ONE place that decides whether a given
 * target is inside that contract, and both doors that must agree on it call it:
 *
 * - the IMPORT door (`@objectstack/rest` `prepareImportRequest`), which refuses
 *   a named mapping before any row, on the dry run and the commit alike;
 * - the AUTHOR-TIME check (`@objectstack/lint`, the reference-integrity suite
 *   that `os validate`, `os lint` and `os build` share).
 *
 * It lives in the spec because those two packages both depend on
 * `@objectstack/spec` and neither depends on the other, so a verdict written
 * anywhere else would have to be copied, and two copies of one verdict drift.
 *
 * ## The state this ends
 *
 * A target that named no field of the object passed `objectstack validate`
 * and the dry run (`ok` on every row), and then failed every row on the
 * commit with `INVALID_FIELD` ("Unknown field 'x' on object 'y'"), because the
 * engine's write door judges the row's keys and the dry run's preview does not.
 * The dry run promised what the commit refused.
 *
 * ## What a target may name
 *
 * A name the object's field map makes addressable, which is the union of:
 *
 * 1. the object's declared `fields` (map keys, or `name` on each entry of the
 *    array form, the two spellings the registry and the linters both read);
 * 2. the columns the platform provisions without the author declaring them,
 *    per object, from {@link resolveInjectedSystemColumns}: the primary key,
 *    the tenant anchor, the audit family and the ownership anchors, each only
 *    where that object carries it (`ownership: 'none'` has no `owner_id`);
 * 3. {@link IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS}: `id`, `created_at` and
 *    `updated_at`, which the engine's write door admits on EVERY object,
 *    `systemFields: false` included (`PLATFORM_PROVISIONED_COLUMNS` in
 *    `@objectstack/objectql`'s `undeclaredWriteFieldErrors`), because the SQL
 *    driver creates the three on every table it builds.
 *
 * Row 3 is what keeps this verdict from refusing a target the write accepts.
 * It is a superset rule, never a narrowing one: an import refused here is one
 * the commit would have refused row by row.
 *
 * ## Where this has no opinion
 *
 * An object whose field map is absent, unreadable or EMPTY answers `null`
 * from {@link indexImportMappingTargets}, and every caller then stays silent.
 * An empty map is indistinguishable from an unpopulated one (an ADR-0015
 * `external` object, a datasource-introspected schema, a registry-less host),
 * so a refusal there would be a verdict made from an absence. The engine's
 * write door takes the same position on the same input.
 *
 * ## Extension point for compound-field parts
 *
 * The maintainer's ruling on #20149 lets a target name a declared PART of a
 * compound field (`mailing_address.street`). That capability extends THIS
 * verdict by one arm in {@link judgeImportMappingTarget}, at the marked
 * place, returning a new `kind: 'part'` member of
 * {@link ImportMappingTargetVerdict}; ⛔ it never becomes a second predicate.
 * Until it lands, a dotted target names no field and is refused.
 *
 * Tolerant of bare / un-parsed records (the same contract as
 * {@link resolveInjectedSystemColumns}), because the import door reads a stored
 * mapping item and the raw `lint` path reads the author's files as written.
 */

import { SystemFieldName } from '../system/constants/system-names';
import { resolveInjectedSystemColumns } from './injected-system-columns';

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The three columns the engine's write door admits on every object whatever
 * the object declares, so an import target naming one is never refused here.
 *
 * Mirrors `PLATFORM_PROVISIONED_COLUMNS` in `@objectstack/objectql` (the
 * write door the commit reaches) rather than defining a new set: this verdict
 * must never be narrower than that door, or a mapping the commit would write
 * is refused.
 */
export const IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS: readonly string[] = Object.freeze([
  SystemFieldName.ID,
  SystemFieldName.CREATED_AT,
  SystemFieldName.UPDATED_AT,
]);

/**
 * The names an object makes addressable as an import target, plus each
 * declared field's definition (the input the compound-part arm reads).
 */
export interface ImportMappingTargetIndex {
  /** Every name a target may be: declared ∪ provisioned. */
  names: ReadonlySet<string>;
  /** The object's DECLARED field definitions, by name. */
  fields: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

/**
 * Index an object definition for target judgement, or `null` when the object
 * carries no readable, non-empty field map (no opinion; see the module note).
 *
 * @param objectDef An object definition, or any bare record shaped like one.
 */
export function indexImportMappingTargets(objectDef: unknown): ImportMappingTargetIndex | null {
  if (!isRec(objectDef)) return null;
  const declared = objectDef.fields;
  const fields = new Map<string, AnyRec>();
  if (Array.isArray(declared)) {
    for (const def of declared) {
      if (isRec(def) && typeof def.name === 'string' && def.name.length > 0) fields.set(def.name, def);
    }
  } else if (isRec(declared)) {
    for (const [key, def] of Object.entries(declared)) {
      const body = isRec(def) ? def : {};
      if (key.length > 0) fields.set(key, body);
      // A definition that names itself differently from its key is addressable
      // under both spellings: the engine reads the key, the linters the name.
      if (typeof body.name === 'string' && body.name.length > 0 && body.name !== key) fields.set(body.name, body);
    }
  } else {
    return null;
  }
  if (fields.size === 0) return null;

  const names = new Set<string>(fields.keys());
  for (const name of resolveInjectedSystemColumns(objectDef).names) names.add(name);
  for (const name of IMPORT_TARGET_ALWAYS_ADDRESSABLE_COLUMNS) names.add(name);
  return { names, fields };
}

/** The verdict on one target string. */
export type ImportMappingTargetVerdict =
  /** The target names a field of the object, declared or platform-provisioned. */
  | { kind: 'field'; target: string }
  /** The target names no field of the object; every row would be refused on write. */
  | { kind: 'unknown'; target: string };

/**
 * Judge one target string against an indexed object.
 */
export function judgeImportMappingTarget(
  index: ImportMappingTargetIndex,
  target: string,
): ImportMappingTargetVerdict {
  if (index.names.has(target)) return { kind: 'field', target };
  // ── #20149 extends the verdict HERE, with one arm ──────────────────────
  // A dotted `head.part` whose head is a declared field with a strict-object
  // value schema, and whose tail is a key that schema declares, answers
  // `{ kind: 'part', … }`. It reads the head's definition from
  // `index.fields`. Until that ruling is implemented a dotted target names
  // no field, and falls through to `unknown` below.
  return { kind: 'unknown', target };
}

/**
 * Every target string ONE `fieldMapping[]` entry writes, with its position:
 * a string target is one, and each element of an array target is one more
 * (a `split` writes all of them). A non-string element is left to the schema.
 */
export function importMappingEntryTargets(entry: unknown): Array<{ target: string; path: string }> {
  if (!isRec(entry)) return [];
  const t = entry.target;
  if (typeof t === 'string') return [{ target: t, path: 'target' }];
  if (!Array.isArray(t)) return [];
  const out: Array<{ target: string; path: string }> = [];
  t.forEach((v, i) => {
    if (typeof v === 'string') out.push({ target: v, path: `target[${i}]` });
  });
  return out;
}

/** One target that names no field of the mapping's object. */
export interface UnknownImportMappingTarget {
  /** Index of the entry in `fieldMapping`. */
  entry: number;
  /** Position inside the mapping, e.g. `fieldMapping[3].target` or `fieldMapping[2].target[1]`. */
  path: string;
  /** The target string as written. */
  target: string;
}

/**
 * Every target in a mapping's `fieldMapping` that names no field of the
 * object, in entry order. Empty when all resolve, and ALSO empty when the
 * object carries no readable field map (no opinion, never a refusal).
 *
 * @param fieldMapping The mapping's `fieldMapping` array, as stored or authored.
 * @param objectDef The definition of the mapping's `targetObject`.
 */
export function unknownImportMappingTargets(
  fieldMapping: unknown,
  objectDef: unknown,
): UnknownImportMappingTarget[] {
  if (!Array.isArray(fieldMapping)) return [];
  const index = indexImportMappingTargets(objectDef);
  if (!index) return [];
  const out: UnknownImportMappingTarget[] = [];
  fieldMapping.forEach((entry, i) => {
    for (const { target, path } of importMappingEntryTargets(entry)) {
      if (judgeImportMappingTarget(index, target).kind === 'unknown') {
        out.push({ entry: i, path: `fieldMapping[${i}].${path}`, target });
      }
    }
  });
  return out;
}
