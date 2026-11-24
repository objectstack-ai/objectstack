/**
 * ObjectUI — fields a disabled package withholds
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#34901 — the fields a DISABLED package contributes to an object it
 * extends.
 *
 * A package can add fields to another package's object (`objectExtensions`).
 * While that package is disabled the platform leaves those fields out of the
 * served object, and the data door judges every `$select`, `$filter`,
 * `$orderby`, `$searchFields` and `groupBy` name against the served object: a
 * name it does not know is refused with `400 INVALID_FIELD`, and with it the
 * whole list. The owner's views are not rewritten by a disable, so a view
 * column on such a field used to fail the list for everyone.
 *
 * The served object read now says which names are withheld, under the
 * top-level read decoration `_withheldFields` (`{ [field]: { packageId } }`,
 * `METADATA_READ_DECORATIONS` in `@objectstack/spec`). It is stamped on the
 * served face only, stripped by the save door, and absent when nothing is
 * withheld. The list readers leave a withheld name out of every request and
 * hide its column by derivation, never by writing the view or the user's list
 * preferences, so re-enabling the package brings the column, the sort and the
 * grouping back with no write at all.
 *
 * Deliberately a separate map and not a stub in `fields`: every other field
 * reader (forms, pickers, the filter builder, the FLS check,
 * {@link isProjectableField}) keeps treating the name as undeclared, which is
 * what it is while the package is off.
 */
export const WITHHELD_FIELDS_KEY = '_withheldFields';

/** One shared empty set, so a dependency list never sees a new identity when nothing is withheld. */
export const NO_WITHHELD_FIELDS: ReadonlySet<string> = new Set<string>();

/**
 * The field map a definition's withheld names were read beside. Lets a reader
 * that holds only the field map (`ObjectGrid`'s grouping decisions take
 * `objectSchema.fields`, not the definition) ask the same question; filled by
 * {@link readWithheldFieldNames}, which every list reader calls on the
 * definition it fetched before handing the definition on.
 */
const withheldByFieldMap = new WeakMap<object, ReadonlySet<string>>();

/**
 * The names `objectDef` marks as withheld by a disabled package. A name the
 * definition also declares in `fields` is not withheld (the platform only
 * marks names the served body leaves out, and a declared field is servable).
 * Empty for anything without the marker.
 */
export function readWithheldFieldNames(objectDef: unknown): ReadonlySet<string> {
  if (!objectDef || typeof objectDef !== 'object') return NO_WITHHELD_FIELDS;
  const def = objectDef as Record<string, unknown>;
  const fields = def.fields;
  const marked = def[WITHHELD_FIELDS_KEY];
  let names: ReadonlySet<string> = NO_WITHHELD_FIELDS;
  if (marked && typeof marked === 'object' && !Array.isArray(marked)) {
    const declared = declaredFieldNames(fields);
    const found = new Set<string>();
    for (const name of Object.keys(marked as Record<string, unknown>)) {
      if (name.length > 0 && !declared.has(name)) found.add(name);
    }
    if (found.size > 0) names = found;
  }
  if (fields && typeof fields === 'object') withheldByFieldMap.set(fields as object, names);
  return names;
}

/**
 * The withheld names read beside this field map by {@link readWithheldFieldNames}.
 * Empty when that definition carried none, or was never read.
 */
export function withheldFieldNamesOfFieldMap(fields: unknown): ReadonlySet<string> {
  if (!fields || typeof fields !== 'object') return NO_WITHHELD_FIELDS;
  return withheldByFieldMap.get(fields as object) ?? NO_WITHHELD_FIELDS;
}

/** Whether a field reference (`project`, or a dotted `project.name`) starts at a withheld field. */
export function refersToWithheldField(ref: unknown, withheld: ReadonlySet<string>): ref is string {
  return typeof ref === 'string' && withheld.size > 0 && withheld.has(ref.split('.')[0]);
}

function declaredFieldNames(fields: unknown): ReadonlySet<string> {
  if (Array.isArray(fields)) {
    return new Set(
      fields
        .map((f) => (f as { name?: unknown } | null)?.name)
        .filter((n): n is string => typeof n === 'string'),
    );
  }
  if (fields && typeof fields === 'object') return new Set(Object.keys(fields as Record<string, unknown>));
  return NO_WITHHELD_FIELDS;
}
