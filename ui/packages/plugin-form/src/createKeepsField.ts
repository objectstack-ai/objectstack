/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * 「Would a CREATE form save this field if it opened with a value in it?」
 * (objectstack#37248).
 *
 * A related list offers + New by opening the child's create form pre-linked:
 * the relationship field already holds this parent's id. When that field is
 * one the create form will not write (`readonly`, computed, server-owned, or
 * refused to this caller by field-level security on create), the record saves
 * WITHOUT the link and never shows in the list the user started from. The list
 * asks this question before it offers + New.
 *
 * ⛔ No second rule. The answer is the create form's own outbound filter,
 * asked with the create form's own field gate: `sanitizeFormData` with
 * `fieldWriteGate(perms, objectName, 'create')`, the pair every form container
 * submits through. Whatever that pair strips, this answers `false` for, so the
 * list and the form cannot disagree about the field.
 *
 * Fail-open where the form fails open: with no resolved principal the field
 * gate is absent, and with no `fields` on the schema only the server-owned
 * roster is judged.
 */

import { sanitizeFormData } from './sanitize';
import { fieldWriteGate, type FieldWritePrincipal } from './fieldWriteGate';

export function createKeepsField(
  objectSchema: { fields?: unknown } | null | undefined,
  objectName: string,
  fieldName: string,
  perms: FieldWritePrincipal | null | undefined,
): boolean {
  // The metadata API serves `fields` keyed by name or as an array of defs
  // carrying their own `name`; the form's filter reads the keyed shape.
  const raw = objectSchema?.fields;
  const fields = Array.isArray(raw)
    ? Object.fromEntries(
        raw
          .filter((f): f is { name: string } => typeof (f as { name?: unknown } | null)?.name === 'string')
          .map((f) => [f.name, f]),
      )
    : (raw as Record<string, any> | undefined);
  const payload = sanitizeFormData(
    { [fieldName]: true },
    fields && typeof fields === 'object' ? { fields } : null,
    { canEdit: fieldWriteGate(perms, objectName, 'create') },
  );
  return Object.prototype.hasOwnProperty.call(payload, fieldName);
}
