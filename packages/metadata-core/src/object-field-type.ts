// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16319] The field-`type` admission vocabulary, shared by the registration
 * door that REFUSES and the boot seam that has to REPORT the refusal.
 *
 * MAINTAINER RULING, 2026-09-10 (director seat batch #111 item 2), verbatim:
 * 「16319 一个没写 type(或拼错)的字段 应该禁止加载。这个才是合理的吧?其他同意」
 *
 * Sunk here by the same criterion as everything else in this package's index:
 * the enforcing door is `@objectstack/objectql`'s `SchemaRegistry` and the
 * reporting seam is `@objectstack/metadata-protocol`'s `loadMetaFromDb`, and
 * objectql DEPENDS ON metadata-protocol — so the reverse import is a cycle
 * turbo refuses. Both sides already declare this package and it depends on
 * neither, so one predicate and one sentence serve both instead of the boot log
 * growing a second opinion about which declarations the registry will take.
 * That second opinion is the whole defect class this card closes.
 *
 * ⛔ What is NOT here: the ADR-0112 `code`. The refusal is thrown by objectql
 * and carries objectql's already-registered `INVALID_METADATA`; this package
 * registers no such code and must not start stamping one. The discriminator a
 * cross-package consumer compares is the error's `name`, exported below.
 */

import { FieldType } from '@objectstack/spec/data';
import { formatSuggestion, suggestFieldType } from '@objectstack/spec/shared';

/**
 * The `name` the registration-door refusal carries.
 *
 * ⛔ A cross-package consumer discriminates on this string, never on
 * `instanceof`: `@objectstack/objectql` declares both module realms in its own
 * `exports`, so a consumer holding the other realm's copy of a class gets
 * `instanceof === false`, silently (#14936, the reason the registry's three
 * conflict refusals took the `*_CODE`-compare route). `code` alone is not a
 * discriminator here — `INVALID_METADATA` is the shared spelling for "this
 * metadata body does not satisfy the spec", carried by several unrelated
 * refusals — so the NAME is what tells this one apart.
 */
export const OBJECT_FIELD_TYPE_REFUSED_ERROR_NAME = 'ObjectFieldTypeRefusedError' as const;

/** The closed `FieldType` vocabulary as a Set — READ from the spec enum, never transcribed, so a type added there is admitted here on the same commit. */
const DECLARABLE_FIELD_TYPES: ReadonlySet<string> = new Set<string>(FieldType.options);

/** [#16319] One field declaration the registration door will not admit. */
export interface ObjectFieldTypeViolation {
  /** The object whose declaration carries it. */
  readonly objectName: string;
  /** The field that carries the unusable `type`. */
  readonly fieldName: string;
  /** The `type` exactly as declared — `undefined` when the key is absent. */
  readonly declaredType: unknown;
}

/** [#16319] The structural face of the thrown refusal — what {@link isObjectFieldTypeRefused} narrows to. */
export interface ObjectFieldTypeRefusal extends Error, ObjectFieldTypeViolation {}

/**
 * [#16319] Is this field `type` one the platform can build a column for?
 *
 * The whole admission rule, in one place: a `type` must be present, a string,
 * and a member of the spec's own closed `FieldType` enum. `FieldSchema` has
 * always said exactly this (`type: FieldType`, non-optional); this is that same
 * statement asked of a declaration that never passed through Zod.
 */
export function isDeclarableFieldType(declared: unknown): declared is string {
  return typeof declared === 'string' && DECLARABLE_FIELD_TYPES.has(declared);
}

/**
 * [#16319] The FIRST field of `schema` whose `type` the platform cannot build a
 * column for, or `null` when every field declares a `FieldType` member.
 *
 * It reads the declaration AS SUPPLIED. The caller that enforces
 * (`SchemaRegistry.registerObject`) calls it before `applySystemFields`,
 * `materializeBaseLayer` and the search-companion provisioning add anything, so
 * the object and field it names are the author's own and never a platform
 * injection.
 *
 * ⚠️ The FIRST offending field, not all of them: the object does not load
 * either way, and one greppable line naming one field and one remedy is what an
 * operator acts on.
 *
 * Both shapes the unvalidated doors deliver are walked — the canonical record
 * keyed by field name, and the array form a hand-built manifest can still carry
 * (each element names itself). A field entry that is not an object at all is a
 * violation too, reported with `declaredType: undefined`.
 *
 * It judges EVERY contributor kind (`own` / `overlay` / `extend`) for one
 * reason: `ObjectSchema.fields` and `ObjectExtensionSchema.fields` are both
 * `z.record(z.string(), FieldSchema)`, so `type` is required on every layer and
 * an object extension is not a partial-field patch channel.
 */
export function findUndeclarableFieldType(schema: unknown): ObjectFieldTypeViolation | null {
  if (!schema || typeof schema !== 'object') return null;
  const fields = (schema as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object') return null;
  const objectName = String((schema as { name?: unknown }).name ?? '<unnamed>');
  const entries: Array<[string, unknown]> = Array.isArray(fields)
    ? (fields as unknown[]).map((f, i) => [
        String((f as { name?: unknown } | null | undefined)?.name ?? `[${i}]`),
        f,
      ])
    : Object.entries(fields as Record<string, unknown>);
  for (const [fieldName, def] of entries) {
    if (!def || typeof def !== 'object') {
      return { objectName, fieldName, declaredType: undefined };
    }
    const declaredType = (def as { type?: unknown }).type;
    if (!isDeclarableFieldType(declaredType)) {
      return { objectName, fieldName, declaredType };
    }
  }
  return null;
}

/**
 * [#16319] The ONE sentence both the throw and the boot log print.
 *
 * Written once here so the operator who meets the refusal at
 * `registerObject` and the operator who meets it in the startup log read the
 * same words about the same row, and so a later edit cannot move one of them.
 * It states the reason, why the WHOLE object is refused rather than the field
 * dropped, which door the declaration must have come through, and the fix.
 */
export function describeUndeclarableFieldType(violation: ObjectFieldTypeViolation): string {
  const { objectName, fieldName, declaredType } = violation;
  const absent = declaredType === undefined || declaredType === null || declaredType === '';
  const shown =
    typeof declaredType === 'string'
      ? `'${declaredType}'`
      : (JSON.stringify(declaredType) ?? String(declaredType));
  const reason = absent
    ? 'declares no `type`'
    : `declares \`type: ${shown}\`, which is not a member of \`FieldType\``;
  const hint =
    !absent && typeof declaredType === 'string'
      ? ` ${formatSuggestion(suggestFieldType(declaredType))}`.trimEnd()
      : '';
  return (
    `Object "${objectName}" is refused: its field "${fieldName}" ${reason}.${hint} ` +
    `The WHOLE object declaration is refused — the field is NOT dropped, because an object loaded ` +
    `one field short reports success at every authoring surface while the column is never created ` +
    `and every read of it answers undefined. \`FieldSchema\` requires \`type\` and admits only ` +
    `\`FieldType\` members, so this declaration reached the registry through a door that skips Zod ` +
    `(a stored \`sys_metadata\` row, a raw package/plugin manifest, or a direct \`registerObject\` ` +
    `call). Give the field a \`FieldType\` member, or remove the field.`
  );
}

/**
 * [#16319] Does this thrown value come from the registration-door field-`type`
 * refusal?
 *
 * ⛔ STRUCTURAL, never `instanceof` — see
 * {@link OBJECT_FIELD_TYPE_REFUSED_ERROR_NAME} for the realm split that makes
 * `instanceof` answer `false` silently across a package boundary.
 */
export function isObjectFieldTypeRefused(e: unknown): e is ObjectFieldTypeRefusal {
  return (
    !!e &&
    typeof e === 'object' &&
    (e as { name?: unknown }).name === OBJECT_FIELD_TYPE_REFUSED_ERROR_NAME &&
    typeof (e as { objectName?: unknown }).objectName === 'string' &&
    typeof (e as { fieldName?: unknown }).fieldName === 'string'
  );
}
