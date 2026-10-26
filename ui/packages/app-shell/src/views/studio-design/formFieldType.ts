/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * formFieldType — the studio form designer's producer-side normalization of an
 * object-metadata field type into the ONE legal `FormField.type` spelling.
 *
 * Its own module rather than a second export from `ObjectFormDesigner.tsx`:
 * that file exports components only, and hanging a plain function off it trips
 * `react-refresh/only-export-components` (fast refresh degrades to a full
 * reload for the whole designer). It also lets the next producer in this
 * folder reuse the normalization instead of copying it.
 */

import { mapFieldTypeToFormType } from '@object-ui/fields';

/**
 * Normalize an object-def field type into the ONE legal `FormField.type`
 * spelling — the namespaced widget id.
 *
 * Maintainer ruling 2026-08-19 (objectui#4838): a BARE spec-type name
 * (`markdown`, `html`, `richtext`) is **not** a legal `FormField.type`. This
 * canvas mirrors the real form, so the string it hands to FORM-vocabulary
 * helpers must be the one `ObjectForm` resolves for the same field, produced
 * by the one place that decision is made — `mapFieldTypeToFormType`. The
 * ruling fixes the PRODUCER: the tolerant `field:`-prefix fallback in
 * `renderFieldComponent` and the dual-spelling `WIDE_FIELD_TYPES` set are both
 * left exactly as they are, each retired under its own follow-up.
 *
 * Not merely hygiene — the two vocabularies had already drifted apart here.
 * `WIDE_FIELD_TYPES` carries the five bare names that happen to double as
 * widget ids, so a `repeater` (a spec `FieldType` that resolves to the WIDE
 * `field:grid` widget) matched nothing: the canvas laid a repeater out at
 * normal width while the runtime form spanned it full-row. Any future wide
 * widget whose spec name differs from its widget id falls in the same hole.
 *
 * Idempotent by explicit guard, never by luck: `mapFieldTypeToFormType` holds
 * no entry for an already-namespaced key, so its `|| 'field:text'` tail would
 * turn `field:markdown` into `field:text` — a silent downgrade to a plain text
 * input, a worse failure than the missing stamp this normalization fixes. An
 * already-namespaced spelling therefore passes through UNCHANGED; it is never
 * prefixed a second time into `field:field:markdown`.
 */
export function toFormFieldType(objectFieldType: string): string {
  return objectFieldType.startsWith('field:')
    ? objectFieldType
    : mapFieldTypeToFormType(objectFieldType);
}
