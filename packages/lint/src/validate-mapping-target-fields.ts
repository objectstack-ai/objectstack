// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20150] An import mapping's `fieldMapping[].target` must name a field of the
 * mapping's `targetObject` — the author-time half of the import door's refusal.
 *
 * ## The state this rule ends
 *
 * `ImportFieldMappingSchema.target` is declared as "Target object field(s)",
 * and nothing checked it: a mapping whose targets named no field of the object
 * passed `objectstack validate` at exit 0, its dry run answered `ok` for every
 * row, and its commit then failed every row with `INVALID_FIELD`. The import
 * door now refuses such a mapping before any row, on the dry run and the
 * commit alike; this rule reports the same target when the mapping is
 * written, so the author meets the refusal at `os validate` rather than at the
 * first import.
 *
 * ## A declared part of a compound field (#20149)
 *
 * A target may also name a declared PART of a compound field
 * (`mailing_address.street`); the import endpoint assembles the parts one row
 * maps into that field's one value. The shared verdict decides which fields
 * are compound and which parts they declare, from the field's value schema.
 * This rule reports what stays refused, and names the legal parts each time:
 * a part the value does not declare (`mailing_address.stret`), a dotted path
 * on a field with no parts (never a lookup traversal), and a part of a field
 * the same mapping also writes whole (the two would collide on one value).
 *
 * ## One verdict, two doors
 *
 * The verdict is not written here. It is `unknownImportMappingTargets`
 * (`@objectstack/spec/data`), the one place that decides what a target may
 * name, and the import door in `@objectstack/rest` calls the same function.
 * So the two doors cannot disagree about a name: in particular this rule never
 * refuses a platform-provisioned column (`id`, `owner_id`, `organization_id`,
 * the audit family) that the door, and the write behind it, accept.
 *
 * ## Severity: `error`
 *
 * A target that names no field is refused at the import door on every run, so
 * the mapping can import nothing. No reading of it behaves as written.
 *
 * ## Skips — the same shape as the package's other field-existence rules
 *
 *   1. A mapping whose `targetObject` this stack does not define. It may come
 *      from another package, and a stack-local miss is already refused by
 *      `defineStack`'s own cross-reference pass; judging its fields here would
 *      need a field map this stack cannot see.
 *   2. An object with no readable, non-empty field map (ADR-0015 `external`,
 *      introspected schemas). The shared verdict answers "no opinion" there.
 *
 * Fields an `objectExtensions[]` entry merges into the object (from this stack
 * or from a sibling package of the same artifact) ARE addressable at runtime,
 * because the registry merges every extension layer onto its target, so they
 * are folded into the object's field map before it is judged. Fields injected
 * imperatively by plugin code are not metadata and no static rule can see
 * them; the import door, which reads the registered object, still judges them.
 */

import {
  indexImportMappingTargets,
  REFERENCE_VALUE_TYPES,
  unknownImportMappingTargets,
  type ImportMappingTargetHead,
} from '@objectstack/spec/data';

import { listNames, recordsOf, suggestName } from './object-graph.js';

/**
 * A `fieldMapping[].target` the mapping cannot write on its object: it names no
 * field and no declared part of a compound field, or it names a part of a field
 * the same mapping also writes whole.
 */
export const MAPPING_TARGET_FIELD_UNKNOWN = 'mapping-target-field-unknown';

export interface MappingTargetFieldFinding {
  severity: 'error';
  rule: string;
  /** Human-readable location, e.g. `mapping "contact_import" · object "crm_contact"`. */
  where: string;
  /** Config path, e.g. `mappings[0].fieldMapping[3].target`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Target object name → the field records every `objectExtensions[]` entry
 * aimed at it contributes, read from the stack in hand and from each
 * `packages[].manifest` body (the per-package leg of `os build` sees a
 * sibling's extension only there).
 */
function extensionFieldsByTarget(stack: AnyRec): Map<string, AnyRec[]> {
  const byTarget = new Map<string, AnyRec[]>();
  const add = (extensions: unknown) => {
    for (const extension of recordsOf(extensions)) {
      const target = strName(extension.extend);
      if (!target) continue;
      const fields = recordsOf(extension.fields);
      if (fields.length === 0) continue;
      byTarget.set(target, [...(byTarget.get(target) ?? []), ...fields]);
    }
  };
  add(stack.objectExtensions);
  for (const entry of recordsOf(stack.packages)) {
    if (isRec(entry.manifest)) add(entry.manifest.objectExtensions);
  }
  return byTarget;
}

/**
 * Report every import-mapping target its mapping cannot write on its object:
 * one that names no field and no declared part of a compound field, and a
 * part of a field the same mapping also writes whole. Returns findings
 * (empty = clean).
 */
export function validateMappingTargetFields(stack: AnyRec): MappingTargetFieldFinding[] {
  const findings: MappingTargetFieldFinding[] = [];
  if (!isRec(stack)) return findings;
  const mappings = recordsOf(stack.mappings);
  if (mappings.length === 0) return findings;

  const objects = new Map<string, AnyRec>();
  for (const obj of recordsOf(stack.objects)) {
    const n = strName(obj.name);
    if (n) objects.set(n, obj);
  }
  const extensionFields = extensionFieldsByTarget(stack);

  for (let mi = 0; mi < mappings.length; mi++) {
    const mapping = mappings[mi];
    const objectName = strName(mapping.targetObject);
    if (!objectName) continue; // a missing targetObject is the schema's subject
    const declared = objects.get(objectName);
    if (!declared) continue; // skip 1
    const extra = extensionFields.get(objectName);
    const objectDef: AnyRec = extra
      ? { ...declared, fields: [...recordsOf(declared.fields), ...extra] }
      : declared;

    const misses = unknownImportMappingTargets(mapping.fieldMapping, objectDef);
    if (misses.length === 0) continue; // clean, or skip 2
    const index = indexImportMappingTargets(objectDef);
    const known = index?.names ?? new Set<string>();
    // The object's compound fields and their legal parts, which EVERY finding's
    // hint lists, a collision's included (ruling on #20149, item 3).
    const compoundParts = index && index.parts.size > 0
      ? [...index.parts].map(([field, parts]) => `${field}: ${parts.join(', ')}`).join('; ')
      : '';
    const mappingName = strName(mapping.name) ?? `#${mi}`;
    const where = `mapping "${mappingName}" · object "${objectName}"`;

    for (const miss of misses) {
      if (miss.reason === 'collides') {
        const dot = miss.target.indexOf('.');
        findings.push({
          severity: 'error',
          rule: MAPPING_TARGET_FIELD_UNKNOWN,
          where,
          path: `mappings[${mi}].${miss.path}`,
          message:
            `Import mapping "${mappingName}" writes the compound field "${miss.target.slice(0, dot)}" of object ` +
            `"${objectName}" both whole (${miss.wholeAt}) and by its part "${miss.target.slice(dot + 1)}" ` +
            `(${miss.path}). One row carries one value for a field, so the two collide, and the import endpoint ` +
            `refuses this mapping before any row, on the dry run and the commit alike (INVALID_FIELD).`,
          hint:
            'Map the field whole or by its parts, not both. A declared part of a compound field is ' +
            `written field.part (${compoundParts}).`,
        });
        continue;
      }
      findings.push({
        severity: 'error',
        rule: MAPPING_TARGET_FIELD_UNKNOWN,
        where,
        path: `mappings[${mi}].${miss.path}`,
        message:
          `Import mapping "${mappingName}" writes target "${miss.target}", which names no field of ` +
          `object "${objectName}". The import endpoint refuses this mapping before any row, on the dry ` +
          `run and the commit alike (INVALID_FIELD), so it can import nothing.` +
          (miss.head?.field ? dottedReason(miss.head, miss.target, objectName) : suggestName(miss.target, known)),
        hint:
          `Point the target at a field "${objectName}" declares, or at a column the platform provisions ` +
          `on it` +
          (compoundParts ? `, or at a declared part of a compound field as field.part (${compoundParts})` : '') +
          `. Addressable names: ${listNames(known)}.`,
      });
    }
  }
  return findings;
}

/**
 * Why a dotted target whose head names a field of the object is still no
 * target (#20149): its part is not one the field's value declares, or the
 * field has no parts at all.
 */
function dottedReason(head: ImportMappingTargetHead, target: string, objectName: string): string {
  const field = head.type ? `the ${head.type} field "${head.name}"` : `"${head.name}"`;
  if (head.parts) {
    const part = target.slice(head.name.length + 1);
    return (
      ` "${part}" is not a part of ${field}: the parts a target may name on it are ` +
      `${head.parts.join(', ')}.` + suggestName(part, head.parts)
    );
  }
  if (head.type && REFERENCE_VALUE_TYPES.has(head.type)) {
    return (
      ` ${capitalize(field)} is a field of "${objectName}" with no parts: a dotted target never ` +
      `traverses a reference. Map the column to "${head.name}" with transform "lookup", which resolves ` +
      `the cell's display text to a record id.`
    );
  }
  return (
    ` ${capitalize(field)} is a field of "${objectName}" with no parts: only a compound field ` +
    `(one whose value declares parts, such as an address) takes a part target.`
  );
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}
