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
 * …or a declared part of one of those declared fields, when the field is
 * compound (the section below).
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
 * ## A declared part of a compound field (#20149)
 *
 * The maintainer's ruling on #20149 (A) lets a target name a declared PART of
 * a compound field: `mailing_address.street`. The importer assembles the parts
 * one row maps into ONE value under the field's own key. That is one arm of
 * {@link judgeImportMappingTarget}, answering `kind: 'part'`; ⛔ it is never a
 * second predicate.
 *
 * A field is compound here when its stored VALUE schema (`valueSchemaFor`,
 * `field-value.zod.ts`) is a CLOSED object whose every declared part is an
 * OPTIONAL STRING, and its part names are exactly that object's keys: read from
 * the schema, never listed by hand. Today that selects `address` (street,
 * city, state, postalCode, country, countryCode, formatted); the test file
 * pins the census over every field type. `location` is the one other
 * closed-object value, and it is deliberately NOT compound: its parts are
 * numbers and `lat` / `lng` are
 * required, so a value assembled from text cells would be the wrong type or
 * incomplete, and the ADR-0104 warn-first write path would store it with a
 * warning rather than refuse it. The two conditions are what make an assembled
 * value valid by construction: every subset of text cells is one.
 *
 * Refused, each with the part list in hand for the refusal to name:
 *
 * - a part the value does not declare (`mailing_address.stret`);
 * - a dotted path whose head is not a compound field. ⛔ It is never read as a
 *   lookup traversal (`account.name`): resolving a reference from its display
 *   text is the `lookup` transform's business, on the reference field itself;
 * - a part of a field the SAME mapping also writes whole (`mailing_address`
 *   and `mailing_address.street`): one row carries one value for the field, so
 *   the two collide, and {@link unknownImportMappingTargets} reports the part
 *   with `reason: 'collides'`.
 *
 * Tolerant of bare / un-parsed records (the same contract as
 * {@link resolveInjectedSystemColumns}), because the import door reads a stored
 * mapping item and the raw `lint` path reads the author's files as written.
 */

import { SystemFieldName } from '../system/constants/system-names';
import { valueSchemaFor } from './field-value.zod';
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
 * declared field's definition and the parts of each compound field.
 */
export interface ImportMappingTargetIndex {
  /** Every name a target may be: declared ∪ provisioned. */
  names: ReadonlySet<string>;
  /** The object's DECLARED field definitions, by name. */
  fields: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
  /**
   * [#20149] Each compound declared field, by name, mapped to the parts a
   * target may name on it (`mailing_address` → `street`, `city`, …), in the
   * order its value schema declares them. A field absent here takes no part
   * target.
   */
  parts: ReadonlyMap<string, readonly string[]>;
}

/** The `def.type` of a zod node, or `undefined`. */
function zodType(node: unknown): string | undefined {
  const def = (node as { _zod?: { def?: { type?: unknown } } } | undefined)?._zod?.def;
  return typeof def?.type === 'string' ? def.type : undefined;
}

/**
 * [#20149] The parts an import target may name on ONE declared field, or
 * `undefined` when the field is not compound: the keys of its stored value
 * schema when that schema is a closed object (`catchall: never`) whose every
 * part is an optional string. See the module note for why both conditions.
 */
function importTargetPartsOf(def: Readonly<Record<string, unknown>>): readonly string[] | undefined {
  if (typeof def.type !== 'string') return undefined;
  const schema = valueSchemaFor(def as { type: string; multiple?: boolean }, 'stored') as unknown as {
    _zod?: { def?: { type?: unknown; catchall?: unknown; shape?: unknown } };
  };
  const objectDef = schema?._zod?.def;
  if (!objectDef || objectDef.type !== 'object' || zodType(objectDef.catchall) !== 'never') return undefined;
  const rawShape: unknown = objectDef.shape;
  const shape = ((typeof rawShape === 'function' ? (rawShape as () => unknown)() : rawShape) ?? {}) as Record<string, unknown>;
  const names = Object.keys(shape);
  if (names.length === 0) return undefined;
  for (const name of names) {
    const member = shape[name] as { _zod?: { def?: { innerType?: unknown } } } | undefined;
    if (zodType(member) !== 'optional' || zodType(member?._zod?.def?.innerType) !== 'string') return undefined;
  }
  return Object.freeze(names);
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
  const parts = new Map<string, readonly string[]>();
  for (const [name, def] of fields) {
    const compound = importTargetPartsOf(def);
    if (compound) parts.set(name, compound);
  }
  return { names, fields, parts };
}

/**
 * What the text before the first dot of a dotted target names, so a refusal
 * can say why the path is not a target and which parts ARE.
 */
export interface ImportMappingTargetHead {
  /** The text before the first dot (`mailing_address` in `mailing_address.stret`). */
  name: string;
  /** Whether that text names a field of the object, declared or provisioned. */
  field: boolean;
  /** The head's declared `type`, when it is a DECLARED field that carries one. */
  type?: string;
  /** The parts a target may name on the head, when it is a compound field. */
  parts?: readonly string[];
}

/** The verdict on one target string. */
export type ImportMappingTargetVerdict =
  /** The target names a field of the object, declared or platform-provisioned. */
  | { kind: 'field'; target: string }
  /**
   * [#20149] The target names a declared part of a compound field
   * (`field.part`): the importer writes it into that field's one value.
   */
  | { kind: 'part'; target: string; field: string; part: string }
  /**
   * The target names no field of the object and no declared part; every row
   * would be refused on write. `head` is present when the target is dotted.
   */
  | { kind: 'unknown'; target: string; head?: ImportMappingTargetHead };

/**
 * Judge one target string against an indexed object.
 */
export function judgeImportMappingTarget(
  index: ImportMappingTargetIndex,
  target: string,
): ImportMappingTargetVerdict {
  if (index.names.has(target)) return { kind: 'field', target };
  // [#20149] The compound-part arm. The head is judged against the DECLARED
  // fields only (a provisioned column has no compound value), and the part
  // against the closed set the head's value schema declares. A dotted path
  // that fails either stays `unknown`, carrying what its head names.
  const dot = target.indexOf('.');
  if (dot > 0) {
    const name = target.slice(0, dot);
    const part = target.slice(dot + 1);
    const parts = index.parts.get(name);
    if (parts?.includes(part)) return { kind: 'part', target, field: name, part };
    const type = index.fields.get(name)?.type;
    return {
      kind: 'unknown',
      target,
      head: {
        name,
        field: index.names.has(name),
        ...(typeof type === 'string' ? { type } : {}),
        ...(parts ? { parts } : {}),
      },
    };
  }
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

/** One target a mapping cannot write on its object. */
export interface UnknownImportMappingTarget {
  /** Index of the entry in `fieldMapping`. */
  entry: number;
  /** Position inside the mapping, e.g. `fieldMapping[3].target` or `fieldMapping[2].target[1]`. */
  path: string;
  /** The target string as written. */
  target: string;
  /**
   * Why it is refused:
   * - `unknown` — it names no field of the object and no declared part of a
   *   compound field;
   * - `collides` — [#20149] it names a declared part of a compound field that
   *   the same mapping also writes whole, and one row carries one value for
   *   the field.
   */
  reason: 'unknown' | 'collides';
  /** `unknown`, dotted target: what its head names (see {@link ImportMappingTargetHead}). */
  head?: ImportMappingTargetHead;
  /** `collides`: the position of the target that writes the whole field. */
  wholeAt?: string;
}

/**
 * Every target in a mapping's `fieldMapping` that the mapping cannot write on
 * the object, in entry order: one that names no field and no declared part
 * (`unknown`), and a declared part of a field the same mapping also writes
 * whole (`collides`). Empty when all resolve, and ALSO empty when the object
 * carries no readable field map (no opinion, never a refusal).
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
  const judged: Array<{ entry: number; path: string; verdict: ImportMappingTargetVerdict }> = [];
  // The first position that writes each field WHOLE, for the collision check.
  const wholeAt = new Map<string, string>();
  fieldMapping.forEach((entry, i) => {
    for (const { target, path } of importMappingEntryTargets(entry)) {
      const verdict = judgeImportMappingTarget(index, target);
      const located = `fieldMapping[${i}].${path}`;
      if (verdict.kind === 'field' && !wholeAt.has(target)) wholeAt.set(target, located);
      judged.push({ entry: i, path: located, verdict });
    }
  });
  const out: UnknownImportMappingTarget[] = [];
  for (const { entry, path, verdict } of judged) {
    if (verdict.kind === 'unknown') {
      out.push({
        entry, path, target: verdict.target, reason: 'unknown',
        ...(verdict.head ? { head: verdict.head } : {}),
      });
    } else if (verdict.kind === 'part') {
      const whole = wholeAt.get(verdict.field);
      if (whole !== undefined) out.push({ entry, path, target: verdict.target, reason: 'collides', wholeAt: whole });
    }
  }
  return out;
}
