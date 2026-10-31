import type { Field as SpecField } from '@objectstack/spec/data';

/**
 * One declared `{ target, source, overwrite? }` pair of `@objectstack/spec`'s
 * `FieldSchema.lookupAutofill`, typed by reference so the two cannot drift.
 */
export type LookupAutofillPair = NonNullable<SpecField['lookupAutofill']>[number];

/**
 * The declared pairs of the lookup fields of one object, keyed by the lookup
 * field's name: what a line-item grid is handed for its lookup columns, since
 * a grid column (`InlineGridColumnSchema`) carries no field definition.
 */
export type LookupAutofillByField = Readonly<Record<string, readonly LookupAutofillPair[]>>;

type Values = Record<string, unknown>;

/** A target holding nothing a person could have written. */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The writes one pick in a lookup makes under its declared `lookupAutofill`
 * pairs: each `target` of the record being edited takes the picked record's
 * `source`.
 *
 * The overwrite rule is the spec's (the key's describe): a pair without
 * `overwrite: true` fills its target only while the target is empty or still
 * holds the value an earlier pick filled in — `previous`, the record the lookup
 * held from an earlier pick in this same form or row, read at the same
 * `source`. A value the user typed or the record already stored stays. A pair
 * declaring `overwrite: true` replaces the target on every pick.
 *
 * A `source` the picked record does not carry (a field the reader may not
 * read is not served) writes nothing: a missing key is not a value.
 */
export function declaredLookupAutofillPatch(
  pairs: readonly LookupAutofillPair[] | undefined,
  picked: Values | null | undefined,
  current: Values | null | undefined,
  previous?: Values | null,
): Values {
  const patch: Values = {};
  if (!pairs?.length || !picked || typeof picked !== 'object') return patch;
  for (const { target, source, overwrite } of pairs) {
    if (!(source in picked) || picked[source] === undefined) continue;
    const held = current?.[target];
    const filledByEarlierPick = !!previous && source in previous && sameValue(held, previous[source]);
    if (overwrite === true || isEmptyValue(held) || filledByEarlierPick) patch[target] = picked[source];
  }
  return patch;
}

/**
 * The declared `lookupAutofill` pairs of an object's fields, by lookup field
 * name. Only single-value `lookup` / `master_detail` fields carry the key (the
 * spec refuses it elsewhere), so only those are read.
 */
export function lookupAutofillByField(fields: Record<string, unknown> | undefined | null): LookupAutofillByField {
  const out: Record<string, readonly LookupAutofillPair[]> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [name, def] of Object.entries(fields)) {
    const d = def as { type?: unknown; multiple?: unknown; lookupAutofill?: unknown } | null | undefined;
    if (!d || (d.type !== 'lookup' && d.type !== 'master_detail') || d.multiple === true) continue;
    if (Array.isArray(d.lookupAutofill) && d.lookupAutofill.length > 0) {
      out[name] = d.lookupAutofill as LookupAutofillPair[];
    }
  }
  return out;
}
