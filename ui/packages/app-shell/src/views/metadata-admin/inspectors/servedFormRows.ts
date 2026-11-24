// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FormFieldSpec, FormViewSpec } from '../form-spec.js';

/**
 * The rows the served form declares for `keys`, in the form's own order
 * (objectstack#35650).
 *
 * A curated inspector edits most keys with its own controls and hands the rest
 * to a "More fields" `SchemaForm` fed the bare served schema. A key whose
 * served row declares its face — a `widget`, help text, nested row
 * descriptors, a visibility predicate — loses all of it there: the schema
 * alone says only "a record", and a record with no row reads as the raw JSON
 * editor. Drawing such a key from its served row is how the inspector reads
 * the contract the server already serves, instead of hand-building a second
 * face for it.
 *
 * A key the form declares no row for is not returned, so the caller keeps
 * drawing it in its fallback form, as before: nothing is lost when the host
 * has no served form, or the server's form predates the row. A `{ group }`
 * section names no row by key, so it contributes none here (`SchemaForm`
 * resolves such a section when it renders a whole form; this is a lookup).
 */
export function servedFormRows(
  form: FormViewSpec | undefined,
  keys: readonly string[],
): FormFieldSpec[] {
  const rows: FormFieldSpec[] = [];
  for (const section of form?.sections ?? form?.groups ?? []) {
    if (!Array.isArray(section.fields)) continue;
    for (const row of section.fields) {
      const spec: FormFieldSpec = typeof row === 'string' ? { field: row } : row;
      if (keys.includes(spec.field) && !rows.some((r) => r.field === spec.field)) rows.push(spec);
    }
  }
  return rows;
}
