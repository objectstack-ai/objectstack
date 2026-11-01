// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10, second rule] The TARGET CHECK of an object extension's
 * `fieldPatches`: does the object it extends have every field it patches, and
 * every option value it patches under `options`?
 *
 * The slot's SHAPE is the spec's (`ObjectExtensionSchema.fieldPatches`, keys
 * derived from `BASE_FIELD_DISPLAY_WHITELIST`); whether the names it uses exist
 * is a question about the target, so it is answered where the target is known.
 * One judge, three readers:
 *
 *  - the marketplace install door (`POST /api/v1/marketplace/install-local`)
 *    REFUSES a package whose patch names what its installed target lacks —
 *    ADR-0141 D2 admitted the base first, so the target is in the registry;
 *  - `os validate` REFUSES the same patch when the target is in the composed
 *    stack;
 *  - the registry fold (`@objectstack/objectql`, `SchemaRegistry`) does not
 *    apply such a patch and NAMES it once in the log. ⛔ Never a boot refusal:
 *    a boot is still filling the registry when the fold first runs (AGENTS.md
 *    *Startup registry reads*), and the patch applies the moment the field
 *    arrives.
 *
 * A patch that names a field the target does not have would otherwise change
 * nothing, and say nothing: the author reads "Sector" in their package and the
 * screen keeps "Industry".
 *
 * Pure: reads plain bodies and returns findings, so each reader decides what a
 * finding means at its door.
 */

/** One name a field patch uses that its target object does not have. */
export interface FieldPatchTargetMiss {
  /** The extended object, as the extension names it (`extend`). */
  object: string;
  /** The patched field — the key under `fieldPatches`. */
  field: string;
  /** The patched option's stored value — the key under the patch's `options` — when the miss is an option. */
  option?: string;
  /**
   * What is missing: `field` (no such field), `option` (no option with that
   * stored value), or `picklist-option` (the field takes its options from a
   * picklist, which no field patch reaches).
   */
  reason: 'field' | 'option' | 'picklist-option';
  /** The sentence an author is shown: what is missing, and what to write instead. */
  message: string;
}

/** A {@link FieldPatchTargetMiss} located in the manifest that declares it. */
export interface FieldPatchTargetRefusal extends FieldPatchTargetMiss {
  /** Where the patch sits, e.g. `objectExtensions[0].fieldPatches.industry.options.tech`. */
  path: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** A field of an object body, by name — a name-keyed record or a `name`-bearing array, the two spellings a body carries. */
function fieldOf(target: unknown, name: string): Record<string, unknown> | undefined {
  if (!isRecord(target)) return undefined;
  const fields = target.fields;
  if (Array.isArray(fields)) {
    const found = fields.find((f) => isRecord(f) && f.name === name);
    return isRecord(found) ? found : undefined;
  }
  if (!isRecord(fields) || !Object.prototype.hasOwnProperty.call(fields, name)) return undefined;
  const field = fields[name];
  return isRecord(field) ? field : undefined;
}

/** The stored values of a field's own `options`, in order. */
function optionValuesOf(field: Record<string, unknown>): string[] {
  const options = field.options;
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => (isRecord(o) ? o.value : undefined))
    .filter((v): v is string => typeof v === 'string');
}

/**
 * Every name `fieldPatches` uses that `target` does not have. `[]` when the
 * patch is absent, malformed (the schema's parse reports that), or fully
 * matched.
 *
 * `target` is the extended object's OWN declaration as the reader sees it —
 * a patch reaches the owner's own fields only, never one an extension adds:
 * the registry's owner declaration at the install door, the owner's fields as
 * the fold has merged them in the fold, the composed stack's declaration at
 * `os validate`.
 */
export function fieldPatchTargetMisses(object: string, fieldPatches: unknown, target: unknown): FieldPatchTargetMiss[] {
  if (!isRecord(fieldPatches)) return [];
  const misses: FieldPatchTargetMiss[] = [];
  for (const [fieldName, patch] of Object.entries(fieldPatches)) {
    const field = fieldOf(target, fieldName);
    if (!field) {
      misses.push({
        object,
        field: fieldName,
        reason: 'field',
        message:
          `\`fieldPatches.${fieldName}\` names a field object \`${object}\` does not have, so the patch would ` +
          `change nothing. A field patch changes the display of one of the extended object's own fields: ` +
          `use the name of a field \`${object}\` declares, or declare a field of your own in \`fields\`.`,
      });
      continue;
    }
    const options = isRecord(patch) ? patch.options : undefined;
    if (!isRecord(options)) continue;
    const picklist = typeof field.picklist === 'string' && field.picklist !== '' ? field.picklist : undefined;
    const values = optionValuesOf(field);
    for (const value of Object.keys(options)) {
      if (picklist !== undefined) {
        misses.push({
          object,
          field: fieldName,
          option: value,
          reason: 'picklist-option',
          message:
            `\`fieldPatches.${fieldName}.options.${value}\` patches an option of \`${object}.${fieldName}\`, ` +
            `which takes its options from the picklist \`${picklist}\`: the option labels are the picklist's, ` +
            `and a field patch never reaches them. Remove \`options\` from this patch.`,
        });
        continue;
      }
      if (values.includes(value)) continue;
      misses.push({
        object,
        field: fieldName,
        option: value,
        reason: 'option',
        message:
          `\`fieldPatches.${fieldName}.options.${value}\` names an option \`${object}.${fieldName}\` does not ` +
          `have: an option is addressed by its stored \`value\`, and this field's are ` +
          `${values.length > 0 ? values.map((v) => `\`${v}\``).join(', ') : 'none'}. ` +
          'Which options exist stays the vendor\'s, so a patch can only relabel one of them.',
      });
    }
  }
  return misses;
}

/**
 * Every patch in a manifest's `objectExtensions` that names what its target
 * lacks, located. An entry whose target `getTarget` does not know is not
 * judged: at the install door that target is ADR-0141 D2's to answer, and at
 * `os validate` a target outside the composed stack is judged at install.
 *
 * `pathPrefix` locates the entries for a multi-package artifact
 * (`packages[1].manifest.`); empty for a single stack.
 */
export function fieldPatchTargetRefusals(
  objectExtensions: unknown,
  getTarget: (name: string) => unknown,
  pathPrefix = '',
): FieldPatchTargetRefusal[] {
  if (!Array.isArray(objectExtensions)) return [];
  const refusals: FieldPatchTargetRefusal[] = [];
  objectExtensions.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.extend !== 'string' || !isRecord(entry.fieldPatches)) return;
    const target = getTarget(entry.extend);
    if (target === undefined || target === null) return;
    for (const miss of fieldPatchTargetMisses(entry.extend, entry.fieldPatches, target)) {
      const at = `${pathPrefix}objectExtensions[${index}].fieldPatches.${miss.field}`;
      refusals.push({ ...miss, path: miss.option === undefined ? at : `${at}.options.${miss.option}` });
    }
  });
  return refusals;
}

/**
 * The install door's refusal sentence for a non-empty
 * {@link fieldPatchTargetRefusals} answer: how many, the first one whole, and
 * that nothing was installed. Every refusal is listed in the answer's
 * `details.refusals`.
 */
export function fieldPatchTargetRefusalMessage(packageId: string, refusals: readonly FieldPatchTargetRefusal[]): string {
  const n = refusals.length;
  return (
    `Package '${packageId}' cannot be installed: ${n} field patch${n > 1 ? 'es name' : ' names'} a field or option ` +
    `the extended object does not have (ADR-0146 D10). ${refusals[0]?.path}: ${refusals[0]?.message}` +
    (n > 1 ? ` (${n - 1} more in \`details.refusals\`.)` : '') +
    ' Nothing was installed or written.'
  );
}
