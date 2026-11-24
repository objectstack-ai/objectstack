/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record form's statement that one record is being edited here
 * (`withRecordBeingEdited` in `@object-ui/fields`), applied ONCE to the
 * resolved field list, at the step every `ObjectForm` layout draws its fields
 * through (`gateFormFields`).
 *
 * Invariants:
 * - Every field a record form draws is a field of the record being edited,
 *   whatever produced it: generated from the object schema, a `customFields`
 *   member, an inline section entry. So every one is stamped the same way,
 *   here, after the merge and the section expansion, never per source.
 * - Only this step writes the key. A field that arrives carrying it — a
 *   document's inline member, an object field — has it dropped before the
 *   stamp is applied, so what the widget reads is the form's statement, not
 *   the author's.
 * - Both faces a widget may read are handled: the runtime field itself and the
 *   object-field metadata it carries under `field`. Each is stamped on its own
 *   `lookupFilters`, so the face the widget reads carries its own stamp.
 * - A field whose faces neither read `{ $record }` nor carry the key comes
 *   back as the same object.
 * - A lookup declaring `lookupAutofill` also carries the definitions of its
 *   targets (`withLookupAutofillTargets`), read off the same field map: a
 *   pick copies an amount only into a target in the same currency
 *   (objectstack#36249), and a target's currency is its definition's. A
 *   target the form draws carries the name the form shows for it, so the
 *   note about a target it did not fill names it the same way.
 */
import { RECORD_BEING_EDITED_KEY, withLookupAutofillTargets, withRecordBeingEdited } from '@object-ui/fields';

type Def = Record<string, unknown>;

const isDef = (v: unknown): v is Def => !!v && typeof v === 'object' && !Array.isArray(v);

/** `face` without an authored stamp, then stamped by the form. */
function restamp(
  face: Def,
  objectFields: Readonly<Record<string, unknown>> | null | undefined,
  labels: Readonly<Record<string, string>>,
): Def {
  let clean = face;
  if (Object.prototype.hasOwnProperty.call(face, RECORD_BEING_EDITED_KEY)) {
    const { [RECORD_BEING_EDITED_KEY]: _authored, ...rest } = face;
    clean = rest;
  }
  return withLookupAutofillTargets(withRecordBeingEdited(clean, objectFields), objectFields, labels);
}

/**
 * `fields` as a record form draws them: each one stamped as a field of the
 * record being edited, with the object each `{ $record }` hop's lookup points
 * at read off `objectFields` (the edited object's field map; absent while the
 * schema loads, or on a form with no metadata source, when a hop names no
 * object and is left out).
 */
export function stampRecordFormFields<T extends Record<string, any>>(
  fields: T[] | undefined,
  objectFields: Readonly<Record<string, unknown>> | null | undefined,
): T[] | undefined {
  if (!Array.isArray(fields)) return fields;
  // Each drawn field's name as the form shows it (already translated), for a
  // lookup's note about a target it did not fill (objectstack#36249).
  const labels: Record<string, string> = {};
  for (const f of fields) {
    if (isDef(f) && typeof f.name === 'string' && typeof f.label === 'string' && f.label !== '') labels[f.name] = f.label;
  }
  return fields.map((f) => {
    if (!isDef(f)) return f;
    const outer = restamp(f, objectFields, labels);
    const inner = outer.field;
    const field = isDef(inner) ? restamp(inner, objectFields, labels) : inner;
    if (outer === f && field === inner) return f;
    return (field === inner ? outer : { ...outer, field }) as T;
  });
}
