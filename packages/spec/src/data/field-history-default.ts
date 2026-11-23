// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether a changed field's old → new values show on the record activity
 * timeline (#36290, ruling 7076513167 point 1) — declared ONCE, here.
 *
 * # The fact
 *
 * Values show by default. An object turns them off for every field with
 * `enable.fieldHistory: false`; a field turns its own off with
 * `fieldHistory: false`. Two classes never show them, whatever the flags say
 * on the field's default: a credential field (masked on read, so both sides
 * are the same mask) never, and a type in {@link NO_LINE_VALUE_FIELD_TYPES}
 * only when the field opts in with `fieldHistory: true` or
 * `trackHistory: true`.
 *
 * # Why it lives in `spec`
 *
 * Two consumers ask the question. `@objectstack/plugin-audit` writes the
 * activity row and decides whether to keep the values; the metadata form
 * shows an author what an unset `fieldHistory` resolves to for the field in
 * front of them (#36482). Until #36482 the type list was a private set in the
 * audit writer, so a form could only copy it, and a type added to one copy
 * and not the other would be drawn as "on" while the writer kept it off. Same
 * reason, same home as {@link isMaskedOnReadFieldType}.
 */

import type { FieldType } from './field.zod';
import { isMaskedOnReadFieldType } from './masked-field-types';

/**
 * The field types whose value has no one-line text — media, embedded
 * structured values, vectors, a signature. A change to one is named by the
 * field's label only, unless the field itself turns values on
 * (`fieldHistory: true`, or the older `trackHistory: true` opt-in).
 */
export const NO_LINE_VALUE_FIELD_TYPES: readonly FieldType[] = Object.freeze([
  'image', 'file', 'avatar', 'video', 'audio', 'signature',
  'composite', 'repeater', 'record', 'location', 'address', 'code', 'json', 'vector',
] as const satisfies readonly FieldType[]);

const NO_LINE_VALUE_FIELD_TYPE_SET: ReadonlySet<unknown> = new Set(NO_LINE_VALUE_FIELD_TYPES);

/** The field keys {@link fieldChangeValuesShown} reads. */
export interface FieldChangeValuesField {
  readonly type?: unknown;
  readonly fieldHistory?: unknown;
  readonly trackHistory?: unknown;
}

/** The object keys {@link fieldChangeValuesShown} reads. */
export interface FieldChangeValuesObject {
  readonly managedBy?: unknown;
  readonly enable?: { readonly fieldHistory?: unknown } | null;
}

/**
 * Whether a change to `field` on `object` shows its old → new values on the
 * activity timeline. Total over its inputs, because consumers call it on
 * stored, unvalidated metadata: only a literal `false` turns values off and
 * only a literal `true` opts in.
 *
 * `object` may be `undefined` where the caller has no object in hand (a
 * single field's form): the answer is then the field's own, as on an object
 * that neither turns values off nor declares a `managedBy`.
 *
 * To ask what an UNSET `fieldHistory` resolves to — the default the form
 * shows — pass the field with `fieldHistory` removed.
 */
export function fieldChangeValuesShown(
  field: FieldChangeValuesField | undefined | null,
  object: FieldChangeValuesObject | undefined | null,
): boolean {
  if (object?.enable?.fieldHistory === false) return false;
  if (!field || field.fieldHistory === false) return false;
  if (isMaskedOnReadFieldType(field.type, object?.managedBy)) return false;
  if (field.fieldHistory === true || field.trackHistory === true) return true;
  return !NO_LINE_VALUE_FIELD_TYPE_SET.has(field.type);
}
