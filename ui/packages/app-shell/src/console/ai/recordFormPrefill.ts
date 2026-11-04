/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * cloud#3565 — the query string 打开完整表单 opens the New form with, from a
 * record-write card's fields. `RecordFormPage` reads a create's prefill as
 * one `<field>=<value>` pair per field (the related-list "+ New" contract),
 * every value a string, so each card value is flattened to the string the
 * form can open on: a scalar as itself, a list joined with commas, an empty
 * value left out (the form's own default fills it).
 */
export function recordFormPrefillQuery(
  fields: ReadonlyArray<{ name: string; value: unknown }>,
): string {
  const prefill = new URLSearchParams();
  for (const f of fields) {
    const text = prefillText(f.value);
    if (f.name && text !== undefined) prefill.set(f.name, text);
  }
  return prefill.toString();
}

function prefillText(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (Array.isArray(value)) {
    const parts = value.map(prefillText).filter((v): v is string => v !== undefined);
    return parts.length > 0 ? parts.join(',') : undefined;
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
